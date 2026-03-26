import * as authController from './controllers/authController.js';
import * as workspaceController from './controllers/workspaceController.js';
import * as projectController from './controllers/projectController.js';
import * as fileController from './controllers/fileController.js';
import * as licenseController from './controllers/licenseController.js';
import * as accessController from './controllers/accessController.js';
import * as teamController from './controllers/teamController.js';
import * as loaderController from './controllers/loaderController.js';
import * as adminController from './controllers/adminController.js';
import { jsonResponse, methodNotAllowed, notFound } from './utils/http.js';
import { config } from './config.js';

const routes = [
  // Health
  { method: 'GET', path: '/api/health', handler: async () => jsonResponse(200, { success: true, service: 'code_protector_aws' }) },
  { method: 'GET', path: '/api/ws/config', handler: async () => jsonResponse(200, {
    success: true,
    endpoint: config.wsApiEndpoint ? String(config.wsApiEndpoint).replace(/^http/i, 'ws') : null
  }) },

  // Auth
  { method: 'POST', path: '/api/login', handler: (req) => authController.login(req) },
  { method: 'POST', path: '/api/register', handler: (req) => authController.register(req) },
  { method: 'POST', path: '/api/user/password', handler: (req) => authController.changePassword(req) },
  { method: 'GET', path: '/api/user/profile', handler: (req) => authController.getProfile(req) },
  { method: 'PUT', path: '/api/user/profile', handler: (req) => authController.updateProfile(req) },
  { method: 'GET', path: '/api/user/stats', handler: (req) => authController.getUserStats(req) },
  { method: 'DELETE', path: '/api/user/account', handler: (req) => authController.deleteAccount(req) },

  // Admin
  { method: 'GET', path: '/api/admin/overview', handler: (req) => adminController.getAdminOverview(req) },
  { method: 'GET', path: '/api/admin/users', handler: (req) => adminController.listAdminUsers(req) },
  { method: 'GET', path: '/api/admin/users/:id', handler: (req, params) => adminController.getAdminUser(req, params.id) },
  { method: 'PATCH', path: '/api/admin/users/:id', handler: (req, params) => adminController.patchAdminUser(req, params.id) },
  { method: 'POST', path: '/api/admin/users/:id/suspend', handler: (req, params) => adminController.suspendAdminUser(req, params.id) },
  { method: 'POST', path: '/api/admin/users/:id/activate', handler: (req, params) => adminController.activateAdminUser(req, params.id) },
  { method: 'DELETE', path: '/api/admin/users/:id', handler: (req, params) => adminController.deleteAdminUser(req, params.id) },
  { method: 'GET', path: '/api/admin/workspaces', handler: (req) => adminController.listAdminWorkspaces(req) },
  { method: 'GET', path: '/api/admin/workspaces/:id', handler: (req, params) => adminController.getAdminWorkspace(req, params.id) },
  { method: 'POST', path: '/api/admin/workspaces/:id/suspend', handler: (req, params) => adminController.suspendAdminWorkspace(req, params.id) },
  { method: 'POST', path: '/api/admin/workspaces/:id/activate', handler: (req, params) => adminController.activateAdminWorkspace(req, params.id) },
  { method: 'DELETE', path: '/api/admin/workspaces/:id', handler: (req, params) => adminController.deleteAdminWorkspace(req, params.id) },
  { method: 'GET', path: '/api/admin/audit', handler: (req) => adminController.getAdminAudit(req) },
  { method: 'GET', path: '/api/admin/aws/services', handler: (req) => adminController.getAdminAwsServices(req) },
  { method: 'POST', path: '/api/admin/guard/start', handler: (req) => adminController.startAdminGuard(req) },
  { method: 'POST', path: '/api/admin/guard/verify', handler: (req) => adminController.verifyAdminGuard(req) },

  // Workspaces
  { method: 'GET', path: '/api/workspaces', handler: (req) => workspaceController.listWorkspaces(req) },
  { method: 'POST', path: '/api/workspaces', handler: (req) => workspaceController.createWorkspace(req) },
  { method: 'GET', path: '/api/workspaces/:id', handler: (req, params) => workspaceController.getWorkspaceDetails(req, params.id) },
  { method: 'PUT', path: '/api/workspaces/:id/settings', handler: (req, params) => workspaceController.updateWorkspaceSettings(req, params.id) },
  { method: 'DELETE', path: '/api/workspaces/:id', handler: (req, params) => workspaceController.deleteWorkspace(req, params.id) },
  { method: 'GET', path: '/api/workspaces/:id/logs', handler: (req, params) => workspaceController.getWorkspaceLogs(req, params.id) },
  { method: 'DELETE', path: '/api/workspaces/:id/logs', handler: (req, params) => workspaceController.clearWorkspaceLogs(req, params.id) },
  { method: 'POST', path: '/api/workspaces/:id/pin', handler: (req, params) => workspaceController.setWorkspacePin(req, params.id) },
  { method: 'POST', path: '/api/workspaces/:id/pin/verify', handler: (req, params) => workspaceController.verifyWorkspacePin(req, params.id) },
  { method: 'DELETE', path: '/api/workspaces/:id/pin', handler: (req, params) => workspaceController.removeWorkspacePin(req, params.id) },

  // Projects (+ script aliases)
  { method: 'POST', path: '/api/workspaces/:id/projects', handler: (req, params) => projectController.createProject(req, params.id) },
  { method: 'PUT', path: '/api/projects/:id', handler: (req, params) => projectController.updateProject(req, params.id) },
  { method: 'DELETE', path: '/api/projects/:id', handler: (req, params) => projectController.deleteProject(req, params.id) },
  { method: 'PUT', path: '/api/projects/:id/settings', handler: (req, params) => projectController.updateProjectSettings(req, params.id) },
  { method: 'POST', path: '/api/projects/:id/toggle-active', handler: (req, params) => projectController.toggleProjectActive(req, params.id) },
  { method: 'POST', path: '/api/projects/:id/reset-stats', handler: (req, params) => projectController.resetProjectStats(req, params.id) },
  { method: 'PUT', path: '/api/projects/:id/rename', handler: (req, params) => projectController.renameProject(req, params.id) },
  { method: 'POST', path: '/api/workspaces/:id/scripts', handler: (req, params) => projectController.createProject(req, params.id) },
  { method: 'PUT', path: '/api/scripts/:id', handler: (req, params) => projectController.updateProject(req, params.id) },
  { method: 'DELETE', path: '/api/scripts/:id', handler: (req, params) => projectController.deleteProject(req, params.id) },
  { method: 'PUT', path: '/api/scripts/:id/settings', handler: (req, params) => projectController.updateProjectSettings(req, params.id) },
  { method: 'POST', path: '/api/scripts/:id/toggle-active', handler: (req, params) => projectController.toggleProjectActive(req, params.id) },
  { method: 'POST', path: '/api/scripts/:id/reset-stats', handler: (req, params) => projectController.resetProjectStats(req, params.id) },
  { method: 'PUT', path: '/api/scripts/:id/rename', handler: (req, params) => projectController.renameProject(req, params.id) },

  // File management
  { method: 'GET', path: '/api/projects/:id/files', handler: (req, params) => fileController.getFileTree(req, params.id) },
  { method: 'GET', path: '/api/projects/:id/files/:fileId/content', handler: (req, params) => fileController.getFileContent(req, params.id, params.fileId) },
  { method: 'POST', path: '/api/projects/:id/files', handler: (req, params) => fileController.createFile(req, params.id) },
  { method: 'PUT', path: '/api/projects/:id/files/:fileId', handler: (req, params) => fileController.updateFileContent(req, params.id, params.fileId) },
  { method: 'PUT', path: '/api/projects/:id/files/:fileId/rename', handler: (req, params) => fileController.renameFile(req, params.id, params.fileId) },
  { method: 'PUT', path: '/api/projects/:id/files/:fileId/move', handler: (req, params) => fileController.moveFile(req, params.id, params.fileId) },
  { method: 'DELETE', path: '/api/projects/:id/files/:fileId', handler: (req, params) => fileController.deleteFile(req, params.id, params.fileId) },
  { method: 'POST', path: '/api/projects/:id/files/upload', handler: (req, params) => fileController.uploadFile(req, params.id) },
  { method: 'POST', path: '/api/projects/:id/files/search', handler: (req, params) => fileController.searchFiles(req, params.id) },
  { method: 'POST', path: '/api/projects/:id/files/:fileId/copy', handler: (req, params) => fileController.copyFile(req, params.id, params.fileId) },
  { method: 'PUT', path: '/api/projects/:id/files/:fileId/entry-point', handler: (req, params) => fileController.setEntryPoint(req, params.id, params.fileId) },
  { method: 'POST', path: '/api/projects/:id/files/batch', handler: (req, params) => fileController.batchOperation(req, params.id) },
  { method: 'POST', path: '/api/projects/:id/bundle', handler: (req, params) => fileController.generateBundle(req, params.id) },

  // Licenses
  { method: 'GET', path: '/api/workspaces/:id/licenses', handler: (req, params) => licenseController.listLicenses(req, params.id) },
  { method: 'POST', path: '/api/workspaces/:id/licenses', handler: (req, params) => licenseController.createLicense(req, params.id) },
  { method: 'POST', path: '/api/workspaces/:id/licenses/batch', handler: (req, params) => licenseController.batchCreateLicenses(req, params.id) },
  { method: 'GET', path: '/api/workspaces/:id/licenses/export', handler: (req, params) => licenseController.exportLicenses(req, params.id) },
  { method: 'DELETE', path: '/api/licenses/:id', handler: (req, params) => licenseController.deleteLicense(req, params.id) },
  { method: 'POST', path: '/api/licenses/:id/toggle', handler: (req, params) => licenseController.toggleLicenseStatus(req, params.id) },
  { method: 'POST', path: '/api/licenses/:id/toggle-lock', handler: (req, params) => licenseController.toggleHwidLock(req, params.id) },
  { method: 'POST', path: '/api/licenses/:id/reset-hwid', handler: (req, params) => licenseController.resetHwid(req, params.id) },

  // Access lists
  { method: 'GET', path: '/api/workspaces/:id/access-lists', handler: (req, params) => accessController.listAccessRules(req, params.id) },
  { method: 'POST', path: '/api/workspaces/:id/access-lists', handler: (req, params) => accessController.createAccessRule(req, params.id) },
  { method: 'DELETE', path: '/api/access-lists/:id', handler: (req, params) => accessController.deleteAccessRule(req, params.id) },

  // Team
  { method: 'GET', path: '/api/workspaces/:id/team', handler: (req, params) => teamController.listTeamMembers(req, params.id) },
  { method: 'POST', path: '/api/workspaces/:id/team/invite', handler: (req, params) => teamController.inviteTeamMember(req, params.id) },
  { method: 'PUT', path: '/api/workspaces/:id/team/:memberId', handler: (req, params) => teamController.updateTeamMember(req, params.id, params.memberId) },
  { method: 'DELETE', path: '/api/workspaces/:id/team/:memberId', handler: (req, params) => teamController.removeTeamMember(req, params.id, params.memberId) },
  { method: 'DELETE', path: '/api/workspaces/:id/invitations/:inviteId', handler: (req, params) => teamController.cancelInvitation(req, params.id, params.inviteId) },
  { method: 'GET', path: '/api/invitations/:token', handler: (req, params) => teamController.getInvitationDetails(req, params.token) },
  { method: 'POST', path: '/api/invitations/:token/accept', handler: (req, params) => teamController.acceptInvitation(req, params.token) },

  // Loaders
  { method: 'GET', path: '/files/:id.py', handler: (req, params) => loaderController.getUnifiedLoader(req, params.id) },
  { method: 'GET', path: '/files/:id.js', handler: (req, params) => loaderController.getUnifiedLoaderJS(req, params.id) },
  { method: 'GET', path: '/files/:id.lua', handler: (req, params) => loaderController.getUnifiedLoaderLua(req, params.id) },
  { method: 'GET', path: '/api/v5/execute', handler: (req) => loaderController.executeScript(req) },
  { method: 'POST', path: '/api/v5/handshake', handler: (req) => loaderController.ecdhHandshake(req) }
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compilePath(path) {
  const keys = [];
  const regexPattern = path
    .split('/')
    .map((segment) => {
      if (!segment) return '';
      if (segment.includes(':')) {
        let transformed = '';
        let cursor = 0;
        const matcher = /:([A-Za-z0-9_]+)/g;
        let match = matcher.exec(segment);
        while (match) {
          const [token, key] = match;
          keys.push(key);
          transformed += escapeRegex(segment.slice(cursor, match.index));
          transformed += `(?<${key}>[^/]+)`;
          cursor = match.index + token.length;
          match = matcher.exec(segment);
        }
        transformed += escapeRegex(segment.slice(cursor));
        return transformed;
      }
      return escapeRegex(segment);
    })
    .join('/');

  return {
    path,
    regex: new RegExp(`^${regexPattern}$`),
    keys
  };
}

const compiledRoutes = routes.map((route) => ({ ...route, ...compilePath(route.path) }));

export async function routeRequest(request) {
  const method = String(request.method || 'GET').toUpperCase();
  const path = request.path || '/';

  const samePath = compiledRoutes.filter((route) => route.regex.test(path));
  if (!samePath.length) return notFound();

  const matched = samePath.find((route) => route.method === method);
  if (!matched) return methodNotAllowed();

  const params = path.match(matched.regex)?.groups || {};
  return await matched.handler(request, params);
}
