const ADMIN_AUTH_RETURN_KEY = 'auth_return_to';

const adminState = {
  profile: window.__ADMIN_PROFILE__ || null,
  token: window.__ADMIN_TOKEN__ || localStorage.getItem('token') || '',
  overview: null,
  aws: null,
  awsLoadingPromise: null,
  awsAutoRefreshTimer: null,
  awsLastFetchedAt: '',
  users: [],
  workspaces: [],
  audit: [],
  selectedEntity: null,
  selectedEntityRaw: null,
  activeTab: 'overview',
  awsUi: {
    window: localStorage.getItem('adminAwsWindow') || '24h',
    autoRefresh: localStorage.getItem('adminAwsAutoRefresh') || 'off',
    density: localStorage.getItem('adminAwsDensity') || 'comfortable',
    dataView: localStorage.getItem('adminAwsDataView') || 'dynamodb',
    selectedService: localStorage.getItem('adminAwsSelectedService') || 'lambda'
  },
  ws: null,
  wsEndpoint: null,
  wsReconnectTimer: null,
  wsShouldReconnect: true,
  wsReconnectDelay: 2000,
  fetchWrapped: false,
  charts: { activity: null, status: null, awsServices: null, awsBilling: null },
  guard: {
    open: false,
    phase: 'confirm',
    action: null,
    targetType: null,
    targetId: null,
    reason: '',
    value: '',
    valueLabel: '',
    valuePlaceholder: '',
    onConfirm: null,
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

function formatBytes(value) {
  const bytes = safeNumber(value, 0);
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const sized = bytes / (1024 ** exponent);
  return `${sized.toFixed(exponent === 0 ? 0 : 2)} ${units[exponent]}`;
}

function formatCurrency(value, currency = 'USD') {
  const amount = safeNumber(value, 0);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 4
    }).format(amount);
  } catch {
    return `${amount.toFixed(4)} ${currency || ''}`.trim();
  }
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatPercent(value, fractionDigits = 2) {
  const amount = safeNumber(value, 0);
  return `${amount.toFixed(fractionDigits)}%`;
}

function formatCompactNumber(value) {
  const amount = safeNumber(value, 0);
  try {
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(amount);
  } catch {
    return String(Math.round(amount));
  }
}

function getAwsWindowValue() {
  const allowed = new Set(['1h', '24h', '7d', '30d']);
  const value = String(adminState.awsUi.window || '24h');
  return allowed.has(value) ? value : '24h';
}

function getAwsAutoRefreshValue() {
  const allowed = new Set(['off', '60s', '5m']);
  const value = String(adminState.awsUi.autoRefresh || 'off');
  return allowed.has(value) ? value : 'off';
}

function getAwsDensityValue() {
  return String(adminState.awsUi.density || 'comfortable') === 'compact' ? 'compact' : 'comfortable';
}

function getAwsDataViewValue() {
  const allowed = new Set(['dynamodb', 's3', 'alarms', 'billing']);
  const value = String(adminState.awsUi.dataView || 'dynamodb');
  return allowed.has(value) ? value : 'dynamodb';
}

function getAwsSelectedServiceKey() {
  const allowed = new Set(['lambda', 'cloudfront', 'dynamodb', 's3', 'cloudwatch', 'billing']);
  const value = String(adminState.awsUi.selectedService || 'lambda');
  return allowed.has(value) ? value : 'lambda';
}

function setAwsUiSetting(key, value) {
  adminState.awsUi[key] = value;
  const storageKeys = {
    window: 'adminAwsWindow',
    autoRefresh: 'adminAwsAutoRefresh',
    density: 'adminAwsDensity',
    dataView: 'adminAwsDataView',
    selectedService: 'adminAwsSelectedService'
  };
  const storageKey = storageKeys[key];
  if (storageKey) localStorage.setItem(storageKey, String(value));
}

function syncAwsUiControls() {
  const windowSelect = document.getElementById('awsTimeRangeSelect');
  const autoSelect = document.getElementById('awsAutoRefreshSelect');
  const densityButton = document.getElementById('awsDensityToggle');
  if (windowSelect) windowSelect.value = getAwsWindowValue();
  if (autoSelect) autoSelect.value = getAwsAutoRefreshValue();
  if (densityButton) densityButton.textContent = getAwsDensityValue() === 'compact' ? 'Compact' : 'Comfortable';
  document.body.classList.toggle('aws-density-compact', getAwsDensityValue() === 'compact');
}

function setAwsLiveStatus(message) {
  const el = document.getElementById('awsStatusLiveRegion');
  if (el) el.textContent = message || '';
}

function setAwsPanelBusy(busy) {
  const panel = document.getElementById('awsPanel');
  const refresh = document.getElementById('awsRefreshButton');
  if (panel) panel.setAttribute('aria-busy', busy ? 'true' : 'false');
  if (refresh) refresh.disabled = Boolean(busy);
}

function awsServiceByKey(key) {
  const services = adminState.aws?.services || {};
  return services[String(key || '').toLowerCase()] || null;
}

function awsServiceOrder() {
  return ['lambda', 'cloudfront', 'dynamodb', 's3', 'cloudwatch', 'billing'];
}

function awsSummaryChips(service) {
  const key = String(service?.service || '').toLowerCase();
  const chips = [];
  if (key === 'lambda') {
    chips.push({ label: 'Invocations', value: formatCompactNumber(service.metrics_24h?.invocations || 0) });
    chips.push({ label: 'Errors', value: formatCompactNumber(service.metrics_24h?.errors || 0) });
    chips.push({ label: 'Throttles', value: formatCompactNumber(service.metrics_24h?.throttles || 0) });
    chips.push({ label: 'Avg duration', value: `${safeNumber(service.metrics_24h?.avg_duration_ms || 0).toFixed(1)} ms` });
  } else if (key === 'cloudfront') {
    chips.push({ label: 'Requests', value: formatCompactNumber(service.metrics_24h?.requests || 0) });
    chips.push({ label: 'Bytes', value: formatBytes(service.metrics_24h?.bytes_downloaded || 0) });
    chips.push({ label: '4xx', value: formatPercent(service.metrics_24h?.avg_4xx_error_rate || 0, 3) });
    chips.push({ label: '5xx', value: formatPercent(service.metrics_24h?.avg_5xx_error_rate || 0, 3) });
  } else if (key === 'dynamodb') {
    chips.push({ label: 'Tables', value: formatCompactNumber(service.summary?.total_tables || 0) });
    chips.push({ label: 'Items', value: formatCompactNumber(service.summary?.total_items || 0) });
    chips.push({ label: 'Storage', value: formatBytes(service.summary?.total_size_bytes || 0) });
    chips.push({ label: 'Healthy', value: formatCompactNumber(service.summary?.healthy_tables || 0) });
  } else if (key === 's3') {
    chips.push({ label: 'Buckets', value: formatCompactNumber(service.summary?.total_buckets || 0) });
    chips.push({ label: 'Objects', value: formatCompactNumber(service.summary?.total_sampled_objects || 0) });
    chips.push({ label: 'Sampled', value: formatBytes(service.summary?.total_sampled_size_bytes || 0) });
    chips.push({ label: 'Healthy', value: formatCompactNumber(service.summary?.healthy_buckets || 0) });
  } else if (key === 'cloudwatch') {
    chips.push({ label: 'Alarms', value: formatCompactNumber(service.active_alarm_count || 0) });
    chips.push({ label: 'Retention', value: service.log_group?.retention_days ? `${safeNumber(service.log_group?.retention_days || 0)}d` : 'n/a' });
    chips.push({ label: 'Stored', value: formatBytes(service.log_group?.stored_bytes || 0) });
    chips.push({ label: 'Errors', value: formatCompactNumber((service.errors || []).length || 0) });
  } else if (key === 'billing') {
    chips.push({ label: 'MTD', value: formatCurrency(service.month_to_date_total || 0, service.currency || 'USD') });
    chips.push({ label: 'Forecast', value: formatCurrency(service.forecast_month_total || 0, service.currency || 'USD') });
    chips.push({ label: 'Days', value: formatCompactNumber((service.daily_costs || []).length || 0) });
  }
  return chips;
}

