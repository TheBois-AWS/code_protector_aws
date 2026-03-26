import { createCookie, getClientIp, jsonResponse, parseJsonBody, serverError, unauthorized } from '../utils/http.js';
import { appConfigRepo, logsRepo, pinVerificationsRepo, projectFilesRepo, projectsRepo, usersRepo, workspaceInvitationsRepo, workspaceMembersRepo, workspacesRepo, licensesRepo, accessListsRepo } from '../services/repositories.js';
import { buildRateLimitKey, checkRateLimit } from '../utils/rateLimit.js';
import { getUserIdFromRequest, hashPassword, isSystemAdminByUserId, verifyPassword } from '../utils/auth.js';
import { generateWorkspaceKey } from '../utils/crypto.js';
import { nowIso, randomId, sortByDateDesc } from '../utils/common.js';
import { storage } from '../services/storage.js';
import { getWorkspaceAccess, hasPermission, listWorkspaceLogs, listWorkspaceMembers, listWorkspaceProjects, resolveWorkspace } from '../utils/workspace.js';
import { config } from '../config.js';
import { broadcastUserEvent, broadcastWorkspaceEvent } from '../utils/realtime.js';

export async function logAction(workspaceId, action, details, request, country = 'Unknown') {
  const logEntry = {
    id: randomId(),
    workspace_id: workspaceId ? String(workspaceId) : null,
    action,
    details,
    ip: getClientIp(request),
    country,
    timestamp: Date.now(),
    created_at: nowIso()
  };
  await logsRepo.create(logEntry);
  if (workspaceId) {
    await broadcastWorkspaceEvent(workspaceId, 'LOG', logEntry);
  }
}

async function deleteProjectStorage(projectId) {
  const files = await projectFilesRepo.listByProject(String(projectId));
  for (const file of files) {
    if (file.content && String(file.content).startsWith('r2:')) {
      try {
        await storage.delete(String(file.content).slice(3));
      } catch {}
    }
    await projectFilesRepo.delete(String(file.id));
  }
}

export async function destroyWorkspaceData(workspaceId) {
  const projects = await projectsRepo.listByWorkspace(String(workspaceId));
  for (const project of projects) {
    if (project.content && String(project.content).startsWith('r2:')) {
      try {
        await storage.delete(String(project.content).slice(3));
      } catch {}
    }
    if (project.published_content && String(project.published_content).startsWith('r2:')) {
      try {
        await storage.delete(String(project.published_content).slice(3));
      } catch {}
    }
    await deleteProjectStorage(project.id);
    await projectsRepo.delete(String(project.id));
  }

  for (const license of await licensesRepo.listByWorkspace(String(workspaceId))) {
    await licensesRepo.delete(String(license.id));
  }
  for (const member of await workspaceMembersRepo.listByWorkspace(String(workspaceId))) {
    await workspaceMembersRepo.delete(String(member.id));
  }
  for (const invitation of await workspaceInvitationsRepo.listByWorkspace(String(workspaceId))) {
    await workspaceInvitationsRepo.delete(String(invitation.id));
  }
  for (const item of await accessListsRepo.listByWorkspace(String(workspaceId))) {
    await accessListsRepo.delete(String(item.id));
  }
  for (const item of await logsRepo.listByWorkspace(String(workspaceId))) {
    await logsRepo.delete(String(item.id));
  }
  for (const pin of await pinVerificationsRepo.listByWorkspace(String(workspaceId))) {
    await pinVerificationsRepo.delete(String(pin.token));
  }
  await workspacesRepo.delete(String(workspaceId));
}

function sanitizeWorkspace(workspace) {
  const { encryption_key, pin_hash, ...safe } = workspace;
  return safe;
}

async function verifyPinToken(workspace, userId, pinToken) {
  if (!workspace.pin_enabled) return true;
  if (!pinToken) return false;
  const verification = await pinVerificationsRepo.getById(String(pinToken));
  if (!verification) return false;
  if (String(verification.workspace_id) !== String(workspace.id)) return false;
  if (String(verification.user_id) !== String(userId)) return false;
  if (Number(verification.expires_at || 0) <= Date.now()) return false;
  return true;
}

