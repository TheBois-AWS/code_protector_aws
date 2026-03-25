// Initialize Lucide icons
lucide.createIcons();

// XSS prevention utility
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Theme toggle
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

function updateThemeIcons() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const sun = document.getElementById('themeIconSun');
  const moon = document.getElementById('themeIconMoon');
  const label = document.getElementById('themeLabel');
  if (sun) sun.style.display = isLight ? '' : 'none';
  if (moon) moon.style.display = isLight ? 'none' : '';
  if (label) label.textContent = isLight ? 'Dark Mode' : 'Light Mode';
}
updateThemeIcons();

// Sidebar toggle
function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  sidebar.classList.toggle('collapsed');
  const isCollapsed = sidebar.classList.contains('collapsed');
  localStorage.setItem('sidebarCollapsed', JSON.stringify(isCollapsed));
  // lucide.createIcons();
}

// Initialize sidebar state
(function() {
  const isCollapsed = JSON.parse(localStorage.getItem('sidebarCollapsed') || 'false');
  if (isCollapsed) {
    document.querySelector('.sidebar').classList.add('collapsed');
  }
  lucide.createIcons();
})();

// Auth Check
const token = localStorage.getItem('token');
if (!token) {
  window.location.href = '/login';
}

// Global State
let allWorkspaces = [];
let userProfile = null;
let dashboardWs = null;
let dashboardWsReconnectTimer = null;
let dashboardWsEndpoint = null;
let dashboardWsUserId = null;
let dashboardWsShouldReconnect = true;
let dashboardWsReconnectDelayMs = 2000;
let dashboardRealtimeRefreshTimer = null;
let dashboardFetchWrapped = false;

function scheduleDashboardRealtimeRefresh(delay = 300) {
  if (dashboardRealtimeRefreshTimer) clearTimeout(dashboardRealtimeRefreshTimer);
  dashboardRealtimeRefreshTimer = setTimeout(() => {
    dashboardRealtimeRefreshTimer = null;
    refreshDashboardData().catch((error) => {
      console.error('Dashboard realtime refresh failed', error);
    });
  }, delay);
}

async function getDashboardWsEndpoint() {
  if (dashboardWsEndpoint !== null) return dashboardWsEndpoint;
  dashboardWsEndpoint = '';
  try {
    const res = await fetch('/api/ws/config', {
      headers: { 'Authorization': token }
    });
    const data = await res.json();
    if (data?.success && data.endpoint) {
      dashboardWsEndpoint = String(data.endpoint);
    }
  } catch (error) {
    dashboardWsEndpoint = null;
    console.warn('WebSocket endpoint config unavailable', error);
  }
  return dashboardWsEndpoint;
}

