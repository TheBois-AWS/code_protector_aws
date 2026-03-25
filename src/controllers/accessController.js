import { jsonResponse, parseJsonBody, unauthorized } from '../utils/http.js';
import { getUserIdFromRequest } from '../utils/auth.js';
import { accessListsRepo } from '../services/repositories.js';
import { nowIso, randomId, sortByDateDesc } from '../utils/common.js';
import { getWorkspaceAccess, hasPermission, listWorkspaceAccessRules, resolveWorkspace } from '../utils/workspace.js';
import { logAction } from './workspaceController.js';
import { broadcastWorkspaceEvent } from '../utils/realtime.js';

export async function listAccessRules(request, workspaceIdentifier) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const workspace = await resolveWorkspace(workspaceIdentifier);
  if (!workspace) return jsonResponse(404, { success: false, error: 'Workspace not found' });
  const access = await getWorkspaceAccess(workspace.id, userId);
  if (!access || !hasPermission(access.role, 'view')) return jsonResponse(403, { success: false, error: 'Access denied' });
  return jsonResponse(200, { success: true, items: await listWorkspaceAccessRules(workspace.id) });
}

export async function createAccessRule(request, workspaceIdentifier) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const payload = parseJsonBody(request);
  if (!payload?.identifier || !payload?.type) return jsonResponse(400, { success: false, error: 'Missing fields' });
  if (!['blacklist', 'whitelist'].includes(String(payload.type))) return jsonResponse(400, { success: false, error: 'Invalid type' });

  const workspace = await resolveWorkspace(workspaceIdentifier);
  if (!workspace) return jsonResponse(404, { success: false, error: 'Workspace not found' });
  const access = await getWorkspaceAccess(workspace.id, userId);
  if (!access || !hasPermission(access.role, 'manage_access')) return jsonResponse(403, { success: false, error: 'Access denied' });

  const rule = await accessListsRepo.create({
    id: randomId(),
    workspace_id: workspace.id,
    type: String(payload.type),
    identifier: String(payload.identifier),
    note: payload.note ? String(payload.note) : null,
    created_at: nowIso()
  });
  await logAction(workspace.id, 'CREATE_ACCESS_RULE', `Created access rule [${rule.type}] ${rule.identifier}`, request);
  await broadcastWorkspaceEvent(workspace.id, 'ACCESS_UPDATE', { action: 'create', rule });
  return jsonResponse(200, { success: true, rule });
}

export async function deleteAccessRule(request, ruleId) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const rule = await accessListsRepo.getById(String(ruleId));
  if (!rule) return jsonResponse(404, { success: false, error: 'Rule not found' });

  const access = await getWorkspaceAccess(rule.workspace_id, userId);
  if (!access || !hasPermission(access.role, 'manage_access')) return jsonResponse(403, { success: false, error: 'Access denied' });

  await accessListsRepo.delete(String(rule.id));
  await logAction(rule.workspace_id, 'DELETE_ACCESS_RULE', `Deleted access rule [${rule.type}] ${rule.identifier}`, request);
  await broadcastWorkspaceEvent(rule.workspace_id, 'ACCESS_UPDATE', { action: 'delete', id: String(rule.id) });
  return jsonResponse(200, { success: true });
}
