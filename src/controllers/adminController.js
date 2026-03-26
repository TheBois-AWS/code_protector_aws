import { jsonResponse, parseJsonBody } from '../utils/http.js';
import { hashPassword, requireSystemAdmin } from '../utils/auth.js';
import { adminAuditRepo, accessListsRepo, appConfigRepo, licensesRepo, logsRepo, projectFilesRepo, projectsRepo, rateLimitsRepo, usersRepo, websocketConnectionsRepo, workspaceInvitationsRepo, workspaceMembersRepo, workspacesRepo } from '../services/repositories.js';
import { nowIso, randomId, sortByDateDesc } from '../utils/common.js';
import { broadcastAdminEvent } from '../utils/realtime.js';
import { destroyWorkspaceData } from './workspaceController.js';
import { config } from '../config.js';
import { cloudFrontClient, cloudWatchClient, cloudWatchGlobalClient, cloudWatchLogsClient, costExplorerClient, ddbClient, lambdaClient, s3 } from '../services/aws.js';
import { DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { GetBucketEncryptionCommand, GetBucketLocationCommand, GetBucketVersioningCommand, HeadBucketCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { GetFunctionConfigurationCommand } from '@aws-sdk/client-lambda';
import { GetDistributionCommand, ListDistributionsCommand } from '@aws-sdk/client-cloudfront';
import { DescribeAlarmsCommand, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { DescribeLogGroupsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { GetCostAndUsageCommand, GetCostForecastCommand } from '@aws-sdk/client-cost-explorer';

const GUARD_CHALLENGE_PREFIX = 'admin_guard_challenge:';
const GUARD_TOKEN_PREFIX = 'admin_guard_token:';
const GUARD_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const GUARD_TOKEN_TTL_MS = 10 * 60 * 1000;

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function toDateInput(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const numeric = Number(raw);
  const date = Number.isFinite(numeric)
    ? new Date(raw.length <= 10 ? numeric * 1000 : numeric)
    : new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toJsonSafe(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

async function requireAdmin(request) {
  return await requireSystemAdmin(request);
}

async function readGuardSession(key) {
  const raw = await appConfigRepo.get(key);
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed?.expires_at && Number(parsed.expires_at) <= Date.now()) {
      await appConfigRepo.delete(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeGuardSession(key, payload) {
  await appConfigRepo.set(key, JSON.stringify(payload));
}

function buildGuardChallengeKey(challenge) {
  return `${GUARD_CHALLENGE_PREFIX}${challenge}`;
}

function buildGuardTokenKey(token) {
  return `${GUARD_TOKEN_PREFIX}${token}`;
}

async function issueGuardChallenge(actorUserId, payload) {
  const challenge = randomId();
  await writeGuardSession(buildGuardChallengeKey(challenge), {
    challenge,
    actor_user_id: String(actorUserId),
    action: normalizeText(payload.action),
    target_type: normalizeText(payload.target_type),
    target_id: normalizeText(payload.target_id),
    reason: normalizeText(payload.reason),
    created_at: nowIso(),
    expires_at: Date.now() + GUARD_CHALLENGE_TTL_MS
  });
  return challenge;
}

async function issueGuardTokenFromChallenge(challenge) {
  const session = await readGuardSession(buildGuardChallengeKey(challenge));
  if (!session) return null;

  const token = randomId();
  const tokenSession = {
    token,
    actor_user_id: session.actor_user_id,
    action: session.action,
    target_type: session.target_type,
    target_id: session.target_id,
    reason: session.reason,
    created_at: nowIso(),
    expires_at: Date.now() + GUARD_TOKEN_TTL_MS
  };
  await writeGuardSession(buildGuardTokenKey(token), tokenSession);
  await appConfigRepo.delete(buildGuardChallengeKey(challenge));
  return tokenSession;
}

async function requireGuardToken(request, expected = {}) {
  const token = normalizeText(request.headers['x-admin-guard-token'] || request.headers['X-Admin-Guard-Token']);
  if (!token) return { ok: false, response: jsonResponse(403, { success: false, error: 'Admin guard token required' }) };
  const session = await readGuardSession(buildGuardTokenKey(token));
  if (!session) return { ok: false, response: jsonResponse(403, { success: false, error: 'Admin guard token expired or invalid' }) };

  const payload = parseJsonBody(request) || {};
  const reason = normalizeText(payload.reason);
  if (!reason) return { ok: false, response: jsonResponse(400, { success: false, error: 'Reason required' }) };
  if (normalizeText(session.reason) && normalizeText(session.reason) !== reason) {
    return { ok: false, response: jsonResponse(403, { success: false, error: 'Reason mismatch' }) };
  }
  if (expected.action && normalizeText(session.action) !== normalizeText(expected.action)) {
    return { ok: false, response: jsonResponse(403, { success: false, error: 'Admin guard token scope mismatch' }) };
  }
  if (expected.target_type && normalizeText(session.target_type) !== normalizeText(expected.target_type)) {
    return { ok: false, response: jsonResponse(403, { success: false, error: 'Admin guard token scope mismatch' }) };
  }
  if (expected.target_id && normalizeText(session.target_id) !== normalizeText(expected.target_id)) {
    return { ok: false, response: jsonResponse(403, { success: false, error: 'Admin guard token scope mismatch' }) };
  }
  return { ok: true, session, reason, token };
}

async function logAdminAction(actorUserId, action, targetType, targetId, reason, metadata = {}) {
  const entry = {
    id: randomId(),
    actor_user_id: String(actorUserId),
    action: normalizeText(action),
    target_type: normalizeText(targetType),
    target_id: normalizeText(targetId),
    reason: normalizeText(reason),
    metadata: toJsonSafe(metadata),
    created_at: nowIso(),
    timestamp: Date.now()
  };
  await adminAuditRepo.create(entry);
  await broadcastAdminEvent('ADMIN_AUDIT', entry);
  return entry;
}

async function listAllWorkspaces() {
  const workspaces = await workspacesRepo.scan();
  return sortByDateDesc(workspaces);
}

async function listAllUsers() {
  const users = await usersRepo.scan();
  return sortByDateDesc(users);
}

async function listRelatedRecordsForWorkspace(workspaceId) {
  const [projects, licenses, accessRules, logs, members, invitations] = await Promise.all([
    projectsRepo.listByWorkspace(String(workspaceId)),
    licensesRepo.listByWorkspace(String(workspaceId)),
    accessListsRepo.listByWorkspace(String(workspaceId)),
    logsRepo.listByWorkspace(String(workspaceId)),
    workspaceMembersRepo.listByWorkspace(String(workspaceId)),
    workspaceInvitationsRepo.listByWorkspace(String(workspaceId))
  ]);
  return { projects, licenses, accessRules, logs, members, invitations };
}

async function deleteWebsocketConnectionsByUser(userId) {
  const connections = await websocketConnectionsRepo.listByUser(String(userId));
  for (const connection of connections) {
    await websocketConnectionsRepo.deleteByConnectionId(String(connection.connection_id));
  }
}

async function deleteWebsocketConnectionsByWorkspace(workspaceId) {
  const connections = await websocketConnectionsRepo.listByWorkspace(String(workspaceId));
  for (const connection of connections) {
    await websocketConnectionsRepo.deleteByConnectionId(String(connection.connection_id));
  }
}

function applyQueryFilters(items, query = {}) {
  const q = normalizeLower(query.q || query.search);
  const status = normalizeLower(query.status);
  const role = normalizeLower(query.role);
  const type = normalizeLower(query.target_type);
  const action = normalizeLower(query.action);
  const target = normalizeLower(query.target_id);
  const from = toDateInput(query.date_from || query.from);
  const to = toDateInput(query.date_to || query.to);

  return items.filter((item) => {
    if (q) {
      const haystack = normalizeLower([
        item.id,
        item.email,
        item.display_name,
        item.name,
        item.key,
        item.loader_key,
        item.secret_key,
        item.reason,
        item.target_type,
        item.target_id,
        item.action,
        item.workspace_id
      ].filter(Boolean).join(' '));
      if (!haystack.includes(q)) return false;
    }
    if (status && normalizeLower(item.status || item.is_active || item.state) !== status) return false;
    if (role && normalizeLower(item.role) !== role) return false;
    if (type && normalizeLower(item.target_type) !== type) return false;
    if (action && normalizeLower(item.action) !== action) return false;
    if (target && !normalizeLower(item.target_id).includes(target)) return false;
    if (from || to) {
      const createdAt = item.created_at || item.timestamp;
      const date = toDateInput(createdAt);
      if (!date) return false;
      if (from && date < from) return false;
      if (to && date > new Date(to.getTime() + 24 * 60 * 60 * 1000)) return false;
    }
    return true;
  });
}

function countByDay(items, field = 'created_at') {
  const bucket = new Map();
  for (const item of items) {
    const date = toDateInput(item[field] || item.timestamp);
    if (!date) continue;
    const key = date.toISOString().slice(0, 10);
    bucket.set(key, (bucket.get(key) || 0) + 1);
  }
  return [...bucket.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, count]) => ({ date, count }));
}

function buildUserSummary(user, ownedWorkspaces, memberships) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name || '',
    role: user.role || 'user',
    status: user.status || 'active',
    created_at: user.created_at,
    owned_workspace_count: ownedWorkspaces.length,
    shared_workspace_count: memberships.length,
    total_workspace_count: ownedWorkspaces.length + memberships.length
  };
}

function buildWorkspaceSummary(workspace, owner, related = {}) {
  return {
    id: workspace.id,
    name: workspace.name,
    loader_key: workspace.loader_key,
    status: workspace.status || 'active',
    user_id: workspace.user_id,
    owner: owner ? {
      id: owner.id,
      email: owner.email,
      display_name: owner.display_name || ''
    } : null,
    language: workspace.language,
    default_project_id: workspace.default_project_id || null,
    default_script_id: workspace.default_script_id || null,
    discord_webhook: workspace.discord_webhook || '',
    pin_enabled: Number(workspace.pin_enabled || 0),
    created_at: workspace.created_at,
    project_count: related.projects?.length || 0,
    file_count: related.projects?.reduce((sum, project) => sum + (related.filesByProject?.get(String(project.id))?.length || 0), 0) || 0,
    license_count: related.licenses?.length || 0,
    team_count: 1 + (related.members?.length || 0),
    access_rule_count: related.accessRules?.length || 0
  };
}

async function hydrateWorkspaceDetails(workspace) {
  const owner = await usersRepo.getById(String(workspace.user_id));
  const related = await listRelatedRecordsForWorkspace(workspace.id);
  const filesByProject = new Map();
  for (const project of related.projects) {
    filesByProject.set(String(project.id), await projectFilesRepo.listByProject(String(project.id)));
  }
  return {
    ...buildWorkspaceSummary(workspace, owner, { ...related, filesByProject }),
    projects: sortByDateDesc(related.projects).map((project) => ({
      ...project,
      file_count: filesByProject.get(String(project.id))?.length || 0
    })),
    licenses: sortByDateDesc(related.licenses),
    access_rules: sortByDateDesc(related.accessRules),
    logs: sortByDateDesc(related.logs),
    members: sortByDateDesc(related.members),
    invitations: sortByDateDesc(related.invitations)
  };
}

function formatAwsError(error) {
  if (!error) return 'Unknown error';
  const code = normalizeText(error.name || error.code);
  const message = normalizeText(error.message);
  if (!code && !message) return 'Unknown error';
  return [code, message].filter(Boolean).join(': ');
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((value) => normalizeText(value)).filter(Boolean))];
}

async function probeUrl(url, timeoutMs = 4000) {
  if (!url) return { ok: false, status: 0, message: 'URL not configured' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: 'GET', cache: 'no-store', signal: controller.signal });
    clearTimeout(timer);
    return {
      ok: response.ok,
      status: response.status,
      message: response.ok ? 'Reachable' : `HTTP ${response.status}`
    };
  } catch (error) {
    clearTimeout(timer);
    return { ok: false, status: 0, message: formatAwsError(error) };
  }
}