export async function listWorkspaces(request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();

  try {
    const owned = (await workspacesRepo.listByOwner(userId)).map((workspace) => ({ ...workspace, role: 'owner' }));
    const memberships = await workspaceMembersRepo.listByUser(userId);
    const shared = [];
    for (const membership of memberships) {
      const workspace = await workspacesRepo.getById(String(membership.workspace_id));
      if (workspace) shared.push({ ...workspace, role: membership.role || 'viewer' });
    }

    const all = sortByDateDesc([...owned, ...shared]);
    for (const workspace of all) {
      const projects = await projectsRepo.listByWorkspace(String(workspace.id));
      workspace.projects = sortByDateDesc(projects).map((project) => ({
        id: project.id,
        name: project.name,
        secret_key: project.secret_key,
        created_at: project.created_at,
        status: project.status,
        execution_count: Number(project.execution_count || 0)
      }));
      workspace.project_count = workspace.projects.length;
      workspace.license_count = (await licensesRepo.listByWorkspace(String(workspace.id))).length;
      workspace.team_count = 1 + (await workspaceMembersRepo.listByWorkspace(String(workspace.id))).length;
    }

    return jsonResponse(200, { success: true, workspaces: all.map(sanitizeWorkspace) });
  } catch (error) {
    console.error('list workspaces error', error);
    return serverError();
  }
}

export async function createWorkspace(request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const payload = parseJsonBody(request);
  if (!payload || !payload.name) return jsonResponse(400, { success: false, error: 'Name required' });

  const rateLimit = await checkRateLimit(buildRateLimitKey('create_workspace', request, userId), 60, 5);
  if (!rateLimit.allowed) {
    return jsonResponse(429, { success: false, error: 'Rate limited' }, { 'retry-after': String(rateLimit.retryAfterSeconds) });
  }

  const language = ['python', 'nodejs', 'userscript', 'lua'].includes(String(payload.language || '').toLowerCase())
    ? String(payload.language).toLowerCase()
    : (String(payload.language).toLowerCase() === 'javascript' ? 'nodejs' : 'python');

  const workspace = await workspacesRepo.create({
    id: randomId(),
    user_id: userId,
    name: String(payload.name),
    loader_key: randomId(),
    language,
    default_project_id: null,
    default_script_id: null,
    discord_webhook: '',
    status: 'active',
    pin_hash: null,
    pin_enabled: 0,
    encryption_key: generateWorkspaceKey(),
    created_at: nowIso()
  });

  await logAction(workspace.id, 'CREATE_WORKSPACE', `Created workspace \"${workspace.name}\"`, request);
  await broadcastUserEvent(userId, 'WORKSPACE_UPDATE', {
    action: 'create',
    workspace: sanitizeWorkspace(workspace)
  });
  return jsonResponse(200, { success: true, workspace: sanitizeWorkspace(workspace) });
}

export async function getWorkspaceDetails(request, identifier) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();

  const workspace = await resolveWorkspace(identifier);
  if (!workspace) return jsonResponse(404, { success: false, error: 'Workspace not found' });

  const access = await getWorkspaceAccess(workspace.id, userId);
  if (!access || !hasPermission(access.role, 'view')) return jsonResponse(404, { success: false, error: 'Workspace not found or access denied' });

  const pinToken = request.headers['x-pin-token'] || request.headers['X-Pin-Token'];
  const pinOk = await verifyPinToken(workspace, userId, pinToken);
  if (!pinOk) {
    return jsonResponse(200, {
      success: true,
      workspace: sanitizeWorkspace(workspace),
      projects: [],
      userRole: access.role,
      requirePin: true
    });
  }

  const projects = await listWorkspaceProjects(workspace.id);
  const filesByProject = new Map();
  for (const project of projects) {
    const files = await projectFilesRepo.listByProject(String(project.id));
    filesByProject.set(String(project.id), files);
  }

  const mappedProjects = projects.map((project) => ({
    id: project.id,
    workspace_id: project.workspace_id,
    name: project.name,
    content: project.content || '',
    secret_key: project.secret_key,
    status: project.status || 'approved',
    is_active: Number(project.is_active ?? 1),
    created_at: project.created_at,
    require_license: Number(project.require_license ?? 0),
    require_hwid: Number(project.require_hwid ?? 0),
    ip_whitelist_enabled: Number(project.ip_whitelist_enabled ?? 0),
    max_executions: project.max_executions ?? null,
    rate_limit: Number(project.rate_limit ?? 30),
    execution_count: Number(project.execution_count ?? 0),
    is_encrypted: Number(project.is_encrypted ?? 0),
    file_count: filesByProject.get(String(project.id))?.length || 0
  }));

  return jsonResponse(200, {
    success: true,
    workspace: sanitizeWorkspace(workspace),
    projects: mappedProjects,
    userRole: access.role,
    requirePin: false
  });
}

