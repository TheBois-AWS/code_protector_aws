/*
Required DynamoDB GSIs for production efficiency:
- users.email-index (email)
- workspaces.user_id-index (user_id)
- workspaces.loader_key-index (loader_key)
- workspace_members.workspace_id-index (workspace_id)
- workspace_members.user_id-index (user_id)
- workspace_invitations.workspace_id-index (workspace_id)
- workspace_invitations.token-index (token)
- projects.workspace_id-index (workspace_id)
- projects.secret_key-index (secret_key)
- project_files.project_id-index (project_id)
- licenses.workspace_id-index (workspace_id)
- licenses.key-index (key)
- access_lists.workspace_id-index (workspace_id)
- logs.workspace_id-index (workspace_id)
- websocket_connections.user_id-index (user_id)
- websocket_connections.workspace_id-index (workspace_id)
- pin_verifications.workspace_id-index (workspace_id)
- admin_audit.actor_user_id-index (actor_user_id)
- admin_audit.target_id-index (target_id)

The helpers below fall back to Scan when an index is unavailable so local development can still work.
*/
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand
} from '@aws-sdk/lib-dynamodb';
import { config } from '../config.js';
import { ddb } from './aws.js';
import { randomId } from '../utils/common.js';

async function getItem(TableName, Key) {
  const response = await ddb.send(new GetCommand({ TableName, Key }));
  return response.Item || null;
}

async function putItem(TableName, Item) {
  await ddb.send(new PutCommand({ TableName, Item }));
  return Item;
}

async function deleteItem(TableName, Key) {
  await ddb.send(new DeleteCommand({ TableName, Key }));
}

async function scanItems(TableName, predicate = {}) {
  const expressionNames = {};
  const expressionValues = {};
  const filters = [];
  Object.entries(predicate).forEach(([field, value], index) => {
    const name = `#f${index}`;
    const variable = `:v${index}`;
    expressionNames[name] = field;
    expressionValues[variable] = value;
    filters.push(`${name} = ${variable}`);
  });

  const response = await ddb.send(new ScanCommand({
    TableName,
    ...(filters.length ? {
      FilterExpression: filters.join(' AND '),
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues
    } : {})
  }));

  return response.Items || [];
}

async function queryByField(TableName, IndexName, field, value) {
  try {
    const response = await ddb.send(new QueryCommand({
      TableName,
      IndexName,
      KeyConditionExpression: '#field = :value',
      ExpressionAttributeNames: { '#field': field },
      ExpressionAttributeValues: { ':value': value }
    }));
    return response.Items || [];
  } catch {
    return await scanItems(TableName, { [field]: value });
  }
}

function createStandardRepo(TableName, keyName = 'id') {
  return {
    async getById(id) {
      return await getItem(TableName, { [keyName]: id });
    },
    async create(payload) {
      const item = { ...payload };
      if (!item[keyName]) item[keyName] = randomId();
      await putItem(TableName, item);
      return item;
    },
    async put(item) {
      await putItem(TableName, item);
      return item;
    },
    async update(id, patch) {
      const current = await getItem(TableName, { [keyName]: id });
      if (!current) return null;
      const next = { ...current, ...patch };
      await putItem(TableName, next);
      return next;
    },
    async delete(id) {
      await deleteItem(TableName, { [keyName]: id });
    },
    async scan(predicate = {}) {
      return await scanItems(TableName, predicate);
    }
  };
}

const usersBase = createStandardRepo(config.tables.users);
const workspacesBase = createStandardRepo(config.tables.workspaces);
const workspaceMembersBase = createStandardRepo(config.tables.workspaceMembers);
const invitationsBase = createStandardRepo(config.tables.workspaceInvitations);
const projectsBase = createStandardRepo(config.tables.projects);
const projectFilesBase = createStandardRepo(config.tables.projectFiles);
const licensesBase = createStandardRepo(config.tables.licenses);
const accessBase = createStandardRepo(config.tables.accessLists);
const logsBase = createStandardRepo(config.tables.logs);
const websocketConnectionsBase = createStandardRepo(config.tables.websocketConnections, 'connection_id');
const pinBase = createStandardRepo(config.tables.pinVerifications, 'token');
const adminAuditBase = createStandardRepo(config.tables.adminAudit);

export const usersRepo = {
  ...usersBase,
  async findByEmail(email) {
    return (await queryByField(config.tables.users, config.indexes.usersByEmail, 'email', email))[0] || null;
  }
};

export const workspacesRepo = {
  ...workspacesBase,
  async listByOwner(userId) {
    return await queryByField(config.tables.workspaces, config.indexes.workspacesByOwner, 'user_id', userId);
  },
  async findByLoaderKey(loaderKey) {
    return (await queryByField(config.tables.workspaces, config.indexes.workspacesByLoaderKey, 'loader_key', loaderKey))[0] || null;
  }
};

export const workspaceMembersRepo = {
  ...workspaceMembersBase,
  async listByWorkspace(workspaceId) {
    return await queryByField(config.tables.workspaceMembers, config.indexes.membersByWorkspace, 'workspace_id', workspaceId);
  },
  async listByUser(userId) {
    return await queryByField(config.tables.workspaceMembers, config.indexes.membersByUser, 'user_id', userId);
  },
  async findByWorkspaceAndUser(workspaceId, userId) {
    return (await scanItems(config.tables.workspaceMembers, { workspace_id: workspaceId, user_id: userId }))[0] || null;
  }
};