function awsServiceActions(key) {
  const mapping = {
    lambda: [
      { action: 'lambda_refresh', label: 'Refresh config', icon: 'refresh-cw', variant: 'secondary' },
      { action: 'lambda_concurrency', label: 'Set concurrency', icon: 'sliders-horizontal', variant: 'primary' }
    ],
    cloudfront: [
      { action: 'cloudfront_invalidations', label: 'List invalidations', icon: 'list', variant: 'secondary' },
      { action: 'cloudfront_invalidation', label: 'Invalidate cache', icon: 'refresh-ccw', variant: 'primary' }
    ],
    cloudwatch: [
      { action: 'cloudwatch_retention', label: 'Set retention', icon: 'clock-3', variant: 'primary' },
      { action: 'cloudwatch_alarm_actions', label: 'Alarm actions', icon: 'bell-off', variant: 'secondary' }
    ],
    billing: [
      { action: 'billing_refresh', label: 'Refresh billing', icon: 'refresh-cw', variant: 'secondary' },
      { action: 'billing_export', label: 'Export CSV', icon: 'download', variant: 'primary' }
    ]
  };
  return mapping[String(key || '').toLowerCase()] || [
    { action: 'service_refresh', label: 'Refresh', icon: 'refresh-cw', variant: 'secondary' }
  ];
}

function awsServiceSubtitle(service) {
  const key = String(service?.service || '').toLowerCase();
  if (key === 'lambda') return `${service.runtime || '-'}  -  ${safeNumber(service.memory_size || 0)} MB  -  ${safeNumber(service.timeout_seconds || 0)}s timeout`;
  if (key === 'cloudfront') return `${service.domain_name || '-'}  -  ${safeNumber(service.in_progress_invalidations || 0)} invalidations in flight`;
  if (key === 'dynamodb') return `${safeNumber(service.summary?.total_tables || 0)} tables  -  ${formatBytes(service.summary?.total_size_bytes || 0)} storage`;
  if (key === 's3') return `${safeNumber(service.summary?.total_buckets || 0)} buckets  -  ${safeNumber(service.summary?.healthy_buckets || 0)} healthy`;
  if (key === 'cloudwatch') return `${safeNumber(service.active_alarm_count || 0)} active alarms  -  ${service.log_group?.name || 'No log group'}`;
  if (key === 'billing') return `${service.provider || 'cost_explorer'}  -  ${service.currency || 'USD'}  -  ${service.period_start || '-'} to ${service.period_end || '-'}`;
  return '';
}

function awsServiceFreshness(service) {
  const key = String(service?.service || '').toLowerCase();
  if (key === 'billing') return 'Billing';
  if (service?.checked_at) return `Updated ${formatDateTime(service.checked_at)}`;
  return `Updated ${formatDateTime(adminState.aws?.checked_at || adminState.awsLastFetchedAt)}`;
}

function awsServiceDescription(service) {
  const key = String(service?.service || '').toLowerCase();
  if (key === 'lambda') {
    return `${service.state || 'unknown'} / ${service.last_update_status || 'n/a'} / concurrency ${safeNumber(service.reserved_concurrency || 0)}`;
  }
  if (key === 'cloudfront') {
    return `${service.deployment_status || service.status || 'unknown'} / ${service.lookup?.method || 'lookup'} / ${service.health_probe?.message || 'no probe'}`;
  }
  if (key === 'dynamodb') {
    return `${safeNumber(service.summary?.healthy_tables || 0)} healthy / ${safeNumber(service.summary?.unhealthy_tables || 0)} unhealthy`;
  }
  if (key === 's3') {
    return `${service.summary?.healthy_buckets || 0} healthy / ${service.summary?.unhealthy_buckets || 0} unhealthy`;
  }
  if (key === 'cloudwatch') {
    return `${service.log_group?.retention_days ? `${service.log_group.retention_days} day retention` : 'No retention set'} / ${safeNumber(service.active_alarm_count || 0)} alarms`;
  }
  if (key === 'billing') {
    return `${formatCurrency(service.month_to_date_total || 0, service.currency || 'USD')} month-to-date / ${formatCurrency(service.forecast_month_total || 0, service.currency || 'USD')} forecast`;
  }
  return '';
}

function awsServiceTone(service) {
  const key = String(service?.service || '').toLowerCase();
  if (key === 'billing') return 'success';
  if (String(service?.status || '').toLowerCase() === 'healthy') return 'success';
  if (String(service?.status || '').toLowerCase() === 'degraded') return '';
  return 'danger';
}

function awsServiceKeyFromAction(action) {
  const value = String(action || '').toLowerCase();
  if (value.includes('lambda')) return 'lambda';
  if (value.includes('cloudfront') || value.includes('cf')) return 'cloudfront';
  if (value.includes('cloudwatch') || value.includes('alarm')) return 'cloudwatch';
  if (value.includes('billing')) return 'billing';
  if (value.includes('s3')) return 's3';
  if (value.includes('dynamo')) return 'dynamodb';
  return getAwsSelectedServiceKey();
}

function renderAwsChipList(items) {
  return `<div class="aws-chip-list">${items.map((item) => `
    <div class="aws-chip">
      <span class="aws-chip-label">${escapeHtml(item.label)}</span>
      <span class="aws-chip-value">${escapeHtml(item.value)}</span>
    </div>
  `).join('')}</div>`;
}

function renderAwsActionButtons(service) {
  const key = String(service?.service || '').toLowerCase();
  return `<div class="aws-action-row">${awsServiceActions(key).map((item) => `
    <button type="button" class="aws-action-button ${item.variant === 'primary' ? 'primary' : ''}" data-aws-action="${escapeHtml(item.action)}" data-aws-service="${escapeHtml(key)}">
      <i data-lucide="${escapeHtml(item.icon)}" class="w-4 h-4"></i>
      <span>${escapeHtml(item.label)}</span>
    </button>
  `).join('')}</div>`;
}

