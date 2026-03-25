import crypto from 'crypto';
import { gzipSync } from 'zlib';
import { jsonResponse, parseJsonBody, unauthorized } from '../utils/http.js';
import { getUserIdFromRequest } from '../utils/auth.js';
import { buildRateLimitKey, checkRateLimit } from '../utils/rateLimit.js';
import { projectsRepo, projectFilesRepo } from '../services/repositories.js';
import { storage } from '../services/storage.js';
import { encryptAES } from '../utils/crypto.js';
import { nowIso, randomId } from '../utils/common.js';
import { getWorkspaceAccess, hasPermission, resolveWorkspace } from '../utils/workspace.js';
import { logAction } from './workspaceController.js';
import { broadcastWorkspaceEvent } from '../utils/realtime.js';

function compressContent(content) {
  return gzipSync(Buffer.from(content, 'utf-8')).toString('base64');
}

function detectLanguage(filename) {
  const extension = String(filename).split('.').pop().toLowerCase();
  const map = {
    py: 'python',
    lua: 'lua',
    js: 'javascript',
    ts: 'typescript',
    json: 'json',
    html: 'html',
    css: 'css',
    md: 'markdown',
    txt: 'plaintext',
    yml: 'yaml',
    yaml: 'yaml',
    sh: 'shell'
  };
  return map[extension] || 'plaintext';
}

function getWorkspaceScriptPreset(workspaceLanguage) {
  const normalized = String(workspaceLanguage || '').toLowerCase();
  if (normalized === 'nodejs' || normalized === 'userscript' || normalized === 'javascript' || normalized === 'javascript_nodejs') {
    return { language: 'javascript', extension: 'js' };
  }
  if (normalized === 'lua') {
    return { language: 'lua', extension: 'lua' };
  }
  return { language: 'python', extension: 'py' };
}

async function resolveProject(projectIdentifier) {
  return (await projectsRepo.getById(String(projectIdentifier))) || (await projectsRepo.findBySecretKey(String(projectIdentifier)));
}

async function getProjectAccess(projectIdentifier, userId) {
  const project = await resolveProject(projectIdentifier);
  if (!project) return null;
  const access = await getWorkspaceAccess(project.workspace_id, userId);
  if (!access) return null;
  return { project, access, workspaceId: project.workspace_id };
}

async function storeProjectContent(project, workspace, content) {
  const compressed = compressContent(content);
  let body = compressed;
  let isEncrypted = 0;
  if (workspace?.encryption_key) {
    body = encryptAES(compressed, workspace.encryption_key);
    isEncrypted = 1;
  }
  const preset = getWorkspaceScriptPreset(workspace?.language);
  const key = `${project.secret_key}.${preset.extension}.gz`;
  await storage.put(key, body);
  return { contentReference: `r2:${key}`, isEncrypted, compressedSize: Buffer.byteLength(body, 'utf-8') };
}

export async function createProject(request, workspaceIdentifier) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const payload = parseJsonBody(request);
  if (!payload?.name || payload.content === undefined) return jsonResponse(400, { success: false, error: 'Name and content required' });

  const rateLimit = await checkRateLimit(buildRateLimitKey('create_project', request, userId), 60, 10);
  if (!rateLimit.allowed) return jsonResponse(429, { success: false, error: 'Rate limited' }, { 'retry-after': String(rateLimit.retryAfterSeconds) });

  const workspace = await resolveWorkspace(workspaceIdentifier);
  if (!workspace) return jsonResponse(404, { success: false, error: 'Workspace not found' });
  const access = await getWorkspaceAccess(workspace.id, userId);
  if (!access || !hasPermission(access.role, 'manage_projects')) return jsonResponse(403, { success: false, error: 'Access denied' });

  const project = {
    id: randomId(),
    workspace_id: workspace.id,
    name: String(payload.name),
    content: '',
    published_content: null,
    secret_key: randomId(),
    status: 'approved',
    is_active: 1,
    is_encrypted: 0,
    require_license: 0,
    require_hwid: 0,
    ip_whitelist_enabled: 0,
    max_executions: null,
    rate_limit: 30,
    execution_count: 0,
    created_at: nowIso()
  };

  const stored = await storeProjectContent(project, workspace, String(payload.content));
  project.content = stored.contentReference;
  project.is_encrypted = stored.isEncrypted;
  await projectsRepo.create(project);

  const preset = getWorkspaceScriptPreset(workspace.language);
  await projectFilesRepo.create({
    id: randomId(),
    project_id: project.id,
    parent_id: undefined,
    name: `main.${preset.extension}`,
    type: 'file',
    content: stored.contentReference,
    is_encrypted: stored.isEncrypted,
    size: Buffer.byteLength(String(payload.content), 'utf-8'),
    language: preset.language,
    sort_order: 0,
    is_entry_point: 1,
    created_at: nowIso(),
    updated_at: nowIso()
  });

  await logAction(workspace.id, 'CREATE_PROJECT', `Created project ${project.name}`, request);
  await broadcastWorkspaceEvent(workspace.id, 'PROJECT_UPDATE', { action: 'create', project: { id: project.id, name: project.name, secret_key: project.secret_key } });
  return jsonResponse(200, { success: true, id: project.id, secret_key: project.secret_key, status: project.status });
}