function buildDashboardWsUrl(endpoint, userId) {
  if (!endpoint || !userId) return '';
  let normalized = String(endpoint).trim();
  if (!normalized) return '';
  if (normalized.startsWith('https://')) normalized = `wss://${normalized.slice(8)}`;
  if (normalized.startsWith('http://')) normalized = `ws://${normalized.slice(7)}`;
  if (!/^wss?:\/\//i.test(normalized)) return '';

  const url = new URL(normalized);
  url.searchParams.set('path', `/api/ws/user/${userId}`);
  url.searchParams.set('token', token);
  return url.toString();
}

function disconnectDashboardWebSocket({ allowReconnect = false } = {}) {
  dashboardWsShouldReconnect = allowReconnect;
  if (dashboardWsReconnectTimer) {
    clearTimeout(dashboardWsReconnectTimer);
    dashboardWsReconnectTimer = null;
  }
  if (!dashboardWs) return;
  const socket = dashboardWs;
  dashboardWs = null;
  socket.onclose = null;
  socket.onmessage = null;
  socket.onerror = null;
  try {
    socket.close(1000, 'client_closed');
  } catch {}
}

function scheduleDashboardWsReconnect() {
  if (!dashboardWsShouldReconnect || dashboardWsReconnectTimer || !dashboardWsUserId) return;
  const delay = dashboardWsReconnectDelayMs;
  dashboardWsReconnectTimer = setTimeout(() => {
    dashboardWsReconnectTimer = null;
    connectDashboardWebSocket(dashboardWsUserId);
  }, delay);
  dashboardWsReconnectDelayMs = Math.min(delay * 2, 30000);
}

function handleDashboardWsMessage(raw) {
  let message = null;
  try {
    message = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return;
  }
  if (!message?.type) return;

  if (message.type === 'WORKSPACE_UPDATE') {
    scheduleDashboardRealtimeRefresh(200);
    return;
  }

  if (message.type === 'PROFILE_UPDATE') {
    scheduleDashboardRealtimeRefresh(250);
    return;
  }
}

async function connectDashboardWebSocket(userId) {
  if (!userId) return;
  dashboardWsUserId = String(userId);
  if (dashboardWs && (dashboardWs.readyState === WebSocket.OPEN || dashboardWs.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const endpoint = await getDashboardWsEndpoint();
  const wsUrl = buildDashboardWsUrl(endpoint, dashboardWsUserId);
  if (!wsUrl) {
    scheduleDashboardWsReconnect();
    return;
  }

  dashboardWsShouldReconnect = true;
  const socket = new WebSocket(wsUrl);
  dashboardWs = socket;

  socket.onopen = () => {
    dashboardWsReconnectDelayMs = 2000;
  };

  socket.onmessage = (event) => {
    handleDashboardWsMessage(event.data);
  };

  socket.onclose = () => {
    if (dashboardWs === socket) dashboardWs = null;
    scheduleDashboardWsReconnect();
  };

  socket.onerror = (error) => {
    console.error('Dashboard WebSocket error', error);
  };
}

function updateStatsFromLocal() {
  document.getElementById('statsWorkspaces').textContent = allWorkspaces.length;
}

async function refreshDashboardData() {
  await loadUserProfile();

  const activePanel = document.querySelector('.view-panel.active')?.id || 'overview';
  if (activePanel === 'workspaces') {
    await loadWorkspaces();
    return;
  }

  if (activePanel === 'settings') {
    await loadSettingsStats();
    return;
  }

  await loadOverviewData();
}

// Toast Notifications
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  
  const colors = {
    success: 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400',
    error: 'bg-red-500/20 border-red-500/30 text-red-400',
    warning: 'bg-amber-500/20 border-amber-500/30 text-amber-400',
    info: 'bg-blue-500/20 border-blue-500/30 text-blue-400'
  };

  const icons = {
    success: 'check-circle',
    error: 'x-circle',
    warning: 'alert-triangle',
    info: 'info'
  };

  toast.className = `flex items-center gap-3 px-4 py-3 rounded-lg border ${colors[type]} backdrop-blur-sm shadow-lg transform translate-x-full transition-transform duration-300`;
  toast.innerHTML = `
    <i data-lucide="${icons[type]}" class="w-5 h-5"></i>
    <span class="text-sm font-medium">${escapeHtml(message)}</span>
    <button onclick="this.parentElement.remove()" class="ml-2 hover:opacity-70">
      <i data-lucide="x" class="w-4 h-4"></i>
    </button>
  `;
  
  container.appendChild(toast);
  lucide.createIcons();
  
  // Animate in
  setTimeout(() => toast.classList.remove('translate-x-full'), 10);
  
  // Auto remove
  setTimeout(() => {
    toast.classList.add('translate-x-full');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function getNavElForPanel(panelId) {
  return document.querySelector(`.nav-item[onclick*="'${panelId}'"]`) ||
         document.querySelector(`.nav-item[onclick*='"${panelId}"']`);
}

function setDashboardNetworkBanner(visible, message) {
  const banner = document.getElementById('networkStatusBanner');
  const text = document.getElementById('networkStatusText');
  if (!banner || !text) return;
  text.textContent = message || 'Connection issue detected. Some actions may fail.';
  banner.classList.toggle('show', Boolean(visible));
}

function retryDashboardConnection() {
  setDashboardNetworkBanner(false);
  refreshDashboardData().catch(() => {
    setDashboardNetworkBanner(true, 'Still unable to connect. Please try again in a moment.');
  });
}

function openMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const backdrop = document.getElementById('mobileSidebarBackdrop');
  const toggle = document.getElementById('mobileSidebarToggle');
  if (!sidebar || window.innerWidth > 768) return;
  sidebar.classList.remove('-translate-x-full');
  sidebar.classList.add('translate-x-0');
  backdrop?.classList.add('active');
  if (toggle) toggle.setAttribute('aria-expanded', 'true');
}

function closeMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const backdrop = document.getElementById('mobileSidebarBackdrop');
  const toggle = document.getElementById('mobileSidebarToggle');
  if (!sidebar || window.innerWidth > 768) return;
  sidebar.classList.add('-translate-x-full');
  sidebar.classList.remove('translate-x-0');
  backdrop?.classList.remove('active');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
}

function toggleMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar || window.innerWidth > 768) return;
  const isOpen = sidebar.classList.contains('translate-x-0');
  if (isOpen) {
    closeMobileSidebar();
  } else {
    openMobileSidebar();
  }
}

function installDashboardFetchGuard() {
  if (dashboardFetchWrapped) return;
  dashboardFetchWrapped = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    try {
      const response = await nativeFetch(...args);
      if (response.status >= 500) {
        setDashboardNetworkBanner(true, 'Server is busy right now. Retrying may help.');
      } else {
        setDashboardNetworkBanner(false);
      }
      return response;
    } catch (error) {
      setDashboardNetworkBanner(true, 'Network error. Check your connection and retry.');
      throw error;
    }
  };
}

