import { jsonResponse, parseJsonBody } from '../utils/http.js';
import { hashPassword, requireSystemAdmin } from '../utils/auth.js';
import { adminAuditRepo, accessListsRepo, appConfigRepo, licensesRepo, logsRepo, projectFilesRepo, projectsRepo, rateLimitsRepo, usersRepo, websocketConnectionsRepo, workspaceInvitationsRepo, workspaceMembersRepo, workspacesRepo } from '../services/repositories.js';
import { nowIso, randomId, sortByDateDesc } from '../utils/common.js';
import { broadcastAdminEvent } from '../utils/realtime.js';
import { destroyWorkspaceData } from './workspaceController.js';

const GUARD_CHALLENGE_PREFIX = 'admin_guard_challenge:';
const GUARD_TOKEN_PREFIX = 'admin_guard_token:';
const GUARD_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const GUARD_TOKEN_TTL_MS = 10 * 60 * 1000;

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function toDateInput(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const numeric = Number(raw);
  const date = Number.isFinite(numeric)
    ? new Date(raw.length <= 10 ? numeric * 1000 : numeric)
    : new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toJsonSafe(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

async function requireAdmin(request) {
  return await requireSystemAdmin(request);
}

async function readGuardSession(key) {
  const raw = await appConfigRepo.get(key);
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed?.expires_at && Number(parsed.expires_at) <= Date.now()) {
      await appConfigRepo.delete(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeGuardSession(key, payload) {
  await appConfigRepo.set(key, JSON.stringify(payload));
}

function buildGuardChallengeKey(challenge) {
  return `${GUARD_CHALLENGE_PREFIX}${challenge}`;
}

function buildGuardTokenKey(token) {
  return `${GUARD_TOKEN_PREFIX}${token}`;
}

async function issueGuardChallenge(actorUserId, payload) {
  const challenge = randomId();
  await writeGuardSession(buildGuardChallengeKey(challenge), {
    challenge,
    actor_user_id: String(actorUserId),
    action: normalizeText(payload.action),
    target_type: normalizeText(payload.target_type),
    target_id: normalizeText(payload.target_id),
    reason: normalizeText(payload.reason),
    created_at: nowIso(),
    expires_at: Date.now() + GUARD_CHALLENGE_TTL_MS
  });
  return challenge;
}

async function issueGuardTokenFromChallenge(challenge) {
  const session = await readGuardSession(buildGuardChallengeKey(challenge));
  if (!session) return null;

  const token = randomId();
  const tokenSession = {
    token,
    actor_user_id: session.actor_user_id,
    action: session.action,
    target_type: session.target_type,
    target_id: session.target_id,
    reason: session.reason,
    created_at: nowIso(),
    expires_at: Date.now() + GUARD_TOKEN_TTL_MS
  };
  await writeGuardSession(buildGuardTokenKey(token), tokenSession);
  await appConfigRepo.delete(buildGuardChallengeKey(challenge));
  return tokenSession;
}

async function requireGuardToken(request, expected = {}) {
  const token = normalizeText(request.headers['x-admin-guard-token'] || request.headers['X-Admin-Guard-Token']);
  if (!token) return { ok: false, response: jsonResponse(403, { success: false, error: 'Admin guard token required' }) };
  const session = await readGuardSession(buildGuardTokenKey(token));
  if (!session) return { ok: false, response: jsonResponse(403, { success: false, error: 'Admin guard token expired or invalid' }) };

  const payload = parseJsonBody(request) || {};
  const reason = normalizeText(payload.reason);
  if (!reason) return { ok: false, response: jsonResponse(400, { success: false, error: 'Reason required' }) };
  if (normalizeText(session.reason) && normalizeText(session.reason) !== reason) {
    return { ok: false, response: jsonResponse(403, { success: false, error: 'Reason mismatch' }) };
  }
  if (expected.action && normalizeText(session.action) !== normalizeText(expected.action)) {
    return { ok: false, response: jsonResponse(403, { success: false, error: 'Admin guard token scope mismatch' }) };
  }
  if (expected.target_type && normalizeText(session.target_type) !== normalizeText(expected.target_type)) {
    return { ok: false, response: jsonResponse(403, { success: false, error: 'Admin guard token scope mismatch' }) };
  }
  if (expected.target_id && normalizeText(session.target_id) !== normalizeText(expected.target_id)) {
    return { ok: false, response: jsonResponse(403, { success: false, error: 'Admin guard token scope mismatch' }) };
  }
  return { ok: true, session, reason, token };
}

async function logAdminAction(actorUserId, action, targetType, targetId, reason, metadata = {}) {
  const entry = {
    id: randomId(),
    actor_user_id: String(actorUserId),
    action: normalizeText(action),
    target_type: normalizeText(targetType),
    target_id: normalizeText(targetId),
    reason: normalizeText(reason),
    metadata: toJsonSafe(metadata),
    created_at: nowIso(),
    timestamp: Date.now()
  };
  await adminAuditRepo.create(entry);
  await broadcastAdminEvent('ADMIN_AUDIT', entry);
  return entry;
}

async function listAllWorkspaces() {
  const workspaces = await workspacesRepo.scan();
  return sortByDateDesc(workspaces);
}

async function listAllUsers() {
  const users = await usersRepo.scan();
  return sortByDateDesc(users);
}

async function listRelatedRecordsForWorkspace(workspaceId) {
  const [projects, licenses, accessRules, logs, members, invitations] = await Promise.all([
    projectsRepo.listByWorkspace(String(workspaceId)),
    licensesRepo.listByWorkspace(String(workspaceId)),
    accessListsRepo.listByWorkspace(String(workspaceId)),
    logsRepo.listByWorkspace(String(workspaceId)),
    workspaceMembersRepo.listByWorkspace(String(workspaceId)),
    workspaceInvitationsRepo.listByWorkspace(String(workspaceId))
  ]);
  return { projects, licenses, accessRules, logs, members, invitations };
}

async function deleteWebsocketConnectionsByUser(userId) {
  const connections = await websocketConnectionsRepo.listByUser(String(userId));
  for (const connection of connections) {
    await websocketConnectionsRepo.deleteByConnectionId(String(connection.connection_id));
  }
}

async function deleteWebsocketConnectionsByWorkspace(workspaceId) {
  const connections = await websocketConnectionsRepo.listByWorkspace(String(workspaceId));
  for (const connection of connections) {
    await websocketConnectionsRepo.deleteByConnectionId(String(connection.connection_id));
  }
}

function applyQueryFilters(items, query = {}) {
  const q = normalizeLower(query.q || query.search);
  const status = normalizeLower(query.status);
  const role = normalizeLower(query.role);
  const type = normalizeLower(query.target_type);
  const action = normalizeLower(query.action);
  const target = normalizeLower(query.target_id);
  const from = toDateInput(query.date_from || query.from);
  const to = toDateInput(query.date_to || query.to);

  return items.filter((item) => {
    if (q) {
      const haystack = normalizeLower([
        item.id,
        item.email,
        item.display_name,
        item.name,
        item.key,
        item.loader_key,
        item.secret_key,
        item.reason,
        item.target_type,
        item.target_id,
        item.action,
        item.workspace_id
      ].filter(Boolean).join(' '));
      if (!haystack.includes(q)) return false;
    }
    if (status && normalizeLower(item.status || item.is_active || item.state) !== status) return false;
    if (role && normalizeLower(item.role) !== role) return false;
    if (type && normalizeLower(item.target_type) !== type) return false;
    if (action && normalizeLower(item.action) !== action) return false;
    if (target && !normalizeLower(item.target_id).includes(target)) return false;
    if (from || to) {
      const createdAt = item.created_at || item.timestamp;
      const date = toDateInput(createdAt);
      if (!date) return false;
      if (from && date < from) return false;
      if (to && date > new Date(to.getTime() + 24 * 60 * 60 * 1000)) return false;
    }
    return true;
  });
}

function countByDay(items, field = 'created_at') {
  const bucket = new Map();
  for (const item of items) {
    const date = toDateInput(item[field] || item.timestamp);
    if (!date) continue;
    const key = date.toISOString().slice(0, 10);
    bucket.set(key, (bucket.get(key) || 0) + 1);
  }
  return [...bucket.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, count]) => ({ date, count }));
}

function buildUserSummary(user, ownedWorkspaces, memberships) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name || '',
    role: user.role || 'user',
    status: user.status || 'active',
    created_at: user.created_at,
    owned_workspace_count: ownedWorkspaces.length,
    shared_workspace_count: memberships.length,
    total_workspace_count: ownedWorkspaces.length + memberships.length
  };
}

