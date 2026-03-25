import crypto from 'crypto';
import { gunzipSync, gzipSync } from 'zlib';
import { jsonResponse, parseJsonBody, unauthorized } from '../utils/http.js';
import { getUserIdFromRequest } from '../utils/auth.js';
import { buildRateLimitKey, checkRateLimit } from '../utils/rateLimit.js';
import { projectFilesRepo, projectsRepo } from '../services/repositories.js';
import { storage } from '../services/storage.js';
import { decryptAES, encryptAES } from '../utils/crypto.js';
import { nowIso, randomId } from '../utils/common.js';
import { getWorkspaceAccess, hasPermission, resolveWorkspace } from '../utils/workspace.js';
import { detectLanguage, getProjectAccess } from './projectController.js';
import { broadcastWorkspaceEvent } from '../utils/realtime.js';

function compressContent(content) {
  return gzipSync(Buffer.from(content, 'utf-8')).toString('base64');
}

function decompressContent(content) {
  try {
    return gunzipSync(Buffer.from(content, 'base64')).toString('utf-8');
  } catch {
    return content;
  }
}

async function getWorkspace(projectId) {
  const project = await projectsRepo.getById(String(projectId));
  return project ? await resolveWorkspace(String(project.workspace_id)) : null;
}

export async function resolveFileContent(file, workspaceId) {
  if (!file?.content) return '';
  if (!String(file.content).startsWith('r2:')) return String(file.content);
  const object = await storage.get(String(file.content).slice(3));
  if (!object) return '# Error: Content not found';
  let raw = await object.text();
  const workspace = await resolveWorkspace(String(workspaceId));
  if (workspace?.encryption_key && Number(file.is_encrypted)) {
    try { raw = decryptAES(raw, workspace.encryption_key); } catch {}
  }
  return decompressContent(raw);
}

async function storeFileContent(project, workspaceId, plaintext, existingRef = null) {
  const compressed = compressContent(plaintext);
  const workspace = await resolveWorkspace(String(workspaceId));
  let body = compressed;
  let isEncrypted = 0;
  if (workspace?.encryption_key) {
    body = encryptAES(compressed, workspace.encryption_key);
    isEncrypted = 1;
  }
  const key = existingRef && String(existingRef).startsWith('r2:')
    ? String(existingRef).slice(3)
    : `${project.secret_key}_f${Date.now()}_${crypto.randomBytes(4).toString('hex')}.gz`;
  await storage.put(key, body);
  return { contentRef: `r2:${key}`, isEncrypted, size: Buffer.byteLength(plaintext, 'utf-8') };
}

function buildTree(files) {
  const map = new Map();
  const roots = [];
  for (const file of files) map.set(String(file.id), { ...file, children: [] });
  for (const file of files) {
    const node = map.get(String(file.id));
    if (file.parent_id && map.has(String(file.parent_id))) map.get(String(file.parent_id)).children.push(node);
    else roots.push(node);
  }
  return roots;
}

async function collectDescendants(projectId, parentId, bucket) {
  const files = await projectFilesRepo.listByProject(String(projectId));
  for (const file of files.filter((item) => String(item.parent_id || '') === String(parentId))) {
    bucket.push(file);
    if (file.type === 'folder') await collectDescendants(projectId, file.id, bucket);
  }
}

function getPathMap(files) {
  const byId = new Map(files.map((file) => [String(file.id), file]));
  const getPath = (file) => {
    if (!file.parent_id) return file.name;
    const parent = byId.get(String(file.parent_id));
    return parent ? `${getPath(parent)}/${file.name}` : file.name;
  };
  return { byId, getPath };
}

function normalizeParentId(value) {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  return String(value);
}

export async function getFileTree(request, projectIdentifier) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const access = await getProjectAccess(projectIdentifier, userId);
  if (!access) return jsonResponse(404, { success: false, error: 'Project not found or access denied' });
  if (!hasPermission(access.access.role, 'view')) return jsonResponse(403, { success: false, error: 'Access denied' });
  const files = await projectFilesRepo.listByProject(String(access.project.id));
  return jsonResponse(200, { success: true, files });
}