installDashboardFetchGuard();

// Panel Navigation
function showPanel(panelId, navEl) {
  const targetNav = navEl || getNavElForPanel(panelId);

  // Hide all panels
  document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
  // Show target panel
  document.getElementById(panelId).classList.add('active');
  
  // Update nav state
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.remove('active', 'text-gray-200');
    n.classList.add('text-gray-400');
  });
  if (targetNav) {
    targetNav.classList.add('active', 'text-gray-200');
    targetNav.classList.remove('text-gray-400');
  }

  closeMobileSidebar();

  if (panelId === 'workspaces') {
    loadWorkspaces();
  } else if (panelId === 'settings') {
    loadSettingsStats();
  } else if (panelId === 'overview') {
    loadOverviewData();
  }
}

function logout() {
  disconnectDashboardWebSocket({ allowReconnect: false });
  localStorage.removeItem('token');
  window.location.href = '/login';
}

// User Profile Functions
async function loadUserProfile() {
  try {
    const res = await fetch('/api/user/profile', {
      headers: { 'Authorization': token }
    });
    
    // Handle expired/invalid token
    if (res.status === 401 || res.status === 403) {
      disconnectDashboardWebSocket({ allowReconnect: false });
      localStorage.removeItem('token');
      window.location.href = '/login';
      return;
    }
    
    const data = await res.json();
    
    if (data.success) {
      userProfile = data.user;
      connectDashboardWebSocket(data.user.id);
      
      // Update sidebar
      document.getElementById('sidebarUsername').textContent = data.user.display_name || 'User';
      document.getElementById('sidebarEmail').textContent = data.user.email;
      
      // Update settings form
      document.getElementById('settingsDisplayName').value = data.user.display_name || '';
      document.getElementById('settingsEmail').value = data.user.email;
      document.getElementById('settingsMemberSince').value = new Date(data.user.created_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    }
  } catch (e) {
    console.error('Failed to load profile:', e);
  }
}

async function saveProfile() {
  const displayName = document.getElementById('settingsDisplayName').value.trim();
  
  try {
    const res = await fetch('/api/user/profile', {
      method: 'PUT',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': token 
      },
      body: JSON.stringify({ display_name: displayName })
    });
    const data = await res.json();
    
    if (data.success) {
      showToast('Profile updated successfully!', 'success');
      document.getElementById('sidebarUsername').textContent = displayName || 'User';
    } else {
      showToast(data.error || 'Failed to update profile', 'error');
    }
  } catch (e) {
    showToast('Connection error', 'error');
  }
}