function buildWorkspaceSummary(workspace, owner, related = {}) {
  return {
    id: workspace.id,
    name: workspace.name,
    loader_key: workspace.loader_key,
    status: workspace.status || 'active',
    user_id: workspace.user_id,
    owner: owner ? {
      id: owner.id,
      email: owner.email,
      display_name: owner.display_name || ''
    } : null,
    language: workspace.language,
    default_project_id: workspace.default_project_id || null,
    default_script_id: workspace.default_script_id || null,
    discord_webhook: workspace.discord_webhook || '',
    pin_enabled: Number(workspace.pin_enabled || 0),
    created_at: workspace.created_at,
    project_count: related.projects?.length || 0,
    file_count: related.projects?.reduce((sum, project) => sum + (related.filesByProject?.get(String(project.id))?.length || 0), 0) || 0,
    license_count: related.licenses?.length || 0,
    team_count: 1 + (related.members?.length || 0),
    access_rule_count: related.accessRules?.length || 0
  };
}

async function hydrateWorkspaceDetails(workspace) {
  const owner = await usersRepo.getById(String(workspace.user_id));
  const related = await listRelatedRecordsForWorkspace(workspace.id);
  const filesByProject = new Map();
  for (const project of related.projects) {
    filesByProject.set(String(project.id), await projectFilesRepo.listByProject(String(project.id)));
  }
  return {
    ...buildWorkspaceSummary(workspace, owner, { ...related, filesByProject }),
    projects: sortByDateDesc(related.projects).map((project) => ({
      ...project,
      file_count: filesByProject.get(String(project.id))?.length || 0
    })),
    licenses: sortByDateDesc(related.licenses),
    access_rules: sortByDateDesc(related.accessRules),
    logs: sortByDateDesc(related.logs),
    members: sortByDateDesc(related.members),
    invitations: sortByDateDesc(related.invitations)
  };
}