export async function updateWorkspaceSettings(request, identifier) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const payload = parseJsonBody(request);
  if (!payload) return jsonResponse(400, { success: false, error: 'Invalid JSON' });

  const workspace = await resolveWorkspace(identifier);
  if (!workspace) return jsonResponse(404, { success: false, error: 'Workspace not found' });
  const systemAdmin = await isSystemAdminByUserId(userId);
  if (!systemAdmin && String(workspace.user_id) !== String(userId)) return jsonResponse(403, { success: false, error: 'Access denied' });

  let defaultProjectId = workspace.default_project_id || null;
  if (payload.default_project_id !== undefined || payload.default_script_id !== undefined) {
    const requested = String(payload.default_project_id ?? payload.default_script_id ?? '');
    if (!requested) {
      defaultProjectId = null;
    } else {
      const projects = await projectsRepo.listByWorkspace(String(workspace.id));
      const project = projects.find((item) => String(item.id) === requested || String(item.secret_key) === requested);
      if (!project) return jsonResponse(400, { success: false, error: 'Invalid project ID' });
      defaultProjectId = project.id;
    }
  }

  const updated = await workspacesRepo.update(String(workspace.id), {
    default_project_id: defaultProjectId,
    default_script_id: defaultProjectId,
    discord_webhook: payload.discord_webhook !== undefined ? String(payload.discord_webhook || '') : workspace.discord_webhook
  });

  await logAction(workspace.id, 'UPDATE_WORKSPACE_SETTINGS', 'Updated workspace settings', request);
  await broadcastWorkspaceEvent(workspace.id, 'SETTINGS_UPDATE', {
    default_project_id: updated.default_project_id || null,
    default_script_id: updated.default_script_id || null,
    discord_webhook: updated.discord_webhook || ''
  });
  return jsonResponse(200, { success: true, workspace: sanitizeWorkspace(updated) });
}

export async function deleteWorkspace(request, identifier) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const workspace = await resolveWorkspace(identifier);
  if (!workspace) return jsonResponse(404, { success: false, error: 'Workspace not found' });
  const systemAdmin = await isSystemAdminByUserId(userId);
  if (!systemAdmin && String(workspace.user_id) !== String(userId)) return jsonResponse(403, { success: false, error: 'Access denied' });

  await destroyWorkspaceData(String(workspace.id));
  await broadcastUserEvent(userId, 'WORKSPACE_UPDATE', {
    action: 'delete',
    id: String(workspace.id)
  });
  return jsonResponse(200, { success: true });
}

export async function getWorkspaceLogs(request, identifier) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const workspace = await resolveWorkspace(identifier);
  if (!workspace) return jsonResponse(404, { success: false, error: 'Workspace not found' });
  const access = await getWorkspaceAccess(workspace.id, userId);
  if (!access || !hasPermission(access.role, 'view_logs')) return jsonResponse(403, { success: false, error: 'Access denied' });

  const logs = (await listWorkspaceLogs(workspace.id)).slice(0, 100);
  return jsonResponse(200, { success: true, logs });
}