function toUtcDateParts(date) {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    day: date.getUTCDate()
  };
}

function toYmd(date) {
  return date.toISOString().slice(0, 10);
}

function buildMonthRange(now = new Date()) {
  const { year, month, day } = toUtcDateParts(now);
  const start = new Date(Date.UTC(year, month, 1));
  const endExclusive = new Date(Date.UTC(year, month, day + 1));
  const nextMonthStart = new Date(Date.UTC(year, month + 1, 1));
  return { start, endExclusive, nextMonthStart };
}

function normalizeHost(value) {
  return normalizeText(value).replace(/^https?:\/\//i, '').replace(/\/+$/, '').replace(/:\d+$/, '');
}

function parseCost(value) {
  const parsed = Number.parseFloat(String(value ?? '0'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function toMetricSummary(datapoints, stat) {
  if (!Array.isArray(datapoints) || datapoints.length === 0) {
    return { latest: 0, total: 0, average: 0, points: [] };
  }
  const sorted = [...datapoints]
    .map((point) => ({
      timestamp: point.Timestamp ? new Date(point.Timestamp).toISOString() : null,
      value: Number(point?.[stat] || 0)
    }))
    .filter((point) => point.timestamp && Number.isFinite(point.value))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  if (!sorted.length) {
    return { latest: 0, total: 0, average: 0, points: [] };
  }
  const total = sorted.reduce((sum, point) => sum + point.value, 0);
  return {
    latest: sorted[sorted.length - 1].value,
    total,
    average: total / sorted.length,
    points: sorted
  };
}

async function fetchMetricStatistics(client, { namespace, metricName, dimensions, stat = 'Sum', period = 300, startTime, endTime, unit = undefined }) {
  try {
    const result = await client.send(new GetMetricStatisticsCommand({
      Namespace: namespace,
      MetricName: metricName,
      Dimensions: dimensions,
      StartTime: startTime,
      EndTime: endTime,
      Period: period,
      Statistics: [stat],
      Unit: unit
    }));
    return { ok: true, summary: toMetricSummary(result?.Datapoints || [], stat) };
  } catch (error) {
    return { ok: false, error: formatAwsError(error), summary: { latest: 0, total: 0, average: 0, points: [] } };
  }
}

function resolveDistributionByHost(items = [], host = '') {
  const expectedHost = normalizeLower(host);
  if (!expectedHost) return null;
  return items.find((item) => {
    const domain = normalizeLower(item?.DomainName);
    const aliases = (item?.Aliases?.Items || []).map((alias) => normalizeLower(alias));
    const origins = (item?.Origins?.Items || []).map((origin) => normalizeLower(origin?.DomainName));
    return domain === expectedHost
      || aliases.includes(expectedHost)
      || origins.includes(expectedHost);
  }) || null;
}

async function inspectDynamoDbTables() {
  const tableNames = uniqueStrings(Object.values(config.tables || {}));
  const tables = await Promise.all(tableNames.map(async (tableName) => {
    try {
      const result = await ddbClient.send(new DescribeTableCommand({ TableName: tableName }));
      const table = result?.Table || {};
      return {
        name: tableName,
        status: normalizeText(table.TableStatus || 'UNKNOWN'),
        item_count: Number(table.ItemCount || 0),
        size_bytes: Number(table.TableSizeBytes || 0),
        billing_mode: normalizeText(table.BillingModeSummary?.BillingMode || 'PAY_PER_REQUEST'),
        table_class: normalizeText(table.TableClassSummary?.TableClass || 'STANDARD'),
        stream_enabled: Boolean(table.StreamSpecification?.StreamEnabled),
        stream_view_type: normalizeText(table.StreamSpecification?.StreamViewType || ''),
        deletion_protection_enabled: Boolean(table.DeletionProtectionEnabled),
        gsi_count: Array.isArray(table.GlobalSecondaryIndexes) ? table.GlobalSecondaryIndexes.length : 0,
        arn: normalizeText(table.TableArn),
        healthy: normalizeLower(table.TableStatus) === 'active'
      };
    } catch (error) {
      return {
        name: tableName,
        status: 'ERROR',
        error: formatAwsError(error),
        healthy: false
      };
    }
  }));
  const healthyCount = tables.filter((table) => table.healthy).length;
  const totalItems = tables.reduce((sum, table) => sum + Number(table.item_count || 0), 0);
  const totalSizeBytes = tables.reduce((sum, table) => sum + Number(table.size_bytes || 0), 0);
  return {
    service: 'dynamodb',
    status: healthyCount === tables.length ? 'healthy' : (healthyCount ? 'degraded' : 'unavailable'),
    summary: {
      total_tables: tables.length,
      healthy_tables: healthyCount,
      unhealthy_tables: tables.length - healthyCount,
      total_items: totalItems,
      total_size_bytes: totalSizeBytes
    },
    tables
  };
}

async function inspectS3Buckets() {
  const buckets = uniqueStrings([config.s3Bucket, config.assetsBucket]);
  const items = await Promise.all(buckets.map(async (bucketName) => {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
      const [location, versioning, encryption, listing] = await Promise.allSettled([
        s3.send(new GetBucketLocationCommand({ Bucket: bucketName })),
        s3.send(new GetBucketVersioningCommand({ Bucket: bucketName })),
        s3.send(new GetBucketEncryptionCommand({ Bucket: bucketName })),
        s3.send(new ListObjectsV2Command({ Bucket: bucketName, MaxKeys: 1000 }))
      ]);
      const locationValue = location.status === 'fulfilled'
        ? normalizeText(location.value?.LocationConstraint || 'us-east-1')
        : '';
      const versioningValue = versioning.status === 'fulfilled'
        ? normalizeText(versioning.value?.Status || 'Disabled')
        : 'Unknown';
      const encryptionEnabled = encryption.status === 'fulfilled';
      const listedObjects = listing.status === 'fulfilled' ? (listing.value?.Contents || []) : [];
      const sampledSizeBytes = listedObjects.reduce((sum, object) => sum + Number(object?.Size || 0), 0);
      const listingError = listing.status === 'rejected' ? formatAwsError(listing.reason) : '';
      return {
        name: bucketName,
        status: 'ACTIVE',
        region: locationValue || config.aws.region,
        versioning: versioningValue,
        encryption: encryptionEnabled ? 'Enabled' : 'Not configured',
        sampled_object_count: listedObjects.length,
        sampled_size_bytes: sampledSizeBytes,
        sampled_listing_truncated: listing.status === 'fulfilled' ? Boolean(listing.value?.IsTruncated) : false,
        sampled_listing_error: listingError,
        healthy: true
      };
    } catch (error) {
      return {
        name: bucketName,
        status: 'ERROR',
        error: formatAwsError(error),
        healthy: false
      };
    }
  }));
  const healthyCount = items.filter((bucket) => bucket.healthy).length;
  const totalSampledObjects = items.reduce((sum, bucket) => sum + Number(bucket.sampled_object_count || 0), 0);
  const totalSampledSizeBytes = items.reduce((sum, bucket) => sum + Number(bucket.sampled_size_bytes || 0), 0);
  return {
    service: 's3',
    status: healthyCount === items.length ? 'healthy' : (healthyCount ? 'degraded' : 'unavailable'),
    summary: {
      total_buckets: items.length,
      healthy_buckets: healthyCount,
      unhealthy_buckets: items.length - healthyCount,
      total_sampled_objects: totalSampledObjects,
      total_sampled_size_bytes: totalSampledSizeBytes
    },
    buckets: items
  };
}

async function inspectLambdaService() {
  const functionName = normalizeText(config.aws.functionName);
  if (!functionName) {
    return {
      service: 'lambda',
      status: 'unavailable',
      error: 'AWS_LAMBDA_FUNCTION_NAME is not available in current runtime'
    };
  }
  try {
    const now = new Date();
    const startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const [result, invocations, errors, throttles, duration] = await Promise.all([
      lambdaClient.send(new GetFunctionConfigurationCommand({ FunctionName: functionName })),
      fetchMetricStatistics(cloudWatchClient, {
        namespace: 'AWS/Lambda',
        metricName: 'Invocations',
        dimensions: [{ Name: 'FunctionName', Value: functionName }],
        stat: 'Sum',
        period: 300,
        startTime,
        endTime: now
      }),
      fetchMetricStatistics(cloudWatchClient, {
        namespace: 'AWS/Lambda',
        metricName: 'Errors',
        dimensions: [{ Name: 'FunctionName', Value: functionName }],
        stat: 'Sum',
        period: 300,
        startTime,
        endTime: now
      }),
      fetchMetricStatistics(cloudWatchClient, {
        namespace: 'AWS/Lambda',
        metricName: 'Throttles',
        dimensions: [{ Name: 'FunctionName', Value: functionName }],
        stat: 'Sum',
        period: 300,
        startTime,
        endTime: now
      }),
      fetchMetricStatistics(cloudWatchClient, {
        namespace: 'AWS/Lambda',
        metricName: 'Duration',
        dimensions: [{ Name: 'FunctionName', Value: functionName }],
        stat: 'Average',
        period: 300,
        startTime,
        endTime: now
      })
    ]);
    const state = normalizeText(result?.State || 'Unknown');
    const lastUpdateStatus = normalizeText(result?.LastUpdateStatus || 'Unknown');
    const metricErrors = [invocations, errors, throttles, duration]
      .filter((item) => !item.ok && item.error)
      .map((item) => item.error);
    const invocationTotal = Number(invocations.summary?.total || 0);
    const errorTotal = Number(errors.summary?.total || 0);
    const throttleTotal = Number(throttles.summary?.total || 0);
    const durationAvgMs = Number(duration.summary?.average || 0);
    const errorRate = invocationTotal > 0 ? (errorTotal / invocationTotal) * 100 : 0;
    return {
      service: 'lambda',
      status: normalizeLower(state) === 'active'
        && normalizeLower(lastUpdateStatus) === 'successful'
        && throttleTotal === 0
        ? 'healthy'
        : 'degraded',
      function_name: functionName,
      runtime: normalizeText(result?.Runtime),
      memory_size: Number(result?.MemorySize || 0),
      timeout_seconds: Number(result?.Timeout || 0),
      architectures: result?.Architectures || [],
      reserved_concurrency: Number(result?.ReservedConcurrentExecutions || 0),
      state,
      last_update_status: lastUpdateStatus,
      last_modified: normalizeText(result?.LastModified),
      version: normalizeText(result?.Version),
      metrics_24h: {
        window_start: startTime.toISOString(),
        window_end: now.toISOString(),
        invocations: invocationTotal,
        errors: errorTotal,
        throttles: throttleTotal,
        error_rate_percent: Number(errorRate.toFixed(4)),
        avg_duration_ms: Number(durationAvgMs.toFixed(2))
      },
      metric_errors: metricErrors
    };
  } catch (error) {
    return {
      service: 'lambda',
      status: 'unavailable',
      function_name: functionName,
      error: formatAwsError(error)
    };
  }
}

async function inspectCloudFrontService(requestHeaders = {}) {
  const configuredDistributionId = normalizeText(config.aws.cloudFrontDistributionId);
  const configuredDomain = normalizeHost(config.aws.cloudFrontDomainName || config.baseUrl);
  const runtimeHost = normalizeHost(requestHeaders?.host || requestHeaders?.Host || '');
  const forwardedHost = normalizeHost(requestHeaders?.['x-forwarded-host'] || requestHeaders?.['X-Forwarded-Host'] || '');
  const hostCandidates = uniqueStrings([configuredDomain, forwardedHost, runtimeHost]);

  let distributionId = configuredDistributionId;
  let lookupMethod = configuredDistributionId ? 'config.distribution_id' : '';
  let lookupError = '';
  let listedDistribution = null;
  if (!distributionId) {
    try {
      const list = await cloudFrontClient.send(new ListDistributionsCommand({ MaxItems: '100' }));
      const items = list?.DistributionList?.Items || [];

      // 1) match by public host/alias first.
      for (const host of hostCandidates) {
        listedDistribution = resolveDistributionByHost(items, host);
        if (listedDistribution) {
          lookupMethod = host === configuredDomain
            ? 'host.configured_domain'
            : (host === forwardedHost ? 'host.x_forwarded_host' : 'host.runtime_host');
          break;
        }
      }

      // 2) when host is Lambda URL (origin host), match by origin domain.
      if (!listedDistribution && runtimeHost) {
        listedDistribution = items.find((item) => {
          const origins = (item?.Origins?.Items || []).map((origin) => normalizeLower(origin?.DomainName));
          return origins.includes(normalizeLower(runtimeHost));
        }) || null;
        if (listedDistribution) lookupMethod = 'origin.runtime_host';
      }

      distributionId = normalizeText(listedDistribution?.Id);
    } catch (error) {
      lookupError = formatAwsError(error);
    }
  }

  const probeHost = normalizeHost(configuredDomain || listedDistribution?.DomainName || runtimeHost || forwardedHost);
  const healthProbe = await probeUrl(probeHost ? `https://${probeHost}/api/health` : '');
  if (!distributionId) {
    return {
      service: 'cloudfront',
      status: healthProbe.ok ? 'degraded' : 'unavailable',
      distribution_id: '',
      domain_name: probeHost,
      deployment_status: normalizeText(listedDistribution?.Status),
      enabled: Boolean(listedDistribution?.Enabled),
      lookup: {
        method: lookupMethod || 'not_resolved',
        configured_domain: configuredDomain,
        runtime_host: runtimeHost,
        forwarded_host: forwardedHost
      },
      health_probe: healthProbe,
      error: lookupError || 'CloudFront distribution not resolved for current host'
    };
  }

  try {
    const now = new Date();
    const startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const [result, requests, bytesDownloaded, err4xx, err5xx] = await Promise.all([
      cloudFrontClient.send(new GetDistributionCommand({ Id: distributionId })),
      fetchMetricStatistics(cloudWatchGlobalClient, {
        namespace: 'AWS/CloudFront',
        metricName: 'Requests',
        dimensions: [{ Name: 'DistributionId', Value: distributionId }, { Name: 'Region', Value: 'Global' }],
        stat: 'Sum',
        period: 300,
        startTime,
        endTime: now
      }),
      fetchMetricStatistics(cloudWatchGlobalClient, {
        namespace: 'AWS/CloudFront',
        metricName: 'BytesDownloaded',
        dimensions: [{ Name: 'DistributionId', Value: distributionId }, { Name: 'Region', Value: 'Global' }],
        stat: 'Sum',
        period: 300,
        startTime,
        endTime: now
      }),
      fetchMetricStatistics(cloudWatchGlobalClient, {
        namespace: 'AWS/CloudFront',
        metricName: '4xxErrorRate',
        dimensions: [{ Name: 'DistributionId', Value: distributionId }, { Name: 'Region', Value: 'Global' }],
        stat: 'Average',
        period: 300,
        startTime,
        endTime: now
      }),
      fetchMetricStatistics(cloudWatchGlobalClient, {
        namespace: 'AWS/CloudFront',
        metricName: '5xxErrorRate',
        dimensions: [{ Name: 'DistributionId', Value: distributionId }, { Name: 'Region', Value: 'Global' }],
        stat: 'Average',
        period: 300,
        startTime,
        endTime: now
      })
    ]);
    const distribution = result?.Distribution || {};
    const configData = distribution.DistributionConfig || {};
    const deployed = normalizeLower(distribution.Status) === 'deployed';
    const enabled = Boolean(configData.Enabled);
    const metricErrors = [requests, bytesDownloaded, err4xx, err5xx]
      .filter((metric) => !metric.ok && metric.error)
      .map((metric) => metric.error);
    return {
      service: 'cloudfront',
      status: deployed && enabled && healthProbe.ok ? 'healthy' : 'degraded',
      distribution_id: distributionId,
      domain_name: normalizeText(distribution.DomainName || probeHost),
      aliases: configData?.Aliases?.Items || [],
      origins: (configData?.Origins?.Items || []).map((origin) => ({
        id: normalizeText(origin?.Id),
        domain_name: normalizeText(origin?.DomainName),
        origin_path: normalizeText(origin?.OriginPath)
      })),
      price_class: normalizeText(configData?.PriceClass || ''),
      deployment_status: normalizeText(distribution.Status),
      enabled,
      in_progress_invalidations: Number(distribution.InProgressInvalidationBatches || 0),
      last_modified: distribution.LastModifiedTime ? new Date(distribution.LastModifiedTime).toISOString() : null,
      lookup: {
        method: lookupMethod || 'distribution_id',
        configured_domain: configuredDomain,
        runtime_host: runtimeHost,
        forwarded_host: forwardedHost
      },
      metrics_24h: {
        window_start: startTime.toISOString(),
        window_end: now.toISOString(),
        requests: Number(requests.summary?.total || 0),
        bytes_downloaded: Number(bytesDownloaded.summary?.total || 0),
        avg_4xx_error_rate: Number((err4xx.summary?.average || 0).toFixed(4)),
        avg_5xx_error_rate: Number((err5xx.summary?.average || 0).toFixed(4))
      },
      metric_errors: metricErrors,
      health_probe: healthProbe
    };
  } catch (error) {
    return {
      service: 'cloudfront',
      status: healthProbe.ok ? 'degraded' : 'unavailable',
      distribution_id: distributionId,
      domain_name: probeHost,
      lookup: {
        method: lookupMethod || 'distribution_id',
        configured_domain: configuredDomain,
        runtime_host: runtimeHost,
        forwarded_host: forwardedHost
      },
      health_probe: healthProbe,
      error: formatAwsError(error)
    };
  }
}

async function inspectCloudWatchService() {
  const functionName = normalizeText(config.aws.functionName);
  const logGroupName = functionName ? `/aws/lambda/${functionName}` : '';
  const alarmPrefix = normalizeText(
    config.aws.projectName && config.aws.stage
      ? `${config.aws.projectName}-${config.aws.stage}-api-`
      : functionName.replace(/-api$/i, '-')
  );

  const [logGroupsResult, alarmsResult] = await Promise.allSettled([
    logGroupName
      ? cloudWatchLogsClient.send(new DescribeLogGroupsCommand({ logGroupNamePrefix: logGroupName, limit: 20 }))
      : Promise.resolve({ logGroups: [] }),
    alarmPrefix
      ? cloudWatchClient.send(new DescribeAlarmsCommand({ AlarmNamePrefix: alarmPrefix, MaxRecords: 50 }))
      : Promise.resolve({ MetricAlarms: [] })
  ]);

  let logGroup = null;
  let logGroupError = '';
  if (logGroupsResult.status === 'fulfilled') {
    logGroup = (logGroupsResult.value?.logGroups || []).find((group) => normalizeText(group.logGroupName) === logGroupName) || null;
  } else {
    logGroupError = formatAwsError(logGroupsResult.reason);
  }

  let alarms = [];
  let alarmsError = '';
  if (alarmsResult.status === 'fulfilled') {
    alarms = (alarmsResult.value?.MetricAlarms || []).map((alarm) => ({
      name: normalizeText(alarm.AlarmName),
      state: normalizeText(alarm.StateValue || 'UNKNOWN'),
      reason: normalizeText(alarm.StateReason || '')
    }));
  } else {
    alarmsError = formatAwsError(alarmsResult.reason);
  }

  const activeAlarms = alarms.filter((alarm) => normalizeLower(alarm.state) === 'alarm');
  const status = logGroup && !activeAlarms.length ? 'healthy' : ((logGroup || alarms.length) ? 'degraded' : 'unavailable');
  return {
    service: 'cloudwatch',
    status,
    log_group: logGroup ? {
      name: normalizeText(logGroup.logGroupName),
      retention_days: Number(logGroup.retentionInDays || 0),
      stored_bytes: Number(logGroup.storedBytes || 0)
    } : null,
    alarms,
    active_alarm_count: activeAlarms.length,
    errors: [logGroupError, alarmsError].filter(Boolean)
  };
}

async function inspectBillingService() {
  const { start, endExclusive, nextMonthStart } = buildMonthRange(new Date());
  const startDate = toYmd(start);
  const endDate = toYmd(endExclusive);
  const nextMonthDate = toYmd(nextMonthStart);

  try {
    const [costAndUsage, forecast] = await Promise.all([
      costExplorerClient.send(new GetCostAndUsageCommand({
        TimePeriod: { Start: startDate, End: endDate },
        Granularity: 'DAILY',
        Metrics: ['UnblendedCost'],
        GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }]
      })),
      costExplorerClient.send(new GetCostForecastCommand({
        TimePeriod: { Start: endDate, End: nextMonthDate },
        Metric: 'UNBLENDED_COST',
        Granularity: 'MONTHLY'
      }))
    ]);

    const dailyCosts = (costAndUsage?.ResultsByTime || []).map((item) => ({
      date: normalizeText(item?.TimePeriod?.Start),
      cost: parseCost(item?.Total?.UnblendedCost?.Amount || 0)
    }));
    const monthToDateTotal = dailyCosts.reduce((sum, item) => sum + item.cost, 0);

    const byService = new Map();
    for (const day of costAndUsage?.ResultsByTime || []) {
      for (const group of day?.Groups || []) {
        const serviceName = normalizeText(group?.Keys?.[0] || 'Unknown');
        const amount = parseCost(group?.Metrics?.UnblendedCost?.Amount || 0);
        byService.set(serviceName, (byService.get(serviceName) || 0) + amount);
      }
    }
    const serviceBreakdown = [...byService.entries()]
      .map(([service, cost]) => ({ service, cost }))
      .sort((left, right) => right.cost - left.cost)
      .slice(0, 10);
    const forecastTotal = parseCost(forecast?.Total?.Amount || 0);
    const currency = normalizeText(forecast?.Total?.Unit || costAndUsage?.ResultsByTime?.[0]?.Total?.UnblendedCost?.Unit || 'USD');

    return {
      service: 'billing',
      status: 'healthy',
      provider: 'cost_explorer',
      currency,
      period_start: startDate,
      period_end: endDate,
      month_to_date_total: Number(monthToDateTotal.toFixed(4)),
      forecast_month_total: Number(forecastTotal.toFixed(4)),
      daily_costs: dailyCosts,
      service_breakdown: serviceBreakdown
    };
  } catch (error) {
    return {
      service: 'billing',
      status: 'degraded',
      provider: 'cost_explorer',
      currency: 'USD',
      period_start: startDate,
      period_end: endDate,
      month_to_date_total: 0,
      forecast_month_total: 0,
      daily_costs: [],
      service_breakdown: [],
      error: formatAwsError(error)
    };
  }
}

function summarizeServiceStatuses(services = []) {
  const totals = {
    total_services: services.length,
    healthy_services: 0,
    degraded_services: 0,
    unavailable_services: 0
  };
  for (const service of services) {
    const status = normalizeLower(service?.status);
    if (status === 'healthy') totals.healthy_services += 1;
    else if (status === 'degraded') totals.degraded_services += 1;
    else totals.unavailable_services += 1;
  }
  let overall = 'healthy';
  if (totals.degraded_services > 0) overall = 'degraded';
  if (totals.healthy_services === 0 && totals.degraded_services === 0) overall = 'unavailable';
  return { ...totals, overall_status: overall };
}

export async function getAdminOverview(request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const [users, workspaces, projects, licenses, logs, rateLimits, appConfigs, audits] = await Promise.all([
    usersRepo.scan(),
    workspacesRepo.scan(),
    projectsRepo.scan(),
    licensesRepo.scan(),
    logsRepo.scan(),
    rateLimitsRepo.list(),
    appConfigRepo.list(),
    adminAuditRepo.listRecent(100)
  ]);

  const suspendedUsers = users.filter((user) => normalizeLower(user.status) !== 'active').length;
  const suspendedWorkspaces = workspaces.filter((workspace) => normalizeLower(workspace.status) !== 'active').length;
  const totalFiles = (await Promise.all(projects.map(async (project) => (await projectFilesRepo.listByProject(String(project.id))).length)))
    .reduce((sum, count) => sum + count, 0);

  return jsonResponse(200, {
    success: true,
    overview: {
      totals: {
        users: users.length,
        active_users: users.length - suspendedUsers,
        suspended_users: suspendedUsers,
        workspaces: workspaces.length,
        active_workspaces: workspaces.length - suspendedWorkspaces,
        suspended_workspaces: suspendedWorkspaces,
        projects: projects.length,
        files: totalFiles,
        licenses: licenses.length,
        logs: logs.length,
        rate_limits: rateLimits.length,
        app_config_entries: appConfigs.length,
        audits: audits.length
      },
      charts: {
        users_by_day: countByDay(users),
        workspaces_by_day: countByDay(workspaces),
        projects_by_day: countByDay(projects),
        licenses_by_day: countByDay(licenses),
        logs_by_day: countByDay(logs),
        rate_limits_by_day: countByDay(rateLimits, 'window_start')
      },
      recent_audit: audits.slice(0, 25)
    }
  });
}

export async function getAdminAwsServices(request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const requestHeaders = request?.headers || {};

  const [lambda, dynamodb, s3Status, cloudfront, cloudwatch] = await Promise.all([
    inspectLambdaService(),
    inspectDynamoDbTables(),
    inspectS3Buckets(),
    inspectCloudFrontService(requestHeaders),
    inspectCloudWatchService()
  ]);

  const billing = await inspectBillingService();
  const services = [lambda, cloudfront, dynamodb, s3Status, cloudwatch, billing];
  const summary = summarizeServiceStatuses(services);
  return jsonResponse(200, {
    success: true,
    aws: {
      checked_at: nowIso(),
      region: normalizeText(config.aws.region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1'),
      metadata: {
        project_name: normalizeText(config.aws.projectName),
        stage: normalizeText(config.aws.stage),
        lambda_function: normalizeText(config.aws.functionName),
        configured_cloudfront_domain: normalizeText(config.aws.cloudFrontDomainName),
        configured_cloudfront_distribution_id: normalizeText(config.aws.cloudFrontDistributionId)
      },
      summary,
      services: {
        lambda,
        cloudfront,
        dynamodb,
        s3: s3Status,
        cloudwatch,
        billing
      }
    }
  });
}

export async function listAdminUsers(request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const query = request.query || {};
  const users = applyQueryFilters(await listAllUsers(), query);
  const limit = Math.max(1, Math.min(Number(query.limit || 200), 1000));
  const items = [];

  for (const user of users.slice(0, limit)) {
    const ownedWorkspaces = await workspacesRepo.listByOwner(String(user.id));
    const memberships = await workspaceMembersRepo.listByUser(String(user.id));
    items.push(buildUserSummary(user, ownedWorkspaces, memberships));
  }

  return jsonResponse(200, { success: true, users: items, total: users.length });
}

export async function getAdminUser(request, userId) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const user = await usersRepo.getById(String(userId));
  if (!user) return jsonResponse(404, { success: false, error: 'User not found' });
  const ownedWorkspaces = await workspacesRepo.listByOwner(String(user.id));
  const memberships = await workspaceMembersRepo.listByUser(String(user.id));
  const recentAudit = await adminAuditRepo.listByActor(String(user.id), 50);
  const owned = [];
  for (const workspace of ownedWorkspaces) owned.push(await hydrateWorkspaceDetails(workspace));
  const shared = [];
  for (const membership of memberships) {
    const workspace = await workspacesRepo.getById(String(membership.workspace_id));
    if (!workspace) continue;
    shared.push({
      workspace: buildWorkspaceSummary(workspace, await usersRepo.getById(String(workspace.user_id))),
      role: membership.role || 'viewer',
      created_at: membership.created_at
    });
  }
  return jsonResponse(200, {
    success: true,
    user: {
      ...user,
      password: undefined,
      owned_workspaces: owned,
      shared_workspaces: shared,
      recent_audit: recentAudit
    }
  });
}

export async function patchAdminUser(request, userId) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const payload = parseJsonBody(request);
  if (!payload) return jsonResponse(400, { success: false, error: 'Invalid JSON' });

  const user = await usersRepo.getById(String(userId));
  if (!user) return jsonResponse(404, { success: false, error: 'User not found' });

  const patch = {};
  if (payload.email !== undefined) {
    const email = normalizeLower(payload.email);
    if (!email) return jsonResponse(400, { success: false, error: 'Email required' });
    const existing = await usersRepo.findByEmail(email);
    if (existing && String(existing.id) !== String(user.id)) return jsonResponse(409, { success: false, error: 'Email already exists' });
    patch.email = email;
  }
  if (payload.display_name !== undefined) patch.display_name = normalizeText(payload.display_name);
  if (payload.role !== undefined) patch.role = ['user', 'admin'].includes(normalizeLower(payload.role)) ? normalizeLower(payload.role) : null;
  if (payload.status !== undefined) patch.status = ['active', 'suspended', 'disabled'].includes(normalizeLower(payload.status)) ? normalizeLower(payload.status) : null;
  if (payload.password !== undefined && normalizeText(payload.password)) {
    patch.password = await hashPassword(normalizeText(payload.password));
    patch.password_changed_at = Math.floor(Date.now() / 1000);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) return jsonResponse(400, { success: false, error: `Invalid ${key}` });
  }

  const updated = await usersRepo.update(String(user.id), patch);
  await logAdminAction(auth.user.id, 'UPDATE_USER', 'user', String(user.id), normalizeText(payload.reason || 'Updated user'), { patch });
  await broadcastAdminEvent('USER_UPDATED', { user_id: String(user.id), patch: toJsonSafe(patch) });
  return jsonResponse(200, { success: true, user: { ...updated, password: undefined } });
}

