import { jsonResponse, parseJsonBody, unauthorized } from '../utils/http.js';
import { getUserIdFromRequest } from '../utils/auth.js';
import { usersRepo, workspaceInvitationsRepo, workspaceMembersRepo } from '../services/repositories.js';
import { nowIso, randomId } from '../utils/common.js';
import { ROLE_HIERARCHY, getWorkspaceAccess, hasPermission, listWorkspaceInvitations, listWorkspaceMembers, resolveWorkspace } from '../utils/workspace.js';
import { logAction } from './workspaceController.js';

export async function listTeamMembers(request, workspaceIdentifier) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const workspace = await resolveWorkspace(workspaceIdentifier);
  if (!workspace) return jsonResponse(404, { success: false, error: 'Workspace not found' });
  const access = await getWorkspaceAccess(workspace.id, userId);
  if (!access) return jsonResponse(403, { success: false, error: 'Access denied' });

  const owner = await usersRepo.getById(String(workspace.user_id));
  const members = [];
  for (const membership of await listWorkspaceMembers(workspace.id)) {
    const user = await usersRepo.getById(String(membership.user_id));
    if (!user) continue;
    members.push({
      id: membership.id,
      role: membership.role,
      created_at: membership.created_at,
      user_id: user.id,
      email: user.email,
      display_name: user.display_name || ''
    });
  }

  return jsonResponse(200, {
    success: true,
    owner: owner ? { id: owner.id, email: owner.email, display_name: owner.display_name || '', role: 'owner' } : null,
    members,
    invitations: await listWorkspaceInvitations(workspace.id),
    currentUserRole: access.role
  });
}

export async function inviteTeamMember(request, workspaceIdentifier) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const payload = parseJsonBody(request);
  if (!payload?.email) return jsonResponse(400, { success: false, error: 'Email required' });
  const role = ['admin', 'editor', 'viewer'].includes(String(payload.role || 'viewer')) ? String(payload.role || 'viewer') : null;
  if (!role) return jsonResponse(400, { success: false, error: 'Invalid role' });

  const workspace = await resolveWorkspace(workspaceIdentifier);
  if (!workspace) return jsonResponse(404, { success: false, error: 'Workspace not found' });
  const access = await getWorkspaceAccess(workspace.id, userId);
  if (!access || !hasPermission(access.role, 'manage_team')) return jsonResponse(403, { success: false, error: 'Permission denied' });
  if (access.role !== 'owner' && ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[access.role]) {
    return jsonResponse(403, { success: false, error: 'Cannot invite with equal or higher role' });
  }

  const email = String(payload.email).toLowerCase().trim();
  const existingUser = await usersRepo.findByEmail(email);
  if (existingUser) {
    if (String(existingUser.id) === String(workspace.user_id)) return jsonResponse(400, { success: false, error: 'Cannot invite workspace owner' });
    const existingMembership = await workspaceMembersRepo.findByWorkspaceAndUser(String(workspace.id), String(existingUser.id));
    if (existingMembership) return jsonResponse(400, { success: false, error: 'User is already a team member' });

    await workspaceMembersRepo.create({
      id: randomId(),
      workspace_id: workspace.id,
      user_id: existingUser.id,
      role,
      invited_by: userId,
      created_at: nowIso()
    });
    await logAction(workspace.id, 'TEAM_MEMBER_ADDED', `Added ${email} as ${role}`, request);
    return jsonResponse(200, { success: true, message: 'Member added successfully', added: true });
  }

  const existingInvite = await workspaceInvitationsRepo.findActiveByWorkspaceAndEmail(String(workspace.id), email);
  if (existingInvite) return jsonResponse(400, { success: false, error: 'Invitation already sent to this email' });

  const token = randomId();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await workspaceInvitationsRepo.create({
    id: randomId(),
    workspace_id: workspace.id,
    email,
    role,
    token,
    invited_by: userId,
    expires_at: expiresAt,
    created_at: nowIso()
  });
  await logAction(workspace.id, 'TEAM_INVITE_SENT', `Invited ${email} as ${role}`, request);

  const host = request.headers.host || request.headers.Host || '';
  const protocol = (request.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const inviteLink = `${protocol}://${host}/invite/${token}`;
  return jsonResponse(200, { success: true, message: 'Invitation created', inviteLink, token });
}

export async function updateTeamMember(request, workspaceIdentifier, memberId) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const payload = parseJsonBody(request);
  const role = String(payload?.role || '');
  if (!['admin', 'editor', 'viewer'].includes(role)) return jsonResponse(400, { success: false, error: 'Invalid role' });

  const workspace = await resolveWorkspace(workspaceIdentifier);
  if (!workspace) return jsonResponse(404, { success: false, error: 'Workspace not found' });
  const access = await getWorkspaceAccess(workspace.id, userId);
  if (!access || !hasPermission(access.role, 'manage_team')) return jsonResponse(403, { success: false, error: 'Permission denied' });

  const member = await workspaceMembersRepo.getById(String(memberId));
  if (!member || String(member.workspace_id) !== String(workspace.id)) return jsonResponse(404, { success: false, error: 'Member not found' });
  if (access.role !== 'owner') {
    if (ROLE_HIERARCHY[member.role] >= ROLE_HIERARCHY[access.role]) return jsonResponse(403, { success: false, error: 'Cannot modify this member' });
    if (ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[access.role]) return jsonResponse(403, { success: false, error: 'Cannot assign equal or higher role' });
  }

  await workspaceMembersRepo.update(String(member.id), { role });
  await logAction(workspace.id, 'TEAM_ROLE_UPDATED', `Changed member ${member.id} role to ${role}`, request);
  return jsonResponse(200, { success: true });
}