export async function getAdminOverview(request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const [users, workspaces, projects, licenses, logs, rateLimits, appConfigs, audits] = await Promise.all([
    usersRepo.scan(),
    workspacesRepo.scan(),
    projectsRepo.scan(),
    licensesRepo.scan(),
    logsRepo.scan(),
    rateLimitsRepo.list(),
    appConfigRepo.list(),
    adminAuditRepo.listRecent(100)
  ]);

  const suspendedUsers = users.filter((user) => normalizeLower(user.status) !== 'active').length;
  const suspendedWorkspaces = workspaces.filter((workspace) => normalizeLower(workspace.status) !== 'active').length;
  const totalFiles = (await Promise.all(projects.map(async (project) => (await projectFilesRepo.listByProject(String(project.id))).length)))
    .reduce((sum, count) => sum + count, 0);

  return jsonResponse(200, {
    success: true,
    overview: {
      totals: {
        users: users.length,
        active_users: users.length - suspendedUsers,
        suspended_users: suspendedUsers,
        workspaces: workspaces.length,
        active_workspaces: workspaces.length - suspendedWorkspaces,
        suspended_workspaces: suspendedWorkspaces,
        projects: projects.length,
        files: totalFiles,
        licenses: licenses.length,
        logs: logs.length,
        rate_limits: rateLimits.length,
        app_config_entries: appConfigs.length,
        audits: audits.length
      },
      charts: {
        users_by_day: countByDay(users),
        workspaces_by_day: countByDay(workspaces),
        projects_by_day: countByDay(projects),
        licenses_by_day: countByDay(licenses),
        logs_by_day: countByDay(logs),
        rate_limits_by_day: countByDay(rateLimits, 'window_start')
      },
      recent_audit: audits.slice(0, 25)
    }
  });
}