export async function suspendAdminUser(request, userId) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const user = await usersRepo.getById(String(userId));
  if (!user) return jsonResponse(404, { success: false, error: 'User not found' });
  const updated = await usersRepo.update(String(user.id), { status: 'suspended' });
  await deleteWebsocketConnectionsByUser(String(user.id));
  await logAdminAction(auth.user.id, 'SUSPEND_USER', 'user', String(user.id), 'Suspended user', { status: 'suspended' });
  await broadcastAdminEvent('USER_SUSPENDED', { user_id: String(user.id) });
  return jsonResponse(200, { success: true, user: { ...updated, password: undefined } });
}

export async function activateAdminUser(request, userId) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const user = await usersRepo.getById(String(userId));
  if (!user) return jsonResponse(404, { success: false, error: 'User not found' });
  const updated = await usersRepo.update(String(user.id), { status: 'active' });
  await logAdminAction(auth.user.id, 'ACTIVATE_USER', 'user', String(user.id), 'Activated user', { status: 'active' });
  await broadcastAdminEvent('USER_ACTIVATED', { user_id: String(user.id) });
  return jsonResponse(200, { success: true, user: { ...updated, password: undefined } });
}

export async function listAdminWorkspaces(request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const query = request.query || {};
  const workspaces = applyQueryFilters(await listAllWorkspaces(), query);
  const limit = Math.max(1, Math.min(Number(query.limit || 200), 1000));
  const items = [];
  for (const workspace of workspaces.slice(0, limit)) {
    const owner = await usersRepo.getById(String(workspace.user_id));
    const related = await listRelatedRecordsForWorkspace(workspace.id);
    const filesByProject = new Map();
    for (const project of related.projects) {
      filesByProject.set(String(project.id), await projectFilesRepo.listByProject(String(project.id)));
    }
    items.push(buildWorkspaceSummary(workspace, owner, { ...related, filesByProject }));
  }
  return jsonResponse(200, { success: true, workspaces: items, total: workspaces.length });
}