export async function removeTeamMember(request, workspaceIdentifier, memberId) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const workspace = await resolveWorkspace(workspaceIdentifier);
  if (!workspace) return jsonResponse(404, { success: false, error: 'Workspace not found' });
  const access = await getWorkspaceAccess(workspace.id, userId);
  if (!access) return jsonResponse(403, { success: false, error: 'Access denied' });

  const member = await workspaceMembersRepo.getById(String(memberId));
  if (!member || String(member.workspace_id) !== String(workspace.id)) return jsonResponse(404, { success: false, error: 'Member not found' });
  if (String(member.user_id) === String(userId)) {
    await workspaceMembersRepo.delete(String(member.id));
    await logAction(workspace.id, 'TEAM_MEMBER_LEFT', `User ${userId} left workspace`, request);
    return jsonResponse(200, { success: true, left: true });
  }
  if (!hasPermission(access.role, 'manage_team')) return jsonResponse(403, { success: false, error: 'Permission denied' });
  if (access.role !== 'owner' && ROLE_HIERARCHY[member.role] >= ROLE_HIERARCHY[access.role]) return jsonResponse(403, { success: false, error: 'Cannot remove this member' });
  await workspaceMembersRepo.delete(String(member.id));
  await logAction(workspace.id, 'TEAM_MEMBER_REMOVED', `Removed member ${member.id}`, request);
  return jsonResponse(200, { success: true });
}

export async function cancelInvitation(request, workspaceIdentifier, inviteId) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const workspace = await resolveWorkspace(workspaceIdentifier);
  if (!workspace) return jsonResponse(404, { success: false, error: 'Workspace not found' });
  const access = await getWorkspaceAccess(workspace.id, userId);
  if (!access || !hasPermission(access.role, 'manage_team')) return jsonResponse(403, { success: false, error: 'Permission denied' });
  const invitation = await workspaceInvitationsRepo.getById(String(inviteId));
  if (!invitation || String(invitation.workspace_id) !== String(workspace.id)) return jsonResponse(404, { success: false, error: 'Invitation not found' });
  await workspaceInvitationsRepo.delete(String(invitation.id));
  return jsonResponse(200, { success: true });
}

export async function getInvitationDetails(request, token) {
  const invitation = await workspaceInvitationsRepo.findByToken(String(token));
  if (!invitation || (invitation.expires_at && new Date(invitation.expires_at).getTime() <= Date.now())) {
    return jsonResponse(404, { success: false, error: 'Invalid or expired invitation' });
  }
  const workspace = await resolveWorkspace(String(invitation.workspace_id));
  const inviter = await usersRepo.getById(String(invitation.invited_by));
  return jsonResponse(200, {
    success: true,
    invitation: {
      email: invitation.email,
      role: invitation.role,
      workspaceName: workspace?.name || 'Workspace',
      invitedBy: inviter?.display_name || inviter?.email || 'Unknown',
      expiresAt: invitation.expires_at
    }
  });
}

export async function acceptInvitation(request, token) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return jsonResponse(401, { success: false, error: 'Please login first' });

  const invitation = await workspaceInvitationsRepo.findByToken(String(token));
  if (!invitation || (invitation.expires_at && new Date(invitation.expires_at).getTime() <= Date.now())) {
    return jsonResponse(404, { success: false, error: 'Invalid or expired invitation' });
  }

  const user = await usersRepo.getById(String(userId));
  if (!user) return jsonResponse(404, { success: false, error: 'User not found' });
  if (String(invitation.email).toLowerCase() !== String(user.email).toLowerCase()) {
    return jsonResponse(403, { success: false, error: 'Invitation is for a different email address' });
  }

  const existingMembership = await workspaceMembersRepo.findByWorkspaceAndUser(String(invitation.workspace_id), String(userId));
  if (!existingMembership) {
    await workspaceMembersRepo.create({
      id: randomId(),
      workspace_id: invitation.workspace_id,
      user_id: userId,
      role: invitation.role,
      invited_by: invitation.invited_by,
      created_at: nowIso()
    });
  }
  await workspaceInvitationsRepo.delete(String(invitation.id));

  const workspace = await resolveWorkspace(String(invitation.workspace_id));
  await logAction(invitation.workspace_id, 'TEAM_INVITE_ACCEPTED', `${user.email} joined as ${invitation.role}`, request);
  return jsonResponse(200, {
    success: true,
    message: `Joined ${workspace?.name || 'workspace'} as ${invitation.role}`,
    workspaceId: invitation.workspace_id,
    workspaceName: workspace?.name || 'Workspace',
    role: invitation.role
  });
}