function renderAwsInspectorCard(service) {
  const key = String(service?.service || '').toLowerCase();
  const title = {
    lambda: 'Lambda Inspector',
    cloudfront: 'CloudFront Inspector',
    dynamodb: 'DynamoDB Inspector',
    s3: 'S3 Inspector',
    cloudwatch: 'CloudWatch Inspector',
    billing: 'Billing Inspector'
  }[key] || 'AWS Inspector';
  const details = [];
  if (key === 'lambda') {
    details.push(['Function', `<span class="font-mono break-all">${escapeHtml(service.function_name || '-')}</span>`]);
    details.push(['Runtime', service.runtime || '-']);
    details.push(['Memory', `${safeNumber(service.memory_size || 0)} MB`]);
    details.push(['Timeout', `${safeNumber(service.timeout_seconds || 0)} s`]);
    details.push(['Reserved concurrency', `${safeNumber(service.reserved_concurrency || 0)}`]);
    details.push(['State', `${service.state || '-'} / ${service.last_update_status || '-'}`]);
    details.push(['Version', service.version || '-']);
  } else if (key === 'cloudfront') {
    details.push(['Distribution', `<span class="font-mono break-all">${escapeHtml(service.distribution_id || '-')}</span>`]);
    details.push(['Domain', service.domain_name || '-']);
    details.push(['Aliases', `${safeNumber(service.aliases?.length || 0)}`]);
    details.push(['Origins', `${safeNumber(service.origins?.length || 0)}`]);
    details.push(['Deployment', service.deployment_status || service.status || '-']);
    details.push(['Probe', service.health_probe?.message || '-']);
  } else if (key === 'cloudwatch') {
    details.push(['Log group', `<span class="font-mono break-all">${escapeHtml(service.log_group?.name || '-')}</span>`]);
    details.push(['Retention', service.log_group?.retention_days ? `${service.log_group.retention_days} days` : '-']);
    details.push(['Stored bytes', formatBytes(service.log_group?.stored_bytes || 0)]);
    details.push(['Active alarms', `${safeNumber(service.active_alarm_count || 0)}`]);
  } else if (key === 'billing') {
    details.push(['Provider', service.provider || '-']);
    details.push(['Period', `${service.period_start || '-'} -> ${service.period_end || '-'}`]);
    details.push(['Month-to-date', formatCurrency(service.month_to_date_total || 0, service.currency || 'USD')]);
    details.push(['Forecast', formatCurrency(service.forecast_month_total || 0, service.currency || 'USD')]);
  } else if (key === 'dynamodb') {
    details.push(['Tables', `${safeNumber(service.summary?.total_tables || 0)}`]);
    details.push(['Healthy', `${safeNumber(service.summary?.healthy_tables || 0)}`]);
    details.push(['Items', `${safeNumber(service.summary?.total_items || 0)}`]);
    details.push(['Storage', formatBytes(service.summary?.total_size_bytes || 0)]);
  } else if (key === 's3') {
    details.push(['Buckets', `${safeNumber(service.summary?.total_buckets || 0)}`]);
    details.push(['Healthy', `${safeNumber(service.summary?.healthy_buckets || 0)}`]);
    details.push(['Objects sampled', `${safeNumber(service.summary?.total_sampled_objects || 0)}`]);
    details.push(['Sampled size', formatBytes(service.summary?.total_sampled_size_bytes || 0)]);
  }
  return `
    <div class="aws-inspector-card">
      <div class="flex items-start justify-between gap-4">
        <div>
          <div class="aws-section-label">${escapeHtml(title)}</div>
          <h3 class="aws-section-title">${escapeHtml(String(service?.service || key || 'AWS').toUpperCase())}</h3>
          <p class="aws-service-subtitle">${escapeHtml(awsServiceSubtitle(service))}</p>
        </div>
        ${badgeHtml(String(service?.status || 'unknown').toUpperCase(), awsServiceTone(service))}
      </div>
      <div class="aws-inspector-grid">
        ${details.map(([label, value]) => `
          <div class="aws-detail-tile">
            <span class="aws-detail-label">${escapeHtml(label)}</span>
            <span class="aws-detail-value">${value}</span>
          </div>
        `).join('')}
      </div>
      ${renderAwsChipList(awsSummaryChips(service))}
      ${key === 'cloudfront' ? '<div id="awsCloudFrontInvalidations" class="space-y-3 mt-4"></div>' : ''}
      <div class="aws-inspector-meta">
        <span>${escapeHtml(awsServiceFreshness(service))}</span>
        ${service.error ? `<span class="text-rose-300">${escapeHtml(service.error)}</span>` : ''}
        ${Array.isArray(service.metric_errors) && service.metric_errors.length ? `<span class="text-amber-300">${escapeHtml(service.metric_errors.join(' | '))}</span>` : ''}
      </div>
      ${renderAwsActionButtons(service)}
    </div>
  `;
}

function setAwsSelectedService(serviceKey) {
  setAwsUiSetting('selectedService', serviceKey);
  renderAwsServicesPanel();
}

function setAwsDataView(view) {
  setAwsUiSetting('dataView', view);
  renderAwsServicesPanel();
}