export async function clearWorkspaceLogs(request, identifier) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const workspace = await resolveWorkspace(identifier);
  if (!workspace) return jsonResponse(404, { success: false, error: 'Workspace not found' });
  const access = await getWorkspaceAccess(workspace.id, userId);
  if (!access || !(access.isOwner || access.role === 'admin' || access.role === 'editor')) {
    return jsonResponse(403, { success: false, error: 'Access denied' });
  }

  for (const item of await logsRepo.listByWorkspace(String(workspace.id))) {
    await logsRepo.delete(String(item.id));
  }
  await logAction(workspace.id, 'CLEAR_LOGS', 'Cleared workspace logs', request);
  await broadcastWorkspaceEvent(workspace.id, 'LOGS_CLEARED', { workspace_id: String(workspace.id) });
  return jsonResponse(200, { success: true });
}

export async function setWorkspacePin(request, identifier) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const workspace = await resolveWorkspace(identifier);
  if (!workspace) return jsonResponse(404, { success: false, error: 'Workspace not found' });
  const systemAdmin = await isSystemAdminByUserId(userId);
  if (!systemAdmin && String(workspace.user_id) !== String(userId)) return jsonResponse(403, { success: false, error: 'Only workspace owner can set PIN' });

  const payload = parseJsonBody(request);
  if (!payload || !/^\d{6}$/.test(String(payload.pin || ''))) return jsonResponse(400, { success: false, error: 'PIN must be exactly 6 digits' });

  await workspacesRepo.update(String(workspace.id), {
    pin_hash: await hashPassword(String(payload.pin)),
    pin_enabled: 1
  });
  await logAction(workspace.id, 'SET_PIN', 'Workspace PIN protection enabled', request);
  return jsonResponse(200, { success: true, message: 'PIN set successfully' });
}

export async function verifyWorkspacePin(request, identifier) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const workspace = await resolveWorkspace(identifier);
  if (!workspace) return jsonResponse(404, { success: false, error: 'Workspace not found' });
  const access = await getWorkspaceAccess(workspace.id, userId);
  if (!access) return jsonResponse(403, { success: false, error: 'Access denied' });

  const rateLimit = await checkRateLimit(buildRateLimitKey('pin_verify', request, String(workspace.id)), 60, 5);
  if (!rateLimit.allowed) return jsonResponse(429, { success: false, error: 'Too many PIN attempts. Try again later.' }, { 'retry-after': String(rateLimit.retryAfterSeconds) });

  const payload = parseJsonBody(request);
  if (!payload || !payload.pin) return jsonResponse(400, { success: false, error: 'PIN required' });
  if (!workspace.pin_enabled || !workspace.pin_hash) return jsonResponse(200, { success: true, message: 'PIN not required' });

  const verified = await verifyPassword(String(payload.pin), workspace.pin_hash);
  if (!verified.ok) {
    await logAction(workspace.id, 'PIN_FAILED', 'Invalid PIN attempt', request);
    return jsonResponse(401, { success: false, error: 'Invalid PIN' });
  }

  if (verified.needsUpgrade) {
    await workspacesRepo.update(String(workspace.id), { pin_hash: await hashPassword(String(payload.pin)) });
  }

  const token = randomId();
  const expiresAt = Date.now() + (60 * 60 * 1000);
  await pinVerificationsRepo.create({ token, workspace_id: workspace.id, user_id: userId, expires_at: expiresAt, created_at: nowIso() });
  await logAction(workspace.id, 'PIN_VERIFIED', 'PIN verified successfully', request);
  return jsonResponse(200, { success: true, verified: true, token, expiresAt });
}

export async function removeWorkspacePin(request, identifier) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const workspace = await resolveWorkspace(identifier);
  if (!workspace) return jsonResponse(404, { success: false, error: 'Workspace not found' });
  const systemAdmin = await isSystemAdminByUserId(userId);
  if (!systemAdmin && String(workspace.user_id) !== String(userId)) return jsonResponse(403, { success: false, error: 'Only workspace owner can remove PIN' });

  await workspacesRepo.update(String(workspace.id), { pin_hash: null, pin_enabled: 0 });
  for (const pin of await pinVerificationsRepo.listByWorkspace(String(workspace.id))) {
    await pinVerificationsRepo.delete(String(pin.token));
  }
  await logAction(workspace.id, 'REMOVE_PIN', 'Workspace PIN protection disabled', request);
  return jsonResponse(200, { success: true, message: 'PIN removed successfully' });
}
