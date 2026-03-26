const ADMIN_AUTH_RETURN_KEY = 'auth_return_to';

const adminState = {
  profile: window.__ADMIN_PROFILE__ || null,
  token: window.__ADMIN_TOKEN__ || localStorage.getItem('token') || '',
  overview: null,
  aws: null,
  users: [],
  workspaces: [],
  audit: [],
  selectedEntity: null,
  selectedEntityRaw: null,
  activeTab: 'overview',
  ws: null,
  wsEndpoint: null,
  wsReconnectTimer: null,
  wsShouldReconnect: true,
  wsReconnectDelay: 2000,
  fetchWrapped: false,
  charts: { activity: null, status: null, awsServices: null },
  guard: {
    open: false,
    phase: 'confirm',
    action: null,
    targetType: null,
    targetId: null,
    reason: '',
    challengeId: '',
    challenge: '',
    guardToken: ''
  }
};

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

function updateThemeIcons() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const sun = document.getElementById('themeIconSun');
  const moon = document.getElementById('themeIconMoon');
  const label = document.getElementById('themeLabel');
  if (sun) sun.style.display = isLight ? '' : 'none';
  if (moon) moon.style.display = isLight ? 'none' : '';
  if (label) label.textContent = isLight ? 'Dark Mode' : 'Light Mode';
}

function toggleTheme() {
  const html = document.documentElement;
  const isLight = html.getAttribute('data-theme') === 'light';
  if (isLight) {
    html.removeAttribute('data-theme');
    localStorage.setItem('theme', 'dark');
  } else {
    html.setAttribute('data-theme', 'light');
    localStorage.setItem('theme', 'light');
  }
  updateThemeIcons();
}

function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;
  sidebar.classList.toggle('collapsed');
  localStorage.setItem('sidebarCollapsed', JSON.stringify(sidebar.classList.contains('collapsed')));
  lucide.createIcons();
}

function setNetworkBanner(visible, message) {
  const banner = document.getElementById('networkStatusBanner');
  const text = document.getElementById('networkStatusText');
  if (!banner || !text) return;
  text.textContent = message || 'Connection issue detected. Some actions may fail.';
  banner.classList.toggle('show', Boolean(visible));
}

function showToast(title, message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  const colors = {
    success: 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300',
    error: 'bg-red-500/20 border-red-500/30 text-red-300',
    warning: 'bg-amber-500/20 border-amber-500/30 text-amber-300',
    info: 'bg-cyan-500/20 border-cyan-500/30 text-cyan-300'
  };
  const icons = { success: 'check-circle', error: 'x-circle', warning: 'alert-triangle', info: 'info' };
  toast.className = `toast flex items-start gap-3 px-4 py-3 rounded-xl border backdrop-blur-sm shadow-lg ${colors[type] || colors.info}`;
  toast.innerHTML = `
    <i data-lucide="${icons[type] || icons.info}" class="w-5 h-5 mt-0.5 shrink-0"></i>
    <div class="flex-1">
      <div class="text-sm font-semibold">${escapeHtml(title || 'Info')}</div>
      <div class="text-sm opacity-90">${escapeHtml(message || '')}</div>
    </div>
    <button type="button" class="hover:opacity-70" aria-label="Close toast"><i data-lucide="x" class="w-4 h-4"></i></button>
  `;
  toast.querySelector('button')?.addEventListener('click', () => toast.remove());
  container.appendChild(toast);
  lucide.createIcons();
  requestAnimationFrame(() => toast.classList.remove('translate-x-full'));
  setTimeout(() => {
    toast.classList.add('translate-x-full');
    setTimeout(() => toast.remove(), 260);
  }, 3500);
}

function getSafeToken() {
  return adminState.token || localStorage.getItem('token') || '';
}

function apiHeaders(extra = {}, withJson = false) {
  const headers = { Authorization: getSafeToken(), ...extra };
  if (withJson && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  return headers;
}

async function apiFetch(path, options = {}) {
  return fetch(path, {
    cache: 'no-store',
    ...options,
    headers: apiHeaders(options.headers || {}, Boolean(options.body))
  });
}

async function readResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function normalizeList(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of keys) if (Array.isArray(payload[key])) return payload[key];
  return payload.items || payload.data || payload.results || payload.rows || [];
}

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDateOnly(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function badgeHtml(label, tone = '') {
  return `<span class="admin-pill ${tone}">${escapeHtml(label)}</span>`;
}

function statusTone(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'active') return 'success';
  if (normalized === 'suspended' || normalized === 'deleted' || normalized === 'disabled') return 'danger';
  return '';
}

function serviceTone(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'healthy' || normalized === 'active' || normalized === 'ok') return 'success';
  if (normalized === 'degraded' || normalized === 'warning') return '';
  return 'danger';
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value === null || value === undefined ? '-' : String(value);
}

function renderEmpty(target, title, description) {
  if (!target) return;
  target.innerHTML = `<div class="admin-empty"><div class="font-semibold text-white mb-1">${escapeHtml(title)}</div><div class="text-sm">${escapeHtml(description)}</div></div>`;
}

function setPanelActive(panelId) {
  adminState.activeTab = panelId;
  document.querySelectorAll('.admin-tab-link').forEach((item) => {
    const active = item.dataset.adminTab === panelId;
    item.classList.toggle('active', active);
    item.classList.toggle('text-gray-200', active);
    item.classList.toggle('text-gray-400', !active);
  });
  document.querySelectorAll('.admin-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `${panelId}Panel`);
  });
  closeMobileSidebar();
}

function getActivePanelId() {
  return adminState.activeTab || 'overview';
}

function openMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const backdrop = document.getElementById('mobileSidebarBackdrop');
  const toggle = document.getElementById('mobileSidebarToggle');
  if (!sidebar || window.innerWidth > 768) return;
  sidebar.classList.remove('-translate-x-full');
  sidebar.classList.add('translate-x-0');
  backdrop?.classList.add('active');
  toggle?.setAttribute('aria-expanded', 'true');
}

function closeMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const backdrop = document.getElementById('mobileSidebarBackdrop');
  const toggle = document.getElementById('mobileSidebarToggle');
  if (!sidebar || window.innerWidth > 768) return;
  sidebar.classList.add('-translate-x-full');
  sidebar.classList.remove('translate-x-0');
  backdrop?.classList.remove('active');
  toggle?.setAttribute('aria-expanded', 'false');
}

function toggleMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar || window.innerWidth > 768) return;
  if (sidebar.classList.contains('translate-x-0')) closeMobileSidebar();
  else openMobileSidebar();
}

function logout() {
  disconnectAdminWebSocket(false);
  localStorage.removeItem('token');
  localStorage.removeItem(ADMIN_AUTH_RETURN_KEY);
  window.location.replace('/login');
}

function installFetchGuard() {
  if (adminState.fetchWrapped) return;
  adminState.fetchWrapped = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    try {
      const response = await nativeFetch(...args);
      setNetworkBanner(response.status >= 500, response.status >= 500 ? 'Server is busy right now. Retrying may help.' : null);
      return response;
    } catch (error) {
      setNetworkBanner(true, 'Network error. Check your connection and retry.');
      throw error;
    }
  };
}

function disconnectAdminWebSocket(allowReconnect = false) {
  adminState.wsShouldReconnect = allowReconnect;
  if (adminState.wsReconnectTimer) {
    clearTimeout(adminState.wsReconnectTimer);
    adminState.wsReconnectTimer = null;
  }
  if (!adminState.ws) return;
  const socket = adminState.ws;
  adminState.ws = null;
  socket.onclose = null;
  socket.onmessage = null;
  socket.onerror = null;
  try { socket.close(1000, 'client_closed'); } catch {}
}