export async function getFileContent(request, projectIdentifier, fileId) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const access = await getProjectAccess(projectIdentifier, userId);
  if (!access) return jsonResponse(404, { success: false, error: 'Project not found or access denied' });
  if (!hasPermission(access.access.role, 'view')) return jsonResponse(403, { success: false, error: 'Access denied' });
  const file = await projectFilesRepo.getById(String(fileId));
  if (!file || String(file.project_id) !== String(access.project.id)) return jsonResponse(404, { success: false, error: 'File not found' });
  if (file.type === 'folder') return jsonResponse(400, { success: false, error: 'Cannot get content of a folder' });
  const content = await resolveFileContent(file, access.workspaceId);
  if (String(request.query.download || '') === 'true') {
    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename="${file.name}"`
      },
      body: content
    };
  }
  return jsonResponse(200, { success: true, file: { id: file.id, name: file.name, language: file.language, content, updated_at: file.updated_at } });
}

export async function createFile(request, projectIdentifier) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const rateLimit = await checkRateLimit(buildRateLimitKey('create_file', request, userId), 60, 30);
  if (!rateLimit.allowed) return jsonResponse(429, { success: false, error: 'Rate limited' }, { 'retry-after': String(rateLimit.retryAfterSeconds) });
  const access = await getProjectAccess(projectIdentifier, userId);
  if (!access) return jsonResponse(404, { success: false, error: 'Project not found or access denied' });
  if (!hasPermission(access.access.role, 'edit')) return jsonResponse(403, { success: false, error: 'Access denied' });

  const payload = parseJsonBody(request);
  if (!payload?.name || !payload?.type) return jsonResponse(400, { success: false, error: 'Name and type required' });
  if (!['file', 'folder'].includes(String(payload.type))) return jsonResponse(400, { success: false, error: 'Type must be file or folder' });

  const files = await projectFilesRepo.listByProject(String(access.project.id));
  const parentId = normalizeParentId(payload.parent_id);
  if (parentId) {
    const parent = files.find((item) => String(item.id) === parentId);
    if (!parent || parent.type !== 'folder') return jsonResponse(400, { success: false, error: 'Invalid parent folder' });
  }
  if (files.find((item) => String(item.parent_id || '') === String(parentId || '') && item.name === payload.name)) {
    return jsonResponse(400, { success: false, error: 'A file or folder with this name already exists' });
  }

  let contentRef = null;
  let isEncrypted = 0;
  let size = 0;
  let language = null;
  if (payload.type === 'file') {
    const stored = await storeFileContent(access.project, access.workspaceId, String(payload.content || ''));
    contentRef = stored.contentRef;
    isEncrypted = stored.isEncrypted;
    size = stored.size;
    language = detectLanguage(payload.name);
  }

  const file = await projectFilesRepo.create({
    id: randomId(),
    project_id: access.project.id,
    parent_id: parentId,
    name: String(payload.name),
    type: String(payload.type),
    content: contentRef,
    is_encrypted: isEncrypted,
    size,
    language,
    sort_order: 0,
    is_entry_point: 0,
    created_at: nowIso(),
    updated_at: nowIso()
  });
  await broadcastWorkspaceEvent(access.workspaceId, 'PROJECT_FILE_UPDATE', {
    action: 'create',
    projectId: access.project.id,
    file: {
      id: file.id,
      name: file.name,
      type: file.type,
      parent_id: file.parent_id
    }
  });
  return jsonResponse(200, { success: true, file });
}

export async function updateFileContent(request, projectIdentifier, fileId) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const rateLimit = await checkRateLimit(buildRateLimitKey('update_file', request, userId), 60, 60);
  if (!rateLimit.allowed) return jsonResponse(429, { success: false, error: 'Rate limited' }, { 'retry-after': String(rateLimit.retryAfterSeconds) });
  const access = await getProjectAccess(projectIdentifier, userId);
  if (!access) return jsonResponse(404, { success: false, error: 'Project not found or access denied' });
  if (!hasPermission(access.access.role, 'edit')) return jsonResponse(403, { success: false, error: 'Access denied' });
  const payload = parseJsonBody(request);
  if (!payload || payload.content === undefined) return jsonResponse(400, { success: false, error: 'Content required' });
  const file = await projectFilesRepo.getById(String(fileId));
  if (!file || String(file.project_id) !== String(access.project.id) || file.type === 'folder') return jsonResponse(404, { success: false, error: 'File not found' });
  const stored = await storeFileContent(access.project, access.workspaceId, String(payload.content), file.content);
  const updatedAt = nowIso();
  await projectFilesRepo.update(String(file.id), {
    content: stored.contentRef,
    is_encrypted: stored.isEncrypted,
    size: stored.size,
    updated_at: updatedAt
  });
  await broadcastWorkspaceEvent(access.workspaceId, 'PROJECT_FILE_UPDATE', {
    action: 'update',
    projectId: access.project.id,
    fileId: file.id,
    size: stored.size
  });
  return jsonResponse(200, { success: true, size: stored.size, updated_at: updatedAt });
}

export async function renameFile(request, projectIdentifier, fileId) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const access = await getProjectAccess(projectIdentifier, userId);
  if (!access) return jsonResponse(404, { success: false, error: 'Project not found or access denied' });
  if (!hasPermission(access.access.role, 'edit')) return jsonResponse(403, { success: false, error: 'Access denied' });
  const payload = parseJsonBody(request);
  if (!payload?.name) return jsonResponse(400, { success: false, error: 'Name required' });
  const file = await projectFilesRepo.getById(String(fileId));
  if (!file || String(file.project_id) !== String(access.project.id)) return jsonResponse(404, { success: false, error: 'File not found' });
  const files = await projectFilesRepo.listByProject(String(access.project.id));
  if (files.find((item) => String(item.id) !== String(file.id) && String(item.parent_id || '') === String(file.parent_id || '') && item.name === payload.name)) {
    return jsonResponse(400, { success: false, error: 'A file or folder with this name already exists' });
  }
  await projectFilesRepo.update(String(file.id), { name: String(payload.name), language: file.type === 'file' ? detectLanguage(payload.name) : file.language, updated_at: nowIso() });
  await broadcastWorkspaceEvent(access.workspaceId, 'PROJECT_FILE_UPDATE', {
    action: 'rename',
    projectId: access.project.id,
    fileId: file.id,
    name: String(payload.name)
  });
  return jsonResponse(200, { success: true });
}

export async function moveFile(request, projectIdentifier, fileId) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const access = await getProjectAccess(projectIdentifier, userId);
  if (!access) return jsonResponse(404, { success: false, error: 'Project not found or access denied' });
  if (!hasPermission(access.access.role, 'edit')) return jsonResponse(403, { success: false, error: 'Access denied' });
  const payload = parseJsonBody(request) || {};
  const file = await projectFilesRepo.getById(String(fileId));
  if (!file || String(file.project_id) !== String(access.project.id)) return jsonResponse(404, { success: false, error: 'File not found' });
  const targetParentId = normalizeParentId(payload.parent_id);
  const files = await projectFilesRepo.listByProject(String(access.project.id));
  if (targetParentId) {
    const parent = files.find((item) => String(item.id) === String(targetParentId));
    if (!parent || parent.type !== 'folder') return jsonResponse(400, { success: false, error: 'Invalid parent folder' });
    if (String(parent.id) === String(file.id)) return jsonResponse(400, { success: false, error: 'Cannot move into itself' });
  }
  if (files.find((item) => String(item.id) !== String(file.id) && String(item.parent_id || '') === String(targetParentId || '') && item.name === file.name)) {
    return jsonResponse(400, { success: false, error: 'A file or folder with this name already exists in the target' });
  }
  await projectFilesRepo.update(String(file.id), { parent_id: targetParentId, updated_at: nowIso() });
  await broadcastWorkspaceEvent(access.workspaceId, 'PROJECT_FILE_UPDATE', {
    action: 'move',
    projectId: access.project.id,
    fileId: file.id,
    parent_id: targetParentId || null
  });
  return jsonResponse(200, { success: true });
}

export async function deleteFile(request, projectIdentifier, fileId) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const access = await getProjectAccess(projectIdentifier, userId);
  if (!access) return jsonResponse(404, { success: false, error: 'Project not found or access denied' });
  if (!hasPermission(access.access.role, 'edit')) return jsonResponse(403, { success: false, error: 'Access denied' });
  const file = await projectFilesRepo.getById(String(fileId));
  if (!file || String(file.project_id) !== String(access.project.id)) return jsonResponse(404, { success: false, error: 'File not found' });

  const toDelete = [file];
  if (file.type === 'folder') await collectDescendants(access.project.id, file.id, toDelete);
  for (const item of toDelete) {
    if (item.content && String(item.content).startsWith('r2:')) {
      try { await storage.delete(String(item.content).slice(3)); } catch {}
    }
    await projectFilesRepo.delete(String(item.id));
  }
  await broadcastWorkspaceEvent(access.workspaceId, 'PROJECT_FILE_UPDATE', {
    action: 'delete',
    projectId: access.project.id,
    fileId: file.id,
    deleted: toDelete.map((item) => String(item.id))
  });
  return jsonResponse(200, { success: true });
}

export async function uploadFile(request, projectIdentifier) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const access = await getProjectAccess(projectIdentifier, userId);
  if (!access) return jsonResponse(404, { success: false, error: 'Project not found or access denied' });
  if (!hasPermission(access.access.role, 'edit')) return jsonResponse(403, { success: false, error: 'Access denied' });
  const payload = parseJsonBody(request);
  if (!payload?.files || !Array.isArray(payload.files)) return jsonResponse(400, { success: false, error: 'Files array required' });
  const parentId = normalizeParentId(payload.parent_id);

  const created = [];
  for (const item of payload.files) {
    if (!item?.name) continue;
    const content = item.encoding === 'base64' || item.is_base64
      ? Buffer.from(String(item.content || ''), 'base64').toString('utf-8')
      : String(item.content || '');
    const stored = await storeFileContent(access.project, access.workspaceId, content);
    const file = await projectFilesRepo.create({
      id: randomId(),
      project_id: access.project.id,
      parent_id: parentId,
      name: String(item.name),
      type: 'file',
      content: stored.contentRef,
      is_encrypted: stored.isEncrypted,
      size: stored.size,
      language: detectLanguage(item.name),
      sort_order: 0,
      is_entry_point: 0,
      created_at: nowIso(),
      updated_at: nowIso()
    });
    created.push({ id: file.id, name: file.name, size: file.size, language: file.language });
  }
  await broadcastWorkspaceEvent(access.workspaceId, 'PROJECT_FILE_UPDATE', {
    action: 'bulk_create',
    projectId: access.project.id,
    count: created.length
  });
  return jsonResponse(200, { success: true, files: created });
}

export async function searchFiles(request, projectIdentifier) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const access = await getProjectAccess(projectIdentifier, userId);
  if (!access) return jsonResponse(404, { success: false, error: 'Project not found or access denied' });
  if (!hasPermission(access.access.role, 'view')) return jsonResponse(403, { success: false, error: 'Access denied' });
  const payload = parseJsonBody(request);
  if (!payload?.query) return jsonResponse(400, { success: false, error: 'Query required' });

  const queryText = String(payload.query);
  const useRegex = payload.regex === true;
  const files = (await projectFilesRepo.listByProject(String(access.project.id))).filter((item) => item.type === 'file');
  const results = [];

  for (const file of files) {
    const content = await resolveFileContent(file, access.workspaceId);
    const lines = String(content).split('\n');
    const matches = [];
    for (let index = 0; index < lines.length; index += 1) {
      let matched = false;
      if (useRegex) {
        try { matched = new RegExp(queryText, 'i').test(lines[index]); } catch { matched = false; }
      } else {
        matched = lines[index].toLowerCase().includes(queryText.toLowerCase());
      }
      if (matched) {
        matches.push({
          line: index + 1,
          content: lines[index].slice(0, 200),
          context_before: index > 0 ? lines[index - 1].slice(0, 200) : null,
          context_after: index < lines.length - 1 ? lines[index + 1].slice(0, 200) : null
        });
      }
    }
    if (matches.length) results.push({ fileId: file.id, name: file.name, parent_id: file.parent_id, matches });
  }

  return jsonResponse(200, { success: true, results, total: results.reduce((sum, item) => sum + item.matches.length, 0) });
}

export async function copyFile(request, projectIdentifier, fileId) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const access = await getProjectAccess(projectIdentifier, userId);
  if (!access) return jsonResponse(404, { success: false, error: 'Project not found or access denied' });
  if (!hasPermission(access.access.role, 'edit')) return jsonResponse(403, { success: false, error: 'Access denied' });
  const file = await projectFilesRepo.getById(String(fileId));
  if (!file || String(file.project_id) !== String(access.project.id)) return jsonResponse(404, { success: false, error: 'File not found' });
  const payload = parseJsonBody(request) || {};
  const newName = String(payload.name || `${file.name} (copy)`);

  async function duplicateNode(node, parentId, nameOverride = null) {
    if (node.type === 'file') {
      const content = await resolveFileContent(node, access.workspaceId);
      const stored = await storeFileContent(access.project, access.workspaceId, content);
      return await projectFilesRepo.create({
        id: randomId(),
        project_id: access.project.id,
        parent_id: normalizeParentId(parentId),
        name: nameOverride || node.name,
        type: 'file',
        content: stored.contentRef,
        is_encrypted: stored.isEncrypted,
        size: stored.size,
        language: node.language,
        sort_order: 0,
        is_entry_point: 0,
        created_at: nowIso(),
        updated_at: nowIso()
      });
    }

    const folder = await projectFilesRepo.create({
      id: randomId(),
      project_id: access.project.id,
      parent_id: normalizeParentId(parentId),
      name: nameOverride || node.name,
      type: 'folder',
      content: null,
      is_encrypted: 0,
      size: 0,
      language: null,
      sort_order: 0,
      is_entry_point: 0,
      created_at: nowIso(),
      updated_at: nowIso()
    });
    const children = (await projectFilesRepo.listByProject(String(access.project.id))).filter((item) => String(item.parent_id || '') === String(node.id));
    for (const child of children) await duplicateNode(child, folder.id);
    return folder;
  }

  const copied = await duplicateNode(file, normalizeParentId(file.parent_id), newName);
  await broadcastWorkspaceEvent(access.workspaceId, 'PROJECT_FILE_UPDATE', {
    action: 'copy',
    projectId: access.project.id,
    fileId: file.id,
    copiedId: copied.id
  });
  return jsonResponse(200, { success: true, file: { id: copied.id, name: copied.name } });
}

export async function setEntryPoint(request, projectIdentifier, fileId) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const access = await getProjectAccess(projectIdentifier, userId);
  if (!access) return jsonResponse(404, { success: false, error: 'Project not found or access denied' });
  if (!hasPermission(access.access.role, 'edit')) return jsonResponse(403, { success: false, error: 'Access denied' });
  const target = await projectFilesRepo.getById(String(fileId));
  if (!target || String(target.project_id) !== String(access.project.id) || target.type === 'folder') return jsonResponse(404, { success: false, error: 'File not found' });
  for (const file of await projectFilesRepo.listByProject(String(access.project.id))) {
    if (file.type === 'file' && Number(file.is_entry_point) === 1) await projectFilesRepo.update(String(file.id), { is_entry_point: 0, updated_at: nowIso() });
  }
  await projectFilesRepo.update(String(target.id), { is_entry_point: 1, updated_at: nowIso() });
  await broadcastWorkspaceEvent(access.workspaceId, 'PROJECT_FILE_UPDATE', {
    action: 'entry_point',
    projectId: access.project.id,
    fileId: target.id
  });
  return jsonResponse(200, { success: true });
}

export async function batchOperation(request, projectIdentifier) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const access = await getProjectAccess(projectIdentifier, userId);
  if (!access) return jsonResponse(404, { success: false, error: 'Project not found or access denied' });
  if (!hasPermission(access.access.role, 'edit')) return jsonResponse(403, { success: false, error: 'Access denied' });
  const payload = parseJsonBody(request);
  if (!payload?.action || !Array.isArray(payload.file_ids)) return jsonResponse(400, { success: false, error: 'Action and file_ids required' });

  if (payload.action === 'delete') {
    let deleted = 0;
    for (const id of payload.file_ids) {
      const response = await deleteFile(request, access.project.id, id);
      if (response.statusCode === 200) deleted += 1;
    }
    await broadcastWorkspaceEvent(access.workspaceId, 'PROJECT_FILE_UPDATE', {
      action: 'bulk_delete',
      projectId: access.project.id,
      count: deleted
    });
    return jsonResponse(200, { success: true, deleted });
  }

  if (payload.action === 'move') {
    let moved = 0;
    const movePayload = {};
    const normalizedTargetParentId = normalizeParentId(payload.target_parent_id);
    if (normalizedTargetParentId) movePayload.parent_id = normalizedTargetParentId;
    for (const id of payload.file_ids) {
      const response = await moveFile({ ...request, body: JSON.stringify(movePayload) }, access.project.id, id);
      if (response.statusCode === 200) moved += 1;
    }
    await broadcastWorkspaceEvent(access.workspaceId, 'PROJECT_FILE_UPDATE', {
      action: 'bulk_move',
      projectId: access.project.id,
      count: moved
    });
    return jsonResponse(200, { success: true, moved });
  }

  return jsonResponse(400, { success: false, error: 'Invalid action' });
}

export function generatePyBundle(fileContents, entryPath) {
  let modules = '';
  let entryCode = '';
  const packagePaths = new Set();
  for (const [path, content] of Object.entries(fileContents)) {
    const escaped = String(content).replace(/\\/g, '\\\\').replace(/'''/g, "\\'\\'\\'");
    if (path === entryPath) entryCode = escaped;
    else {
      const moduleName = path.replace(/\.\w+$/, '').replace(/\/__init__$/, '');
      modules += `_MODULES[${JSON.stringify(moduleName)}] = '''${escaped}'''\n`;
      const parts = moduleName.split('/');
      for (let index = 1; index < parts.length; index += 1) packagePaths.add(parts.slice(0, index).join('/'));
    }
  }
  for (const pkg of packagePaths) modules += `_MODULES.setdefault(${JSON.stringify(pkg)}, '')\n`;
  return `# Auto-generated bundle by code_protector_aws\nimport sys\nimport importlib.abc\nimport importlib.machinery\n_MODULES = {}\n${modules}\nclass _BundleLoader(importlib.abc.Loader):\n    def __init__(self, key):\n        self._key = key\n    def create_module(self, spec):\n        return None\n    def exec_module(self, module):\n        code = _MODULES.get(self._key, '')\n        if code:\n            module.__file__ = '<bundled:{}>'.format(self._key)\n            exec(compile(code, module.__file__, 'exec'), module.__dict__)\nclass _BundleFinder(importlib.abc.MetaPathFinder):\n    def find_spec(self, fullname, path, target=None):\n        key = fullname.replace('.', '/')\n        if key in _MODULES:\n            is_pkg = any(name.startswith(key + '/') for name in _MODULES)\n            spec = importlib.machinery.ModuleSpec(fullname, _BundleLoader(key), is_package=is_pkg)\n            if is_pkg:\n                spec.submodule_search_locations = [key]\n            return spec\n        return None\nsys.meta_path.insert(0, _BundleFinder())\nexec(compile('''${entryCode}''', '<entry>', 'exec'))\n`;
}