export async function listAdminUsers(request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const query = request.query || {};
  const users = applyQueryFilters(await listAllUsers(), query);
  const limit = Math.max(1, Math.min(Number(query.limit || 200), 1000));
  const items = [];

  for (const user of users.slice(0, limit)) {
    const ownedWorkspaces = await workspacesRepo.listByOwner(String(user.id));
    const memberships = await workspaceMembersRepo.listByUser(String(user.id));
    items.push(buildUserSummary(user, ownedWorkspaces, memberships));
  }

  return jsonResponse(200, { success: true, users: items, total: users.length });
}

export async function getAdminUser(request, userId) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const user = await usersRepo.getById(String(userId));
  if (!user) return jsonResponse(404, { success: false, error: 'User not found' });
  const ownedWorkspaces = await workspacesRepo.listByOwner(String(user.id));
  const memberships = await workspaceMembersRepo.listByUser(String(user.id));
  const recentAudit = await adminAuditRepo.listByActor(String(user.id), 50);
  const owned = [];
  for (const workspace of ownedWorkspaces) owned.push(await hydrateWorkspaceDetails(workspace));
  const shared = [];
  for (const membership of memberships) {
    const workspace = await workspacesRepo.getById(String(membership.workspace_id));
    if (!workspace) continue;
    shared.push({
      workspace: buildWorkspaceSummary(workspace, await usersRepo.getById(String(workspace.user_id))),
      role: membership.role || 'viewer',
      created_at: membership.created_at
    });
  }
  return jsonResponse(200, {
    success: true,
    user: {
      ...user,
      password: undefined,
      owned_workspaces: owned,
      shared_workspaces: shared,
      recent_audit: recentAudit
    }
  });
}

export async function patchAdminUser(request, userId) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const payload = parseJsonBody(request);
  if (!payload) return jsonResponse(400, { success: false, error: 'Invalid JSON' });

  const user = await usersRepo.getById(String(userId));
  if (!user) return jsonResponse(404, { success: false, error: 'User not found' });

  const patch = {};
  if (payload.email !== undefined) {
    const email = normalizeLower(payload.email);
    if (!email) return jsonResponse(400, { success: false, error: 'Email required' });
    const existing = await usersRepo.findByEmail(email);
    if (existing && String(existing.id) !== String(user.id)) return jsonResponse(409, { success: false, error: 'Email already exists' });
    patch.email = email;
  }
  if (payload.display_name !== undefined) patch.display_name = normalizeText(payload.display_name);
  if (payload.role !== undefined) patch.role = ['user', 'admin'].includes(normalizeLower(payload.role)) ? normalizeLower(payload.role) : null;
  if (payload.status !== undefined) patch.status = ['active', 'suspended', 'disabled'].includes(normalizeLower(payload.status)) ? normalizeLower(payload.status) : null;
  if (payload.password !== undefined && normalizeText(payload.password)) {
    patch.password = await hashPassword(normalizeText(payload.password));
    patch.password_changed_at = Math.floor(Date.now() / 1000);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) return jsonResponse(400, { success: false, error: `Invalid ${key}` });
  }

  const updated = await usersRepo.update(String(user.id), patch);
  await logAdminAction(auth.user.id, 'UPDATE_USER', 'user', String(user.id), normalizeText(payload.reason || 'Updated user'), { patch });
  await broadcastAdminEvent('USER_UPDATED', { user_id: String(user.id), patch: toJsonSafe(patch) });
  return jsonResponse(200, { success: true, user: { ...updated, password: undefined } });
}

export async function suspendAdminUser(request, userId) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const user = await usersRepo.getById(String(userId));
  if (!user) return jsonResponse(404, { success: false, error: 'User not found' });
  const updated = await usersRepo.update(String(user.id), { status: 'suspended' });
  await deleteWebsocketConnectionsByUser(String(user.id));
  await logAdminAction(auth.user.id, 'SUSPEND_USER', 'user', String(user.id), 'Suspended user', { status: 'suspended' });
  await broadcastAdminEvent('USER_SUSPENDED', { user_id: String(user.id) });
  return jsonResponse(200, { success: true, user: { ...updated, password: undefined } });
}

