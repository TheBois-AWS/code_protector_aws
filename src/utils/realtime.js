import { broadcastToChannel, broadcastToUser, broadcastToWorkspace } from '../services/websocket.js';

export async function broadcastWorkspaceEvent(workspaceId, type, data = {}) {
  if (!workspaceId) return 0;
  try {
    const normalizedWorkspaceId = String(workspaceId);
    const delivered = await broadcastToWorkspace(normalizedWorkspaceId, { type, data });

    // Mirror non-log workspace events to system admin channel for global realtime visibility.
    const normalizedType = String(type || '').toUpperCase();
    if (normalizedType && normalizedType !== 'LOG') {
      await broadcastAdminEvent(`WORKSPACE_${normalizedType}`, {
        workspace_id: normalizedWorkspaceId,
        ...data
      });
    }

    return delivered;
  } catch (error) {
    console.error('workspace realtime broadcast failed', { workspaceId, type, error: error?.message || String(error) });
    return 0;
  }
}

export async function broadcastUserEvent(userId, type, data = {}) {
  if (!userId) return 0;
  try {
    const normalizedUserId = String(userId);
    const delivered = await broadcastToUser(normalizedUserId, { type, data });

    // Promote selected user-level mutations to admin channel.
    const normalizedType = String(type || '').toUpperCase();
    if (normalizedType === 'PROFILE_UPDATE') {
      await broadcastAdminEvent(normalizedType, {
        user_id: normalizedUserId,
        ...data
      });
    }

    return delivered;
  } catch (error) {
    console.error('user realtime broadcast failed', { userId, type, error: error?.message || String(error) });
    return 0;
  }
}

export async function broadcastAdminEvent(type, data = {}) {
  try {
    return await broadcastToChannel('admin', { type, data });
  } catch (error) {
    console.error('admin realtime broadcast failed', { type, error: error?.message || String(error) });
    return 0;
  }
}
