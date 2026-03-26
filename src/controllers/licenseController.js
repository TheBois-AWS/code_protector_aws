import crypto from 'crypto';
import { jsonResponse, parseJsonBody, unauthorized } from '../utils/http.js';
import { getUserIdFromRequest } from '../utils/auth.js';
import { buildRateLimitKey, checkRateLimit } from '../utils/rateLimit.js';
import { licensesRepo, projectsRepo } from '../services/repositories.js';
import { nowIso, randomId, sortByDateDesc } from '../utils/common.js';
import { getWorkspaceAccess, hasPermission, resolveWorkspace } from '../utils/workspace.js';
import { logAction } from './workspaceController.js';
import { broadcastWorkspaceEvent } from '../utils/realtime.js';

function randomLicenseKey(prefix = '', suffix = '') {
  return `${prefix}LIC-${crypto.randomUUID().split('-')[0].toUpperCase()}-${crypto.randomUUID().split('-')[1].toUpperCase()}${suffix}`;
}

async function resolveProjectId(workspaceId, input) {
  if (!input) return null;
  const projects = await projectsRepo.listByWorkspace(String(workspaceId));
  const project = projects.find((item) => String(item.id) === String(input) || String(item.secret_key) === String(input));
  return project ? project.id : null;
}

export async function listLicenses(request, workspaceIdentifier) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const workspace = await resolveWorkspace(workspaceIdentifier);
  if (!workspace) return jsonResponse(404, { success: false, error: 'Workspace not found' });
  const access = await getWorkspaceAccess(workspace.id, userId);
  if (!access || !hasPermission(access.role, 'view')) return jsonResponse(404, { success: false, error: 'Workspace not found or access denied' });
  return jsonResponse(200, { success: true, licenses: sortByDateDesc(await licensesRepo.listByWorkspace(String(workspace.id))) });
}

export async function createLicense(request, workspaceIdentifier) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const payload = parseJsonBody(request);
  if (!payload) return jsonResponse(400, { success: false, error: 'Invalid JSON' });

  const rateLimit = await checkRateLimit(buildRateLimitKey('create_license', request, userId), 60, 30);
  if (!rateLimit.allowed) return jsonResponse(429, { success: false, error: 'Rate limited' }, { 'retry-after': String(rateLimit.retryAfterSeconds) });

  const workspace = await resolveWorkspace(workspaceIdentifier);
  if (!workspace) return jsonResponse(404, { success: false, error: 'Workspace not found' });
  const access = await getWorkspaceAccess(workspace.id, userId);
  if (!access || !hasPermission(access.role, 'manage_licenses')) return jsonResponse(404, { success: false, error: 'Workspace not found or access denied' });

  const projectId = await resolveProjectId(workspace.id, payload.script_id || payload.project_id);
  if ((payload.script_id || payload.project_id) && !projectId) return jsonResponse(400, { success: false, error: 'Invalid project ID' });

  const customKey = payload.custom_key ? String(payload.custom_key) : '';
  if (customKey && !/^[\w-]+$/.test(customKey)) return jsonResponse(400, { success: false, error: 'Custom key can only contain letters, numbers, hyphens and underscores' });
  const key = customKey || randomLicenseKey(String(payload.prefix || ''), String(payload.suffix || ''));
  const existing = await licensesRepo.findByKey(key);
  if (existing) return jsonResponse(400, { success: false, error: 'This license key already exists' });

  const license = await licensesRepo.create({
    id: randomId(),
    workspace_id: workspace.id,
    key,
    note: payload.note ? String(payload.note) : null,
    expiration_date: payload.expiration_date || null,
    script_id: projectId,
    project_id: projectId,
    is_active: 1,
    hwid_lock: 1,
    activated_hwid: null,
    activated_os: null,
    last_used_at: null,
    usage_count: 0,
    created_at: nowIso()
  });

  await logAction(workspace.id, 'CREATE_LICENSE', `Created license ${license.key} for project ${projectId || 'ALL'}`, request);
  await broadcastWorkspaceEvent(workspace.id, 'LICENSE_UPDATE', { action: 'create', license });
  return jsonResponse(200, { success: true, key: license.key, license });
}

export async function batchCreateLicenses(request, workspaceIdentifier) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const payload = parseJsonBody(request);
  if (!payload) return jsonResponse(400, { success: false, error: 'Invalid JSON' });

  const rateLimit = await checkRateLimit(buildRateLimitKey('batch_create_licenses', request, userId), 60, 5);
  if (!rateLimit.allowed) return jsonResponse(429, { success: false, error: 'Rate limited' }, { 'retry-after': String(rateLimit.retryAfterSeconds) });

  const workspace = await resolveWorkspace(workspaceIdentifier);
  if (!workspace) return jsonResponse(404, { success: false, error: 'Workspace not found' });
  const access = await getWorkspaceAccess(workspace.id, userId);
  if (!access || !hasPermission(access.role, 'manage_licenses')) return jsonResponse(404, { success: false, error: 'Workspace not found or access denied' });

  const count = Math.min(Math.max(Number(payload.count || 1), 1), 100);
  const projectId = await resolveProjectId(workspace.id, payload.script_id || payload.project_id);
  if ((payload.script_id || payload.project_id) && !projectId) return jsonResponse(400, { success: false, error: 'Invalid project ID' });

  const licenses = [];
  for (let index = 0; index < count; index += 1) {
    let key = randomLicenseKey(String(payload.prefix || ''), String(payload.suffix || ''));
    while (await licensesRepo.findByKey(key)) key = randomLicenseKey(String(payload.prefix || ''), String(payload.suffix || ''));
    const license = await licensesRepo.create({
      id: randomId(),
      workspace_id: workspace.id,
      key,
      note: payload.note ? String(payload.note) : null,
      expiration_date: payload.expiration_date || null,
      script_id: projectId,
      project_id: projectId,
      is_active: 1,
      hwid_lock: 1,
      activated_hwid: null,
      activated_os: null,
      last_used_at: null,
      usage_count: 0,
      created_at: nowIso()
    });
    licenses.push(license);
  }

  await logAction(workspace.id, 'BATCH_CREATE_LICENSE', `Created ${licenses.length} licenses`, request);
  await broadcastWorkspaceEvent(workspace.id, 'LICENSE_UPDATE', { action: 'batch_create', count: licenses.length });
  return jsonResponse(200, { success: true, licenses, count: licenses.length });
}