export async function activateAdminUser(request, userId) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const user = await usersRepo.getById(String(userId));
  if (!user) return jsonResponse(404, { success: false, error: 'User not found' });
  const updated = await usersRepo.update(String(user.id), { status: 'active' });
  await logAdminAction(auth.user.id, 'ACTIVATE_USER', 'user', String(user.id), 'Activated user', { status: 'active' });
  await broadcastAdminEvent('USER_ACTIVATED', { user_id: String(user.id) });
  return jsonResponse(200, { success: true, user: { ...updated, password: undefined } });
}

export async function listAdminWorkspaces(request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const query = request.query || {};
  const workspaces = applyQueryFilters(await listAllWorkspaces(), query);
  const limit = Math.max(1, Math.min(Number(query.limit || 200), 1000));
  const items = [];
  for (const workspace of workspaces.slice(0, limit)) {
    const owner = await usersRepo.getById(String(workspace.user_id));
    const related = await listRelatedRecordsForWorkspace(workspace.id);
    const filesByProject = new Map();
    for (const project of related.projects) {
      filesByProject.set(String(project.id), await projectFilesRepo.listByProject(String(project.id)));
    }
    items.push(buildWorkspaceSummary(workspace, owner, { ...related, filesByProject }));
  }
  return jsonResponse(200, { success: true, workspaces: items, total: workspaces.length });
}

export async function getAdminWorkspace(request, workspaceId) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const workspace = await workspacesRepo.getById(String(workspaceId));
  if (!workspace) return jsonResponse(404, { success: false, error: 'Workspace not found' });
  return jsonResponse(200, { success: true, workspace: await hydrateWorkspaceDetails(workspace) });
}

export async function suspendAdminWorkspace(request, workspaceId) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const workspace = await workspacesRepo.getById(String(workspaceId));
  if (!workspace) return jsonResponse(404, { success: false, error: 'Workspace not found' });
  const updated = await workspacesRepo.update(String(workspace.id), { status: 'suspended' });
  await logAdminAction(auth.user.id, 'SUSPEND_WORKSPACE', 'workspace', String(workspace.id), 'Suspended workspace', { status: 'suspended' });
  await broadcastAdminEvent('WORKSPACE_SUSPENDED', { workspace_id: String(workspace.id) });
  return jsonResponse(200, { success: true, workspace: updated });
}

export async function activateAdminWorkspace(request, workspaceId) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const workspace = await workspacesRepo.getById(String(workspaceId));
  if (!workspace) return jsonResponse(404, { success: false, error: 'Workspace not found' });
  const updated = await workspacesRepo.update(String(workspace.id), { status: 'active' });
  await logAdminAction(auth.user.id, 'ACTIVATE_WORKSPACE', 'workspace', String(workspace.id), 'Activated workspace', { status: 'active' });
  await broadcastAdminEvent('WORKSPACE_ACTIVATED', { workspace_id: String(workspace.id) });
  return jsonResponse(200, { success: true, workspace: updated });
}

export async function deleteAdminUser(request, userId) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const guard = await requireGuardToken(request, { action: 'delete_user', target_type: 'user', target_id: String(userId) });
  if (!guard.ok) return guard.response;

  const user = await usersRepo.getById(String(userId));
  if (!user) return jsonResponse(404, { success: false, error: 'User not found' });

  const ownedWorkspaces = await workspacesRepo.listByOwner(String(user.id));
  for (const workspace of ownedWorkspaces) {
    await deleteWebsocketConnectionsByWorkspace(String(workspace.id));
    await destroyWorkspaceData(String(workspace.id));
  }

  for (const membership of await workspaceMembersRepo.listByUser(String(user.id))) {
    await workspaceMembersRepo.delete(String(membership.id));
  }
  for (const invitation of await workspaceInvitationsRepo.scan({ email: user.email })) {
    await workspaceInvitationsRepo.delete(String(invitation.id));
  }

  await usersRepo.delete(String(user.id));
  await logAdminAction(auth.user.id, 'DELETE_USER', 'user', String(user.id), guard.reason, {
    guard_token: guard.token,
    cascade_workspaces: ownedWorkspaces.map((workspace) => String(workspace.id))
  });
  await appConfigRepo.delete(buildGuardTokenKey(String(guard.token)));
  await broadcastAdminEvent('USER_DELETED', { user_id: String(user.id) });
  return jsonResponse(200, { success: true });
}

