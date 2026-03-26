import { createCookie, jsonResponse, parseJsonBody, serverError, unauthorized } from '../utils/http.js';
import { buildRateLimitKey, checkRateLimit } from '../utils/rateLimit.js';
import { generateAuthToken, getUserIdFromRequest, hashPassword, verifyPassword } from '../utils/auth.js';
import { licensesRepo, logsRepo, projectFilesRepo, projectsRepo, usersRepo, workspaceMembersRepo, workspacesRepo } from '../services/repositories.js';
import { config } from '../config.js';
import { storage } from '../services/storage.js';
import { nowIso, randomId, sortByDateDesc, unixNow } from '../utils/common.js';
import { destroyWorkspaceData } from './workspaceController.js';
import { broadcastAdminEvent } from '../utils/realtime.js';

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function login(request) {
  const payload = parseJsonBody(request);
  if (!payload) return jsonResponse(400, { success: false, error: 'Invalid JSON' });

  const ipLimit = await checkRateLimit(buildRateLimitKey('login', request), 60, 10);
  const emailLimit = await checkRateLimit(buildRateLimitKey('login_email', request, String(payload.email || '').toLowerCase().trim() || 'missing'), 60, 5);
  if (!ipLimit.allowed || !emailLimit.allowed) {
    return jsonResponse(429, { success: false, error: 'Rate limited' }, { 'retry-after': String(Math.max(ipLimit.retryAfterSeconds, emailLimit.retryAfterSeconds)) });
  }

  const email = String(payload.email || '').toLowerCase().trim();
  const password = String(payload.password || '');
  if (!email || !password) return jsonResponse(400, { success: false, error: 'Missing fields' });
  if (!emailRegex.test(email)) return jsonResponse(400, { success: false, error: 'Invalid email' });

  try {
    const user = await usersRepo.findByEmail(email);
    if (!user) return jsonResponse(401, { success: false, error: 'Invalid email or password' });
    if (user.status && user.status !== 'active') return jsonResponse(403, { success: false, error: 'Account is disabled' });

    const verified = await verifyPassword(password, user.password);
    if (!verified.ok) return jsonResponse(401, { success: false, error: 'Invalid email or password' });

    if (verified.needsUpgrade) {
      await usersRepo.update(user.id, { password: await hashPassword(password) });
    }

    const token = await generateAuthToken(user.id);
    return jsonResponse(200, {
      success: true,
      token,
      user: { id: user.id, email: user.email, name: user.display_name || '' },
      message: 'Login successful'
    }, {}, [createCookie('token', token, {
      path: '/',
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'Lax',
      maxAge: 60 * 60 * 24 * 7
    })]);
  } catch (error) {
    console.error('login error', error);
    return serverError();
  }
}

export async function register(request) {
  const payload = parseJsonBody(request);
  if (!payload) return jsonResponse(400, { success: false, error: 'Invalid JSON' });

  const rateLimit = await checkRateLimit(buildRateLimitKey('register', request), 60, 5);
  if (!rateLimit.allowed) {
    return jsonResponse(429, { success: false, error: 'Rate limited' }, { 'retry-after': String(rateLimit.retryAfterSeconds) });
  }

  const email = String(payload.email || '').toLowerCase().trim();
  const password = String(payload.password || '');
  const confirmPassword = String(payload.confirmPassword || payload.confirm_password || '');

  if (!email || !password) return jsonResponse(400, { success: false, error: 'Missing fields' });
  if (!emailRegex.test(email)) return jsonResponse(400, { success: false, error: 'Invalid email' });
  if (password.length < 8) return jsonResponse(400, { success: false, error: 'Password must be at least 8 characters' });
  if (password !== confirmPassword) return jsonResponse(400, { success: false, error: 'Passwords do not match' });
  if (await usersRepo.findByEmail(email)) return jsonResponse(409, { success: false, error: 'Email already exists' });

  try {
    const newUserId = randomId();
    await usersRepo.create({
      id: newUserId,
      email,
      password: await hashPassword(password),
      display_name: '',
      role: 'user',
      status: 'active',
      created_at: nowIso(),
      password_changed_at: 0
    });
    await broadcastAdminEvent('USER_REGISTERED', { user_id: newUserId, email });
    return jsonResponse(201, { success: true, message: 'Account created' });
  } catch (error) {
    console.error('register error', error);
    return serverError();
  }
}