export const workspaceInvitationsRepo = {
  ...invitationsBase,
  async listByWorkspace(workspaceId) {
    return await queryByField(config.tables.workspaceInvitations, config.indexes.invitationsByWorkspace, 'workspace_id', workspaceId);
  },
  async findByToken(token) {
    return (await queryByField(config.tables.workspaceInvitations, config.indexes.invitationsByToken, 'token', token))[0] || null;
  },
  async findActiveByWorkspaceAndEmail(workspaceId, email) {
    const items = await scanItems(config.tables.workspaceInvitations, { workspace_id: workspaceId, email });
    return items.find((item) => !item.expires_at || new Date(item.expires_at).getTime() > Date.now()) || null;
  }
};

export const projectsRepo = {
  ...projectsBase,
  async listByWorkspace(workspaceId) {
    return await queryByField(config.tables.projects, config.indexes.projectsByWorkspace, 'workspace_id', workspaceId);
  },
  async findBySecretKey(secretKey) {
    return (await queryByField(config.tables.projects, config.indexes.projectsBySecretKey, 'secret_key', secretKey))[0] || null;
  }
};

export const projectFilesRepo = {
  ...projectFilesBase,
  async listByProject(projectId) {
    return await queryByField(config.tables.projectFiles, config.indexes.projectFilesByProject, 'project_id', projectId);
  }
};

export const licensesRepo = {
  ...licensesBase,
  async listByWorkspace(workspaceId) {
    return await queryByField(config.tables.licenses, config.indexes.licensesByWorkspace, 'workspace_id', workspaceId);
  },
  async findByKey(key) {
    return (await queryByField(config.tables.licenses, config.indexes.licensesByKey, 'key', key))[0] || null;
  }
};

export const accessListsRepo = {
  ...accessBase,
  async listByWorkspace(workspaceId) {
    return await queryByField(config.tables.accessLists, config.indexes.accessByWorkspace, 'workspace_id', workspaceId);
  }
};

export const logsRepo = {
  ...logsBase,
  async listByWorkspace(workspaceId) {
    return await queryByField(config.tables.logs, config.indexes.logsByWorkspace, 'workspace_id', workspaceId);
  }
};

export const websocketConnectionsRepo = {
  ...websocketConnectionsBase,
  async getByConnectionId(connectionId) {
    return await websocketConnectionsBase.getById(String(connectionId));
  },
  async putConnection(connection) {
    return await websocketConnectionsBase.put({
      connection_id: String(connection.connection_id),
      user_id: String(connection.user_id),
      workspace_id: connection.workspace_id ? String(connection.workspace_id) : undefined,
      channel: connection.channel ? String(connection.channel) : 'workspace',
      endpoint: connection.endpoint ? String(connection.endpoint) : '',
      created_at: connection.created_at,
      expires_at: connection.expires_at
    });
  },
  async deleteByConnectionId(connectionId) {
    await websocketConnectionsBase.delete(String(connectionId));
  },
  async listByUser(userId) {
    return await queryByField(config.tables.websocketConnections, config.indexes.websocketByUser, 'user_id', String(userId));
  },
  async listByWorkspace(workspaceId) {
    return await queryByField(config.tables.websocketConnections, config.indexes.websocketByWorkspace, 'workspace_id', String(workspaceId));
  },
  async listByChannel(channel) {
    return await scanItems(config.tables.websocketConnections, { channel: String(channel) });
  }
};

export const pinVerificationsRepo = {
  ...pinBase,
  async listByWorkspace(workspaceId) {
    return await queryByField(config.tables.pinVerifications, config.indexes.pinByWorkspace, 'workspace_id', workspaceId);
  }
};

export const appConfigRepo = {
  async get(key) {
    const item = await getItem(config.tables.appConfig, { key });
    return item?.value ?? null;
  },
  async set(key, value) {
    await putItem(config.tables.appConfig, { key, value });
    return value;
  },
  async list() {
    return await scanItems(config.tables.appConfig);
  },
  async delete(key) {
    await deleteItem(config.tables.appConfig, { key: String(key) });
  }
};

export const rateLimitsRepo = {
  async get(key) {
    return await getItem(config.tables.rateLimits, { key });
  },
  async set(key, value) {
    await putItem(config.tables.rateLimits, value);
    return value;
  },
  async increment(key, windowStart, expiresAt) {
    await ddb.send(new UpdateCommand({
      TableName: config.tables.rateLimits,
      Key: { key },
      UpdateExpression: 'SET window_start = :windowStart, expires_at = :expiresAt ADD #count :inc',
      ExpressionAttributeNames: { '#count': 'count' },
      ExpressionAttributeValues: {
        ':windowStart': windowStart,
        ':expiresAt': expiresAt,
        ':inc': 1
      }
    }));
  },
  async list() {
    return await scanItems(config.tables.rateLimits);
  },
  async delete(key) {
    await deleteItem(config.tables.rateLimits, { key: String(key) });
  }
};

export const adminAuditRepo = {
  ...adminAuditBase,
  async listRecent(limit = 200) {
    const items = await adminAuditBase.scan();
    return [...items]
      .sort((left, right) => Number(right.timestamp || 0) - Number(left.timestamp || 0))
      .slice(0, Math.max(1, Math.min(Number(limit || 200), 1000)));
  },
  async listByActor(actorUserId, limit = 200) {
    const items = await queryByField(config.tables.adminAudit, config.indexes.adminAuditByActor, 'actor_user_id', String(actorUserId));
    return [...items]
      .sort((left, right) => Number(right.timestamp || 0) - Number(left.timestamp || 0))
      .slice(0, Math.max(1, Math.min(Number(limit || 200), 1000)));
  },
  async listByTarget(targetId, limit = 200) {
    const items = await queryByField(config.tables.adminAudit, config.indexes.adminAuditByTarget, 'target_id', String(targetId));
    return [...items]
      .sort((left, right) => Number(right.timestamp || 0) - Number(left.timestamp || 0))
      .slice(0, Math.max(1, Math.min(Number(limit || 200), 1000)));
  }
};
