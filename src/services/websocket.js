import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { websocketConnectionsRepo } from './repositories.js';
import { config } from '../config.js';

const clientsByEndpoint = new Map();

function normalizeEndpoint(endpoint) {
  if (!endpoint) return '';
  return String(endpoint).replace(/\/+$/, '');
}

function getClient(endpoint) {
  const normalized = normalizeEndpoint(endpoint);
  if (!normalized) return null;
  if (!clientsByEndpoint.has(normalized)) {
    clientsByEndpoint.set(normalized, new ApiGatewayManagementApiClient({ endpoint: normalized }));
  }
  return clientsByEndpoint.get(normalized);
}

function getStatusCode(error) {
  return error?.$metadata?.httpStatusCode || error?.statusCode || 0;
}

async function sendToConnection(connection, message, endpointHint = '') {
  const endpoint = normalizeEndpoint(endpointHint || connection.endpoint || config.wsApiEndpoint);
  const client = getClient(endpoint);
  if (!client) return false;

  try {
    await client.send(new PostToConnectionCommand({
      ConnectionId: String(connection.connection_id),
      Data: Buffer.from(JSON.stringify(message))
    }));
    return true;
  } catch (error) {
    const statusCode = getStatusCode(error);
    if (statusCode === 410 || String(error?.name || '') === 'GoneException') {
      await websocketConnectionsRepo.deleteByConnectionId(String(connection.connection_id));
      return false;
    }
    console.error('websocket send failed', {
      connectionId: connection.connection_id,
      endpoint,
      statusCode,
      message: error?.message || String(error)
    });
    return false;
  }
}

export async function broadcastToWorkspace(workspaceId, message, endpointHint = '') {
  const connections = await websocketConnectionsRepo.listByWorkspace(String(workspaceId));
  const targets = connections.filter((connection) => !connection.channel || connection.channel === 'workspace');
  if (!targets.length) return 0;
  let delivered = 0;
  for (const connection of targets) {
    if (await sendToConnection(connection, message, endpointHint)) delivered += 1;
  }
  return delivered;
}

export async function broadcastToUser(userId, message, endpointHint = '') {
  const connections = await websocketConnectionsRepo.listByUser(String(userId));
  const targets = connections.filter((connection) => !connection.channel || connection.channel === 'user');
  if (!targets.length) return 0;
  let delivered = 0;
  for (const connection of targets) {
    if (await sendToConnection(connection, message, endpointHint)) delivered += 1;
  }
  return delivered;
}

export async function broadcastToChannel(channel, message, endpointHint = '') {
  const normalizedChannel = String(channel || '').trim();
  if (!normalizedChannel) return 0;
  const connections = await websocketConnectionsRepo.listByChannel(normalizedChannel);
  if (!connections.length) return 0;
  let delivered = 0;
  for (const connection of connections) {
    if (await sendToConnection(connection, message, endpointHint)) delivered += 1;
  }
  return delivered;
}

export async function closeConnection(connectionId) {
  await websocketConnectionsRepo.deleteByConnectionId(String(connectionId));
}