export async function getProfile(request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();

  const user = await usersRepo.getById(userId);
  if (!user) return jsonResponse(404, { success: false, error: 'User not found' });

  return jsonResponse(200, {
    success: true,
    user: {
      id: user.id,
      email: user.email,
      display_name: user.display_name || '',
      role: user.role || 'user',
      status: user.status || 'active',
      created_at: user.created_at
    }
  });
}

export async function updateProfile(request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const payload = parseJsonBody(request);
  if (!payload) return jsonResponse(400, { success: false, error: 'Invalid JSON' });

  const displayName = String(payload.display_name || '');
  await usersRepo.update(userId, { display_name: displayName });
  await broadcastAdminEvent('USER_PROFILE_UPDATED', { user_id: String(userId), display_name: displayName });
  return jsonResponse(200, { success: true, message: 'Profile updated' });
}

export async function changePassword(request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const payload = parseJsonBody(request);
  if (!payload) return jsonResponse(400, { success: false, error: 'Invalid JSON' });

  const user = await usersRepo.getById(userId);
  if (!user) return unauthorized();
  if (!payload.currentPassword || !payload.newPassword) return jsonResponse(400, { success: false, error: 'Missing fields' });
  if (String(payload.newPassword).length < 8) return jsonResponse(400, { success: false, error: 'Password must be at least 8 characters' });

  const verified = await verifyPassword(String(payload.currentPassword), user.password);
  if (!verified.ok) return jsonResponse(401, { success: false, error: 'Current password is incorrect' });

  await usersRepo.update(userId, {
    password: await hashPassword(String(payload.newPassword)),
    password_changed_at: unixNow()
  });

  await broadcastAdminEvent('USER_PASSWORD_CHANGED', { user_id: String(userId) });

  return jsonResponse(200, { success: true, message: 'Password changed successfully' });
}

export async function deleteAccount(request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const payload = parseJsonBody(request);
  if (!payload) return jsonResponse(400, { success: false, error: 'Invalid JSON' });

  const user = await usersRepo.getById(userId);
  if (!user) return unauthorized();
  const verified = await verifyPassword(String(payload.password || ''), user.password);
  if (!verified.ok) return jsonResponse(401, { success: false, error: 'Password is incorrect' });

  try {
    const ownedWorkspaces = await workspacesRepo.listByOwner(userId);
    for (const workspace of ownedWorkspaces) {
      await destroyWorkspaceData(String(workspace.id));
    }

    const sharedMemberships = await workspaceMembersRepo.listByUser(userId);
    for (const membership of sharedMemberships) {
      await workspaceMembersRepo.delete(String(membership.id));
    }

    await usersRepo.delete(userId);
    await broadcastAdminEvent('USER_DELETED', { user_id: String(userId), source: 'self_service' });
    return jsonResponse(200, { success: true, message: 'Account deleted' }, {}, [createCookie('token', '', {
      path: '/',
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'Lax',
      maxAge: 0
    })]);
  } catch (error) {
    console.error('delete account error', error);
    return serverError();
  }
}

export async function getUserStats(request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();

  const workspaces = await workspacesRepo.listByOwner(userId);
  const sharedWorkspaces = await workspaceMembersRepo.listByUser(userId);
  const uniqueWorkspaceIds = new Set([...workspaces.map((item) => String(item.id)), ...sharedWorkspaces.map((item) => String(item.workspace_id))]);

  let projectCount = 0;
  let licenseCount = 0;
  let logCount = 0;

  for (const workspaceId of uniqueWorkspaceIds) {
    projectCount += (await projectsRepo.listByWorkspace(workspaceId)).length;
    licenseCount += (await licensesRepo.listByWorkspace(workspaceId)).length;
    logCount += (await logsRepo.listByWorkspace(workspaceId)).length;
  }

  return jsonResponse(200, {
    success: true,
    stats: {
      workspaces: uniqueWorkspaceIds.size,
      projects: projectCount,
      scripts: projectCount,
      licenses: licenseCount,
      logs: logCount
    }
  });
}