async function changePassword() {
  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;

  if (!currentPassword || !newPassword || !confirmPassword) {
    showToast('Please fill in all password fields', 'warning');
    return;
  }

  if (newPassword !== confirmPassword) {
    showToast('New passwords do not match', 'error');
    return;
  }

  if (newPassword.length < 8) {
    showToast('New password must be at least 8 characters', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/user/password', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': token 
      },
      body: JSON.stringify({ 
        currentPassword,
        newPassword 
      })
    });
    const data = await res.json();
    
    if (data.success) {
      showToast('Password changed successfully!', 'success');
      document.getElementById('currentPassword').value = '';
      document.getElementById('newPassword').value = '';
      document.getElementById('confirmPassword').value = '';
    } else {
      showToast(data.error || 'Failed to change password', 'error');
    }
  } catch (e) {
    showToast('Connection error', 'error');
  }
}

function togglePassword(inputId) {
  const input = document.getElementById(inputId);
  const icon = input.parentElement.querySelector('i');
  
  if (input.type === 'password') {
    input.type = 'text';
    icon.setAttribute('data-lucide', 'eye-off');
  } else {
    input.type = 'password';
    icon.setAttribute('data-lucide', 'eye');
  }
  lucide.createIcons();
}

function openDeleteAccountModal() {
  document.getElementById('deleteAccountModal').style.display = 'flex';
  document.getElementById('deleteAccountPassword').value = '';
}

async function deleteAccount() {
  const password = document.getElementById('deleteAccountPassword').value;
  
  if (!password) {
    showToast('Please enter your password to confirm', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/user/account', {
      method: 'DELETE',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': token 
      },
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    
    if (data.success) {
      showToast('Account deleted. Redirecting...', 'success');
      localStorage.removeItem('token');
      setTimeout(() => window.location.href = '/login', 2000);
    } else {
      showToast(data.error || 'Failed to delete account', 'error');
    }
  } catch (e) {
    showToast('Connection error', 'error');
  }
}

// Stats Functions
async function loadUserStats() {
  try {
    const res = await fetch('/api/user/stats', {
      headers: { 'Authorization': token }
    });
    const data = await res.json();
    
    if (data.success) {
      return data.stats;
    }
    return null;
  } catch (e) {
    console.error('Failed to load stats:', e);
    return null;
  }
}

async function loadOverviewData() {
  const stats = await loadUserStats();
  
  if (stats) {
    // Update overview stats
    document.getElementById('statsWorkspaces').textContent = stats.workspaces;
    document.getElementById('statsProjects').textContent = stats.projects;
    document.getElementById('statsLicenses').textContent = stats.licenses;
    document.getElementById('statsExecutions').textContent = stats.logs;
  }
  
  // Load recent workspaces
  await loadRecentWorkspaces();
}

async function loadSettingsStats() {
  const stats = await loadUserStats();
  
  if (stats) {
    document.getElementById('settingsStatWorkspaces').textContent = stats.workspaces;
    document.getElementById('settingsStatProjects').textContent = stats.projects;
    document.getElementById('settingsStatLicenses').textContent = stats.licenses;
    document.getElementById('settingsStatLogs').textContent = stats.logs;
  }
}

async function loadRecentWorkspaces() {
  const container = document.getElementById('recentWorkspaces');
  
  try {
    const res = await fetch('/api/workspaces', {
      headers: { 'Authorization': token }
    });
    const data = await res.json();
    
    if (!data.success) throw new Error(data.error);
    
    allWorkspaces = data.workspaces;
    
    if (data.workspaces.length === 0) {
      container.innerHTML = `
        <div class="col-span-full stat-card p-12 text-center">
          <div class="flex justify-center mb-4">
            <div class="icon-box indigo w-14 h-14">
              <i data-lucide="folder-open" class="w-7 h-7 text-indigo-400"></i>
            </div>
          </div>
          <h3 class="text-lg font-semibold text-white mb-2">No workspaces yet</h3>
          <p class="text-gray-500 text-sm mb-6">Create your first workspace to start protecting projects</p>
          <button class="btn-primary text-white px-4 py-2.5 rounded-lg text-sm font-medium inline-flex items-center gap-2" onclick="openCreateWorkspaceModal()">
            <i data-lucide="plus" class="w-4 h-4"></i> Create Workspace
          </button>
        </div>
      `;
      lucide.createIcons();
      return;
    }

    // Show only 3 most recent
    const recent = data.workspaces.slice(0, 3);
    container.innerHTML = recent.map(ws => renderWorkspaceCard(ws)).join('');
    lucide.createIcons();
  } catch (e) {
    container.innerHTML = `<div class="col-span-full text-center py-12 text-red-500">Error: ${escapeHtml(e.message)}</div>`;
  }
}