export async function getAdminWorkspace(request, workspaceId) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const workspace = await workspacesRepo.getById(String(workspaceId));
  if (!workspace) return jsonResponse(404, { success: false, error: 'Workspace not found' });
  return jsonResponse(200, { success: true, workspace: await hydrateWorkspaceDetails(workspace) });
}

export async function suspendAdminWorkspace(request, workspaceId) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const workspace = await workspacesRepo.getById(String(workspaceId));
  if (!workspace) return jsonResponse(404, { success: false, error: 'Workspace not found' });
  const updated = await workspacesRepo.update(String(workspace.id), { status: 'suspended' });
  await logAdminAction(auth.user.id, 'SUSPEND_WORKSPACE', 'workspace', String(workspace.id), 'Suspended workspace', { status: 'suspended' });
  await broadcastAdminEvent('WORKSPACE_SUSPENDED', { workspace_id: String(workspace.id) });
  return jsonResponse(200, { success: true, workspace: updated });
}

export async function activateAdminWorkspace(request, workspaceId) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const workspace = await workspacesRepo.getById(String(workspaceId));
  if (!workspace) return jsonResponse(404, { success: false, error: 'Workspace not found' });
  const updated = await workspacesRepo.update(String(workspace.id), { status: 'active' });
  await logAdminAction(auth.user.id, 'ACTIVATE_WORKSPACE', 'workspace', String(workspace.id), 'Activated workspace', { status: 'active' });
  await broadcastAdminEvent('WORKSPACE_ACTIVATED', { workspace_id: String(workspace.id) });
  return jsonResponse(200, { success: true, workspace: updated });
}