export async function exportLicenses(request, workspaceIdentifier) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const workspace = await resolveWorkspace(workspaceIdentifier);
  if (!workspace) return jsonResponse(404, { success: false, error: 'Workspace not found' });
  const access = await getWorkspaceAccess(workspace.id, userId);
  if (!access || !hasPermission(access.role, 'view')) return jsonResponse(404, { success: false, error: 'Workspace not found or access denied' });

  const headers = ['License Key', 'Note', 'Active', 'Expiration', 'HWID', 'OS', 'Usage Count', 'Last Used', 'Created'];
  const rows = sortByDateDesc(await licensesRepo.listByWorkspace(String(workspace.id))).map((item) => [
    item.key,
    item.note || '',
    Number(item.is_active) ? 'Yes' : 'No',
    item.expiration_date || '',
    item.activated_hwid || '',
    item.activated_os || '',
    item.usage_count || 0,
    item.last_used_at || '',
    item.created_at || ''
  ]);
  const csv = [headers.join(','), ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))].join('\n');
  return {
    statusCode: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="licenses_${workspace.id}.csv"`
    },
    body: csv
  };
}

export async function deleteLicense(request, licenseId) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const license = await licensesRepo.getById(String(licenseId));
  if (!license) return jsonResponse(404, { success: false, error: 'License not found' });
  const access = await getWorkspaceAccess(license.workspace_id, userId);
  if (!access || !hasPermission(access.role, 'manage_licenses')) return jsonResponse(404, { success: false, error: 'Workspace not found or access denied' });
  await licensesRepo.delete(String(license.id));
  await broadcastWorkspaceEvent(license.workspace_id, 'LICENSE_UPDATE', { action: 'delete', id: String(license.id) });
  return jsonResponse(200, { success: true });
}

export async function toggleLicenseStatus(request, licenseId) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const license = await licensesRepo.getById(String(licenseId));
  if (!license) return jsonResponse(404, { success: false, error: 'License not found' });
  const access = await getWorkspaceAccess(license.workspace_id, userId);
  if (!access || !hasPermission(access.role, 'manage_licenses')) return jsonResponse(404, { success: false, error: 'Workspace not found or access denied' });
  const updated = await licensesRepo.update(String(license.id), { is_active: Number(license.is_active) ? 0 : 1 });
  await logAction(license.workspace_id, 'TOGGLE_LICENSE', `${license.key} -> ${updated.is_active ? 'active' : 'inactive'}`, request);
  await broadcastWorkspaceEvent(license.workspace_id, 'LICENSE_UPDATE', { action: 'toggle', id: String(license.id), is_active: Number(updated.is_active) });
  return jsonResponse(200, { success: true, is_active: updated.is_active });
}

export async function toggleHwidLock(request, licenseId) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const license = await licensesRepo.getById(String(licenseId));
  if (!license) return jsonResponse(404, { success: false, error: 'License not found' });
  const access = await getWorkspaceAccess(license.workspace_id, userId);
  if (!access || !hasPermission(access.role, 'manage_licenses')) return jsonResponse(404, { success: false, error: 'Workspace not found or access denied' });
  const updated = await licensesRepo.update(String(license.id), { hwid_lock: Number(license.hwid_lock) ? 0 : 1 });
  await broadcastWorkspaceEvent(license.workspace_id, 'LICENSE_UPDATE', { action: 'toggle_hwid_lock', id: String(license.id), hwid_lock: Number(updated.hwid_lock) });
  return jsonResponse(200, { success: true, hwid_lock: updated.hwid_lock });
}

export async function resetHwid(request, licenseId) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const license = await licensesRepo.getById(String(licenseId));
  if (!license) return jsonResponse(404, { success: false, error: 'License not found' });
  const access = await getWorkspaceAccess(license.workspace_id, userId);
  if (!access || !hasPermission(access.role, 'manage_licenses')) return jsonResponse(404, { success: false, error: 'Workspace not found or access denied' });
  await licensesRepo.update(String(license.id), { activated_hwid: null, activated_os: null });
  await broadcastWorkspaceEvent(license.workspace_id, 'LICENSE_UPDATE', { action: 'reset_hwid', id: String(license.id) });
  return jsonResponse(200, { success: true });
}