export function generateJsBundle(fileContents, entryPath) {
  let modules = '';
  let entryCode = '';
  for (const [path, content] of Object.entries(fileContents)) {
    const escaped = String(content).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    if (path === entryPath) entryCode = escaped;
    else {
      const moduleName = path.replace(/\.\w+$/, '');
      modules += `  _MODULES[${JSON.stringify(moduleName)}] = function(module, exports, require) {\n${escaped.split('\n').map((line) => `    ${line}`).join('\n')}\n  };\n`;
    }
  }
  return `// Auto-generated bundle by code_protector_aws\n(function() {\n  const _MODULES = {};\n${modules}  const _CACHE = {};\n  const _nativeRequire = typeof require !== 'undefined' ? require : null;\n  function _require(name) {\n    const normalized = name.replace(/^\\.\\//, '').replace(/\\.js$/, '');\n    if (_CACHE[normalized]) return _CACHE[normalized].exports;\n    if (!_MODULES[normalized]) {\n      if (_nativeRequire) return _nativeRequire(name);\n      throw new Error('Module not found: ' + name);\n    }\n    const module = { exports: {} };\n    _CACHE[normalized] = module;\n    _MODULES[normalized](module, module.exports, _require);\n    return module.exports;\n  }\n  (function(require) {\n${entryCode.split('\n').map((line) => `    ${line}`).join('\n')}\n  })(_require);\n})();\n`;
}

