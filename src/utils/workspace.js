import { accessListsRepo, logsRepo, projectsRepo, workspaceInvitationsRepo, workspaceMembersRepo, workspacesRepo } from '../services/repositories.js';

export const ROLE_HIERARCHY = {
  owner: 4,
  admin: 3,
  editor: 2,
  viewer: 1
};

export const PERMISSIONS = {
  owner: ['*'],
  admin: ['view', 'edit', 'manage_projects', 'manage_licenses', 'manage_access', 'manage_team', 'view_logs'],
  editor: ['view', 'edit', 'manage_projects', 'manage_licenses', 'view_logs'],
  viewer: ['view', 'view_logs']
};

export function hasPermission(role, permission) {
  const permissions = PERMISSIONS[role] || [];
  return permissions.includes('*') || permissions.includes(permission);
}

export async function resolveWorkspace(identifier) {
  if (!identifier) return null;
  return (await workspacesRepo.getById(String(identifier))) || (await workspacesRepo.findByLoaderKey(String(identifier)));
}

export async function getWorkspaceAccess(workspaceId, userId) {
  const workspace = await workspacesRepo.getById(String(workspaceId));
  if (!workspace) return null;
  if (String(workspace.user_id) === String(userId)) {
    return { workspace, role: 'owner', isOwner: true };
  }
  const member = await workspaceMembersRepo.findByWorkspaceAndUser(String(workspaceId), String(userId));
  if (!member) return null;
  return { workspace, role: member.role || 'viewer', isOwner: false, member };
}

export async function listWorkspaceInvitations(workspaceId) {
  const now = Date.now();
  const invitations = await workspaceInvitationsRepo.listByWorkspace(String(workspaceId));
  return invitations.filter((item) => !item.expires_at || new Date(item.expires_at).getTime() > now);
}

export async function listWorkspaceLogs(workspaceId) {
  const logs = await logsRepo.listByWorkspace(String(workspaceId));
  return [...logs].sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')));
}

export async function listWorkspaceProjects(workspaceId) {
  const projects = await projectsRepo.listByWorkspace(String(workspaceId));
  return [...projects].sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')));
}

export async function listWorkspaceMembers(workspaceId) {
  const members = await workspaceMembersRepo.listByWorkspace(String(workspaceId));
  return [...members].sort((left, right) => String(left.created_at || '').localeCompare(String(right.created_at || '')));
}

export async function listWorkspaceAccessRules(workspaceId) {
  const items = await accessListsRepo.listByWorkspace(String(workspaceId));
  return [...items].sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')));
}