export async function updateProject(request, projectIdentifier) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const payload = parseJsonBody(request);
  if (!payload || payload.content === undefined) return jsonResponse(400, { success: false, error: 'Content required' });

  const rateLimit = await checkRateLimit(buildRateLimitKey('update_project', request, userId), 60, 30);
  if (!rateLimit.allowed) return jsonResponse(429, { success: false, error: 'Rate limited' }, { 'retry-after': String(rateLimit.retryAfterSeconds) });

  const projectAccess = await getProjectAccess(projectIdentifier, userId);
  if (!projectAccess) return jsonResponse(404, { success: false, error: 'Project not found or access denied' });
  if (!hasPermission(projectAccess.access.role, 'edit')) return jsonResponse(403, { success: false, error: 'Access denied' });

  const workspace = await resolveWorkspace(projectAccess.workspaceId);
  const stored = await storeProjectContent(projectAccess.project, workspace, String(payload.content));
  await projectsRepo.update(String(projectAccess.project.id), {
    content: stored.contentReference,
    published_content: null,
    is_encrypted: stored.isEncrypted,
    status: 'approved'
  });

  const files = await projectFilesRepo.listByProject(String(projectAccess.project.id));
  const entry = files.find((item) => Number(item.is_entry_point) === 1) || files.find((item) => item.type === 'file');
  if (entry) {
    await projectFilesRepo.update(String(entry.id), {
      content: stored.contentReference,
      is_encrypted: stored.isEncrypted,
      size: Buffer.byteLength(String(payload.content), 'utf-8'),
      updated_at: nowIso()
    });
  }

  await logAction(projectAccess.workspaceId, 'UPDATE_PROJECT', `Updated project ${projectAccess.project.id}`, request);
  await broadcastWorkspaceEvent(projectAccess.workspaceId, 'PROJECT_UPDATE', { action: 'update', project: { id: projectAccess.project.id, secret_key: projectAccess.project.secret_key } });
  return jsonResponse(200, { success: true, status: 'approved', compressed_size: stored.compressedSize });
}

export async function deleteProject(request, projectIdentifier) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const projectAccess = await getProjectAccess(projectIdentifier, userId);
  if (!projectAccess) return jsonResponse(404, { success: false, error: 'Project not found or access denied' });
  if (!hasPermission(projectAccess.access.role, 'manage_projects')) return jsonResponse(403, { success: false, error: 'Access denied' });

  const files = await projectFilesRepo.listByProject(String(projectAccess.project.id));
  for (const file of files) {
    if (file.content && String(file.content).startsWith('r2:')) {
      try { await storage.delete(String(file.content).slice(3)); } catch {}
    }
    await projectFilesRepo.delete(String(file.id));
  }
  if (projectAccess.project.content && String(projectAccess.project.content).startsWith('r2:')) {
    try { await storage.delete(String(projectAccess.project.content).slice(3)); } catch {}
  }
  await projectsRepo.delete(String(projectAccess.project.id));
  await logAction(projectAccess.workspaceId, 'DELETE_PROJECT', `Deleted project ${projectAccess.project.id}`, request);
  await broadcastWorkspaceEvent(projectAccess.workspaceId, 'PROJECT_UPDATE', { action: 'delete', id: projectAccess.project.id, secret_key: projectAccess.project.secret_key });
  return jsonResponse(200, { success: true });
}