export async function deleteAdminUser(request, userId) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const guard = await requireGuardToken(request, { action: 'delete_user', target_type: 'user', target_id: String(userId) });
  if (!guard.ok) return guard.response;

  const user = await usersRepo.getById(String(userId));
  if (!user) return jsonResponse(404, { success: false, error: 'User not found' });

  const ownedWorkspaces = await workspacesRepo.listByOwner(String(user.id));
  for (const workspace of ownedWorkspaces) {
    await deleteWebsocketConnectionsByWorkspace(String(workspace.id));
    await destroyWorkspaceData(String(workspace.id));
  }

  for (const membership of await workspaceMembersRepo.listByUser(String(user.id))) {
    await workspaceMembersRepo.delete(String(membership.id));
  }
  for (const invitation of await workspaceInvitationsRepo.scan({ email: user.email })) {
    await workspaceInvitationsRepo.delete(String(invitation.id));
  }

  await usersRepo.delete(String(user.id));
  await logAdminAction(auth.user.id, 'DELETE_USER', 'user', String(user.id), guard.reason, {
    guard_token: guard.token,
    cascade_workspaces: ownedWorkspaces.map((workspace) => String(workspace.id))
  });
  await appConfigRepo.delete(buildGuardTokenKey(String(guard.token)));
  await broadcastAdminEvent('USER_DELETED', { user_id: String(user.id) });
  return jsonResponse(200, { success: true });
}