function scheduleAdminWsReconnect() {
  if (!adminState.wsShouldReconnect || adminState.wsReconnectTimer) return;
  const delay = adminState.wsReconnectDelay;
  adminState.wsReconnectTimer = setTimeout(() => {
    adminState.wsReconnectTimer = null;
    connectAdminWebSocket();
  }, delay);
  adminState.wsReconnectDelay = Math.min(delay * 2, 30000);
}

async function getAdminWsEndpoint() {
  if (adminState.wsEndpoint !== null) return adminState.wsEndpoint;
  adminState.wsEndpoint = '';
  try {
    const res = await fetch('/api/ws/config', { headers: apiHeaders() });
    const data = await readResponse(res);
    if (data?.success && data.endpoint) adminState.wsEndpoint = String(data.endpoint);
  } catch (error) {
    adminState.wsEndpoint = null;
    console.warn('Admin WebSocket endpoint unavailable', error);
  }
  return adminState.wsEndpoint;
}

function buildAdminWsUrl(endpoint) {
  if (!endpoint) return '';
  let normalized = String(endpoint).trim();
  if (!normalized) return '';
  if (normalized.startsWith('https://')) normalized = `wss://${normalized.slice(8)}`;
  if (normalized.startsWith('http://')) normalized = `ws://${normalized.slice(7)}`;
  if (!/^wss?:\/\//i.test(normalized)) return '';
  const url = new URL(normalized);
  url.searchParams.set('path', '/api/ws/admin');
  url.searchParams.set('channel', 'admin');
  url.searchParams.set('token', getSafeToken());
  return url.toString();
}

function renderOverviewCharts(users, workspaces, audit) {
  const activityCanvas = document.getElementById('activityChart');
  const statusCanvas = document.getElementById('statusChart');
  if (!activityCanvas || !statusCanvas || typeof Chart === 'undefined') return;

  const byDay = new Map();
  const today = new Date();
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    byDay.set(d.toISOString().slice(0, 10), 0);
  }
  [...audit].forEach((item) => {
    const key = new Date(item.created_at || item.timestamp || item.createdAt || Date.now()).toISOString().slice(0, 10);
    if (byDay.has(key)) byDay.set(key, byDay.get(key) + 1);
  });

  if (adminState.charts.activity) adminState.charts.activity.destroy();
  if (adminState.charts.status) adminState.charts.status.destroy();

  adminState.charts.activity = new Chart(activityCanvas, {
    type: 'bar',
    data: {
      labels: [...byDay.keys()].map((value) => value.slice(5)),
      datasets: [{
        label: 'Mutations',
        data: [...byDay.values()],
        backgroundColor: 'rgba(56, 189, 248, 0.72)',
        borderRadius: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(148, 163, 184, 0.08)' }, ticks: { color: '#94a3b8' } },
        y: { grid: { color: 'rgba(148, 163, 184, 0.08)' }, ticks: { color: '#94a3b8', precision: 0 } }
      }
    }
  });

  const userStatus = users.reduce((acc, item) => {
    const status = String(item.status || 'active').toLowerCase();
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  const workspaceStatus = workspaces.reduce((acc, item) => {
    const status = String(item.status || 'active').toLowerCase();
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  adminState.charts.status = new Chart(statusCanvas, {
    type: 'doughnut',
    data: {
      labels: ['Active users', 'Suspended users', 'Active workspaces', 'Suspended workspaces'],
      datasets: [{
        data: [userStatus.active || 0, userStatus.suspended || 0, workspaceStatus.active || 0, workspaceStatus.suspended || 0],
        backgroundColor: ['rgba(34, 197, 94, 0.8)', 'rgba(239, 68, 68, 0.8)', 'rgba(56, 189, 248, 0.8)', 'rgba(249, 115, 22, 0.8)'],
        borderColor: 'rgba(15, 23, 42, 0.85)',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '64%',
      plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', boxWidth: 12, usePointStyle: true } } }
    }
  });
}

function refreshOverviewFromState() {
  const totals = adminState.overview?.totals || {};
  const users = adminState.users;
  const workspaces = adminState.workspaces;
  const audit = adminState.audit;
  const userCounts = users.reduce((acc, item) => {
    const status = String(item.status || 'active').toLowerCase();
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  const workspaceCounts = workspaces.reduce((acc, item) => {
    const status = String(item.status || 'active').toLowerCase();
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  const totalUsers = users.length || safeNumber(totals.users);
  const totalWorkspaces = workspaces.length || safeNumber(totals.workspaces);
  const activeUsers = (userCounts.active || 0) || safeNumber(totals.active_users);
  const activeWorkspaces = (workspaceCounts.active || 0) || safeNumber(totals.active_workspaces);
  const suspendedUsers = (userCounts.suspended || 0) || safeNumber(totals.suspended_users);
  const suspendedWorkspaces = (workspaceCounts.suspended || 0) || safeNumber(totals.suspended_workspaces);
  const totalProjects = workspaces.reduce((sum, ws) => sum + safeNumber(ws.project_count ?? ws.projects?.length ?? 0), 0) || safeNumber(totals.projects);
  const totalLogs = safeNumber(adminState.overview?.logs_count ?? adminState.overview?.logs ?? totals.logs ?? audit.length);
  const rateLimits = safeNumber(adminState.overview?.rate_limits_count ?? adminState.overview?.rateLimitsCount ?? totals.rate_limits ?? 0);

  setText('overviewUsersCount', totalUsers);
  setText('overviewWorkspacesCount', totalWorkspaces);
  setText('overviewProjectsCount', totalProjects);
  setText('overviewLogsCount', totalLogs);
  setText('healthRateLimits', rateLimits);
  setText('healthSuspended', suspendedUsers + suspendedWorkspaces);
  setText('healthActiveUsers', activeUsers);
  setText('healthActiveWorkspaces', activeWorkspaces);
  setText('usersTrend', activeUsers ? `+${activeUsers} active` : '-');
  setText('workspacesTrend', activeWorkspaces ? `+${activeWorkspaces} active` : '-');
  setText('projectsTrend', totalProjects ? `+${totalProjects} projects` : '-');
  setText('logsTrend', audit.length ? `${audit.length} events` : '-');
  renderOverviewCharts(users, workspaces, audit);
  renderRecentActivity(audit);
}

function renderRecentActivity(audit) {
  const container = document.getElementById('recentActivityList');
  if (!container) return;
  const rows = [...audit].slice(0, 6);
  if (!rows.length) {
    renderEmpty(container, 'No audit records yet', 'Activity will appear here after admin actions are recorded.');
    return;
  }
  container.innerHTML = rows.map((item) => `
    <div class="summary-card">
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="label">${escapeHtml(item.action || item.type || 'ACTION')}</div>
          <div class="value">${escapeHtml(item.target_type || item.targetType || 'system')} / ${escapeHtml(item.target_id || item.targetId || '-')}</div>
          <div class="text-xs text-gray-400 mt-1">${escapeHtml(item.reason || 'No reason provided')}</div>
        </div>
        <div class="text-right text-xs text-gray-500 shrink-0">
          <div>${escapeHtml(formatDateTime(item.created_at || item.timestamp || item.createdAt))}</div>
          <div class="mt-1">${escapeHtml(item.actor_user_id || item.actor || 'system')}</div>
        </div>
      </div>
    </div>
  `).join('');
}

async function loadOverview({ force = false } = {}) {
  if (adminState.overview && !force) {
    refreshOverviewFromState();
    return adminState.overview;
  }
  try {
    const response = await apiFetch('/api/admin/overview');
    const data = await readResponse(response);
    if (!response.ok || data.success === false) throw new Error(data.error || `Failed to load overview (${response.status})`);
    const overview = data.overview || data.data || data || {};
    adminState.overview = overview;

    const users = normalizeList(data.users, ['users']);
    if (users.length) adminState.users = users;

    const workspaces = normalizeList(data.workspaces, ['workspaces']);
    if (workspaces.length) adminState.workspaces = workspaces;

    const audit = normalizeList(data.audit, ['audit', 'events', 'logs']);
    const recentAudit = normalizeList(overview.recent_audit, ['recent_audit']);
    if (audit.length) adminState.audit = audit;
    else if (recentAudit.length) adminState.audit = recentAudit;

    refreshOverviewFromState();
    return adminState.overview;
  } catch (error) {
    console.error('Overview load failed', error);
    showToast('Overview', error.message, 'error');
    refreshOverviewFromState();
    return null;
  }
}

function renderAwsServiceChart(summary = {}) {
  const canvas = document.getElementById('awsServiceChart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (adminState.charts.awsServices) adminState.charts.awsServices.destroy();
  adminState.charts.awsServices = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Healthy', 'Degraded', 'Unavailable'],
      datasets: [{
        data: [
          safeNumber(summary.healthy_services || 0),
          safeNumber(summary.degraded_services || 0),
          safeNumber(summary.unavailable_services || 0)
        ],
        backgroundColor: ['rgba(16, 185, 129, 0.85)', 'rgba(245, 158, 11, 0.85)', 'rgba(244, 63, 94, 0.85)'],
        borderColor: 'rgba(15, 23, 42, 0.85)',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#94a3b8', boxWidth: 12, usePointStyle: true }
        }
      }
    }
  });
}

function renderAwsTableWrap(target, html) {
  if (!target) return;
  target.innerHTML = html;
}

function renderAwsServicesPanel() {
  const aws = adminState.aws || {};
  const summary = aws.summary || {};
  const services = aws.services || {};
  setText('awsSummaryStatus', String(summary.overall_status || '-').toUpperCase());
  setText('awsSummaryHealthy', safeNumber(summary.healthy_services || 0));
  setText('awsSummaryDegraded', safeNumber(summary.degraded_services || 0));
  setText('awsSummaryUnavailable', safeNumber(summary.unavailable_services || 0));
  setText('awsRegion', `Region: ${aws.region || '-'}`);
  setText('awsCheckedAt', `Checked: ${formatDateTime(aws.checked_at)}`);
  renderAwsServiceChart(summary);

  const cards = document.getElementById('awsServiceCards');
  if (cards) {
    const cardRows = Object.values(services).filter(Boolean);
    if (!cardRows.length) renderEmpty(cards, 'No service checks yet', 'Refresh the panel to run AWS service checks.');
    else {
      cards.innerHTML = cardRows.map((service) => `
        <div class="summary-card">
          <div class="flex items-center justify-between gap-2">
            <div class="font-semibold text-white">${escapeHtml(String(service.service || '').toUpperCase())}</div>
            ${badgeHtml(String(service.status || 'unknown').toUpperCase(), serviceTone(service.status))}
          </div>
          <div class="text-xs text-gray-400 mt-1 break-all">${escapeHtml(service.error || service.message || '')}</div>
        </div>
      `).join('');
    }
  }

  const lambdaDetails = document.getElementById('awsLambdaDetails');
  if (lambdaDetails) {
    const lambda = services.lambda || {};
    lambdaDetails.innerHTML = `
      <div><span class="text-gray-500">Function</span>: <span class="font-mono">${escapeHtml(lambda.function_name || '-')}</span></div>
      <div><span class="text-gray-500">Runtime</span>: ${escapeHtml(lambda.runtime || '-')}</div>
      <div><span class="text-gray-500">Memory/Timeout</span>: ${escapeHtml(`${safeNumber(lambda.memory_size, 0)}MB / ${safeNumber(lambda.timeout_seconds, 0)}s`)}</div>
      <div><span class="text-gray-500">State</span>: ${escapeHtml(lambda.state || lambda.status || '-')} (${escapeHtml(lambda.last_update_status || '-')})</div>
      <div><span class="text-gray-500">Last Modified</span>: ${escapeHtml(formatDateTime(lambda.last_modified))}</div>
      ${lambda.error ? `<div class="text-rose-300">${escapeHtml(lambda.error)}</div>` : ''}
    `;
  }

  const cloudFrontDetails = document.getElementById('awsCloudFrontDetails');
  if (cloudFrontDetails) {
    const cloudfront = services.cloudfront || {};
    cloudFrontDetails.innerHTML = `
      <div><span class="text-gray-500">Distribution ID</span>: <span class="font-mono">${escapeHtml(cloudfront.distribution_id || '-')}</span></div>
      <div><span class="text-gray-500">Domain</span>: ${escapeHtml(cloudfront.domain_name || '-')}</div>
      <div><span class="text-gray-500">Deployment</span>: ${escapeHtml(cloudfront.deployment_status || cloudfront.status || '-')}</div>
      <div><span class="text-gray-500">Probe</span>: ${escapeHtml(cloudfront.health_probe?.message || '-')}</div>
      ${cloudfront.error ? `<div class="text-rose-300">${escapeHtml(cloudfront.error)}</div>` : ''}
    `;
  }

  const cloudWatchDetails = document.getElementById('awsCloudWatchDetails');
  if (cloudWatchDetails) {
    const cloudwatch = services.cloudwatch || {};
    cloudWatchDetails.innerHTML = `
      <div><span class="text-gray-500">Log Group</span>: <span class="font-mono">${escapeHtml(cloudwatch.log_group?.name || '-')}</span></div>
      <div><span class="text-gray-500">Retention</span>: ${escapeHtml(cloudwatch.log_group?.retention_days ? `${cloudwatch.log_group.retention_days} days` : '-')}</div>
      <div><span class="text-gray-500">Stored Bytes</span>: ${escapeHtml(String(safeNumber(cloudwatch.log_group?.stored_bytes || 0)))}</div>
      <div><span class="text-gray-500">Active alarms</span>: ${escapeHtml(String(safeNumber(cloudwatch.active_alarm_count || 0)))}</div>
      ${(cloudwatch.errors || []).map((err) => `<div class="text-rose-300">${escapeHtml(err)}</div>`).join('')}
    `;
  }

  const alarmsContainer = document.getElementById('awsCloudWatchAlarms');
  if (alarmsContainer) {
    const alarms = (services.cloudwatch?.alarms || []);
    if (!alarms.length) renderEmpty(alarmsContainer, 'No alarms returned', 'No CloudWatch alarms matched the current project prefix.');
    else {
      alarmsContainer.innerHTML = alarms.slice(0, 12).map((alarm) => `
        <div class="summary-card">
          <div class="flex items-center justify-between gap-2">
            <div class="font-semibold text-white break-all">${escapeHtml(alarm.name || '-')}</div>
            ${badgeHtml(String(alarm.state || 'unknown').toUpperCase(), serviceTone(String(alarm.state || '').toLowerCase() === 'alarm' ? 'degraded' : 'healthy'))}
          </div>
          <div class="text-xs text-gray-400 mt-1">${escapeHtml(alarm.reason || '')}</div>
        </div>
      `).join('');
    }
  }

  const dynamoWrap = document.getElementById('awsDynamoTableWrap');
  const dynamodb = services.dynamodb || {};
  const dynamoTables = Array.isArray(dynamodb.tables) ? dynamodb.tables : [];
  if (!dynamoTables.length) renderEmpty(dynamoWrap, 'No DynamoDB tables', 'No table diagnostics were returned by the API.');
  else {
    renderAwsTableWrap(dynamoWrap, `
      <table class="admin-table">
        <thead><tr><th>Table</th><th>Status</th><th>Items</th><th>GSI</th><th>Billing</th><th>Error</th></tr></thead>
        <tbody>
          ${dynamoTables.map((table) => `
            <tr>
              <td class="text-sm text-gray-300 font-mono break-all">${escapeHtml(table.name || '-')}</td>
              <td>${badgeHtml(table.status || '-', serviceTone(table.healthy ? 'healthy' : 'degraded'))}</td>
              <td class="text-sm text-gray-300">${escapeHtml(String(safeNumber(table.item_count || 0)))}</td>
              <td class="text-sm text-gray-300">${escapeHtml(String(safeNumber(table.gsi_count || 0)))}</td>
              <td class="text-sm text-gray-300">${escapeHtml(table.billing_mode || '-')}</td>
              <td class="text-xs text-rose-300">${escapeHtml(table.error || '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `);
  }

  const s3Wrap = document.getElementById('awsS3TableWrap');
  const s3Status = services.s3 || {};
  const buckets = Array.isArray(s3Status.buckets) ? s3Status.buckets : [];
  if (!buckets.length) renderEmpty(s3Wrap, 'No S3 buckets', 'No bucket diagnostics were returned by the API.');
  else {
    renderAwsTableWrap(s3Wrap, `
      <table class="admin-table">
        <thead><tr><th>Bucket</th><th>Status</th><th>Region</th><th>Versioning</th><th>Encryption</th><th>Error</th></tr></thead>
        <tbody>
          ${buckets.map((bucket) => `
            <tr>
              <td class="text-sm text-gray-300 font-mono break-all">${escapeHtml(bucket.name || '-')}</td>
              <td>${badgeHtml(bucket.status || '-', serviceTone(bucket.healthy ? 'healthy' : 'degraded'))}</td>
              <td class="text-sm text-gray-300">${escapeHtml(bucket.region || '-')}</td>
              <td class="text-sm text-gray-300">${escapeHtml(bucket.versioning || '-')}</td>
              <td class="text-sm text-gray-300">${escapeHtml(bucket.encryption || '-')}</td>
              <td class="text-xs text-rose-300">${escapeHtml(bucket.error || '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `);
  }

  lucide.createIcons();
}

async function loadAwsStatus({ force = false } = {}) {
  if (adminState.aws && !force) {
    renderAwsServicesPanel();
    return adminState.aws;
  }
  const cards = document.getElementById('awsServiceCards');
  if (cards) renderEmpty(cards, 'Checking AWS services...', 'Collecting diagnostics from backend checks.');
  try {
    const response = await apiFetch('/api/admin/aws/services');
    const data = await readResponse(response);
    if (!response.ok || data.success === false) throw new Error(data.error || `Failed to load AWS services (${response.status})`);
    adminState.aws = data.aws || data.data || {};
    renderAwsServicesPanel();
    return adminState.aws;
  } catch (error) {
    showToast('AWS Services', error.message, 'error');
    if (cards) renderEmpty(cards, 'Unable to load AWS checks', error.message);
    return null;
  }
}

function userFilterMatches(item) {
  const search = document.getElementById('userSearch')?.value?.trim().toLowerCase() || '';
  const statusFilter = document.getElementById('userStatusFilter')?.value || 'all';
  const haystack = [item.display_name, item.name, item.email, item.role, item.status, item.id].join(' ').toLowerCase();
  if (statusFilter !== 'all' && String(item.status || '').toLowerCase() !== statusFilter) return false;
  if (search && !haystack.includes(search)) return false;
  return true;
}

function workspaceFilterMatches(item) {
  const search = document.getElementById('workspaceSearch')?.value?.trim().toLowerCase() || '';
  const statusFilter = document.getElementById('workspaceStatusFilter')?.value || 'all';
  const haystack = [item.name, item.loader_key, item.loaderKey, item.owner_email, item.owner?.email, item.owner?.display_name, item.status, item.id].join(' ').toLowerCase();
  if (statusFilter !== 'all' && String(item.status || '').toLowerCase() !== statusFilter) return false;
  if (search && !haystack.includes(search)) return false;
  return true;
}

function renderUsersTable() {
  const wrap = document.getElementById('usersTableWrap');
  if (!wrap) return;
  const rows = adminState.users.filter(userFilterMatches);
  if (!rows.length) return renderEmpty(wrap, 'No users found', 'Try another search or load data again.');
  wrap.innerHTML = `
    <table class="admin-table">
      <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
      <tbody>
        ${rows.map((user) => `
          <tr data-user-row="${escapeHtml(user.id)}">
            <td><div class="entity-name">${escapeHtml(user.display_name || user.name || 'Unnamed user')}</div><div class="text-xs text-gray-400 font-mono break-all mt-1">${escapeHtml(user.id || '-')}</div></td>
            <td class="text-sm text-gray-300">${escapeHtml(user.email || '-')}</td>
            <td><select class="admin-input admin-user-role">${['user', 'admin'].map((role) => `<option value="${role}" ${String(user.role || 'user') === role ? 'selected' : ''}>${role}</option>`).join('')}</select></td>
            <td><select class="admin-input admin-user-status">${['active', 'suspended'].map((status) => `<option value="${status}" ${String(user.status || 'active') === status ? 'selected' : ''}>${status}</option>`).join('')}</select></td>
            <td class="text-sm text-gray-400">${escapeHtml(formatDateOnly(user.created_at || user.createdAt))}</td>
            <td><div class="admin-action-group"><button class="quick-action" data-user-action="save" data-id="${escapeHtml(user.id)}"><i data-lucide="save" class="w-4 h-4 text-cyan-400"></i>Save</button><button class="quick-action" data-user-action="${String(user.status || '').toLowerCase() === 'active' ? 'suspend' : 'activate'}" data-id="${escapeHtml(user.id)}"><i data-lucide="${String(user.status || '').toLowerCase() === 'active' ? 'pause-circle' : 'play-circle'}" class="w-4 h-4 text-cyan-400"></i>${String(user.status || '').toLowerCase() === 'active' ? 'Suspend' : 'Activate'}</button><button class="quick-action" data-user-action="delete" data-id="${escapeHtml(user.id)}"><i data-lucide="trash-2" class="w-4 h-4 text-red-400"></i>Delete</button></div></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  lucide.createIcons();
}

async function loadUsers({ force = false } = {}) {
  if (adminState.users.length && !force) {
    renderUsersTable();
    return adminState.users;
  }
  const wrap = document.getElementById('usersTableWrap');
  if (wrap) renderEmpty(wrap, 'Loading users...', 'Please wait while system accounts are fetched.');
  try {
    const response = await apiFetch('/api/admin/users');
    const data = await readResponse(response);
    if (!response.ok || data.success === false) throw new Error(data.error || `Failed to load users (${response.status})`);
    adminState.users = normalizeList(data.users || data.items || data.data, ['users']);
    renderUsersTable();
    refreshOverviewFromState();
    renderEntityTargets();
    return adminState.users;
  } catch (error) {
    if (wrap) renderEmpty(wrap, 'Unable to load users', error.message);
    showToast('Users', error.message, 'error');
    return [];
  }
}

function renderWorkspacesTable() {
  const wrap = document.getElementById('workspacesTableWrap');
  if (!wrap) return;
  const rows = adminState.workspaces.filter(workspaceFilterMatches);
  if (!rows.length) return renderEmpty(wrap, 'No workspaces found', 'Try a different filter or refresh the panel.');
  wrap.innerHTML = `
    <table class="admin-table">
      <thead><tr><th>Workspace</th><th>Loader Key</th><th>Owner</th><th>Status</th><th>Projects</th><th>Actions</th></tr></thead>
      <tbody>
        ${rows.map((workspace) => `
          <tr data-workspace-row="${escapeHtml(workspace.id)}">
            <td><div class="entity-name">${escapeHtml(workspace.name || 'Unnamed workspace')}</div><div class="text-xs text-gray-400 font-mono break-all mt-1">${escapeHtml(workspace.id || '-')}</div></td>
            <td class="text-xs text-gray-300 font-mono break-all">${escapeHtml(workspace.loader_key || workspace.loaderKey || '-')}</td>
            <td class="text-sm text-gray-300">${escapeHtml(workspace.owner?.email || workspace.owner_email || workspace.owner?.display_name || workspace.owner_name || workspace.owner_id || '-')}</td>
            <td>${badgeHtml(workspace.status || 'active', statusTone(workspace.status || 'active'))}</td>
            <td class="text-sm text-gray-400">${escapeHtml(safeNumber(workspace.project_count ?? workspace.projects?.length ?? 0))}</td>
            <td><div class="admin-action-group"><button class="quick-action" data-workspace-action="open" data-id="${escapeHtml(workspace.id)}" data-loader="${escapeHtml(workspace.loader_key || workspace.loaderKey || '')}"><i data-lucide="external-link" class="w-4 h-4 text-cyan-400"></i>Open</button><button class="quick-action" data-workspace-action="${String(workspace.status || '').toLowerCase() === 'active' ? 'suspend' : 'activate'}" data-id="${escapeHtml(workspace.id)}"><i data-lucide="${String(workspace.status || '').toLowerCase() === 'active' ? 'pause-circle' : 'play-circle'}" class="w-4 h-4 text-cyan-400"></i>${String(workspace.status || '').toLowerCase() === 'active' ? 'Suspend' : 'Activate'}</button><button class="quick-action" data-workspace-action="delete" data-id="${escapeHtml(workspace.id)}"><i data-lucide="trash-2" class="w-4 h-4 text-red-400"></i>Delete</button></div></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  lucide.createIcons();
}

async function loadWorkspaces({ force = false } = {}) {
  if (adminState.workspaces.length && !force) {
    renderWorkspacesTable();
    return adminState.workspaces;
  }
  const wrap = document.getElementById('workspacesTableWrap');
  if (wrap) renderEmpty(wrap, 'Loading workspaces...', 'Please wait while workspace records are fetched.');
  try {
    const response = await apiFetch('/api/admin/workspaces');
    const data = await readResponse(response);
    if (!response.ok || data.success === false) throw new Error(data.error || `Failed to load workspaces (${response.status})`);
    adminState.workspaces = normalizeList(data.workspaces || data.items || data.data, ['workspaces']);
    renderWorkspacesTable();
    refreshOverviewFromState();
    renderEntityTargets();
    return adminState.workspaces;
  } catch (error) {
    if (wrap) renderEmpty(wrap, 'Unable to load workspaces', error.message);
    showToast('Workspaces', error.message, 'error');
    return [];
  }
}
function filterAuditRows(rows) {
  const search = document.getElementById('auditSearch')?.value?.trim().toLowerCase() || '';
  const from = document.getElementById('auditDateFrom')?.value || '';
  const to = document.getElementById('auditDateTo')?.value || '';
  return rows.filter((item) => {
    const haystack = [item.actor_user_id, item.actor, item.action, item.target_type, item.targetType, item.target_id, item.targetId, item.reason].join(' ').toLowerCase();
    if (search && !haystack.includes(search)) return false;
    const created = new Date(item.created_at || item.timestamp || item.createdAt || Date.now());
    if (from && created < new Date(`${from}T00:00:00`)) return false;
    if (to && created > new Date(`${to}T23:59:59.999`)) return false;
    return true;
  });
}

function renderAudit() {
  const timeline = document.getElementById('auditTimeline');
  const wrap = document.getElementById('auditTableWrap');
  if (!timeline || !wrap) return;
  const filtered = filterAuditRows(adminState.audit);
  if (!filtered.length) {
    renderEmpty(timeline, 'No audit events', 'Try widening the date or keyword filters.');
    renderEmpty(wrap, 'No audit records', 'Try widening the date or keyword filters.');
    return;
  }
  timeline.innerHTML = filtered.slice(0, 12).map((item) => `
    <div class="summary-card">
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="label">${escapeHtml(item.action || item.type || 'ACTION')}</div>
          <div class="value">${escapeHtml(item.target_type || item.targetType || 'system')} / ${escapeHtml(item.target_id || item.targetId || '-')}</div>
          <div class="text-xs text-gray-400 mt-1">${escapeHtml(item.reason || 'No reason provided')}</div>
        </div>
        <div class="text-right text-xs text-gray-500 shrink-0">
          <div>${escapeHtml(formatDateTime(item.created_at || item.timestamp || item.createdAt))}</div>
          <div class="mt-1">${escapeHtml(item.actor_user_id || item.actor || 'system')}</div>
        </div>
      </div>
    </div>
  `).join('');
  wrap.innerHTML = `
    <table class="admin-table">
      <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Reason</th></tr></thead>
      <tbody>
        ${filtered.map((item) => `
          <tr>
            <td class="text-sm text-gray-400">${escapeHtml(formatDateTime(item.created_at || item.timestamp || item.createdAt))}</td>
            <td class="text-sm text-gray-300">${escapeHtml(item.actor_user_id || item.actor || '-')}</td>
            <td class="text-sm text-gray-300">${escapeHtml(item.action || item.type || '-')}</td>
            <td class="text-sm text-gray-300">${escapeHtml([item.target_type || item.targetType || '-', item.target_id || item.targetId || '-'].join(' / '))}</td>
            <td class="text-sm text-gray-400">${escapeHtml(item.reason || '-')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  lucide.createIcons();
}

async function loadAudit({ force = false } = {}) {
  if (adminState.audit.length && !force) {
    renderAudit();
    return adminState.audit;
  }
  const timeline = document.getElementById('auditTimeline');
  const wrap = document.getElementById('auditTableWrap');
  if (timeline) renderEmpty(timeline, 'Loading audit events...', 'Please wait while the timeline is fetched.');
  if (wrap) renderEmpty(wrap, 'Loading audit table...', 'Please wait while records are fetched.');
  try {
    const response = await apiFetch('/api/admin/audit');
    const data = await readResponse(response);
    if (!response.ok || data.success === false) throw new Error(data.error || `Failed to load audit (${response.status})`);
    adminState.audit = normalizeList(data.audit || data.items || data.data, ['audit']);
    renderAudit();
    refreshOverviewFromState();
    return adminState.audit;
  } catch (error) {
    if (timeline) renderEmpty(timeline, 'Unable to load audit', error.message);
    if (wrap) renderEmpty(wrap, 'Unable to load audit', error.message);
    showToast('Audit', error.message, 'error');
    return [];
  }
}

function renderEntityTargets() {
  const container = document.getElementById('entityQuickTargets');
  if (!container) return;
  const targets = [];
  if (adminState.profile) targets.push({ label: 'Current admin profile', type: 'user', id: adminState.profile.id, subtitle: adminState.profile.email });
  adminState.workspaces.slice(0, 5).forEach((workspace) => targets.push({ label: workspace.name || 'Workspace', type: 'workspace', id: workspace.id || workspace.loader_key || workspace.loaderKey, subtitle: workspace.loader_key || workspace.loaderKey || workspace.id }));
  adminState.users.slice(0, 5).forEach((user) => targets.push({ label: user.display_name || user.email || 'User', type: 'user', id: user.id, subtitle: user.email }));
  if (!targets.length) return renderEmpty(container, 'No targets yet', 'Load users or workspaces to populate quick inspectors.');
  container.innerHTML = targets.map((item) => `
    <button class="w-full text-left rounded-xl border border-white/10 bg-white/5 p-3 hover:border-cyan-500/20 hover:bg-cyan-500/10 transition-colors" data-inspect-type="${escapeHtml(item.type)}" data-inspect-id="${escapeHtml(item.id)}">
      <div class="font-semibold text-white">${escapeHtml(item.label)}</div>
      <div class="text-xs text-gray-400 mt-1">${escapeHtml(item.subtitle || '')}</div>
    </button>
  `).join('');
}

function filterAndRenderEntityTargets() {
  renderEntityTargets();
  const query = String(document.getElementById('entityLookup')?.value || '').trim().toLowerCase();
  if (!query) return;
  const buttons = Array.from(document.querySelectorAll('#entityQuickTargets [data-inspect-id]'));
  buttons.forEach((button) => {
    const label = String(button.textContent || '').toLowerCase();
    const id = String(button.getAttribute('data-inspect-id') || '').toLowerCase();
    button.classList.toggle('hidden', !(label.includes(query) || id.includes(query)));
  });
}

function renderEntityDetails(entity, raw) {
  const summary = document.getElementById('entitySummary');
  const json = document.getElementById('entityJson');
  if (!summary || !json) return;
  if (!entity) {
    summary.innerHTML = `<div class="admin-empty"><div class="font-semibold text-white mb-1">Select an entity</div><div class="text-sm">Use the search box or quick targets to inspect a user, workspace, or nested object.</div></div>`;
    json.textContent = 'Select an entity to inspect.';
    return;
  }
  const rows = Object.entries(entity).filter(([key, value]) => value !== undefined && value !== null && key !== 'raw');
  summary.innerHTML = rows.slice(0, 8).map(([key, value]) => `
    <div class="summary-card">
      <div class="label">${escapeHtml(key.replace(/_/g, ' '))}</div>
      <div class="value">${escapeHtml(Array.isArray(value) ? `${value.length} item(s)` : typeof value === 'object' ? 'Object' : value)}</div>
    </div>
  `).join('');
  json.textContent = JSON.stringify(raw || entity, null, 2);
}

async function inspectEntity(identifier, kind = 'auto') {
  const value = String(identifier || '').trim();
  if (!value) {
    showToast('Entity Console', 'Enter a workspace ID, loader key, or user email.', 'warning');
    return;
  }
  const lower = value.toLowerCase();
  const matchedUser = adminState.users.find((item) => String(item.id || '').toLowerCase() === lower || String(item.email || '').toLowerCase() === lower || String(item.display_name || '').toLowerCase() === lower);
  const matchedWorkspace = adminState.workspaces.find((item) => String(item.id || '').toLowerCase() === lower || String(item.loader_key || item.loaderKey || '').toLowerCase() === lower || String(item.name || '').toLowerCase() === lower);
  if (kind === 'user' || (kind === 'auto' && matchedUser && !matchedWorkspace)) {
    adminState.selectedEntity = matchedUser || null;
    adminState.selectedEntityRaw = matchedUser || null;
    renderEntityDetails(matchedUser, matchedUser);
    return;
  }
  if (kind === 'workspace' || matchedWorkspace) {
    try {
      const workspaceId = matchedWorkspace?.id || value;
      const response = await apiFetch(`/api/admin/workspaces/${encodeURIComponent(workspaceId)}`);
      const data = await readResponse(response);
      if (!response.ok || data.success === false) throw new Error(data.error || `Failed to load workspace (${response.status})`);
      const workspace = data.workspace || data.data || data;
      adminState.selectedEntity = workspace;
      adminState.selectedEntityRaw = data;
      renderEntityDetails(workspace, data);
      showToast('Entity Console', `Loaded workspace ${workspace.name || workspace.id}`, 'success');
      return;
    } catch (error) {
      showToast('Entity Console', error.message, 'error');
    }
  }
  if (matchedUser) {
    adminState.selectedEntity = matchedUser;
    adminState.selectedEntityRaw = matchedUser;
    renderEntityDetails(matchedUser, matchedUser);
    return;
  }
  const fallback = { lookup: value, note: 'No direct match found. Select a loaded user or workspace target.' };
  adminState.selectedEntity = fallback;
  adminState.selectedEntityRaw = fallback;
  renderEntityDetails(fallback, fallback);
}
async function copyEntityJson() {
  const payload = JSON.stringify(adminState.selectedEntityRaw || adminState.selectedEntity || {}, null, 2);
  try {
    await navigator.clipboard.writeText(payload);
    showToast('Entity Console', 'JSON copied to clipboard.', 'success');
  } catch {
    showToast('Entity Console', 'Unable to copy JSON.', 'error');
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportAuditJson() {
  downloadBlob(new Blob([JSON.stringify(filterAuditRows(adminState.audit), null, 2)], { type: 'application/json' }), `admin-audit-${Date.now()}.json`);
}

function exportAuditCsv() {
  const filtered = filterAuditRows(adminState.audit);
  const rows = [['created_at', 'actor_user_id', 'action', 'target_type', 'target_id', 'reason', 'metadata'].join(',')];
  filtered.forEach((item) => {
    const line = [item.created_at || item.timestamp || item.createdAt || '', item.actor_user_id || item.actor || '', item.action || item.type || '', item.target_type || item.targetType || '', item.target_id || item.targetId || '', item.reason || '', JSON.stringify(item.metadata || {})].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',');
    rows.push(line);
  });
  downloadBlob(new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' }), `admin-audit-${Date.now()}.csv`);
}

function openGuardModal(context) {
  adminState.guard = { open: true, phase: 'confirm', action: context.action, targetType: context.targetType, targetId: context.targetId, reason: '', challengeId: '', challenge: '', guardToken: '' };
  const modal = document.getElementById('adminActionModal');
  const title = document.getElementById('adminActionTitle');
  const desc = document.getElementById('adminActionDescription');
  const step = document.getElementById('adminActionStepLabel');
  const reason = document.getElementById('adminActionReason');
  const challengeWrap = document.getElementById('adminActionChallengeWrap');
  const challenge = document.getElementById('adminActionChallenge');
  const challengeInput = document.getElementById('adminActionChallengeInput');
  const primary = document.getElementById('adminActionPrimaryButton');
  if (!modal || !title || !desc || !step || !reason || !challengeWrap || !challenge || !challengeInput || !primary) return;
  title.textContent = context.title || 'Confirm Destructive Action';
  desc.textContent = context.description || 'This action is permanent or broadly disruptive. Provide a reason and complete the guard flow.';
  step.textContent = 'Step 1 of 2';
  reason.value = '';
  challengeWrap.classList.add('hidden');
  challenge.textContent = '';
  challengeInput.value = '';
  primary.disabled = false;
  primary.innerHTML = '<i data-lucide="shield-check" class="w-4 h-4"></i>Generate Guard Token';
  modal.style.display = 'flex';
  lucide.createIcons();
  setTimeout(() => reason.focus(), 50);
}

function closeGuardModal() {
  adminState.guard.open = false;
  const modal = document.getElementById('adminActionModal');
  if (modal) modal.style.display = 'none';
}

async function runGuardFlow() {
  const guard = adminState.guard;
  const reason = document.getElementById('adminActionReason');
  const challengeInput = document.getElementById('adminActionChallengeInput');
  const challengeWrap = document.getElementById('adminActionChallengeWrap');
  const challenge = document.getElementById('adminActionChallenge');
  const step = document.getElementById('adminActionStepLabel');
  const primary = document.getElementById('adminActionPrimaryButton');
  if (!reason || !challengeInput || !challengeWrap || !challenge || !step || !primary) return null;
  guard.reason = reason.value.trim();
  if (!guard.reason) {
    showToast('Guard', 'Reason is required.', 'warning');
    return null;
  }
  if (guard.phase === 'confirm') {
    primary.disabled = true;
    primary.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i>Creating Challenge';
    try {
      const response = await apiFetch('/api/admin/guard/start', { method: 'POST', body: JSON.stringify({ action: guard.action, target_type: guard.targetType, target_id: guard.targetId, reason: guard.reason }) });
      const data = await readResponse(response);
      if (!response.ok || data.success === false) throw new Error(data.error || `Failed to start guard (${response.status})`);
      guard.challengeId = data.challengeId || data.guardId || data.id || data.challenge || '';
      guard.challenge = data.prompt || data.message || guard.challengeId;
      if (data.guardToken || data.token) {
        guard.guardToken = data.guardToken || data.token;
        closeGuardModal();
        return guard.guardToken;
      }
      guard.phase = 'verify';
      step.textContent = 'Step 2 of 2';
      challengeWrap.classList.remove('hidden');
      challenge.textContent = guard.challenge || 'Enter the verification text provided by the server.';
      primary.disabled = false;
      primary.innerHTML = '<i data-lucide="shield-check" class="w-4 h-4"></i>Verify Guard Token';
      challengeInput.focus();
      lucide.createIcons();
      showToast('Guard', 'Challenge created. Complete verification to continue.', 'info');
      return null;
    } catch (error) {
      primary.disabled = false;
      primary.innerHTML = '<i data-lucide="shield-check" class="w-4 h-4"></i>Generate Guard Token';
      showToast('Guard', error.message, 'error');
      return null;
    }
  }
  primary.disabled = true;
  primary.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i>Verifying';
  try {
    const response = await apiFetch('/api/admin/guard/verify', { method: 'POST', body: JSON.stringify({ action: guard.action, target_type: guard.targetType, target_id: guard.targetId, reason: guard.reason, challengeId: guard.challengeId, response: challengeInput.value.trim(), challenge: guard.challengeId || guard.challenge }) });
    const data = await readResponse(response);
    if (!response.ok || data.success === false) throw new Error(data.error || `Failed to verify guard (${response.status})`);
    guard.guardToken = data.guardToken || data.token || data.guard_token || '';
    if (!guard.guardToken) throw new Error('Guard token was not issued by the server.');
    closeGuardModal();
    return guard.guardToken;
  } catch (error) {
    primary.disabled = false;
    primary.innerHTML = '<i data-lucide="shield-check" class="w-4 h-4"></i>Verify Guard Token';
    showToast('Guard', error.message, 'error');
    return null;
  }
}

async function destroyEntity(kind, id) {
  const response = await fetch(kind === 'user' ? `/api/admin/users/${encodeURIComponent(id)}` : `/api/admin/workspaces/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    cache: 'no-store',
    headers: apiHeaders({ 'X-Admin-Guard-Token': adminState.guard.guardToken }, true),
    body: JSON.stringify({ reason: adminState.guard.reason })
  });
  const data = await readResponse(response);
  if (!response.ok || data.success === false) throw new Error(data.error || `Delete failed (${response.status})`);
  showToast('Admin', data.message || `${kind} deleted successfully`, 'success');
}

async function handleUserAction(button) {
  const userId = button.dataset.id;
  const action = button.dataset.userAction;
  const row = button.closest('tr');
  const user = adminState.users.find((item) => String(item.id) === String(userId));
  if (!user || !row) return;
  if (action === 'save') {
    const role = row.querySelector('.admin-user-role')?.value || user.role || 'user';
    const status = row.querySelector('.admin-user-status')?.value || user.status || 'active';
    try {
      const response = await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify({ role, status }) });
      const data = await readResponse(response);
      if (!response.ok || data.success === false) throw new Error(data.error || `Failed to update user (${response.status})`);
      adminState.users = adminState.users.map((item) => String(item.id) === String(userId) ? { ...item, role, status } : item);
      renderUsersTable();
      refreshOverviewFromState();
      showToast('Users', 'User updated successfully.', 'success');
    } catch (error) {
      showToast('Users', error.message, 'error');
    }
    return;
  }
  if (action === 'suspend' || action === 'activate') {
    try {
      const endpoint = action === 'suspend' ? 'suspend' : 'activate';
      const response = await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/${endpoint}`, { method: 'POST' });
      const data = await readResponse(response);
      if (!response.ok || data.success === false) throw new Error(data.error || `Failed to ${action} user (${response.status})`);
      await loadUsers({ force: true });
      await loadOverview({ force: true });
      showToast('Users', data.message || `User ${action}d successfully.`, 'success');
    } catch (error) {
      showToast('Users', error.message, 'error');
    }
    return;
  }
  if (action === 'delete') {
    openGuardModal({ action: 'delete_user', targetType: 'user', targetId: userId, title: `Delete user ${user.display_name || user.email || user.id}`, description: 'This will permanently remove the user and cascade related data where applicable.' });
  }
}

async function handleWorkspaceAction(button) {
  const workspaceId = button.dataset.id;
  const action = button.dataset.workspaceAction;
  const workspace = adminState.workspaces.find((item) => String(item.id) === String(workspaceId));
  if (!workspace) return;
  if (action === 'open') {
    window.location.href = `/workspace/${encodeURIComponent(workspace.id)}`;
    return;
  }
  if (action === 'suspend' || action === 'activate') {
    try {
      const endpoint = action === 'suspend' ? 'suspend' : 'activate';
      const response = await apiFetch(`/api/admin/workspaces/${encodeURIComponent(workspaceId)}/${endpoint}`, { method: 'POST' });
      const data = await readResponse(response);
      if (!response.ok || data.success === false) throw new Error(data.error || `Failed to ${action} workspace (${response.status})`);
      await loadWorkspaces({ force: true });
      await loadOverview({ force: true });
      showToast('Workspaces', data.message || `Workspace ${action}d successfully.`, 'success');
    } catch (error) {
      showToast('Workspaces', error.message, 'error');
    }
    return;
  }
  if (action === 'delete') {
    openGuardModal({ action: 'delete_workspace', targetType: 'workspace', targetId: workspaceId, title: `Delete workspace ${workspace.name || workspace.id}`, description: 'This will permanently remove the workspace and all linked content.' });
  }
}

function loadPanel(panelId, { force = false } = {}) {
  if (panelId === 'overview') return loadOverview({ force });
  if (panelId === 'aws') return loadAwsStatus({ force });
  if (panelId === 'users') return loadUsers({ force });
  if (panelId === 'workspaces') return loadWorkspaces({ force });
  if (panelId === 'audit') return loadAudit({ force });
  if (panelId === 'entities') {
    filterAndRenderEntityTargets();
    if (!adminState.selectedEntity) renderEntityDetails(null, null);
  }
  return null;
}

async function refreshAll() {
  showToast('Refreshing', 'Syncing admin data...', 'info');
  await Promise.allSettled([loadOverview({ force: true }), loadAwsStatus({ force: true }), loadUsers({ force: true }), loadWorkspaces({ force: true }), loadAudit({ force: true })]);
  filterAndRenderEntityTargets();
  showToast('Done', 'Admin data refreshed.', 'success');
}
function handleAdminWsMessage(raw) {
  let message = null;
  try { message = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
  if (!message?.type) return;
  const normalized = String(message.type).toUpperCase();
  if (normalized.includes('AUDIT') || normalized.includes('ADMIN') || normalized.includes('MUTATION') || normalized.includes('EVENT')) {
    adminState.audit = [message.data || message, ...adminState.audit].slice(0, 200);
    renderAudit();
    refreshOverviewFromState();
  }
  if (normalized.includes('USER')) loadUsers({ force: true });
  if (normalized.includes('WORKSPACE')) loadWorkspaces({ force: true });
}

async function connectAdminWebSocket() {
  if (!getSafeToken()) return;
  if (adminState.ws && (adminState.ws.readyState === WebSocket.OPEN || adminState.ws.readyState === WebSocket.CONNECTING)) return;
  const endpoint = await getAdminWsEndpoint();
  const wsUrl = buildAdminWsUrl(endpoint);
  if (!wsUrl) {
    scheduleAdminWsReconnect();
    return;
  }
  adminState.wsShouldReconnect = true;
  const socket = new WebSocket(wsUrl);
  adminState.ws = socket;
  socket.onopen = () => { adminState.wsReconnectDelay = 2000; };
  socket.onmessage = (event) => handleAdminWsMessage(event.data);
  socket.onclose = () => { if (adminState.ws === socket) adminState.ws = null; scheduleAdminWsReconnect(); };
  socket.onerror = (error) => console.error('Admin WebSocket error', error);
}

function bindEvents() {
  document.getElementById('logoutButton')?.addEventListener('click', logout);
  document.getElementById('mobileSidebarToggle')?.addEventListener('click', toggleMobileSidebar);
  document.getElementById('mobileSidebarBackdrop')?.addEventListener('click', closeMobileSidebar);
  document.getElementById('networkRetryButton')?.addEventListener('click', () => loadPanel(getActivePanelId(), { force: true }));
  document.getElementById('refreshAllButton')?.addEventListener('click', refreshAll);
  document.getElementById('refreshCurrentButton')?.addEventListener('click', () => loadPanel(getActivePanelId(), { force: true }));
  document.getElementById('refreshOverviewButton')?.addEventListener('click', () => loadPanel('overview', { force: true }));
  document.getElementById('exportAuditButton')?.addEventListener('click', exportAuditJson);
  document.getElementById('auditJsonButton')?.addEventListener('click', exportAuditJson);
  document.getElementById('auditCsvButton')?.addEventListener('click', exportAuditCsv);
  document.getElementById('inspectEntityButton')?.addEventListener('click', () => inspectEntity(document.getElementById('entityLookup')?.value || ''));
  document.getElementById('copyEntityJsonButton')?.addEventListener('click', copyEntityJson);
  document.getElementById('adminActionPrimaryButton')?.addEventListener('click', async () => {
    const token = await runGuardFlow();
    if (!token) return;
    try {
      await destroyEntity(adminState.guard.targetType, adminState.guard.targetId);
      await Promise.allSettled([loadOverview({ force: true }), adminState.guard.targetType === 'user' ? loadUsers({ force: true }) : loadWorkspaces({ force: true }), loadAudit({ force: true })]);
      closeGuardModal();
    } catch (error) {
      showToast('Admin', error.message, 'error');
    } finally {
      adminState.guard.guardToken = '';
    }
  });
  document.querySelectorAll('[data-close-admin-modal]').forEach((button) => button.addEventListener('click', closeGuardModal));
  document.getElementById('adminActionModal')?.addEventListener('click', (event) => { if (event.target?.id === 'adminActionModal') closeGuardModal(); });
  document.querySelectorAll('.admin-tab-link').forEach((button) => button.addEventListener('click', () => { setPanelActive(button.dataset.adminTab); loadPanel(button.dataset.adminTab, { force: false }); }));
  document.querySelectorAll('[data-refresh-panel]').forEach((button) => button.addEventListener('click', () => loadPanel(button.dataset.refreshPanel, { force: true })));
  document.getElementById('userSearch')?.addEventListener('input', renderUsersTable);
  document.getElementById('userStatusFilter')?.addEventListener('change', renderUsersTable);
  document.getElementById('workspaceSearch')?.addEventListener('input', renderWorkspacesTable);
  document.getElementById('workspaceStatusFilter')?.addEventListener('change', renderWorkspacesTable);
  document.getElementById('auditSearch')?.addEventListener('input', renderAudit);
  document.getElementById('auditDateFrom')?.addEventListener('change', renderAudit);
  document.getElementById('auditDateTo')?.addEventListener('change', renderAudit);
  document.getElementById('usersTableWrap')?.addEventListener('click', (event) => { const button = event.target.closest('[data-user-action]'); if (button) handleUserAction(button); });
  document.getElementById('workspacesTableWrap')?.addEventListener('click', (event) => { const button = event.target.closest('[data-workspace-action]'); if (button) handleWorkspaceAction(button); });
  document.getElementById('entityQuickTargets')?.addEventListener('click', (event) => { const button = event.target.closest('[data-inspect-type]'); if (button) inspectEntity(button.dataset.inspectId, button.dataset.inspectType); });
  document.getElementById('entityLookup')?.addEventListener('input', filterAndRenderEntityTargets);
  document.getElementById('entityLookup')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); inspectEntity(event.currentTarget.value || ''); } });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeGuardModal(); });
}

async function bootstrapAdmin() {
  installFetchGuard();
  updateThemeIcons();
  if (adminState.profile) {
    document.getElementById('adminUsername').textContent = adminState.profile.display_name || adminState.profile.email || 'System Admin';
    document.getElementById('adminEmail').textContent = adminState.profile.email || 'admin';
  }
  const isCollapsed = JSON.parse(localStorage.getItem('sidebarCollapsed') || 'false');
  if (isCollapsed) document.querySelector('.sidebar')?.classList.add('collapsed');
  bindEvents();
  setPanelActive('overview');
  await Promise.allSettled([loadOverview({ force: true }), loadAwsStatus({ force: true }), loadUsers({ force: true }), loadWorkspaces({ force: true }), loadAudit({ force: true })]);
  filterAndRenderEntityTargets();
  connectAdminWebSocket();
  lucide.createIcons();
}

document.addEventListener('DOMContentLoaded', () => {
  bootstrapAdmin().catch((error) => {
    console.error('Admin bootstrap failed', error);
    showToast('Admin', 'Failed to bootstrap admin console.', 'error');
  });
});

window.toggleTheme = toggleTheme;
window.toggleSidebar = toggleSidebar;
window.logout = logout;
