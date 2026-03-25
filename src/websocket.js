import { getUserIdFromRequest } from './utils/auth.js';
import { getWorkspaceAccess, hasPermission, resolveWorkspace } from './utils/workspace.js';
import { websocketConnectionsRepo } from './services/repositories.js';
import { nowIso } from './utils/common.js';
import { config } from './config.js';

function json(statusCode, payload) {
  return {
    statusCode,
    body: JSON.stringify(payload)
  };
}

function normalizeHeaders(rawHeaders = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(rawHeaders || {})) {
    normalized[key] = value;
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
}

function parseTarget(query = {}) {
  const legacyPath = String(query.path || query.ws_path || query.route || '').trim();
  if (legacyPath) {
    const logsMatch = legacyPath.match(/^\/api\/ws\/logs\/([\w-]+)$/);
    if (logsMatch) return { kind: 'workspace', workspaceIdentifier: logsMatch[1] };
    const userMatch = legacyPath.match(/^\/api\/ws\/user\/([\w-]+)$/);
    if (userMatch) return { kind: 'user', userId: userMatch[1] };
  }

  const channel = String(query.channel || '').toLowerCase().trim();
  if (channel === 'logs' || channel === 'workspace') {
    const workspaceIdentifier = String(query.workspaceId || query.workspace_id || query.id || '').trim();
    if (workspaceIdentifier) return { kind: 'workspace', workspaceIdentifier };
  }
  if (channel === 'user') {
    const userId = String(query.userId || query.user_id || query.id || '').trim();
    if (userId) return { kind: 'user', userId };
  }

  return null;
}

function normalizeEndpoint(endpoint) {
  return String(endpoint || '').replace(/\/+$/, '');
}

function endpointFromRequestContext(requestContext = {}) {
  if (requestContext.domainName) {
    const stage = requestContext.stage ? `/${requestContext.stage}` : '';
    return normalizeEndpoint(`https://${requestContext.domainName}${stage}`);
  }
  return normalizeEndpoint(config.wsApiEndpoint);
}

async function authenticateConnect(event) {
  const headers = normalizeHeaders(event.headers || {});
  const query = event.queryStringParameters || {};
  if (query.token && !headers.authorization) headers.authorization = String(query.token);
  return await getUserIdFromRequest({ headers, query });
}

async function handleConnect(event) {
  const connectionId = String(event.requestContext?.connectionId || '');
  if (!connectionId) return json(400, { success: false, error: 'Missing connection ID' });

  const userId = await authenticateConnect(event);
  if (!userId) return json(401, { success: false, error: 'Unauthorized' });

  const query = event.queryStringParameters || {};
  const target = parseTarget(query);
  if (!target) return json(400, { success: false, error: 'Invalid channel' });

  const endpoint = endpointFromRequestContext(event.requestContext);
  const baseConnection = {
    connection_id: connectionId,
    user_id: String(userId),
    endpoint,
    created_at: nowIso(),
    expires_at: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60)
  };

  if (target.kind === 'workspace') {
    const workspace = await resolveWorkspace(target.workspaceIdentifier);
    if (!workspace) return json(404, { success: false, error: 'Workspace not found' });
    const access = await getWorkspaceAccess(String(workspace.id), String(userId));
    if (!access || !hasPermission(access.role, 'view_logs')) return json(403, { success: false, error: 'Forbidden' });

    await websocketConnectionsRepo.putConnection({
      ...baseConnection,
      channel: 'workspace',
      workspace_id: String(workspace.id)
    });
    return json(200, { success: true });
  }

  if (String(target.userId) !== String(userId)) {
    return json(401, { success: false, error: 'Unauthorized' });
  }

  await websocketConnectionsRepo.putConnection({
    ...baseConnection,
    channel: 'user',
    workspace_id: undefined
  });
  return json(200, { success: true });
}

async function handleDisconnect(event) {
  const connectionId = String(event.requestContext?.connectionId || '');
  if (connectionId) await websocketConnectionsRepo.deleteByConnectionId(connectionId);
  return json(200, { success: true });
}

async function handleDefault(event) {
  const routeKey = String(event.requestContext?.routeKey || '$default');
  if (routeKey === 'ping') return json(200, { success: true, pong: true });
  return json(200, { success: true });
}

export async function handleWebSocketEvent(event) {
  const routeKey = String(event.requestContext?.routeKey || '$default');

  try {
    if (routeKey === '$connect') return await handleConnect(event);
    if (routeKey === '$disconnect') return await handleDisconnect(event);
    return await handleDefault(event);
  } catch (error) {
    console.error('websocket handler error', error);
    return json(500, { success: false, error: 'Internal server error' });
  }
}