export async function deleteAdminWorkspace(request, workspaceId) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const payload = parseJsonBody(request) || {};
  const guard = await requireGuardToken(request, { action: 'delete_workspace', target_type: 'workspace', target_id: String(workspaceId) });
  if (!guard.ok) return guard.response;

  const workspace = await workspacesRepo.getById(String(workspaceId));
  if (!workspace) return jsonResponse(404, { success: false, error: 'Workspace not found' });
  await deleteWebsocketConnectionsByWorkspace(String(workspace.id));
  await destroyWorkspaceData(String(workspace.id));
  await logAdminAction(auth.user.id, 'DELETE_WORKSPACE', 'workspace', String(workspace.id), guard.reason, {
    guard_token: guard.token,
    payload: toJsonSafe(payload)
  });
  await appConfigRepo.delete(buildGuardTokenKey(String(guard.token)));
  await broadcastAdminEvent('WORKSPACE_DELETED', { workspace_id: String(workspace.id) });
  return jsonResponse(200, { success: true });
}

export async function getAdminAudit(request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const query = request.query || {};
  const limit = Math.max(1, Math.min(Number(query.limit || 200), 1000));
  let items;
  if (query.actor_user_id || query.actor) {
    items = await adminAuditRepo.listByActor(String(query.actor_user_id || query.actor), limit);
  } else if (query.target_id) {
    items = await adminAuditRepo.listByTarget(String(query.target_id), limit);
  } else {
    items = await adminAuditRepo.listRecent(limit);
  }
  items = applyQueryFilters(items, query);
  return jsonResponse(200, { success: true, audit: items.slice(0, limit), total: items.length });
}

export async function startAdminGuard(request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const payload = parseJsonBody(request);
  if (!payload?.action || !payload?.target_type || !payload?.target_id || !payload?.reason) {
    return jsonResponse(400, { success: false, error: 'Action, target and reason required' });
  }

  const challenge = await issueGuardChallenge(auth.user.id, payload);
  await logAdminAction(auth.user.id, 'GUARD_START', payload.target_type, payload.target_id, payload.reason, {
    action: normalizeText(payload.action),
    challenge
  });
  return jsonResponse(200, {
    success: true,
    challenge,
    expires_at: Date.now() + GUARD_CHALLENGE_TTL_MS
  });
}

export async function verifyAdminGuard(request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const payload = parseJsonBody(request);
  if (!payload?.challenge) return jsonResponse(400, { success: false, error: 'Challenge required' });

  const session = await readGuardSession(buildGuardChallengeKey(String(payload.challenge)));
  if (!session) return jsonResponse(404, { success: false, error: 'Challenge not found or expired' });
  if (String(session.actor_user_id) !== String(auth.user.id)) return jsonResponse(403, { success: false, error: 'Challenge does not belong to current user' });
  if (payload.action && normalizeText(payload.action) !== normalizeText(session.action)) return jsonResponse(403, { success: false, error: 'Challenge scope mismatch' });
  if (payload.target_type && normalizeText(payload.target_type) !== normalizeText(session.target_type)) return jsonResponse(403, { success: false, error: 'Challenge scope mismatch' });
  if (payload.target_id && normalizeText(payload.target_id) !== normalizeText(session.target_id)) return jsonResponse(403, { success: false, error: 'Challenge scope mismatch' });

  const tokenSession = await issueGuardTokenFromChallenge(String(payload.challenge));
  if (!tokenSession) return jsonResponse(500, { success: false, error: 'Unable to issue guard token' });
  await logAdminAction(auth.user.id, 'GUARD_VERIFY', session.target_type, session.target_id, session.reason, {
    action: session.action,
    guard_token: tokenSession.token
  });
  return jsonResponse(200, {
    success: true,
    guard_token: tokenSession.token,
    expires_at: tokenSession.expires_at
  });
}