export async function deleteAdminWorkspace(request, workspaceId) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const payload = parseJsonBody(request) || {};
  const guard = await requireGuardToken(request, { action: 'delete_workspace', target_type: 'workspace', target_id: String(workspaceId) });
  if (!guard.ok) return guard.response;

  const workspace = await workspacesRepo.getById(String(workspaceId));
  if (!workspace) return jsonResponse(404, { success: false, error: 'Workspace not found' });
  await deleteWebsocketConnectionsByWorkspace(String(workspace.id));
  await destroyWorkspaceData(String(workspace.id));
  await logAdminAction(auth.user.id, 'DELETE_WORKSPACE', 'workspace', String(workspace.id), guard.reason, {
    guard_token: guard.token,
    payload: toJsonSafe(payload)
  });
  await appConfigRepo.delete(buildGuardTokenKey(String(guard.token)));
  await broadcastAdminEvent('WORKSPACE_DELETED', { workspace_id: String(workspace.id) });
  return jsonResponse(200, { success: true });
}

export async function getAdminAudit(request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const query = request.query || {};
  const limit = Math.max(1, Math.min(Number(query.limit || 200), 1000));
  let items;
  if (query.actor_user_id || query.actor) {
    items = await adminAuditRepo.listByActor(String(query.actor_user_id || query.actor), limit);
  } else if (query.target_id) {
    items = await adminAuditRepo.listByTarget(String(query.target_id), limit);
  } else {
    items = await adminAuditRepo.listRecent(limit);
  }
  items = applyQueryFilters(items, query);
  return jsonResponse(200, { success: true, audit: items.slice(0, limit), total: items.length });
}