export async function toggleProjectActive(request, projectIdentifier) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const projectAccess = await getProjectAccess(projectIdentifier, userId);
  if (!projectAccess) return jsonResponse(404, { success: false, error: 'Project not found or access denied' });
  if (!hasPermission(projectAccess.access.role, 'manage_projects')) return jsonResponse(403, { success: false, error: 'Access denied' });
  const updated = await projectsRepo.update(String(projectAccess.project.id), { is_active: Number(projectAccess.project.is_active) ? 0 : 1 });
  await logAction(projectAccess.workspaceId, 'TOGGLE_PROJECT', `Set project ${projectAccess.project.id} active to ${updated.is_active}`, request);
  await broadcastWorkspaceEvent(projectAccess.workspaceId, 'PROJECT_UPDATE', { action: 'toggle_active', id: projectAccess.project.id, is_active: Number(updated.is_active) });
  return jsonResponse(200, { success: true, is_active: !!Number(updated.is_active) });
}

export async function updateProjectSettings(request, projectIdentifier) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const projectAccess = await getProjectAccess(projectIdentifier, userId);
  if (!projectAccess) return jsonResponse(404, { success: false, error: 'Project not found or access denied' });
  if (!hasPermission(projectAccess.access.role, 'manage_projects')) return jsonResponse(403, { success: false, error: 'Access denied' });

  const payload = parseJsonBody(request);
  if (!payload) return jsonResponse(400, { success: false, error: 'Invalid payload' });
  const updated = await projectsRepo.update(String(projectAccess.project.id), {
    require_license: payload.require_license !== undefined ? (payload.require_license ? 1 : 0) : projectAccess.project.require_license,
    require_hwid: payload.require_hwid !== undefined ? (payload.require_hwid ? 1 : 0) : projectAccess.project.require_hwid,
    ip_whitelist_enabled: payload.ip_whitelist_enabled !== undefined ? (payload.ip_whitelist_enabled ? 1 : 0) : projectAccess.project.ip_whitelist_enabled,
    max_executions: payload.max_executions !== undefined ? payload.max_executions : projectAccess.project.max_executions,
    rate_limit: payload.rate_limit !== undefined ? Number(payload.rate_limit || 30) : Number(projectAccess.project.rate_limit || 30)
  });
  await logAction(projectAccess.workspaceId, 'UPDATE_PROJECT_SETTINGS', `Updated settings for project ${projectAccess.project.id}`, request);
  await broadcastWorkspaceEvent(projectAccess.workspaceId, 'PROJECT_UPDATE', { action: 'settings_update', id: projectAccess.project.id });
  return jsonResponse(200, { success: true, ...updated });
}

export async function resetProjectStats(request, projectIdentifier) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const projectAccess = await getProjectAccess(projectIdentifier, userId);
  if (!projectAccess) return jsonResponse(404, { success: false, error: 'Project not found or access denied' });
  if (!hasPermission(projectAccess.access.role, 'manage_projects')) return jsonResponse(403, { success: false, error: 'Access denied' });
  await projectsRepo.update(String(projectAccess.project.id), { execution_count: 0 });
  await logAction(projectAccess.workspaceId, 'RESET_PROJECT_STATS', `Reset stats for project ${projectAccess.project.id}`, request);
  await broadcastWorkspaceEvent(projectAccess.workspaceId, 'PROJECT_UPDATE', { action: 'reset_stats', id: projectAccess.project.id });
  return jsonResponse(200, { success: true });
}

export async function renameProject(request, projectIdentifier) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const payload = parseJsonBody(request);
  if (!payload?.name) return jsonResponse(400, { success: false, error: 'Name required' });
  const projectAccess = await getProjectAccess(projectIdentifier, userId);
  if (!projectAccess) return jsonResponse(404, { success: false, error: 'Project not found or access denied' });
  if (!hasPermission(projectAccess.access.role, 'manage_projects')) return jsonResponse(403, { success: false, error: 'Access denied' });
  await projectsRepo.update(String(projectAccess.project.id), { name: String(payload.name) });
  await logAction(projectAccess.workspaceId, 'RENAME_PROJECT', `Renamed project ${projectAccess.project.id} to ${payload.name}`, request);
  await broadcastWorkspaceEvent(projectAccess.workspaceId, 'PROJECT_UPDATE', { action: 'rename', id: projectAccess.project.id, name: String(payload.name) });
  return jsonResponse(200, { success: true });
}

export { compressContent, detectLanguage, getProjectAccess, resolveProject, storeProjectContent };