export async function generateBundle(request, projectIdentifier) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const access = await getProjectAccess(projectIdentifier, userId);
  if (!access) return jsonResponse(404, { success: false, error: 'Project not found or access denied' });
  if (!hasPermission(access.access.role, 'edit')) return jsonResponse(403, { success: false, error: 'Access denied' });

  const allFiles = await projectFilesRepo.listByProject(String(access.project.id));
  const files = allFiles.filter((item) => item.type === 'file');
  if (!files.length) return jsonResponse(400, { success: false, error: 'No files in project' });
  const entry = files.find((item) => Number(item.is_entry_point) === 1);
  if (!entry) return jsonResponse(400, { success: false, error: 'No entry point set' });
  const pathMap = getPathMap(allFiles);
  const fileContents = {};
  let entryPath = '';
  for (const file of files) {
    const path = pathMap.getPath(file);
    fileContents[path] = await resolveFileContent(file, access.workspaceId);
    if (String(file.id) === String(entry.id)) entryPath = path;
  }
  const workspace = await resolveWorkspace(String(access.workspaceId));
  const bundle = workspace?.language === 'nodejs' ? generateJsBundle(fileContents, entryPath) : generatePyBundle(fileContents, entryPath);
  return jsonResponse(200, { success: true, bundle, entry: entryPath, file_count: files.length });
}