export async function startAdminGuard(request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const payload = parseJsonBody(request);
  if (!payload?.action || !payload?.target_type || !payload?.target_id || !payload?.reason) {
    return jsonResponse(400, { success: false, error: 'Action, target and reason required' });
  }

  const challenge = await issueGuardChallenge(auth.user.id, payload);
  await logAdminAction(auth.user.id, 'GUARD_START', payload.target_type, payload.target_id, payload.reason, {
    action: normalizeText(payload.action),
    challenge
  });
  return jsonResponse(200, {
    success: true,
    challenge,
    expires_at: Date.now() + GUARD_CHALLENGE_TTL_MS
  });
}

export async function verifyAdminGuard(request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const payload = parseJsonBody(request);
  if (!payload?.challenge) return jsonResponse(400, { success: false, error: 'Challenge required' });

  const session = await readGuardSession(buildGuardChallengeKey(String(payload.challenge)));
  if (!session) return jsonResponse(404, { success: false, error: 'Challenge not found or expired' });
  if (String(session.actor_user_id) !== String(auth.user.id)) return jsonResponse(403, { success: false, error: 'Challenge does not belong to current user' });
  if (payload.action && normalizeText(payload.action) !== normalizeText(session.action)) return jsonResponse(403, { success: false, error: 'Challenge scope mismatch' });
  if (payload.target_type && normalizeText(payload.target_type) !== normalizeText(session.target_type)) return jsonResponse(403, { success: false, error: 'Challenge scope mismatch' });
  if (payload.target_id && normalizeText(payload.target_id) !== normalizeText(session.target_id)) return jsonResponse(403, { success: false, error: 'Challenge scope mismatch' });

  const tokenSession = await issueGuardTokenFromChallenge(String(payload.challenge));
  if (!tokenSession) return jsonResponse(500, { success: false, error: 'Unable to issue guard token' });
  await logAdminAction(auth.user.id, 'GUARD_VERIFY', session.target_type, session.target_id, session.reason, {
    action: session.action,
    guard_token: tokenSession.token
  });
  return jsonResponse(200, {
    success: true,
    guard_token: tokenSession.token,
    expires_at: tokenSession.expires_at
  });
}
