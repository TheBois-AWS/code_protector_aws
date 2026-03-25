import { broadcastToUser, broadcastToWorkspace } from '../services/websocket.js';

export async function broadcastWorkspaceEvent(workspaceId, type, data = {}) {
  if (!workspaceId) return 0;
  try {
    return await broadcastToWorkspace(String(workspaceId), { type, data });
  } catch (error) {
    console.error('workspace realtime broadcast failed', { workspaceId, type, error: error?.message || String(error) });
    return 0;
  }
}

export async function broadcastUserEvent(userId, type, data = {}) {
  if (!userId) return 0;
  try {
    return await broadcastToUser(String(userId), { type, data });
  } catch (error) {
    console.error('user realtime broadcast failed', { userId, type, error: error?.message || String(error) });
    return 0;
  }
}
