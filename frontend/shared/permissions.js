export const ROLE_HIERARCHY = Object.freeze({
  owner: 4,
  admin: 3,
  editor: 2,
  viewer: 1,
  user: 1
});

export const WORKSPACE_PERMISSIONS = Object.freeze({
  owner: ['*'],
  admin: ['view', 'edit', 'manage_projects', 'manage_licenses', 'manage_access', 'manage_team', 'view_logs'],
  editor: ['view', 'edit', 'manage_projects', 'manage_licenses', 'view_logs'],
  viewer: ['view', 'view_logs']
});

export function hasPermission(role, permission) {
  const normalizedRole = String(role || 'viewer').toLowerCase();
  const list = WORKSPACE_PERMISSIONS[normalizedRole] || [];
  return list.includes('*') || list.includes(permission);
}

export function isWorkspaceRoleAtLeast(role, targetRole) {
  const current = ROLE_HIERARCHY[String(role || '').toLowerCase()] || 0;
  const required = ROLE_HIERARCHY[String(targetRole || '').toLowerCase()] || 0;
  return current >= required;
}

export function isSystemAdmin(user) {
  if (!user || typeof user !== 'object') return false;
  return String(user.status || 'active') === 'active' && String(user.role || '').toLowerCase() === 'admin';
}