// Workspace Functions
async function loadWorkspaces() {
  const container = document.getElementById('workspaceList');
  container.innerHTML = '<div class="col-span-full text-center py-12 text-gray-500">Loading workspaces...</div>';
  
  try {
    const res = await fetch('/api/workspaces', {
      headers: { 'Authorization': token }
    });
    const data = await res.json();
    
    if (!data.success) throw new Error(data.error);
    
    allWorkspaces = data.workspaces;
    renderWorkspaces(allWorkspaces);
  } catch (e) {
    container.innerHTML = `<div class="col-span-full text-center py-12 text-red-500">Error: ${escapeHtml(e.message)}</div>`;
  }
}

function renderWorkspaces(workspaces) {
  const container = document.getElementById('workspaceList');
  
  if (workspaces.length === 0) {
    container.innerHTML = `
      <div class="col-span-full stat-card p-12 text-center">
        <div class="flex justify-center mb-4">
          <div class="icon-box indigo w-14 h-14">
            <i data-lucide="folder-open" class="w-7 h-7 text-indigo-400"></i>
          </div>
        </div>
        <h3 class="text-lg font-semibold text-white mb-2">No workspaces found</h3>
        <p class="text-gray-500 text-sm mb-6">Create your first workspace to start protecting projects</p>
        <button class="btn-primary text-white px-4 py-2.5 rounded-lg text-sm font-medium inline-flex items-center gap-2" onclick="openCreateWorkspaceModal()">
          <i data-lucide="plus" class="w-4 h-4"></i> Create Workspace
        </button>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  container.innerHTML = workspaces.map(ws => renderWorkspaceCard(ws)).join('');
  lucide.createIcons();
}

function renderWorkspaceCard(ws) {
  const langLogos = {
    python: `<svg viewBox="0 0 128 128" class="w-5 h-5"><path fill="#306998" d="M63.391 1.988c-4.222.02-8.252.379-11.8 1.007-10.45 1.846-12.346 5.71-12.346 12.837v9.411h24.693v3.137H29.977c-7.176 0-13.46 4.313-15.426 12.521-2.268 9.405-2.368 15.275 0 25.096 1.755 7.311 5.947 12.519 13.124 12.519h8.491V67.234c0-8.151 7.051-15.34 15.426-15.34h24.665c6.866 0 12.346-5.654 12.346-12.548V15.833c0-6.693-5.646-11.72-12.346-12.837-4.244-.706-8.645-1.027-12.866-1.008zM50.037 9.557c2.55 0 4.634 2.117 4.634 4.721 0 2.593-2.083 4.69-4.634 4.69-2.56 0-4.633-2.097-4.633-4.69-.001-2.604 2.073-4.721 4.633-4.721z"/><path fill="#FFD43B" d="M91.682 28.38v10.966c0 8.5-7.208 15.655-15.426 15.655H51.591c-6.756 0-12.346 5.783-12.346 12.549v23.515c0 6.691 5.818 10.628 12.346 12.547 7.816 2.297 15.312 2.713 24.665 0 6.216-1.801 12.346-5.423 12.346-12.547v-9.412H63.938v-3.138h37.012c7.176 0 9.852-5.005 12.348-12.519 2.578-7.735 2.467-15.174 0-25.096-1.774-7.145-5.161-12.521-12.348-12.521h-9.268zM77.809 87.927c2.561 0 4.634 2.097 4.634 4.692 0 2.602-2.074 4.719-4.634 4.719-2.55 0-4.633-2.117-4.633-4.719 0-2.595 2.083-4.692 4.633-4.692z"/></svg>`,
    lua: `<svg viewBox="0 0 128 128" class="w-5 h-5"><circle cx="64" cy="64" r="54" fill="#2C5AA0"/><circle cx="80" cy="46" r="19" fill="#fff"/><circle cx="83" cy="43" r="14" fill="#2C5AA0"/><circle cx="48" cy="82" r="8" fill="#9CC7FF"/></svg>`,
    nodejs: `<svg viewBox="0 0 128 128" class="w-5 h-5"><path fill="#83CD29" d="M112.771 30.334L68.674 4.729c-2.781-1.584-6.402-1.584-9.205 0L14.901 30.334C12.031 31.985 10 35.088 10 38.407v51.142c0 3.319 2.084 6.423 4.954 8.083l11.775 6.688c5.628 2.772 7.617 2.772 10.178 2.772 8.333 0 13.093-5.039 13.093-13.828v-50.49c0-.713-.371-1.774-1.071-1.774h-5.623c-.712 0-2.306 1.061-2.306 1.773v50.49c0 3.896-3.524 7.773-10.11 4.48L18.723 90.73c-.424-.23-.723-.693-.723-1.181V38.407c0-.482.555-.966.982-1.213l44.424-25.561c.415-.235 1.025-.235 1.439 0l43.882 25.555c.42.253.272.722.272 1.219v51.142c0 .488.183.963-.232 1.198l-44.086 25.576c-.378.227-.847.227-1.261 0l-11.307-6.749c-.341-.198-.746-.269-1.073-.086-3.146 1.783-3.726 2.02-6.677 3.043-.726.253-1.797.692.41 1.929l14.798 8.754a9.294 9.294 0 004.647 1.246c1.642 0 3.25-.426 4.667-1.246l43.885-25.582c2.87-1.672 4.23-4.764 4.23-8.083V38.407c0-3.319-1.36-6.414-4.229-8.073zM77.91 81.445c-11.726 0-14.309-3.235-15.17-9.066-.1-.628-.633-1.379-1.272-1.379h-5.731c-.709 0-1.279.86-1.279 1.566 0 7.466 4.059 16.512 23.453 16.512 14.039 0 22.088-5.455 22.088-15.109 0-9.572-6.467-12.084-20.082-13.886-13.762-1.819-15.16-2.738-15.16-5.962 0-2.658 1.184-6.203 11.374-6.203 9.105 0 12.461 1.954 13.842 8.091.118.577.645 1.137 1.215 1.137h5.721c.344 0 .74-.213 1.001-.463.263-.264.324-.566.269-.905-1.14-10.443-9.612-15.323-22.049-15.323-12.591 0-20.126 5.281-20.126 14.109 0 9.591 7.42 12.267 19.406 13.471 14.344 1.435 15.827 3.566 15.827 6.445 0 5.02-4.029 7.156-13.497 7.156z"/></svg>`,
    userscript: `<svg viewBox="0 0 128 128" class="w-5 h-5"><path fill="#F0DB4F" d="M1.408 1.408h125.184v125.185H1.408z"/><path fill="#323330" d="M116.347 96.736c-.917-5.711-4.641-10.508-15.672-14.981-3.832-1.761-8.104-3.022-9.377-5.926-.452-1.69-.512-2.642-.226-3.665.821-3.32 4.784-4.355 7.925-3.403 2.023.678 3.938 2.237 5.093 4.724 5.402-3.498 5.391-3.475 9.163-5.879-1.381-2.141-2.118-3.129-3.022-4.045-3.249-3.629-7.676-5.498-14.756-5.355l-3.688.477c-3.534.893-6.902 2.748-8.877 5.235-5.926 6.724-4.236 18.492 2.975 23.335 7.104 5.332 17.54 6.545 18.873 11.531 1.297 6.104-4.486 8.08-10.234 7.378-4.236-.881-6.592-3.034-9.139-6.949-4.688 2.713-4.688 2.713-9.508 5.485 1.143 2.499 2.344 3.63 4.26 5.795 9.068 9.198 31.76 8.746 35.83-5.176.165-.478 1.261-3.666.38-8.581zM69.462 58.943H57.753l-.048 30.272c0 6.438.333 12.34-.714 14.149-1.713 3.558-6.152 3.117-8.175 2.427-2.059-1.012-3.106-2.451-4.319-4.485-.333-.584-.583-1.036-.667-1.071l-9.52 5.83c1.583 3.249 3.915 6.069 6.902 7.901 4.462 2.678 10.459 3.499 16.731 2.059 4.082-1.189 7.604-3.652 9.448-7.401 2.666-4.915 2.094-10.864 2.07-17.444.06-10.735.001-21.468.001-32.237z"/></svg>`,
    javascript: `<svg viewBox="0 0 128 128" class="w-5 h-5"><path fill="#F0DB4F" d="M1.408 1.408h125.184v125.185H1.408z"/><path fill="#323330" d="M116.347 96.736c-.917-5.711-4.641-10.508-15.672-14.981-3.832-1.761-8.104-3.022-9.377-5.926-.452-1.69-.512-2.642-.226-3.665.821-3.32 4.784-4.355 7.925-3.403 2.023.678 3.938 2.237 5.093 4.724 5.402-3.498 5.391-3.475 9.163-5.879-1.381-2.141-2.118-3.129-3.022-4.045-3.249-3.629-7.676-5.498-14.756-5.355l-3.688.477c-3.534.893-6.902 2.748-8.877 5.235-5.926 6.724-4.236 18.492 2.975 23.335 7.104 5.332 17.54 6.545 18.873 11.531 1.297 6.104-4.486 8.08-10.234 7.378-4.236-.881-6.592-3.034-9.139-6.949-4.688 2.713-4.688 2.713-9.508 5.485 1.143 2.499 2.344 3.63 4.26 5.795 9.068 9.198 31.76 8.746 35.83-5.176.165-.478 1.261-3.666.38-8.581zM69.462 58.943H57.753l-.048 30.272c0 6.438.333 12.34-.714 14.149-1.713 3.558-6.152 3.117-8.175 2.427-2.059-1.012-3.106-2.451-4.319-4.485-.333-.584-.583-1.036-.667-1.071l-9.52 5.83c1.583 3.249 3.915 6.069 6.902 7.901 4.462 2.678 10.459 3.499 16.731 2.059 4.082-1.189 7.604-3.652 9.448-7.401 2.666-4.915 2.094-10.864 2.07-17.444.06-10.735.001-21.468.001-32.237z"/></svg>`
  };
  const langNames = {
    python: 'Python',
    lua: 'Lua',
    nodejs: 'Node.js',
    node: 'Node.js',
    javascript: 'JavaScript',
    userscript: 'JavaScript'
  };
  
  const langKey = ws.language || 'python';
  const logo = langLogos[langKey] || langLogos['python'];
  const langName = langNames[langKey] || langKey;
  
  return `
    <div class="workspace-card p-6 cursor-pointer group" onclick="window.location.href='/workspace/${ws.loader_key}'">
      <div class="flex justify-between items-start mb-4">
        <div class="card-icon w-12 h-12 rounded-xl bg-gradient-to-br from-zinc-800 to-zinc-900 flex items-center justify-center border border-zinc-700/50 shadow-lg">
          ${logo}
        </div>
        <div class="flex items-center gap-2">
          <div class="badge-success">
            <div class="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
            Active
          </div>
        </div>
      </div>
      <h3 class="text-lg font-bold text-white mb-1 group-hover:text-indigo-300 transition-colors">${escapeHtml(ws.name)}</h3>
      <p class="text-gray-500 text-sm mb-4 flex items-center gap-2">
        <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-zinc-800/80 text-xs text-gray-400 border border-zinc-700/50">
          ${langName}
        </span>
      </p>
      <div class="flex items-center gap-4 text-xs text-gray-500 pt-4 border-t border-[#27272a]">
        <div class="flex items-center gap-1.5">
          <i data-lucide="file-code" class="w-3.5 h-3.5"></i>
          <span>${ws.projects ? ws.projects.length : 0} Projects</span>
        </div>
        <div class="flex items-center gap-1.5">
          <i data-lucide="calendar" class="w-3.5 h-3.5"></i>
          <span>${new Date(ws.created_at).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  `;
}

function filterWorkspaces() {
  const search = document.getElementById('workspaceSearch').value.toLowerCase();
  const filtered = allWorkspaces.filter(ws => 
    ws.name.toLowerCase().includes(search)
  );
  renderWorkspaces(filtered);
}

function sortWorkspaces() {
  const sortBy = document.getElementById('workspaceSort').value;
  let sorted = [...allWorkspaces];
  
  switch (sortBy) {
    case 'newest':
      sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      break;
    case 'oldest':
      sorted.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      break;
    case 'name':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'name-desc':
      sorted.sort((a, b) => b.name.localeCompare(a.name));
      break;
  }
  
  renderWorkspaces(sorted);
}

function openCreateWorkspaceModal() {
  document.getElementById('createWorkspaceModal').style.display = 'flex';
  document.getElementById('newWorkspaceName').value = '';
  toggleJsSubOption();
}

function toggleJsSubOption() {
  const lang = document.getElementById('newWorkspaceLang')?.value || 'python';
  const container = document.getElementById('jsSubOptionContainer');
  if (!container) return;
  container.style.display = lang === 'javascript' ? 'block' : 'none';
}

async function createWorkspace() {
  const name = document.getElementById('newWorkspaceName').value.trim();
  const lang = document.getElementById('newWorkspaceLang')?.value || 'python';
  const jsType = document.getElementById('newWorkspaceJsType')?.value || 'nodejs';
  const finalLanguage = lang === 'javascript' ? jsType : lang;
  
  if (!name) {
    showToast('Please enter a workspace name', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': token },
      body: JSON.stringify({ name, language: finalLanguage })
    });
    const data = await res.json();
    
    if (data.success) {
      document.getElementById('createWorkspaceModal').style.display = 'none';
      showToast('Workspace created successfully!', 'success');
      loadWorkspaces();
      loadOverviewData();
    } else {
      showToast(data.error || 'Failed to create workspace', 'error');
    }
  } catch (e) {
    showToast('Connection error', 'error');
  }
}

// Keyboard Shortcuts
document.addEventListener('keydown', (e) => {
  // Escape to close modals
  if (e.key === 'Escape') {
    document.getElementById('createWorkspaceModal').style.display = 'none';
    document.getElementById('deleteAccountModal').style.display = 'none';
    closeMobileSidebar();
  }
  
  // Ctrl+K for quick search
  if (e.ctrlKey && e.key === 'k') {
    e.preventDefault();
    showPanel('workspaces', document.querySelector('[onclick*="workspaces"]'));
    setTimeout(() => document.getElementById('workspaceSearch')?.focus(), 100);
  }
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  installDashboardFetchGuard();

  const retryButton = document.getElementById('networkRetryButton');
  if (retryButton) {
    retryButton.addEventListener('click', retryDashboardConnection);
  }

  window.addEventListener('offline', () => {
    setDashboardNetworkBanner(true, 'You are offline. Reconnect to continue syncing.');
  });
  window.addEventListener('online', () => {
    setDashboardNetworkBanner(false);
  });

  loadUserProfile();
  loadOverviewData();

  // Mobile sidebar toggle
  const sidebarToggle = document.getElementById('mobileSidebarToggle');
  const sidebarBackdrop = document.getElementById('mobileSidebarBackdrop');
  if (sidebarToggle) {
    sidebarToggle.setAttribute('aria-expanded', 'false');
    sidebarToggle.addEventListener('click', toggleMobileSidebar);
  }
  sidebarBackdrop?.addEventListener('click', closeMobileSidebar);
  window.addEventListener('resize', closeMobileSidebar);

  // Close modals on backdrop click
  document.querySelectorAll('[id$="Modal"]').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
  });
});

window.addEventListener('beforeunload', () => {
  disconnectDashboardWebSocket({ allowReconnect: false });
});