function setAwsDataViewVisibility(view) {
  const normalized = ['dynamodb', 's3', 'alarms', 'billing'].includes(view) ? view : 'dynamodb';
  ['dynamodb', 's3', 'alarms', 'billing'].forEach((panel) => {
    document.getElementById(`awsDataPanel-${panel}`)?.classList.toggle('hidden', panel !== normalized);
  });
  document.querySelectorAll('[data-aws-data-view]').forEach((button) => {
    const active = button.dataset.awsDataView === normalized;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  if (normalized !== getAwsDataViewValue()) setAwsUiSetting('dataView', normalized);
}

function renderAwsServiceCards(services = {}) {
  const cards = document.getElementById('awsServiceCards');
  if (!cards) return;
  const rows = awsServiceOrder().map((key) => services[key]).filter(Boolean);
  if (!rows.length) {
    renderEmpty(cards, 'No service checks yet', 'Refresh the panel to run AWS diagnostics.');
    return;
  }
  const selectedKey = getAwsSelectedServiceKey();
  cards.innerHTML = rows.map((service) => {
    const key = String(service.service || '').toLowerCase();
    const selected = key === selectedKey;
    return `
      <article class="aws-service-card ${selected ? 'selected' : ''}" data-aws-select-service="${escapeHtml(key)}" tabindex="0" role="button" aria-label="Inspect ${escapeHtml(key)} service">
        <div class="aws-service-card-head">
          <div class="min-w-0">
            <div class="aws-section-label">${escapeHtml(String(service.service || '').toUpperCase())}</div>
            <div class="aws-service-title">${escapeHtml(awsServiceSubtitle(service))}</div>
          </div>
          <div class="flex flex-col items-end gap-2 shrink-0">
            ${badgeHtml(String(service.status || 'unknown').toUpperCase(), awsServiceTone(service))}
            <span class="aws-service-freshness">${escapeHtml(awsServiceFreshness(service))}</span>
          </div>
        </div>
        <p class="aws-service-description">${escapeHtml(awsServiceDescription(service))}</p>
        ${renderAwsChipList(awsSummaryChips(service))}
        <div class="aws-action-row">
          <button type="button" class="aws-action-button secondary" data-aws-action="select_service" data-aws-service="${escapeHtml(key)}">
            <i data-lucide="eye" class="w-4 h-4"></i><span>Inspect</span>
          </button>
          ${awsServiceActions(key).map((item) => `
            <button type="button" class="aws-action-button ${item.variant === 'primary' ? 'primary' : ''}" data-aws-action="${escapeHtml(item.action)}" data-aws-service="${escapeHtml(key)}">
              <i data-lucide="${escapeHtml(item.icon)}" class="w-4 h-4"></i><span>${escapeHtml(item.label)}</span>
            </button>
          `).join('')}
        </div>
      </article>
    `;
  }).join('');
}

function renderAwsMetadata(aws = {}) {
  const metadata = document.getElementById('awsMetadataDetails');
  if (!metadata) return;
  const info = aws.metadata || {};
  metadata.innerHTML = `
    <div class="aws-detail-tile"><span class="aws-detail-label">Project</span><span class="aws-detail-value">${escapeHtml(info.project_name || '-')}</span></div>
    <div class="aws-detail-tile"><span class="aws-detail-label">Stage</span><span class="aws-detail-value">${escapeHtml(info.stage || '-')}</span></div>
    <div class="aws-detail-tile"><span class="aws-detail-label">Lambda function</span><span class="aws-detail-value font-mono break-all">${escapeHtml(info.lambda_function || '-')}</span></div>
    <div class="aws-detail-tile"><span class="aws-detail-label">Configured CF domain</span><span class="aws-detail-value">${escapeHtml(info.configured_cloudfront_domain || '-')}</span></div>
    <div class="aws-detail-tile"><span class="aws-detail-label">Configured CF dist ID</span><span class="aws-detail-value font-mono break-all">${escapeHtml(info.configured_cloudfront_distribution_id || '-')}</span></div>
    <div class="aws-detail-tile"><span class="aws-detail-label">Last fetch</span><span class="aws-detail-value">${escapeHtml(formatDateTime(aws.checked_at || adminState.awsLastFetchedAt))}</span></div>
    <div class="aws-detail-tile"><span class="aws-detail-label">Window</span><span class="aws-detail-value">${escapeHtml(getAwsWindowValue())}</span></div>
    <div class="aws-detail-tile"><span class="aws-detail-label">Density</span><span class="aws-detail-value">${escapeHtml(getAwsDensityValue())}</span></div>
  `;
}

function renderAwsInspector(aws = {}) {
  const inspector = document.getElementById('awsInspectorBody');
  if (!inspector) return;
  const selectedKey = getAwsSelectedServiceKey();
  const service = awsServiceByKey(selectedKey) || awsServiceByKey('lambda') || Object.values(aws.services || {}).find(Boolean) || null;
  if (!service) {
    inspector.innerHTML = '<div class="admin-empty">No AWS data loaded yet. Refresh the panel to inspect services.</div>';
    return;
  }
  inspector.innerHTML = renderAwsInspectorCard(service);
  const selectedLabel = document.getElementById('awsSelectedServiceLabel');
  if (selectedLabel) selectedLabel.textContent = `${String(service.service || selectedKey).toUpperCase()} selected`;
  const metricsFreshness = document.getElementById('awsMetricsFreshness');
  if (metricsFreshness) metricsFreshness.textContent = awsServiceFreshness(service);
}

function renderAwsDynamoTable(dynamodb = {}) {
  const wrap = document.getElementById('awsDynamoTableWrap');
  if (!wrap) return;
  const rows = Array.isArray(dynamodb.tables) ? dynamodb.tables : [];
  if (!rows.length) {
    renderEmpty(wrap, 'No DynamoDB tables', 'No table diagnostics were returned by the API.');
    return;
  }
  renderAwsTableWrap(wrap, `
    <table class="admin-table">
      <caption class="sr-only">DynamoDB service table diagnostics</caption>
      <thead>
        <tr>
          <th scope="col">Table</th>
          <th scope="col">Status</th>
          <th scope="col">Items</th>
          <th scope="col">Size</th>
          <th scope="col">GSI</th>
          <th scope="col">Billing / Class</th>
          <th scope="col">Stream</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((table) => `
          <tr data-dynamo-table="${escapeHtml(table.name || '')}">
            <td><div class="entity-name font-mono break-all">${escapeHtml(table.name || '-')}</div><div class="text-xs text-gray-400 mt-1">${escapeHtml(table.arn || '')}</div></td>
            <td>${badgeHtml(String(table.status || 'unknown').toUpperCase(), awsServiceTone({ service: 'dynamodb', status: table.healthy ? 'healthy' : 'degraded' }))}</td>
            <td class="text-sm text-gray-300">${escapeHtml(String(safeNumber(table.item_count || 0)))}</td>
            <td class="text-sm text-gray-300">${escapeHtml(formatBytes(table.size_bytes || 0))}</td>
            <td class="text-sm text-gray-300">${escapeHtml(String(safeNumber(table.gsi_count || 0)))}</td>
            <td class="text-sm text-gray-300">${escapeHtml(`${table.billing_mode || '-'} / ${table.table_class || '-'}`)}</td>
            <td class="text-sm text-gray-300">${escapeHtml(table.stream_enabled ? (table.stream_view_type || 'Enabled') : 'Disabled')}</td>
            <td><div class="admin-action-group">
              <button type="button" class="aws-action-button secondary" data-aws-action="dynamo_refresh" data-aws-table="${escapeHtml(table.name || '')}"><i data-lucide="refresh-cw" class="w-4 h-4"></i><span>Refresh</span></button>
              <button type="button" class="aws-action-button" data-aws-action="dynamo_deletion_protection" data-aws-table="${escapeHtml(table.name || '')}"><i data-lucide="shield" class="w-4 h-4"></i><span>Deletion protection</span></button>
            </div></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `);
}

function renderAwsS3Table(s3Status = {}) {
  const wrap = document.getElementById('awsS3TableWrap');
  if (!wrap) return;
  const rows = Array.isArray(s3Status.buckets) ? s3Status.buckets : [];
  if (!rows.length) {
    renderEmpty(wrap, 'No S3 buckets', 'No bucket diagnostics were returned by the API.');
    return;
  }
  renderAwsTableWrap(wrap, `
    <table class="admin-table">
      <caption class="sr-only">S3 bucket diagnostics</caption>
      <thead>
        <tr>
          <th scope="col">Bucket</th>
          <th scope="col">Status</th>
          <th scope="col">Region</th>
          <th scope="col">Versioning</th>
          <th scope="col">Encryption</th>
          <th scope="col">Sampled Objects</th>
          <th scope="col">Sampled Size</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((bucket) => `
          <tr data-s3-bucket="${escapeHtml(bucket.name || '')}">
            <td><div class="entity-name font-mono break-all">${escapeHtml(bucket.name || '-')}</div><div class="text-xs text-gray-400 mt-1">${escapeHtml(bucket.region || '')}</div></td>
            <td>${badgeHtml(String(bucket.status || 'unknown').toUpperCase(), awsServiceTone({ service: 's3', status: bucket.healthy ? 'healthy' : 'degraded' }))}</td>
            <td class="text-sm text-gray-300">${escapeHtml(bucket.region || '-')}</td>
            <td class="text-sm text-gray-300">${escapeHtml(bucket.versioning || '-')}</td>
            <td class="text-sm text-gray-300">${escapeHtml(bucket.encryption || '-')}</td>
            <td class="text-sm text-gray-300">${escapeHtml(`${safeNumber(bucket.sampled_object_count || 0)}${bucket.sampled_listing_truncated ? '+' : ''}`)}</td>
            <td class="text-sm text-gray-300">${escapeHtml(formatBytes(bucket.sampled_size_bytes || 0))}</td>
            <td><div class="admin-action-group">
              <button type="button" class="aws-action-button secondary" data-aws-action="s3_rescan" data-aws-bucket="${escapeHtml(bucket.name || '')}"><i data-lucide="refresh-cw" class="w-4 h-4"></i><span>Rescan</span></button>
              <button type="button" class="aws-action-button" data-aws-action="s3_versioning" data-aws-bucket="${escapeHtml(bucket.name || '')}"><i data-lucide="layers-3" class="w-4 h-4"></i><span>Versioning</span></button>
              <button type="button" class="aws-action-button" data-aws-action="s3_encryption" data-aws-bucket="${escapeHtml(bucket.name || '')}"><i data-lucide="lock-keyhole" class="w-4 h-4"></i><span>Encryption</span></button>
            </div></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `);
}

function renderAwsCloudWatchPanel(services = {}) {
  const cloudwatch = services.cloudwatch || {};
  const details = document.getElementById('awsCloudWatchDetails');
  if (details) {
    details.innerHTML = `
      <div class="aws-detail-tile"><span class="aws-detail-label">Log group</span><span class="aws-detail-value font-mono break-all">${escapeHtml(cloudwatch.log_group?.name || '-')}</span></div>
      <div class="aws-detail-tile"><span class="aws-detail-label">Retention</span><span class="aws-detail-value">${escapeHtml(cloudwatch.log_group?.retention_days ? `${cloudwatch.log_group.retention_days} days` : '-')}</span></div>
      <div class="aws-detail-tile"><span class="aws-detail-label">Stored bytes</span><span class="aws-detail-value">${escapeHtml(formatBytes(cloudwatch.log_group?.stored_bytes || 0))}</span></div>
      <div class="aws-detail-tile"><span class="aws-detail-label">Active alarms</span><span class="aws-detail-value">${escapeHtml(String(safeNumber(cloudwatch.active_alarm_count || 0)))}</span></div>
      ${cloudwatch.errors?.length ? `<div class="text-amber-300 text-sm">${escapeHtml(cloudwatch.errors.join(' | '))}</div>` : ''}
    `;
  }

  const alarmsContainer = document.getElementById('awsCloudWatchAlarms');
  if (alarmsContainer) {
    const alarms = Array.isArray(cloudwatch.alarms) ? cloudwatch.alarms : [];
    if (!alarms.length) {
      renderEmpty(alarmsContainer, 'No alarms returned', 'No CloudWatch alarms matched the current project prefix.');
    } else {
      alarmsContainer.innerHTML = alarms.slice(0, 12).map((alarm) => `
        <div class="aws-detail-tile">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="font-semibold text-white break-all">${escapeHtml(alarm.name || '-')}</div>
              <div class="text-xs text-gray-400 mt-1">${escapeHtml(alarm.reason || 'No alarm reason provided')}</div>
            </div>
            ${badgeHtml(String(alarm.state || 'unknown').toUpperCase(), awsServiceTone({ service: 'cloudwatch', status: String(alarm.state || '').toLowerCase() === 'alarm' ? 'degraded' : 'healthy' }))}
          </div>
          <div class="aws-action-row mt-3">
            <button type="button" class="aws-action-button secondary" data-aws-action="cloudwatch_alarm_toggle" data-aws-alarm="${escapeHtml(alarm.name || '')}" data-aws-enabled="false"><i data-lucide="bell-off" class="w-4 h-4"></i><span>Disable actions</span></button>
            <button type="button" class="aws-action-button" data-aws-action="cloudwatch_alarm_toggle" data-aws-alarm="${escapeHtml(alarm.name || '')}" data-aws-enabled="true"><i data-lucide="bell" class="w-4 h-4"></i><span>Enable actions</span></button>
            <button type="button" class="aws-action-button secondary" data-aws-action="cloudwatch_snooze" data-aws-alarm="${escapeHtml(alarm.name || '')}"><i data-lucide="moon-star" class="w-4 h-4"></i><span>Snooze</span></button>
            <button type="button" class="aws-action-button secondary" data-aws-action="cloudwatch_unsnooze" data-aws-alarm="${escapeHtml(alarm.name || '')}"><i data-lucide="refresh-cw" class="w-4 h-4"></i><span>Unsnooze</span></button>
          </div>
        </div>
      `).join('');
    }
  }
}

function renderAwsBillingPanel(services = {}) {
  const billing = services.billing || {};
  const details = document.getElementById('awsBillingDetails');
  if (details) {
    details.innerHTML = `
      <div class="aws-detail-tile"><span class="aws-detail-label">Provider</span><span class="aws-detail-value">${escapeHtml(billing.provider || '-')}</span></div>
      <div class="aws-detail-tile"><span class="aws-detail-label">Month-to-date</span><span class="aws-detail-value">${escapeHtml(formatCurrency(billing.month_to_date_total || 0, billing.currency || 'USD'))}</span></div>
      <div class="aws-detail-tile"><span class="aws-detail-label">Forecast</span><span class="aws-detail-value">${escapeHtml(formatCurrency(billing.forecast_month_total || 0, billing.currency || 'USD'))}</span></div>
      <div class="aws-detail-tile"><span class="aws-detail-label">Period</span><span class="aws-detail-value">${escapeHtml(`${billing.period_start || '-'} -> ${billing.period_end || '-'}`)}</span></div>
      ${billing.error ? `<div class="text-rose-300 text-sm">${escapeHtml(billing.error)}</div>` : ''}
    `;
  }
  renderAwsBillingChart(billing);

  const billingBreakdown = document.getElementById('awsBillingBreakdown');
  if (billingBreakdown) {
    const rows = Array.isArray(billing.service_breakdown) ? billing.service_breakdown : [];
    if (!rows.length) {
      renderEmpty(billingBreakdown, 'No billing breakdown', 'Cost Explorer breakdown is not available yet.');
    } else {
      billingBreakdown.innerHTML = rows.map((row) => `
        <div class="aws-detail-tile">
          <div class="flex items-center justify-between gap-3">
            <div class="text-sm text-gray-200 break-all">${escapeHtml(row.service || 'Unknown')}</div>
            <div class="text-sm font-semibold text-white">${escapeHtml(formatCurrency(row.cost || 0, billing.currency || 'USD'))}</div>
          </div>
        </div>
      `).join('');
    }
  }
}

function renderAwsDataPanels(services = {}) {
  renderAwsDynamoTable(services.dynamodb || {});
  renderAwsS3Table(services.s3 || {});
  renderAwsCloudWatchPanel(services);
  renderAwsBillingPanel(services);
  setAwsDataViewVisibility(getAwsDataViewValue());
}

async function loadAwsCloudFrontInvalidations(distributionId) {
  if (!distributionId) return [];
  const response = await apiFetch(`/api/admin/aws/cloudfront/invalidations?distribution_id=${encodeURIComponent(distributionId)}&limit=20`);
  const data = await readResponse(response);
  if (!response.ok || data.success === false) throw new Error(data.error || `Failed to load invalidations (${response.status})`);
  return normalizeList(data.invalidations, ['invalidations']);
}

function renderAwsCloudFrontInvalidations(service, invalidations = []) {
  const list = document.getElementById('awsCloudFrontInvalidations');
  if (!list) return;
  if (!invalidations.length) {
    renderEmpty(list, 'No invalidations', 'Create an invalidation to see recent cache purge history.');
    return;
  }
  list.innerHTML = invalidations.slice(0, 8).map((item) => `
    <div class="aws-detail-tile">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="font-semibold text-white break-all">${escapeHtml(item.id || item.invalidation_id || '-')}</div>
          <div class="text-xs text-gray-400 mt-1">${escapeHtml(item.create_time || item.created_at || item.status || '')}</div>
        </div>
        ${badgeHtml(String(item.status || 'unknown').toUpperCase(), serviceTone(String(item.status || '').toLowerCase() === 'completed' ? 'healthy' : 'degraded'))}
      </div>
      <div class="text-xs text-gray-400 mt-2">${escapeHtml(`${safeNumber(item.paths_count || (item.paths || []).length || 0)} path(s)`)}</div>
    </div>
  `).join('');
}

function scheduleAwsAutoRefresh() {
  if (adminState.awsAutoRefreshTimer) {
    clearTimeout(adminState.awsAutoRefreshTimer);
    adminState.awsAutoRefreshTimer = null;
  }
  const mode = getAwsAutoRefreshValue();
  if (mode === 'off' || document.hidden || getActivePanelId() !== 'aws') return;
  const delay = mode === '5m' ? 5 * 60 * 1000 : 60 * 1000;
  adminState.awsAutoRefreshTimer = setTimeout(async () => {
    adminState.awsAutoRefreshTimer = null;
    if (!document.hidden && getActivePanelId() === 'aws') {
      await loadAwsStatus({ force: true, silent: true });
    }
    scheduleAwsAutoRefresh();
  }, delay);
}

function awsRefreshUrl() {
  const query = new URLSearchParams();
  query.set('window', getAwsWindowValue());
  return `/api/admin/aws/services?${query.toString()}`;
}

function exportAwsSnapshotCsv() {
  const aws = adminState.aws || {};
  const rows = [['service', 'label', 'value'].join(',')];
  const push = (service, label, value) => rows.push([service, label, value].map((item) => `"${String(item).replace(/"/g, '""')}"`).join(','));
  push('aws', 'overall_status', aws.summary?.overall_status || '');
  push('aws', 'region', aws.region || '');
  push('lambda', 'invocations', safeNumber(aws.services?.lambda?.metrics_24h?.invocations || 0));
  push('lambda', 'errors', safeNumber(aws.services?.lambda?.metrics_24h?.errors || 0));
  push('cloudfront', 'requests', safeNumber(aws.services?.cloudfront?.metrics_24h?.requests || 0));
  push('cloudfront', 'bytes_downloaded', safeNumber(aws.services?.cloudfront?.metrics_24h?.bytes_downloaded || 0));
  push('dynamodb', 'tables', safeNumber(aws.services?.dynamodb?.summary?.total_tables || 0));
  push('s3', 'buckets', safeNumber(aws.services?.s3?.summary?.total_buckets || 0));
  push('cloudwatch', 'alarms', safeNumber(aws.services?.cloudwatch?.active_alarm_count || 0));
  push('billing', 'month_to_date_total', safeNumber(aws.services?.billing?.month_to_date_total || 0));
  downloadBlob(new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' }), `aws-snapshot-${Date.now()}.csv`);
}

async function handleAwsAction(action, context = {}) {
  const key = String(action || '').toLowerCase();
  if (key === 'select_service') {
    setAwsSelectedService(context.service || context.key || 'lambda');
    return;
  }
  if (key === 'service_refresh' || key === 'lambda_refresh' || key === 'billing_refresh') {
    await loadAwsStatus({ force: true, silent: true });
    return;
  }
  if (key === 'billing_export') {
    exportAwsSnapshotCsv();
    return;
  }
  if (key === 'cloudfront_invalidations') {
    const service = awsServiceByKey('cloudfront');
    const distributionId = context.distributionId || service?.distribution_id || adminState.aws?.metadata?.configured_cloudfront_distribution_id || '';
    try {
      const invalidations = await loadAwsCloudFrontInvalidations(distributionId);
      renderAwsCloudFrontInvalidations(service, invalidations);
      setAwsLiveStatus(`Loaded ${invalidations.length} CloudFront invalidations.`);
    } catch (error) {
      showToast('CloudFront', error.message, 'error');
    }
    return;
  }
  if (key === 'cloudwatch_alarm_actions') {
    setAwsSelectedService('cloudwatch');
    setAwsDataView('alarms');
    const service = awsServiceByKey('cloudwatch');
    if (service) {
      setAwsLiveStatus(`Showing CloudWatch alarms for ${service.log_group?.name || 'current log group'}.`);
    }
    return;
  }
  if (key === 'cloudfront_invalidation') {
    openGuardModal({
      action: 'aws_cloudfront_create_invalidation',
      targetType: 'aws_cloudfront_distribution',
      targetId: context.distributionId || awsServiceByKey('cloudfront')?.distribution_id || adminState.aws?.metadata?.configured_cloudfront_distribution_id || 'cloudfront',
      title: 'Create CloudFront invalidation',
      description: 'Invalidate the selected distribution cache. Provide a reason and confirm the guard flow.',
      valueLabel: 'Paths',
      valuePlaceholder: '/*',
      value: '/*',
      onConfirm: async (token, guard) => {
        const paths = String(guard.value || '/*').split(',').map((item) => item.trim()).filter(Boolean);
        const response = await apiFetch('/api/admin/aws/cloudfront/invalidation', {
          method: 'POST',
          headers: { 'X-Admin-Guard-Token': token },
          body: JSON.stringify({ distribution_id: guard.targetId, paths, reason: guard.reason })
        });
        const data = await readResponse(response);
        if (!response.ok || data.success === false) throw new Error(data.error || `Failed to create invalidation (${response.status})`);
        showToast('CloudFront', 'Invalidation queued successfully.', 'success');
        await loadAwsStatus({ force: true, silent: true });
      }
    });
    return;
  }
  if (key === 'lambda_concurrency') {
    openGuardModal({
      action: 'aws_lambda_set_concurrency',
      targetType: 'aws_lambda_function',
      targetId: awsServiceByKey('lambda')?.function_name || adminState.aws?.metadata?.lambda_function || 'lambda',
      title: 'Set Lambda reserved concurrency',
      description: 'Set or remove reserved concurrency for the selected Lambda function. Provide a reason and confirm the guard flow.',
      valueLabel: 'Concurrency',
      valuePlaceholder: 'Leave blank to remove or enter a number',
      value: String(safeNumber(awsServiceByKey('lambda')?.reserved_concurrency || 0) || ''),
      onConfirm: async (token, guard) => {
        const raw = String(guard.value || '').trim();
        const response = await apiFetch('/api/admin/aws/lambda/concurrency', {
          method: 'PATCH',
          headers: { 'X-Admin-Guard-Token': token },
          body: JSON.stringify({ function_name: guard.targetId, reserved_concurrency: raw ? safeNumber(raw, 0) : null, reason: guard.reason })
        });
        const data = await readResponse(response);
        if (!response.ok || data.success === false) throw new Error(data.error || `Failed to set concurrency (${response.status})`);
        showToast('Lambda', 'Concurrency updated successfully.', 'success');
        await loadAwsStatus({ force: true, silent: true });
      }
    });
    return;
  }
  if (key === 'cloudwatch_retention') {
    openGuardModal({
      action: 'aws_cloudwatch_set_retention',
      targetType: 'aws_log_group',
      targetId: awsServiceByKey('cloudwatch')?.log_group?.name || 'log-group',
      title: 'Set CloudWatch retention',
      description: 'Update log retention for the selected log group. Provide a reason and confirm the guard flow.',
      valueLabel: 'Retention days',
      valuePlaceholder: '30',
      value: String(awsServiceByKey('cloudwatch')?.log_group?.retention_days || 30),
      onConfirm: async (token, guard) => {
        const response = await apiFetch('/api/admin/aws/logs/retention', {
          method: 'PATCH',
          headers: { 'X-Admin-Guard-Token': token },
          body: JSON.stringify({ log_group_name: guard.targetId, retention_days: safeNumber(guard.value || 30, 30), reason: guard.reason })
        });
        const data = await readResponse(response);
        if (!response.ok || data.success === false) throw new Error(data.error || `Failed to set retention (${response.status})`);
        showToast('CloudWatch', 'Retention updated successfully.', 'success');
        await loadAwsStatus({ force: true, silent: true });
      }
    });
    return;
  }
  if (key === 'cloudwatch_alarm_toggle') {
    openGuardModal({
      action: 'aws_cloudwatch_toggle_alarm_actions',
      targetType: 'aws_alarm',
      targetId: context.alarm || 'alarm',
      title: context.enabled === 'true' ? 'Enable alarm actions' : 'Disable alarm actions',
      description: 'Toggle CloudWatch alarm actions for the selected alarm. Provide a reason and confirm the guard flow.',
      valueLabel: 'Enabled',
      valuePlaceholder: 'true / false',
      value: context.enabled,
      onConfirm: async (token, guard) => {
        const enabled = String(guard.value || context.enabled || '').toLowerCase() !== 'false';
        const response = await apiFetch(`/api/admin/aws/alarms/${encodeURIComponent(guard.targetId)}/actions`, {
          method: 'POST',
          headers: { 'X-Admin-Guard-Token': token },
          body: JSON.stringify({ enabled, reason: guard.reason })
        });
        const data = await readResponse(response);
        if (!response.ok || data.success === false) throw new Error(data.error || `Failed to toggle alarm actions (${response.status})`);
        showToast('CloudWatch', 'Alarm actions updated successfully.', 'success');
        await loadAwsStatus({ force: true, silent: true });
      }
    });
    return;
  }
  if (key === 'cloudwatch_snooze') {
    openGuardModal({
      action: 'aws_cloudwatch_snooze',
      targetType: 'aws_alarm',
      targetId: context.alarm || 'alarm',
      title: 'Snooze CloudWatch alarm',
      description: 'Temporarily snooze the selected alarm. Provide a reason and confirm the guard flow.',
      valueLabel: 'Minutes',
      valuePlaceholder: '30',
      value: '30',
      onConfirm: async (token, guard) => {
        const response = await apiFetch(`/api/admin/aws/alarms/${encodeURIComponent(guard.targetId)}/snooze`, {
          method: 'POST',
          headers: { 'X-Admin-Guard-Token': token },
          body: JSON.stringify({ minutes: safeNumber(guard.value || 30, 30), reason: guard.reason })
        });
        const data = await readResponse(response);
        if (!response.ok || data.success === false) throw new Error(data.error || `Failed to snooze alarm (${response.status})`);
        showToast('CloudWatch', 'Alarm snoozed successfully.', 'success');
        await loadAwsStatus({ force: true, silent: true });
      }
    });
    return;
  }
  if (key === 'cloudwatch_unsnooze') {
    openGuardModal({
      action: 'aws_cloudwatch_unsnooze',
      targetType: 'aws_alarm',
      targetId: context.alarm || 'alarm',
      title: 'Unsnooze CloudWatch alarm',
      description: 'Resume the selected alarm from snooze. Provide a reason and confirm the guard flow.',
      valueLabel: 'Confirm',
      valuePlaceholder: 'type unsnooze',
      value: 'unsnooze',
      onConfirm: async (token, guard) => {
        const response = await apiFetch(`/api/admin/aws/alarms/${encodeURIComponent(guard.targetId)}/snooze`, {
          method: 'DELETE',
          headers: { 'X-Admin-Guard-Token': token },
          body: JSON.stringify({ reason: guard.reason })
        });
        const data = await readResponse(response);
        if (!response.ok || data.success === false) throw new Error(data.error || `Failed to unsnooze alarm (${response.status})`);
        showToast('CloudWatch', 'Alarm unsnoozed successfully.', 'success');
        await loadAwsStatus({ force: true, silent: true });
      }
    });
    return;
  }
  if (key === 's3_rescan') {
    openGuardModal({
      action: 'aws_s3_rescan',
      targetType: 'aws_s3_bucket',
      targetId: context.bucket || '',
      title: 'Rescan S3 bucket',
      description: 'Rescan bucket metadata and sampled object stats. Provide a reason and confirm the guard flow.',
      valueLabel: 'Notes',
      valuePlaceholder: 'Optional notes',
      value: '',
      onConfirm: async (token, guard) => {
        const response = await apiFetch(`/api/admin/aws/s3/${encodeURIComponent(guard.targetId)}/rescan`, {
          method: 'POST',
          headers: { 'X-Admin-Guard-Token': token },
          body: JSON.stringify({ reason: guard.reason })
        });
        const data = await readResponse(response);
        if (!response.ok || data.success === false) throw new Error(data.error || `Failed to rescan bucket (${response.status})`);
        showToast('S3', 'Bucket rescanned successfully.', 'success');
        await loadAwsStatus({ force: true, silent: true });
      }
    });
    return;
  }
  if (key === 's3_versioning') {
    openGuardModal({
      action: 'aws_s3_enable_versioning',
      targetType: 'aws_s3_bucket',
      targetId: context.bucket || '',
      title: 'Enable S3 versioning',
      description: 'Enable versioning for the selected bucket. Provide a reason and confirm the guard flow.',
      valueLabel: 'Confirm',
      valuePlaceholder: 'type enable',
      value: 'enable',
      onConfirm: async (token, guard) => {
        const response = await apiFetch(`/api/admin/aws/s3/${encodeURIComponent(guard.targetId)}/versioning/enable`, {
          method: 'POST',
          headers: { 'X-Admin-Guard-Token': token },
          body: JSON.stringify({ reason: guard.reason })
        });
        const data = await readResponse(response);
        if (!response.ok || data.success === false) throw new Error(data.error || `Failed to enable versioning (${response.status})`);
        showToast('S3', 'Versioning enabled successfully.', 'success');
        await loadAwsStatus({ force: true, silent: true });
      }
    });
    return;
  }
  if (key === 's3_encryption') {
    openGuardModal({
      action: 'aws_s3_enable_encryption',
      targetType: 'aws_s3_bucket',
      targetId: context.bucket || '',
      title: 'Enable S3 encryption',
      description: 'Enable encryption for the selected bucket. Provide a reason and confirm the guard flow.',
      valueLabel: 'Confirm',
      valuePlaceholder: 'type enable',
      value: 'enable',
      onConfirm: async (token, guard) => {
        const response = await apiFetch(`/api/admin/aws/s3/${encodeURIComponent(guard.targetId)}/encryption/enable`, {
          method: 'POST',
          headers: { 'X-Admin-Guard-Token': token },
          body: JSON.stringify({ reason: guard.reason })
        });
        const data = await readResponse(response);
        if (!response.ok || data.success === false) throw new Error(data.error || `Failed to enable encryption (${response.status})`);
        showToast('S3', 'Encryption enabled successfully.', 'success');
        await loadAwsStatus({ force: true, silent: true });
      }
    });
    return;
  }
  if (key === 'dynamo_refresh') {
    try {
      const response = await apiFetch(`/api/admin/aws/dynamodb/${encodeURIComponent(context.table || '')}/refresh`, { method: 'POST' });
      const data = await readResponse(response);
      if (!response.ok || data.success === false) throw new Error(data.error || `Failed to refresh DynamoDB stats (${response.status})`);
      showToast('DynamoDB', 'Table stats refreshed.', 'success');
      await loadAwsStatus({ force: true, silent: true });
    } catch (error) {
      showToast('DynamoDB', error.message, 'error');
    }
    return;
  }
  if (key === 'dynamo_deletion_protection') {
    openGuardModal({
      action: 'aws_dynamodb_toggle_deletion_protection',
      targetType: 'aws_dynamodb_table',
      targetId: context.table || '',
      title: 'Toggle DynamoDB deletion protection',
      description: 'Enable or disable deletion protection on the selected table. Provide a reason and confirm the guard flow.',
      valueLabel: 'Enabled',
      valuePlaceholder: 'true / false',
      value: 'true',
      onConfirm: async (token, guard) => {
        const response = await apiFetch(`/api/admin/aws/dynamodb/${encodeURIComponent(guard.targetId)}/deletion-protection`, {
          method: 'PATCH',
          headers: { 'X-Admin-Guard-Token': token },
          body: JSON.stringify({ enabled: String(guard.value || 'true').toLowerCase() !== 'false', reason: guard.reason })
        });
        const data = await readResponse(response);
        if (!response.ok || data.success === false) throw new Error(data.error || `Failed to toggle deletion protection (${response.status})`);
        showToast('DynamoDB', 'Deletion protection updated successfully.', 'success');
        await loadAwsStatus({ force: true, silent: true });
      }
    });
    return;
  }
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

function renderAwsBillingChart(billing = {}) {
  const canvas = document.getElementById('awsBillingChart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (adminState.charts.awsBilling) adminState.charts.awsBilling.destroy();
  const series = Array.isArray(billing.daily_costs) ? billing.daily_costs : [];
  const labels = series.map((item) => item.date || '-');
  const values = series.map((item) => safeNumber(item.cost || 0));
  adminState.charts.awsBilling = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: `Daily Cost (${billing.currency || 'USD'})`,
        data: values,
        borderColor: '#06b6d4',
        backgroundColor: 'rgba(6, 182, 212, 0.2)',
        tension: 0.35,
        fill: true,
        pointRadius: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148, 163, 184, 0.12)' } },
        y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148, 163, 184, 0.12)' } }
      },
      plugins: {
        legend: {
          labels: { color: '#94a3b8' }
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
  setAwsStatusSummary(summary);
  setText('awsRegion', `Region: ${aws.region || '-'}`);
  setText('awsCheckedAt', `Checked: ${formatDateTime(aws.checked_at || adminState.awsLastFetchedAt)}`);
  setText('awsServiceCount', `${safeNumber(summary.total_services || 0)} services`);
  setAwsLiveStatus(`AWS panel updated at ${formatDateTime(aws.checked_at || adminState.awsLastFetchedAt)}.`);
  renderAwsServiceChart(summary);
  renderAwsServiceCards(services);
  renderAwsMetadata(aws);
  renderAwsInspector(aws);
  renderAwsDataPanels(services);
  if (getAwsSelectedServiceKey() === 'cloudfront') {
    const cloudfront = services.cloudfront || {};
    const invalidationsWrap = document.getElementById('awsCloudFrontInvalidations');
    if (invalidationsWrap) invalidationsWrap.innerHTML = '<div class="admin-empty">Loading CloudFront invalidations...</div>';
    loadAwsCloudFrontInvalidations(cloudfront.distribution_id || aws.metadata?.configured_cloudfront_distribution_id || '')
      .then((invalidations) => renderAwsCloudFrontInvalidations(cloudfront, invalidations))
      .catch((error) => { if (invalidationsWrap) renderEmpty(invalidationsWrap, 'Unable to load invalidations', error.message); });
  }
  syncAwsUiControls();
  lucide.createIcons();
}

async function loadAwsStatus({ force = false, silent = false } = {}) {
  const windowValue = getAwsWindowValue();
  if (adminState.aws && !force && adminState.awsWindow === windowValue) {
    renderAwsServicesPanel();
    scheduleAwsAutoRefresh();
    return adminState.aws;
  }
  if (adminState.awsLoadingPromise) return adminState.awsLoadingPromise;

  const promise = (async () => {
    const cards = document.getElementById('awsServiceCards');
    if (cards) renderEmpty(cards, 'Checking AWS services...', 'Collecting diagnostics from backend checks.');
    setAwsPanelBusy(true);
    try {
      const response = await apiFetch(awsRefreshUrl());
      const data = await readResponse(response);
      if (!response.ok || data.success === false) throw new Error(data.error || `Failed to load AWS services (${response.status})`);
      adminState.aws = data.aws || data.data || {};
      adminState.awsWindow = windowValue;
      adminState.awsLastFetchedAt = adminState.aws?.checked_at || nowIso();
      renderAwsServicesPanel();
      scheduleAwsAutoRefresh();
      if (!silent) setAwsLiveStatus(`AWS services refreshed at ${formatDateTime(adminState.awsLastFetchedAt)}.`);
      return adminState.aws;
    } catch (error) {
      showToast('AWS Services', error.message, 'error');
      if (cards) renderEmpty(cards, 'Unable to load AWS checks', error.message);
      setAwsLiveStatus(`AWS refresh failed: ${error.message}`);
      return null;
    } finally {
      setAwsPanelBusy(false);
      adminState.awsLoadingPromise = null;
    }
  })();

  adminState.awsLoadingPromise = promise;
  return promise;
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
  adminState.guard = { open: true, phase: 'confirm', action: context.action, targetType: context.targetType, targetId: context.targetId, reason: '', value: context.value || '', valueLabel: context.valueLabel || '', valuePlaceholder: context.valuePlaceholder || '', onConfirm: context.onConfirm || null, challengeId: '', challenge: '', guardToken: '' };
  const modal = document.getElementById('adminActionModal');
  const title = document.getElementById('adminActionTitle');
  const desc = document.getElementById('adminActionDescription');
  const step = document.getElementById('adminActionStepLabel');
  const reason = document.getElementById('adminActionReason');
  const challengeWrap = document.getElementById('adminActionChallengeWrap');
  const challenge = document.getElementById('adminActionChallenge');
  const challengeInput = document.getElementById('adminActionChallengeInput');
  const valueWrap = document.getElementById('adminActionValueWrap');
  const valueLabel = document.getElementById('adminActionValueLabel');
  const valueInput = document.getElementById('adminActionValue');
  const primary = document.getElementById('adminActionPrimaryButton');
  if (!modal || !title || !desc || !step || !reason || !challengeWrap || !challenge || !challengeInput || !valueWrap || !valueLabel || !valueInput || !primary) return;
  title.textContent = context.title || 'Confirm Destructive Action';
  desc.textContent = context.description || 'This action is permanent or broadly disruptive. Provide a reason and complete the guard flow.';
  step.textContent = 'Step 1 of 2';
  reason.value = '';
  challengeWrap.classList.add('hidden');
  challenge.textContent = '';
  challengeInput.value = '';
  valueLabel.textContent = context.valueLabel || 'Value';
  valueInput.value = context.value || '';
  valueInput.placeholder = context.valuePlaceholder || '';
  valueWrap.classList.toggle('hidden', !context.valueLabel);
  primary.disabled = false;
  primary.innerHTML = '<i data-lucide="shield-check" class="w-4 h-4"></i>Generate Guard Token';
  modal.style.display = 'flex';
  lucide.createIcons();
  setTimeout(() => reason.focus(), 50);
}

function closeGuardModal() {
  adminState.guard.open = false;
  const modal = document.getElementById('adminActionModal');
  const valueWrap = document.getElementById('adminActionValueWrap');
  if (valueWrap) valueWrap.classList.add('hidden');
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
  const valueInput = document.getElementById('adminActionValue');
  if (!reason || !challengeInput || !challengeWrap || !challenge || !step || !primary || !valueInput) return null;
  guard.reason = reason.value.trim();
  guard.value = valueInput.value.trim();
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
  document.getElementById('awsRefreshButton')?.addEventListener('click', () => loadAwsStatus({ force: true }));
  document.getElementById('awsExportSnapshotButton')?.addEventListener('click', exportAwsSnapshotCsv);
  document.getElementById('awsBillingExportButton')?.addEventListener('click', exportAwsSnapshotCsv);
  document.getElementById('awsAutoRefreshSelect')?.addEventListener('change', (event) => {
    setAwsUiSetting('autoRefresh', event.target.value);
    scheduleAwsAutoRefresh();
  });
  document.getElementById('awsTimeRangeSelect')?.addEventListener('change', (event) => {
    setAwsUiSetting('window', event.target.value);
    loadAwsStatus({ force: true });
  });
  document.getElementById('awsDensityToggle')?.addEventListener('click', () => {
    const next = getAwsDensityValue() === 'compact' ? 'comfortable' : 'compact';
    setAwsUiSetting('density', next);
    document.body.classList.toggle('aws-density-compact', next === 'compact');
    syncAwsUiControls();
    renderAwsServicesPanel();
  });
  document.getElementById('awsDataTabs')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-aws-data-view]');
    if (button) setAwsDataView(button.dataset.awsDataView);
  });
  document.getElementById('awsPanel')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-aws-action]');
    if (button && event.currentTarget.contains(button)) {
      event.preventDefault();
      await handleAwsAction(button.dataset.awsAction, {
        service: button.dataset.awsService,
        key: button.dataset.awsService,
        bucket: button.dataset.awsBucket,
        table: button.dataset.awsTable,
        alarm: button.dataset.awsAlarm,
        enabled: button.dataset.awsEnabled,
        distributionId: button.dataset.awsDistributionId
      });
      return;
    }
    const card = event.target.closest('[data-aws-select-service]');
    if (card && event.currentTarget.contains(card)) {
      setAwsSelectedService(card.dataset.awsSelectService || 'lambda');
    }
  });
  document.getElementById('awsPanel')?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('[data-aws-action]')) return;
    const card = event.target.closest('[data-aws-select-service]');
    if (!card) return;
    event.preventDefault();
    setAwsSelectedService(card.dataset.awsSelectService || 'lambda');
  });
  document.getElementById('adminActionPrimaryButton')?.addEventListener('click', async () => {
    const token = await runGuardFlow();
    if (!token) return;
    const guard = { ...adminState.guard };
    try {
      if (typeof guard.onConfirm === 'function') {
        await guard.onConfirm(token, guard);
        closeGuardModal();
      } else {
        await destroyEntity(guard.targetType, guard.targetId);
        await Promise.allSettled([loadOverview({ force: true }), guard.targetType === 'user' ? loadUsers({ force: true }) : loadWorkspaces({ force: true }), loadAudit({ force: true })]);
        closeGuardModal();
      }
    } catch (error) {
      showToast('Admin', error.message, 'error');
    } finally {
      adminState.guard.guardToken = '';
      adminState.guard.onConfirm = null;
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
  document.addEventListener('visibilitychange', scheduleAwsAutoRefresh);
  window.addEventListener('beforeunload', () => {
    if (adminState.awsAutoRefreshTimer) clearTimeout(adminState.awsAutoRefreshTimer);
  });
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
  syncAwsUiControls();
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
