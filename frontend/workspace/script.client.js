// Initialize Lucide icons
lucide.createIcons();

// XSS prevention utility
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

const MONACO_THEME_DARK = 'guardscript-dark';
const MONACO_THEME_LIGHT = 'guardscript-light';
let monacoThemesRegistered = false;

function ensureMonacoThemes() {
    if (typeof monaco === 'undefined' || !monaco.editor || monacoThemesRegistered) {
        return;
    }

    monaco.editor.defineTheme(MONACO_THEME_DARK, {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
            'editor.background': '#101925',
            'editorGutter.background': '#101925',
            'editor.foreground': '#d9e6f8',
            'editorLineNumber.foreground': '#627a98',
            'editorLineNumber.activeForeground': '#c9d7ec',
            'editorCursor.foreground': '#7bb6ff',
            'editor.selectionBackground': '#2a5b9366',
            'editor.lineHighlightBackground': '#1a2a3fa6',
            'editorIndentGuide.background1': '#243952',
            'editorIndentGuide.activeBackground1': '#3d5f86'
        }
    });

    monaco.editor.defineTheme(MONACO_THEME_LIGHT, {
        base: 'vs',
        inherit: true,
        rules: [],
        colors: {
            'editor.background': '#f7fbff',
            'editorGutter.background': '#f7fbff',
            'editor.foreground': '#1f3650',
            'editorLineNumber.foreground': '#7e91ab',
            'editorLineNumber.activeForeground': '#2b3f58',
            'editorCursor.foreground': '#1f58b8',
            'editor.selectionBackground': '#bfd8ff77',
            'editor.lineHighlightBackground': '#eaf3ff',
            'editorIndentGuide.background1': '#d8e5f7',
            'editorIndentGuide.activeBackground1': '#9db5d5'
        }
    });

    monacoThemesRegistered = true;
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
    // Switch Monaco editor theme
    if (typeof monaco !== 'undefined') {
        const newIsLight = html.getAttribute('data-theme') === 'light';
        ensureMonacoThemes();
        monaco.editor.setTheme(newIsLight ? MONACO_THEME_LIGHT : MONACO_THEME_DARK);
    }
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
    updateSidebarToggleIcon(isCollapsed);
    lucide.createIcons();
}

function updateSidebarToggleIcon(isCollapsed) {
    const toggleBtn = document.querySelector('button[title="Toggle sidebar"]');
    if (toggleBtn) {
        const iconName = isCollapsed ? 'chevrons-right' : 'chevrons-left';
        toggleBtn.innerHTML = `<i data-lucide="${iconName}" class="w-3 h-3 text-gray-400"></i>`;
    }
}

// Initialize sidebar state
(function() {
    const isCollapsed = JSON.parse(localStorage.getItem('sidebarCollapsed') || 'false');
    if (isCollapsed) {
        document.querySelector('.sidebar').classList.add('collapsed');
        updateSidebarToggleIcon(true);
    }
    lucide.createIcons();
})();

// =====================================
// CLIENT-SIDE CRYPTO UTILITIES (AES-256-GCM)
// =====================================

// Helper: Base64 to ArrayBuffer
function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

// Helper: ArrayBuffer to Base64
function arrayBufferToBase64(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

// Decrypt data using AES-256-GCM
async function decryptAES(encryptedBase64, keyBase64) {
    try {
        const combined = base64ToArrayBuffer(encryptedBase64);
        const combinedArray = new Uint8Array(combined);

        // Extract IV (first 12 bytes) and ciphertext
        const iv = combinedArray.slice(0, 12);
        const ciphertext = combinedArray.slice(12);

        const keyBuffer = base64ToArrayBuffer(keyBase64);
        const key = await crypto.subtle.importKey(
            'raw',
            keyBuffer,
            { name: 'AES-GCM', length: 256 },
            false,
            ['decrypt']
        );

        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            ciphertext
        );

        const decoder = new TextDecoder();
        return decoder.decode(decrypted);
    } catch (e) {
        console.error('Decryption failed:', e);
        return null;
    }
}

// Encrypt data using AES-256-GCM (for saving)
async function encryptAES(plaintext, keyBase64) {
    try {
        const encoder = new TextEncoder();
        const data = encoder.encode(plaintext);

        const keyBuffer = base64ToArrayBuffer(keyBase64);
        const key = await crypto.subtle.importKey(
            'raw',
            keyBuffer,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt']
        );

        // Generate random IV (12 bytes for GCM)
        const iv = new Uint8Array(12);
        crypto.getRandomValues(iv);

        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            data
        );

        // Combine IV + ciphertext
        const combined = new Uint8Array(iv.length + encrypted.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(encrypted), iv.length);

        return arrayBufferToBase64(combined);
    } catch (e) {
        console.error('Encryption failed:', e);
        return null;
    }
}

// =====================================
// END CRYPTO UTILITIES
// =====================================

// Decompress gzipped base64 content (used after decryption)
function decompressGzip(base64Data) {
    try {
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return pako.ungzip(bytes, { to: 'string' });
    } catch (e) {
        console.error('Decompression failed:', e);
        // Return original if decompression fails (might be legacy uncompressed)
        return base64Data;
    }
}

// Security Rules Reference
const SECURITY_RULES = {
    'R1': 'External Identity Requests (IP logging)',
    'R2': 'Sensitive Data Exfiltration',
    'R3': 'Dynamic Code Execution',
    'R4': 'Malicious File Operations',
    'R5': 'RAT/Backdoor',
    'R6': 'Stealers (Cookies/Passwords/Tokens)',
    'R7': 'Heavy Obfuscation',
    'R8': 'Process Manipulation',
    'R9': 'Persistence Mechanisms',
    'R10': 'Crypto Mining'
};

function formatViolatedRules(rules) {
    if (!rules || rules.length === 0) return '';
    return rules.map(r => `${r}: ${SECURITY_RULES[r] || 'Unknown'}`).join('\n');
}

// --- Custom Modal Logic ---
let confirmCallback = null;
let promptCallback = null;

function showAlert(title, message) {
    // Use toast for short messages, modal for long ones
    if (message && message.length > 100 || message.includes('\n')) {
        // Long message - use modal
        document.getElementById('alertTitle').textContent = title || 'Alert';
        document.getElementById('alertMessage').textContent = message;
        document.getElementById('alertModal').style.display = 'flex';
    } else {
        // Short message - use toast
        const type = title.toLowerCase().includes('error') ? 'error' :
            title.toLowerCase().includes('success') ? 'success' :
                title.toLowerCase().includes('warning') ? 'warning' : 'info';
        showToast(title, message, type);
    }
}

function closeAlert() {
    document.getElementById('alertModal').style.display = 'none';
}

function showConfirm(title, message, callback) {
    document.getElementById('confirmTitle').textContent = title || 'Confirm';
    document.getElementById('confirmMessage').textContent = message;
    document.getElementById('confirmModal').style.display = 'flex';
    confirmCallback = callback;
}

function closeConfirm(result) {
    document.getElementById('confirmModal').style.display = 'none';
    if (confirmCallback) {
        confirmCallback(result);
        confirmCallback = null;
    }
}

function showPrompt(title, message, callback, defaultValue) {
    document.getElementById('promptTitle').textContent = title || 'Prompt';
    document.getElementById('promptMessage').textContent = message;
    document.getElementById('promptInput').value = defaultValue || '';
    document.getElementById('promptModal').style.display = 'flex';
    document.getElementById('promptInput').focus();
    if (defaultValue) document.getElementById('promptInput').select();
    promptCallback = callback;
}

function closePrompt(result) {
    document.getElementById('promptModal').style.display = 'none';
    if (promptCallback) {
        promptCallback(result);
        promptCallback = null;
    }
}

// Parse URL: /workspace/{id} or /workspace/{id}/{view} or /workspace/{id}/editor/{projectId}
const pathParts = window.location.pathname.split('/').filter(Boolean);
const workspaceIdentifier = pathParts[1]; // workspace ID
const initialView = pathParts[2] || 'projects'; // default to projects
const initialProjectId = pathParts[3] || null; // project ID for deep linking to editor
const token = localStorage.getItem('token');
if (!token) window.location.href = '/login';

// Valid views for URL routing
const validViews = ['overview', 'projects', 'editor', 'licenses', 'access', 'logs', 'team', 'settings'];

let editor;
let currentProjectKey = null;
let projects = [];
let licenses = [];
let accessRules = [];
let logs = [];
let teamData = { owner: null, members: [], invitations: [], currentUserRole: 'viewer' };
let workspaceData = {};
let executionChart = null;

// === File Explorer State ===
let projectFiles = [];        // Flat array of project_files for current project
let fileTree = [];             // Nested tree built from projectFiles
let openTabs = [];             // Array of { fileId, name, language, modified }
let activeFileId = null;       // Currently active file ID in editor
let expandedFolders = new Set(); // Set of expanded folder IDs
let fileContents = new Map();  // Cache: fileId -> content string
let monacoModels = new Map();  // Cache: fileId -> monaco.editor.ITextModel
let draggedFileId = null;      // Currently dragged file ID
let selectedFileIds = new Set(); // Multi-select: set of selected file IDs
let lastClickedFileId = null;  // For shift+click range selection
let closedTabHistory = [];     // Recently closed tabs (for reopen)
let autoSaveTimers = new Map(); // fileId -> timeout id
let autoSaveInFlight = new Set(); // fileId currently autosaving
let lastSavedContent = new Map(); // fileId -> latest saved content
let currentUserRole = 'viewer'; // Current user's role in this workspace
let isLoadingWorkspace = false; // Lock to prevent multiple simultaneous loads
let pinVerified = false; // Track if PIN was already verified this session
let privacyModeEnabled = localStorage.getItem('privacyMode') === 'true'; // Privacy blur protection
let workspaceWs = null;
let workspaceWsReconnectTimer = null;
let workspaceWsShouldReconnect = true;
let workspaceWsEndpoint = null;
let workspaceWsReconnectDelayMs = 2000;
const realtimeRefreshTimers = new Map();
let workspaceFetchWrapped = false;
const PANEL_STATE_KEYS = {
    settingsCollapsed: `workspace:${workspaceIdentifier}:settingsPanelCollapsed`,
    detailsCollapsed: `workspace:${workspaceIdentifier}:detailsPanelCollapsed`,
    settingsHeight: `workspace:${workspaceIdentifier}:settingsPanelHeight`,
    detailsWidth: `workspace:${workspaceIdentifier}:detailsPanelWidth`
};
const TAB_HISTORY_LIMIT = 20;
const AUTOSAVE_DELAY_MS = 1500;

function setWorkspaceNetworkBanner(visible, message) {
    const banner = document.getElementById('networkStatusBanner');
    const text = document.getElementById('networkStatusText');
    if (!banner || !text) return;
    text.textContent = message || 'Connection issue detected. Some actions may fail.';
    banner.classList.toggle('show', Boolean(visible));
}

function retryWorkspaceConnection() {
    setWorkspaceNetworkBanner(false);
    loadWorkspaceData().catch(() => {
        setWorkspaceNetworkBanner(true, 'Still unable to connect. Please try again in a moment.');
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

function installWorkspaceFetchGuard() {
    if (workspaceFetchWrapped) return;
    workspaceFetchWrapped = true;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
        try {
            const response = await nativeFetch(...args);
            if (response.status >= 500) {
                setWorkspaceNetworkBanner(true, 'Server is busy right now. Retrying may help.');
            } else {
                setWorkspaceNetworkBanner(false);
            }
            return response;
        } catch (error) {
            setWorkspaceNetworkBanner(true, 'Network error. Check your connection and retry.');
            throw error;
        }
    };
}

installWorkspaceFetchGuard();

// Permission system - matches backend permissions
const PERMISSIONS = {
    owner: ['*'], // All permissions
    admin: ['view', 'edit', 'manage_projects', 'manage_licenses', 'manage_access', 'manage_team', 'view_logs'],
    editor: ['view', 'edit', 'manage_projects', 'manage_licenses', 'view_logs'],
    viewer: ['view', 'view_logs']
};

function hasPermission(permission) {
    const perms = PERMISSIONS[currentUserRole] || [];
    return perms.includes('*') || perms.includes(permission);
}

// Handle authentication errors - clear all auth data and redirect to login
function handleAuthError() {
    disconnectWorkspaceWebSocket({ allowReconnect: false });

    // Clear all auth-related localStorage items
    localStorage.removeItem('token');

    // Clear workspace-specific PIN tokens
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('pin_token_') || key.startsWith('pin_token_expires_'))) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));

    // Redirect to login
    window.location.href = '/login';
}

// Debounce/throttle helpers to prevent duplicate requests
const pendingRequests = new Map();

function debounce(func, wait, key) {
    return async function (...args) {
        if (pendingRequests.get(key)) {
            return; // Already processing
        }
        pendingRequests.set(key, true);
        try {
            await func.apply(this, args);
        } finally {
            setTimeout(() => pendingRequests.delete(key), wait);
        }
    };
}

function scheduleRealtimeRefresh(key, callback, delay = 300) {
    const activeTimer = realtimeRefreshTimers.get(key);
    if (activeTimer) clearTimeout(activeTimer);
    const nextTimer = setTimeout(async () => {
        realtimeRefreshTimers.delete(key);
        try {
            await callback();
        } catch (error) {
            console.error(`[realtime:${key}] refresh failed`, error);
        }
    }, delay);
    realtimeRefreshTimers.set(key, nextTimer);
}

function normalizeFileId(fileId) {
    return String(fileId ?? '');
}

function findProjectFileById(fileId) {
    const normalized = normalizeFileId(fileId);
    return projectFiles.find((file) => normalizeFileId(file.id) === normalized);
}

function findOpenTab(fileId) {
    const normalized = normalizeFileId(fileId);
    return openTabs.find((tab) => normalizeFileId(tab.fileId) === normalized);
}

function hasUnsavedTabs() {
    return openTabs.some((tab) => Boolean(tab.modified));
}

function updateTreeModifiedIndicator(fileId, modified) {
    const normalized = normalizeFileId(fileId);
    const treeNode = document.querySelector(`.file-tree-node[data-file-id="${normalized}"]`);
    if (!treeNode) return;

    const existingDot = treeNode.querySelector('.tree-modified-dot');
    if (modified && !existingDot) {
        const dot = document.createElement('span');
        dot.className = 'tree-modified-dot';
        const nameSpan = treeNode.querySelector('.file-node-name');
        if (nameSpan) nameSpan.after(dot);
    } else if (!modified && existingDot) {
        existingDot.remove();
    }
}

function setTabModifiedState(fileId, modified) {
    const tab = findOpenTab(fileId);
    if (!tab || tab.modified === modified) return;
    tab.modified = modified;
    renderTabs();
    updateTreeModifiedIndicator(fileId, modified);
}

function clearAutoSaveTimer(fileId) {
    const normalized = normalizeFileId(fileId);
    const timer = autoSaveTimers.get(normalized);
    if (timer) {
        clearTimeout(timer);
        autoSaveTimers.delete(normalized);
    }
}

function scheduleAutoSave(fileId) {
    const normalized = normalizeFileId(fileId);
    const tab = findOpenTab(normalized);
    if (!tab?.modified) return;

    clearAutoSaveTimer(normalized);
    const timer = setTimeout(async () => {
        autoSaveTimers.delete(normalized);
        if (autoSaveInFlight.has(normalized)) return;
        if (!findOpenTab(normalized)?.modified) return;

        autoSaveInFlight.add(normalized);
        const statusEl = document.getElementById('saveStatus');
        if (statusEl) statusEl.textContent = 'Autosaving...';
        const ok = await saveFileById(normalized, { silent: true });
        if (statusEl && findOpenTab(normalized)) {
            statusEl.textContent = ok ? 'Autosaved' : 'Autosave failed';
            setTimeout(() => {
                if (statusEl.textContent === 'Autosaved' || statusEl.textContent === 'Autosave failed') {
                    statusEl.textContent = '';
                }
            }, 1500);
        }
        autoSaveInFlight.delete(normalized);
    }, AUTOSAVE_DELAY_MS);

    autoSaveTimers.set(normalized, timer);
}

function rememberClosedTab(tab) {
    if (!tab?.fileId) return;
    closedTabHistory = closedTabHistory.filter((item) => normalizeFileId(item.fileId) !== normalizeFileId(tab.fileId));
    closedTabHistory.push({
        fileId: normalizeFileId(tab.fileId),
        name: tab.name,
        language: tab.language
    });
    if (closedTabHistory.length > TAB_HISTORY_LIMIT) {
        closedTabHistory = closedTabHistory.slice(-TAB_HISTORY_LIMIT);
    }
}

async function saveAllOpenTabs({ silent = false } = {}) {
    const dirtyTabs = openTabs.filter((tab) => tab.modified);
    if (!dirtyTabs.length) return true;

    let successCount = 0;
    for (const tab of dirtyTabs) {
        const ok = await saveFileById(tab.fileId, { silent: true });
        if (ok) successCount += 1;
    }

    const allSaved = successCount === dirtyTabs.length;
    if (!silent) {
        if (allSaved) showToast('Saved', `Saved ${successCount} file(s)`, 'success');
        else showToast('Warning', `Saved ${successCount}/${dirtyTabs.length} file(s)`, 'warning');
    }
    return allSaved;
}

function reopenLastClosedTab() {
    const last = closedTabHistory.pop();
    if (!last) {
        showToast('Info', 'No recently closed tab', 'info');
        return;
    }
    const file = findProjectFileById(last.fileId);
    if (!file || file.type !== 'file') {
        showToast('Info', 'Closed file is no longer available', 'info');
        return;
    }
    openFileInTab(last.fileId, file.name || last.name);
}

async function getWorkspaceWsEndpoint() {
    if (workspaceWsEndpoint !== null) return workspaceWsEndpoint;
    workspaceWsEndpoint = '';
    try {
        const res = await fetch('/api/ws/config', {
            headers: { 'Authorization': token }
        });
        const data = await res.json();
        if (data?.success && data.endpoint) {
            workspaceWsEndpoint = String(data.endpoint);
        }
    } catch (error) {
        workspaceWsEndpoint = null;
        console.warn('WebSocket endpoint config unavailable', error);
    }
    return workspaceWsEndpoint;
}

function buildWorkspaceWsUrl(endpoint) {
    if (!endpoint) return '';
    let normalized = String(endpoint).trim();
    if (!normalized) return '';
    if (normalized.startsWith('https://')) normalized = `wss://${normalized.slice(8)}`;
    if (normalized.startsWith('http://')) normalized = `ws://${normalized.slice(7)}`;
    if (!/^wss?:\/\//i.test(normalized)) return '';

    const url = new URL(normalized);
    url.searchParams.set('path', `/api/ws/logs/${workspaceIdentifier}`);
    url.searchParams.set('token', token);
    return url.toString();
}

function disconnectWorkspaceWebSocket({ allowReconnect = false } = {}) {
    workspaceWsShouldReconnect = allowReconnect;
    if (workspaceWsReconnectTimer) {
        clearTimeout(workspaceWsReconnectTimer);
        workspaceWsReconnectTimer = null;
    }
    if (!workspaceWs) return;
    const socket = workspaceWs;
    workspaceWs = null;
    socket.onclose = null;
    socket.onmessage = null;
    socket.onerror = null;
    try {
        socket.close(1000, 'client_closed');
    } catch {}
}

function scheduleWorkspaceWsReconnect() {
    if (!workspaceWsShouldReconnect || workspaceWsReconnectTimer) return;
    const delay = workspaceWsReconnectDelayMs;
    workspaceWsReconnectTimer = setTimeout(() => {
        workspaceWsReconnectTimer = null;
        connectWorkspaceWebSocket();
    }, delay);
    workspaceWsReconnectDelayMs = Math.min(delay * 2, 30000);
}

function prependLog(logEntry) {
    if (!logEntry) return;
    logs.unshift(logEntry);
    if (logs.length > 200) logs.length = 200;
    if (document.getElementById('view-logs')?.classList.contains('active')) {
        renderLogsList();
    }
    if (document.getElementById('view-overview')?.classList.contains('active')) {
        renderChart();
    }
}

async function refreshCurrentProjectFileTree() {
    if (!currentProjectKey) return;
    const project = projects.find((item) =>
        String(item.secret_key) === String(currentProjectKey) || String(item.id) === String(currentProjectKey)
    );
    if (!project?.id) return;

    try {
        await loadFileTree(project.id, { autoOpen: false, preserveTabs: true });
    } catch (error) {
        console.error('Failed to refresh file tree from realtime event', error);
    }
}

function handleWorkspaceWsMessage(raw) {
    let message = null;
    try {
        message = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
        return;
    }
    if (!message?.type) return;

    const data = message.data || {};
    switch (message.type) {
        case 'LOG':
            prependLog(data);
            break;
        case 'PROJECT_UPDATE':
            scheduleRealtimeRefresh('workspace-projects', async () => {
                await loadWorkspaceData();
                if (document.getElementById('view-overview')?.classList.contains('active')) {
                    await updateOverviewStats();
                }
            }, 250);
            break;
        case 'PROJECT_FILE_UPDATE':
            scheduleRealtimeRefresh('workspace-file-tree', refreshCurrentProjectFileTree, 250);
            break;
        case 'LICENSE_UPDATE':
            scheduleRealtimeRefresh('workspace-licenses', async () => {
                await loadLicenses(false, true);
                if (document.getElementById('view-overview')?.classList.contains('active')) {
                    await updateOverviewStats();
                }
            }, 300);
            break;
        case 'ACCESS_UPDATE':
            scheduleRealtimeRefresh('workspace-access', async () => {
                await loadAccessList(false, true);
                if (document.getElementById('view-overview')?.classList.contains('active')) {
                    await updateOverviewStats();
                }
            }, 300);
            break;
        case 'TEAM_UPDATE':
            if (document.getElementById('view-team')?.classList.contains('active')) {
                scheduleRealtimeRefresh('workspace-team', loadTeam, 250);
            }
            break;
        case 'SETTINGS_UPDATE':
            if (Object.prototype.hasOwnProperty.call(data, 'default_project_id')) {
                workspaceData.default_project_id = data.default_project_id;
            }
            if (Object.prototype.hasOwnProperty.call(data, 'discord_webhook')) {
                workspaceData.discord_webhook = data.discord_webhook;
            }
            if (document.getElementById('view-settings')?.classList.contains('active')) {
                loadSettings();
            }
            break;
        case 'LOGS_CLEARED':
            logs = [];
            if (document.getElementById('view-logs')?.classList.contains('active')) {
                renderLogsList();
            }
            if (document.getElementById('view-overview')?.classList.contains('active')) {
                renderChart();
            }
            break;
        default:
            break;
    }
}

async function connectWorkspaceWebSocket() {
    if (!workspaceIdentifier || !token) return;
    if (typeof checkPinRequired === 'function' && checkPinRequired()) return;

    if (workspaceWs && (workspaceWs.readyState === WebSocket.OPEN || workspaceWs.readyState === WebSocket.CONNECTING)) {
        return;
    }

    const endpoint = await getWorkspaceWsEndpoint();
    const wsUrl = buildWorkspaceWsUrl(endpoint);
    if (!wsUrl) {
        scheduleWorkspaceWsReconnect();
        return;
    }

    workspaceWsShouldReconnect = true;
    const socket = new WebSocket(wsUrl);
    workspaceWs = socket;

    socket.onopen = () => {
        workspaceWsReconnectDelayMs = 2000;
    };

    socket.onmessage = (event) => {
        handleWorkspaceWsMessage(event.data);
    };

    socket.onclose = () => {
        if (workspaceWs === socket) workspaceWs = null;
        scheduleWorkspaceWsReconnect();
    };

    socket.onerror = (error) => {
        console.error('Workspace WebSocket error', error);
    };
}

async function refreshWorkspaceData() {
    showToast('Refreshing', 'Syncing workspace data...', 'info', 1500);
    try {
        await loadWorkspaceData();
        await Promise.all([
            loadLicenses(false, true),
            loadAccessList(false, true),
            loadLogs(false, true)
        ]);
        if (document.getElementById('view-team')?.classList.contains('active')) {
            await loadTeam();
        }
        if (document.getElementById('view-overview')?.classList.contains('active')) {
            await updateOverviewStats();
        }
        showToast('Done', 'Workspace data refreshed', 'success');
    } catch (e) {
        showToast('Error', `Refresh failed: ${e.message}`, 'error');
    }
}

function renderLogsList() {
    const tbody = document.getElementById('logsList');
    if (logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="px-6 py-4 text-center text-gray-500">No logs found</td></tr>';
        return;
    }

    tbody.innerHTML = logs.map(l => {
        // Check if this log is very recent (e.g. < 2 seconds) to highlight
        const isNew = (new Date() - new Date(l.created_at)) < 2000;
        const rowClass = isNew ? 'hover:bg-[#27272a] transition-colors bg-indigo-500/10' : 'hover:bg-[#27272a] transition-colors';

        return `
        <tr class="${rowClass}">
            <td class="px-6 py-4 text-gray-500 text-xs">${new Date(l.created_at).toLocaleString()}</td>
            <td class="px-6 py-4 font-medium text-gray-300">${l.action}</td>
            <td class="px-6 py-4 text-gray-400">${l.details || '-'}</td>
            <td class="px-6 py-4 font-mono text-gray-400 text-xs">${l.ip || '-'}</td>
        </tr>
    `}).join('');
}

// Initialize Monaco
require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' } });
require(['vs/editor/editor.main'], function () {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    ensureMonacoThemes();
    editor = monaco.editor.create(document.getElementById('editor-container'), {
        value: '# Select a file to start editing',
        language: 'python',
        theme: isLight ? MONACO_THEME_LIGHT : MONACO_THEME_DARK,
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
        padding: { top: 20 }
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, function () {
        saveCurrentFile();
    });

    loadWorkspaceData();

    const applyInitialRouteFromUrl = () => {
        let view = validViews.includes(initialView) ? initialView : 'projects';

        // If accessing /editor with a project ID, open that project
        if (view === 'editor' && initialProjectId) {
            // Wait for projects to load, then open the specific project
            const waitForProjects = setInterval(() => {
                if (projects.length > 0) {
                    clearInterval(waitForProjects);
                    const script = projects.find(s => s.secret_key === initialProjectId || s.id === initialProjectId);
                    if (script) {
                        openProjectEditor(script.secret_key, false);
                    } else {
                        // Project not found, go to scripts view
                        switchView('projects', true);
                    }
                } else if (!isLoadingWorkspace) {
                    // Workspace loaded but there are no projects yet.
                    clearInterval(waitForProjects);
                    switchView('projects', true);
                }
            }, 100);
        } else if (view === 'editor') {
            // /editor without project ID - auto-select first available project
            const waitForProjects = setInterval(() => {
                if (projects.length > 0) {
                    clearInterval(waitForProjects);
                    openProjectEditor(projects[0].secret_key, false);
                } else if (!isLoadingWorkspace && projects.length === 0) {
                    // Loading finished but no projects exist
                    clearInterval(waitForProjects);
                    switchView('projects', true);
                }
            }, 100);
        } else {
            switchView(view, false); // false = don't push to history (already in URL)
        }
    };

    const waitForWorkspaceLoad = setInterval(() => {
        if (isLoadingWorkspace) return;
        clearInterval(waitForWorkspaceLoad);
        applyInitialRouteFromUrl();
    }, 50);
});

// Handle browser back/forward
window.addEventListener('popstate', (event) => {
    if (event.state && event.state.view) {
        if (event.state.view === 'editor' && event.state.projectId) {
            // Navigate to specific project
            openProjectEditor(event.state.projectId, false);
        } else {
            switchView(event.state.view, false);
        }
    }
});

function switchView(viewName, updateHistory = true) {
    // Validate view name - redirect editor to scripts for direct access
    if (!validViews.includes(viewName)) viewName = 'projects';

    // Smooth transition - fade out current, fade in new
    const currentActive = document.querySelector('.view-panel.active');
    const newPanel = document.getElementById(`view-${viewName}`);

    if (currentActive && currentActive !== newPanel) {
        currentActive.style.opacity = '0';
        setTimeout(() => {
            currentActive.classList.remove('active');
            currentActive.style.opacity = '';
            newPanel.classList.add('active');
            newPanel.style.opacity = '0';
            requestAnimationFrame(() => {
                newPanel.style.opacity = '1';
            });
        }, 150);
    } else {
        document.querySelectorAll('.view-panel').forEach(el => el.classList.remove('active'));
        newPanel.classList.add('active');
    }

    // Update nav highlighting
    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.remove('active', 'text-gray-200');
        el.classList.add('text-gray-400');
    });
    // For editor view, highlight scripts nav since editor is accessed from scripts
    const navId = viewName === 'editor' ? 'nav-projects' : `nav-${viewName}`;
    const activeNav = document.getElementById(navId);
    if (activeNav) {
        activeNav.classList.add('active', 'text-gray-200');
        activeNav.classList.remove('text-gray-400');
    }

    closeMobileSidebar();

    // Update URL without reload
    if (updateHistory) {
        const newUrl = `/workspace/${workspaceIdentifier}/${viewName}`;
        history.pushState({ view: viewName }, '', newUrl);
    }

    // Load data for the view
    if (viewName === 'projects') {
        renderProjectsGrid();
    }
    if (viewName === 'overview') {
        requestAnimationFrame(() => updateOverviewStats());
    }
    if (viewName === 'licenses') loadLicenses();
    if (viewName === 'access') loadAccessList();
    if (viewName === 'logs') loadLogs();
    if (viewName === 'team') loadTeam();
    if (viewName === 'settings') loadSettings();
}

function refreshActiveViewAfterWorkspaceLoad() {
    const activePanel = document.querySelector('.view-panel.active');
    if (!activePanel?.id) return;

    const viewName = activePanel.id.replace('view-', '');
    if (viewName === 'overview') {
        requestAnimationFrame(() => updateOverviewStats());
        return;
    }
    if (viewName === 'projects') {
        renderProjectsGrid();
        return;
    }
    if (viewName === 'licenses') {
        loadLicenses(false, true);
        return;
    }
    if (viewName === 'access') {
        loadAccessList(false, true);
        return;
    }
    if (viewName === 'logs') {
        loadLogs(false, true);
        return;
    }
    if (viewName === 'team') {
        loadTeam();
        return;
    }
    if (viewName === 'settings') {
        loadSettings();
    }
}

async function updateOverviewStats() {
    document.getElementById('stat-projects-count').textContent = projects.length;
    document.getElementById('stat-projects-active').textContent = `${projects.filter(s => s.is_active).length} Active`;

    // We might not have licenses/access loaded yet if we haven't visited those tabs
    // Load data in parallel
    const promises = [];

    if (licenses.length === 0) {
        promises.push(loadLicenses().then(() => {
            document.getElementById('stat-licenses-count').textContent = licenses.filter(l => l.is_active).length;
        }));
    } else {
        document.getElementById('stat-licenses-count').textContent = licenses.filter(l => l.is_active).length;
    }

    if (accessRules.length === 0) {
        promises.push(loadAccessList().then(() => {
            document.getElementById('stat-access-count').textContent = accessRules.length;
        }));
    } else {
        document.getElementById('stat-access-count').textContent = accessRules.length;
    }

    // Always refresh logs when opening overview so chart is up to date
    promises.push(loadLogs(false, true));

    // Wait for all data to load then render chart
    await Promise.all(promises);

    // Delay chart render slightly to ensure canvas is properly sized
    setTimeout(() => renderChart(), 100);
}

async function loadWorkspaceData() {
    // Prevent multiple simultaneous loads
    if (isLoadingWorkspace) {
        console.log('[loadWorkspaceData] Already loading, skipping');
        return;
    }
    isLoadingWorkspace = true;

    try {
        // Show loading state
        document.getElementById('workspaceName').textContent = 'Loading...';
        const projectsGridEl = document.getElementById('projectsGrid');
        if (projectsGridEl) projectsGridEl.innerHTML = '<div class="col-span-full text-center py-12 text-gray-500">Loading projects...</div>';

        // Get PIN token from localStorage if exists
        const pinToken = localStorage.getItem(`pin_token_${workspaceIdentifier}`);
        console.log('[loadWorkspaceData] workspaceIdentifier:', workspaceIdentifier);
        console.log('[loadWorkspaceData] pinToken from localStorage:', pinToken ? 'exists (' + pinToken.substring(0, 8) + '...)' : 'missing');

        const headers = { 'Authorization': token };
        if (pinToken) {
            headers['X-Pin-Token'] = pinToken;
        }

        const res = await fetch(`/api/workspaces/${workspaceIdentifier}`, { headers });

        // Handle expired/invalid token
        if (res.status === 401 || res.status === 403) {
            handleAuthError();
            return;
        }

        const data = await res.json();
        console.log('[loadWorkspaceData] response:', { success: data.success, requirePin: data.requirePin, projectsCount: data.projects?.length });

        if (!data.success) throw new Error(data.error);

        workspaceData = data.workspace;
        currentUserRole = data.userRole || currentUserRole || 'viewer';
        document.getElementById('workspaceName').textContent = data.workspace.name;
        document.getElementById('workspaceIdDisplay').textContent = `ID: ${data.workspace.loader_key}`;

        // Check if PIN verification is required
        if (data.requirePin && !pinVerified) {
            console.log('[loadWorkspaceData] PIN required, clearing UI and showing modal');
            disconnectWorkspaceWebSocket({ allowReconnect: false });
            projects = []; // Don't load scripts until PIN verified
            renderFileList(); // Clear the file list UI
            showPinVerifyModal();
            return; // Stop here, user needs to verify PIN
        }

        // Mark PIN as verified for this session
        pinVerified = true;

        // Hide PIN modal if it was showing
        document.getElementById('pinVerifyModal').style.display = 'none';
        connectWorkspaceWebSocket();

        projects = data.projects;

        // Projects are now decrypted and decompressed server-side

        // Store user role for permission checking
        currentUserRole = data.userRole || 'viewer';
        console.log('Current user role:', currentUserRole);

        renderFileList();
        renderProjectsGrid(); // Render projects in Project Manager view
        applyRolePermissions(); // Apply role-based UI restrictions

        // Preload other data in background for smoother navigation
        setTimeout(() => {
            Promise.all([
                loadLicenses(false),
                loadAccessList(false),
                loadLogs(false)
            ]).catch(() => { }); // Silently fail
        }, 500);

        // Route might already be active (deep-link refresh), so re-hydrate current view with fresh data.
        refreshActiveViewAfterWorkspaceLoad();

        // Don't override initial view from URL - it's set in Monaco init callback
    } catch (e) {
        disconnectWorkspaceWebSocket({ allowReconnect: false });
        showAlert('Error', 'Error loading workspace: ' + e.message);
        window.location.href = '/dashboard';
    } finally {
        isLoadingWorkspace = false;
    }
}

function renderChart() {
    // Count pass/fail from logs
    // Pass = successful execution actions (legacy + ECDH flow)
    const passLogs = logs.filter(l =>
        l.action === 'LOAD_SCRIPT' ||
        l.action === 'ECDH_HANDSHAKE'
    );
    const failLogs = logs.filter(l =>
        l.action.includes('BLOCK') ||
        l.action.includes('INVALID')
    );

    const passCount = passLogs.length;
    const failCount = failLogs.length;
    const total = passCount + failCount;
    const successRate = total > 0 ? Math.round((passCount / total) * 100) : 0;

    // Update stats - do this regardless of Chart.js
    const passEl = document.getElementById('passCount');
    const failEl = document.getElementById('failCount');
    const totalEl = document.getElementById('totalExecutions');
    const rateEl = document.getElementById('successRate');

    if (passEl) passEl.textContent = passCount;
    if (failEl) failEl.textContent = failCount;
    if (totalEl) totalEl.textContent = total;
    if (rateEl) rateEl.textContent = successRate + '%';

    // Render recent executions
    const recentContainer = document.getElementById('recentExecutions');
    if (recentContainer) {
        const recentLogs = logs.filter(l =>
            l.action === 'LOAD_SCRIPT' ||
            l.action === 'ECDH_HANDSHAKE' ||
            l.action.includes('BLOCK') ||
            l.action.includes('INVALID')
        ).slice(0, 5);

        if (recentLogs.length === 0) {
            recentContainer.innerHTML = '<div class="text-center text-gray-500 text-sm py-8">No executions yet</div>';
        } else {
            recentContainer.innerHTML = recentLogs.map(log => {
                const isSuccess = log.action === 'LOAD_SCRIPT' || log.action === 'ECDH_HANDSHAKE';
                const timeAgo = getTimeAgo(new Date(log.created_at));
                const actionName = isSuccess
                    ? (log.action === 'ECDH_HANDSHAKE' ? 'Loaded (ECDH)' : 'Loaded')
                    : log.action.replaceAll('_', ' ');
                return `
                    <div class="flex items-center justify-between py-2 px-3 rounded-lg bg-[#09090b]">
                        <div class="flex items-center gap-3">
                            <div class="w-8 h-8 rounded-lg ${isSuccess ? 'bg-emerald-500/10' : 'bg-rose-500/10'} flex items-center justify-center">
                                <i data-lucide="${isSuccess ? 'check' : 'x'}" class="w-4 h-4 ${isSuccess ? 'text-emerald-400' : 'text-rose-400'}"></i>
                            </div>
                            <div>
                                <div class="text-sm text-white">${actionName}</div>
                                <div class="text-xs text-gray-500">${log.ip || 'Unknown IP'}</div>
                            </div>
                        </div>
                        <span class="text-xs text-gray-500">${timeAgo}</span>
                    </div>
                `;
            }).join('');
            lucide.createIcons();
        }
    }

    // Render doughnut chart (only if Chart.js is available)
    const canvas = document.getElementById('executionChart');
    if (!canvas) return;

    // Use ChartJS (stored before Monaco loads) or Chart
    const ChartLib = window.ChartJS || window.Chart;

    // Wait for Chart.js to load (with timeout)
    if (!ChartLib) {
        if (!window._chartRetryCount) window._chartRetryCount = 0;
        window._chartRetryCount++;
        if (window._chartRetryCount < 50) { // Max 5 seconds
            setTimeout(renderChart, 100);
        }
        return;
    }

    const ctx = canvas.getContext('2d');

    // Destroy existing chart
    if (executionChart) executionChart.destroy();

    // Always show chart - gray if no data
    const chartData = total > 0 ? [passCount, failCount] : [1];
    const chartColors = total > 0 ? ['#10b981', '#f43f5e'] : ['#3f3f46'];

    executionChart = new ChartLib(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Passed', 'Failed'],
            datasets: [{
                data: chartData,
                backgroundColor: chartColors,
                borderWidth: 0,
                cutout: '70%'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false },
                tooltip: { enabled: total > 0 }
            }
        }
    });
}

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + 'm ago';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.floor(hours / 24);
    return days + 'd ago';
}

function renderFileList() {
    const container = document.getElementById('fileList');
    // fileList element was moved to Scripts Manager view, skip if not found
    if (!container) return;

    container.innerHTML = projects.map(s => {
        let statusColor = 'text-yellow-500';
        if (s.status === 'approved') statusColor = 'text-green-500';
        if (s.status === 'rejected') statusColor = 'text-red-500';

        const isActive = s.is_active !== 0;
        const activeClass = isActive ? 'text-green-400' : 'text-gray-600';
        const activeTitle = isActive ? 'Active (Click to Disable)' : 'Disabled (Click to Enable)';

        return `
        <div class="flex items-center justify-between px-3 py-2 rounded-md cursor-pointer text-sm text-gray-400 hover:bg-[#27272a] hover:text-white transition-colors ${s.secret_key === currentProjectKey ? 'bg-[#27272a] text-white' : ''}" onclick="selectFile('${s.secret_key}')">
            <div class="flex items-center gap-2 truncate flex-1">
                <i data-lucide="file" class="w-3 h-3"></i>
                <span>${escapeHtml(s.name)}</span>
            </div>
            <div class="flex items-center gap-2">
                <button onclick="event.stopPropagation(); toggleProjectActive('${s.secret_key}')" class="${activeClass} hover:text-white" title="${activeTitle}">
                    <i data-lucide="power" class="w-3 h-3"></i>
                </button>
                <button onclick="event.stopPropagation(); deleteProject('${s.secret_key}')" class="text-red-500 hover:text-red-400" title="Delete Project">
                    <i data-lucide="trash-2" class="w-3 h-3"></i>
                </button>
                <div class="w-2 h-2 rounded-full ${statusColor.replace('text-', 'bg-')}" title="${s.status}"></div>
            </div>
        </div>
    `}).join('');
    lucide.createIcons();
}

// ========== PROJECTS MANAGER VIEW FUNCTIONS ==========

function renderProjectsGrid() {
    const container = document.getElementById('projectsGrid');
    if (!container) return;

    const filteredProjects = getFilteredProjects();

    if (filteredProjects.length === 0) {
        container.innerHTML = `
            <div class="col-span-full flex flex-col items-center justify-center py-16">
                <div class="w-16 h-16 rounded-2xl bg-[#27272a] flex items-center justify-center mb-4">
                    <i data-lucide="folder-open" class="w-8 h-8 text-gray-600"></i>
                </div>
                <h3 class="text-lg font-medium text-white mb-2">No projects yet</h3>
                <p class="text-gray-500 text-sm mb-6">Create your first project to get started</p>
                <button onclick="openCreateProjectModal()" class="btn-primary text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
                    <i data-lucide="plus" class="w-4 h-4"></i> New Project
                </button>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    container.innerHTML = filteredProjects.map(s => {
        const isActive = s.is_active !== 0;
        const isDefault = workspaceData.default_project_id === s.id;

        // Status badge
        let statusBadge = '';
        if (s.status === 'approved') {
            statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Approved</span>';
        } else if (s.status === 'pending') {
            statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-medium bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">Pending</span>';
        } else if (s.status === 'rejected') {
            statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-medium bg-red-500/10 text-red-400 border border-red-500/20">Rejected</span>';
        }

        // Feature badges
        const features = [];
        if (s.require_license) features.push('<span class="text-[10px] text-emerald-400"><i data-lucide="key" class="w-3 h-3 inline"></i></span>');
        if (s.require_hwid) features.push('<span class="text-[10px] text-blue-400"><i data-lucide="cpu" class="w-3 h-3 inline"></i></span>');
        if (s.ip_whitelist_enabled) features.push('<span class="text-[10px] text-orange-400"><i data-lucide="globe" class="w-3 h-3 inline"></i></span>');

        return `
        <div class="project-card group relative">
            <!-- Card Header -->
            <div class="flex items-start justify-between mb-4">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl ${isActive ? 'bg-indigo-500/20 border-indigo-500/30' : 'bg-zinc-800 border-zinc-700'} border flex items-center justify-center">
                        <i data-lucide="file-code" class="w-5 h-5 ${isActive ? 'text-indigo-400' : 'text-gray-500'}"></i>
                    </div>
                    <div>
                        <h3 class="text-white font-medium text-sm flex items-center gap-2">
                            ${escapeHtml(s.name)}
                            ${isDefault ? '<i data-lucide="star" class="w-3 h-3 text-yellow-400" title="Default Project"></i>' : ''}
                        </h3>
                        <div class="flex items-center gap-2 mt-1">
                            ${statusBadge}
                            <span class="text-[10px] ${isActive ? 'text-emerald-400' : 'text-gray-500'}">${isActive ? '● Active' : '○ Inactive'}</span>
                        </div>
                    </div>
                </div>
                <div class="flex items-center gap-1">
                    ${features.join('')}
                </div>
            </div>
            
            <!-- Card Stats -->
            <div class="grid grid-cols-2 gap-3 mb-4">
                <div class="bg-[#09090b] rounded-lg p-3 border border-[#27272a]/50">
                    <div class="text-xs text-gray-500 mb-1">Executions</div>
                    <div class="text-lg font-semibold text-white">${s.execution_count || 0}</div>
                </div>
                <div class="bg-[#09090b] rounded-lg p-3 border border-[#27272a]/50">
                    <div class="text-xs text-gray-500 mb-1">Size</div>
                    <div class="text-lg font-semibold text-white">${formatBytes(s.content?.length || 0)}</div>
                </div>
            </div>
            
            <!-- Timestamps -->
            <div class="text-[11px] text-gray-500 mb-4">
                Created ${new Date(s.created_at).toLocaleDateString()}
                ${s.updated_at ? ` · Updated ${getTimeAgo(new Date(s.updated_at))}` : ''}
            </div>
            
            <!-- Card Actions -->
            <div class="flex items-center gap-2 pt-3 border-t border-[#27272a]/50">
                <button onclick="openProjectEditor('${s.secret_key}')" class="flex-1 flex items-center justify-center gap-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 py-2 rounded-lg text-xs font-medium transition-colors">
                    <i data-lucide="code-2" class="w-3.5 h-3.5"></i> Edit Code
                </button>
                <button onclick="event.stopPropagation(); toggleProjectActive('${s.secret_key}')" class="${isActive ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20' : 'bg-zinc-700/50 text-gray-400 hover:bg-zinc-700'} p-2 rounded-lg transition-colors" title="${isActive ? 'Disable' : 'Enable'}">
                    <i data-lucide="power" class="w-4 h-4"></i>
                </button>
                <button onclick="openProjectSettingsModal('${s.secret_key}')" class="bg-zinc-700/50 hover:bg-zinc-700 text-gray-400 p-2 rounded-lg transition-colors" title="Settings">
                    <i data-lucide="settings" class="w-4 h-4"></i>
                </button>
                <button onclick="event.stopPropagation(); deleteProject('${s.secret_key}')" class="bg-red-500/10 hover:bg-red-500/20 text-red-400 p-2 rounded-lg transition-colors" title="Delete">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
            </div>
        </div>
        `;
    }).join('');
    lucide.createIcons();
}

function getFilteredProjects() {
    const searchTerm = document.getElementById('projectsSearch')?.value?.toLowerCase() || '';
    const statusFilter = document.getElementById('projectsStatusFilter')?.value || 'all';

    return projects.filter(s => {
        // Search filter
        if (searchTerm && !s.name.toLowerCase().includes(searchTerm)) {
            return false;
        }

        // Status filter
        if (statusFilter !== 'all') {
            if (statusFilter === 'active' && !s.is_active) return false;
            if (statusFilter === 'inactive' && s.is_active) return false;
            if (['approved', 'pending', 'rejected'].includes(statusFilter) && s.status !== statusFilter) return false;
        }

        return true;
    });
}

function filterProjects() {
    renderProjectsGrid();
}

function openProjectEditor(secretKey, updateHistory = true) {
    selectFile(secretKey);
    switchView('editor', false); // Don't update history yet

    // Update URL with project ID for deep linking
    if (updateHistory) {
        const newUrl = `/workspace/${workspaceIdentifier}/editor/${secretKey}`;
        history.pushState({ view: 'editor', projectId: secretKey }, '', newUrl);
    }
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function openProjectSettingsModal(secretKey) {
    const script = projects.find(s => s.secret_key === secretKey);
    if (!script) return;

    // For now, just open the editor with settings panel visible
    openProjectEditor(secretKey);
    // Could expand to a dedicated settings modal in the future
}

async function toggleProjectActive(key) {
    // Prevent duplicate clicks
    if (pendingRequests.get(`toggle-active-${key}`)) return;
    pendingRequests.set(`toggle-active-${key}`, true);

    try {
        const res = await fetch(`/api/projects/${key}/toggle-active`, {
            method: 'POST',
            headers: { 'Authorization': token }
        });
        const data = await res.json();
        if (data.success) {
            const s = projects.find(s => s.secret_key === key);
            if (s) {
                s.is_active = data.is_active ? 1 : 0;
                if (s.secret_key === currentProjectKey) {
                    updateProjectInfoSidebar(s);
                }
            }
            renderFileList();
            renderProjectsGrid(); // Keep Project Manager in sync
            showToast('Success', `Script ${data.is_active ? 'enabled' : 'disabled'}`, 'success');
        } else {
            showToast('Error', data.error, 'error');
        }
    } catch (e) {
        showToast('Error', 'Error toggling project', 'error');
    } finally {
        setTimeout(() => pendingRequests.delete(`toggle-active-${key}`), 300);
    }
}

async function deleteProject(key) {
    showConfirm('Delete Project', 'Are you sure you want to delete this project? This cannot be undone.', async (confirmed) => {
        if (!confirmed) return;
        try {
            const res = await fetch(`/api/projects/${key}`, {
                method: 'DELETE',
                headers: { 'Authorization': token }
            });
            const data = await res.json();
            if (data.success) {
                // Update local state immediately
                projects = projects.filter(s => s.secret_key !== key);
                renderFileList();
                renderProjectsGrid(); // Keep Project Manager in sync

                // Clear editor if this was the selected project
                if (currentProjectKey === key) {
                    openTabs.forEach((tab) => {
                        clearAutoSaveTimer(tab.fileId);
                        const model = monacoModels.get(normalizeFileId(tab.fileId));
                        if (model) model.dispose();
                    });
                    openTabs = [];
                    monacoModels.clear();
                    fileContents.clear();
                    lastSavedContent.clear();
                    activeFileId = null;
                    renderTabs();

                    currentProjectKey = null;
                    editor.setValue('# Select a file to start editing');
                    document.getElementById('currentFileName').textContent = 'No file selected';
                    updateProjectInfoSidebar(null);

                    // Select another project if available
                    if (projects.length > 0) {
                        selectFile(projects[0].secret_key);
                    }
                }

                showAlert('Success', 'Project deleted successfully');
            } else {
                showAlert('Error', data.error);
            }
        } catch (e) {
            showAlert('Error', 'Error deleting project');
        }
    });
}

function deleteCurrentProject() {
    if (!currentProjectKey) {
        showAlert('Error', 'Please select a project first');
        return;
    }
    deleteProject(currentProjectKey);
}

async function setAsDefaultProject() {
    if (!currentProjectKey) {
        showAlert('Error', 'Please select a project first');
        return;
    }

    const script = projects.find(s => s.secret_key === currentProjectKey);
    if (!script) return;

    try {
        const res = await fetch(`/api/workspaces/${workspaceIdentifier}/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': token },
            body: JSON.stringify({ default_project_id: script.id })
        });
        const data = await res.json();
        if (data.success) {
            workspaceData.default_project_id = script.id;
            updateDefaultProjectButton();
            showAlert('Success', `"${script.name}" is now the default project`);
        } else {
            showAlert('Error', data.error);
        }
    } catch (e) {
        showAlert('Error', 'Error setting default project');
    }
}

function updateDefaultProjectButton() {
    const btn = document.getElementById('panel-set-default-btn');
    if (!btn) return;

    const script = projects.find(s => s.secret_key === currentProjectKey);
    if (script && workspaceData.default_project_id === script.id) {
        btn.textContent = 'Default ✓';
        btn.classList.add('is-default');
    } else {
        btn.textContent = 'Set Default';
        btn.classList.remove('is-default');
    }
}

// ========== BOTTOM SETTINGS PANEL FUNCTIONS ==========

function updateSettingsPanel(script) {
    // Update project name in header
    const nameEl = document.getElementById('settings-project-name');
    if (nameEl) {
        nameEl.textContent = script ? `- ${script.name}` : '';
    }

    // Update quick status indicators
    const quickStatus = document.getElementById('settings-quick-status');
    if (quickStatus) {
        if (script) {
            const isActive = script.is_active !== 0;
            const hasLicense = script.require_license === 1;
            const hasHwid = script.require_hwid === 1;
            quickStatus.innerHTML = `
                <span class="status-indicator ${isActive ? 'active' : 'inactive'}">
                    <i data-lucide="${isActive ? 'check-circle' : 'x-circle'}" class="w-3 h-3"></i>
                    ${isActive ? 'Active' : 'Inactive'}
                </span>
                ${hasLicense ? '<span class="status-indicator active"><i data-lucide="key" class="w-3 h-3"></i>License</span>' : ''}
                ${hasHwid ? '<span class="status-indicator active"><i data-lucide="cpu" class="w-3 h-3"></i>HWID</span>' : ''}
            `;
        } else {
            quickStatus.innerHTML = '';
        }
    }

    if (!script) {
        // Reset all checkboxes
        setCheckbox('panel-active-check', false);
        setCheckbox('panel-license-check', false);
        setCheckbox('panel-hwid-check', false);
        setCheckbox('panel-ip-check', false);
        setToggleDisabled('panel-hwid-check', true);
        const maxExec = document.getElementById('panel-max-exec');
        const rateLimit = document.getElementById('panel-rate-limit');
        const execCount = document.getElementById('panel-exec-count');
        if (maxExec) maxExec.value = '';
        if (rateLimit) rateLimit.value = '';
        if (execCount) execCount.textContent = '0';
        return;
    }

    // Update checkboxes based on project settings
    setCheckbox('panel-active-check', script.is_active !== 0);
    setCheckbox('panel-license-check', script.require_license === 1);
    setCheckbox('panel-hwid-check', script.require_hwid === 1);
    setCheckbox('panel-ip-check', script.ip_whitelist_enabled === 1);

    // HWID Lock depends on License being enabled
    const licenseEnabled = script.require_license === 1;
    setToggleDisabled('panel-hwid-check', !licenseEnabled);
    updateHwidSettingDesc(licenseEnabled);

    // If license is disabled, also disable HWID in local state
    if (!licenseEnabled && script.require_hwid === 1) {
        // HWID should be off if license is off
        setCheckbox('panel-hwid-check', false);
    }

    // Update limits
    const maxExec = document.getElementById('panel-max-exec');
    const rateLimit = document.getElementById('panel-rate-limit');
    const execCount = document.getElementById('panel-exec-count');
    if (maxExec) maxExec.value = script.max_executions || '';
    if (rateLimit) rateLimit.value = script.rate_limit || '';
    if (execCount) execCount.textContent = script.execution_count || '0';

    // Update default button
    updateDefaultProjectButton();

    lucide.createIcons();
}

function setToggleDisabled(id, disabled) {
    const checkbox = document.getElementById(id);
    if (checkbox) {
        checkbox.disabled = disabled;
        const settingItem = checkbox.closest('.setting-item');
        if (settingItem) {
            if (disabled) {
                settingItem.classList.add('disabled');
            } else {
                settingItem.classList.remove('disabled');
            }
        }
    }
}

function updateHwidSettingDesc(licenseEnabled) {
    const descEl = document.getElementById('hwid-setting-desc');
    if (descEl) {
        descEl.textContent = licenseEnabled ? 'Bind to hardware' : 'Requires License';
    }
}

function setCheckbox(id, isChecked) {
    const checkbox = document.getElementById(id);
    if (checkbox) {
        checkbox.checked = isChecked;
    }
}

async function toggleCurrentProjectActive() {
    if (!currentProjectKey) return;

    // Prevent duplicate clicks
    if (pendingRequests.get('toggle-current-active')) return;
    pendingRequests.set('toggle-current-active', true);

    try {
        const checkbox = document.getElementById('panel-active-check');
        const newValue = checkbox ? checkbox.checked : false;

        await toggleProjectActive(currentProjectKey);

        // Update checkbox to match actual state
        const script = projects.find(s => s.secret_key === currentProjectKey);
        if (script) {
            setCheckbox('panel-active-check', script.is_active !== 0);
            updateSettingsPanel(script);
        }
    } finally {
        setTimeout(() => pendingRequests.delete('toggle-current-active'), 300);
    }
}

async function toggleProjectRequireLicense() {
    if (!currentProjectKey) return;
    const script = projects.find(s => s.secret_key === currentProjectKey);
    if (!script) return;

    // Prevent duplicate clicks
    if (pendingRequests.get('toggle-license')) return;
    pendingRequests.set('toggle-license', true);

    const checkbox = document.getElementById('panel-license-check');
    const newValue = checkbox ? (checkbox.checked ? 1 : 0) : (script.require_license ? 0 : 1);

    // If turning off license, also turn off HWID
    const updatePayload = { require_license: newValue };
    if (newValue === 0 && script.require_hwid === 1) {
        updatePayload.require_hwid = 0;
    }

    try {
        const res = await fetch(`/api/projects/${currentProjectKey}/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': token },
            body: JSON.stringify(updatePayload)
        });
        const data = await res.json();
        if (data.success) {
            script.require_license = newValue;
            if (updatePayload.require_hwid === 0) {
                script.require_hwid = 0;
            }
            showToast('Success', `License requirement ${newValue ? 'enabled' : 'disabled'}`, 'success');
            updateSettingsPanel(script);
        } else {
            // Revert checkbox
            setCheckbox('panel-license-check', script.require_license === 1);
            showToast('Error', data.error, 'error');
        }
    } catch (e) {
        setCheckbox('panel-license-check', script.require_license === 1);
        showToast('Error', 'Error updating setting', 'error');
    } finally {
        setTimeout(() => pendingRequests.delete('toggle-license'), 300);
    }
}

async function toggleProjectHwidLock() {
    if (!currentProjectKey) return;
    const script = projects.find(s => s.secret_key === currentProjectKey);
    if (!script) return;

    // Check if license is enabled first
    if (script.require_license !== 1) {
        setCheckbox('panel-hwid-check', false);
        showToast('Warning', 'Enable License requirement first', 'warning');
        return;
    }

    // Prevent duplicate clicks
    if (pendingRequests.get('toggle-hwid')) return;
    pendingRequests.set('toggle-hwid', true);

    const checkbox = document.getElementById('panel-hwid-check');
    const newValue = checkbox ? (checkbox.checked ? 1 : 0) : (script.require_hwid ? 0 : 1);

    try {
        const res = await fetch(`/api/projects/${currentProjectKey}/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': token },
            body: JSON.stringify({ require_hwid: newValue })
        });
        const data = await res.json();
        if (data.success) {
            script.require_hwid = newValue;
            showToast('Success', `HWID lock ${newValue ? 'enabled' : 'disabled'}`, 'success');
            updateSettingsPanel(script);
        } else {
            setCheckbox('panel-hwid-check', script.require_hwid === 1);
            showToast('Error', data.error, 'error');
        }
    } catch (e) {
        setCheckbox('panel-hwid-check', script.require_hwid === 1);
        showToast('Error', 'Error updating setting', 'error');
    } finally {
        setTimeout(() => pendingRequests.delete('toggle-hwid'), 300);
    }
}

async function toggleProjectIpWhitelist() {
    if (!currentProjectKey) return;
    const script = projects.find(s => s.secret_key === currentProjectKey);
    if (!script) return;

    // Prevent duplicate clicks
    if (pendingRequests.get('toggle-ip')) return;
    pendingRequests.set('toggle-ip', true);

    const checkbox = document.getElementById('panel-ip-check');
    const newValue = checkbox ? (checkbox.checked ? 1 : 0) : (script.ip_whitelist_enabled ? 0 : 1);

    try {
        const res = await fetch(`/api/projects/${currentProjectKey}/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': token },
            body: JSON.stringify({ ip_whitelist_enabled: newValue })
        });
        const data = await res.json();
        if (data.success) {
            script.ip_whitelist_enabled = newValue;
            showToast('Success', `IP whitelist ${newValue ? 'enabled' : 'disabled'}`, 'success');
        } else {
            setCheckbox('panel-ip-check', script.ip_whitelist_enabled === 1);
            showToast('Error', data.error, 'error');
        }
    } catch (e) {
        setCheckbox('panel-ip-check', script.ip_whitelist_enabled === 1);
        showToast('Error', 'Error updating setting', 'error');
    } finally {
        setTimeout(() => pendingRequests.delete('toggle-ip'), 300);
    }
}

async function saveProjectMaxExec() {
    if (!currentProjectKey) return;
    const value = parseInt(document.getElementById('panel-max-exec').value) || null;

    try {
        const res = await fetch(`/api/projects/${currentProjectKey}/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': token },
            body: JSON.stringify({ max_executions: value })
        });
        const data = await res.json();
        if (data.success) {
            const script = projects.find(s => s.secret_key === currentProjectKey);
            if (script) script.max_executions = value;
            showToast('Success', 'Max executions saved', 'success');
        } else {
            showToast('Error', data.error, 'error');
        }
    } catch (e) {
        showToast('Error', 'Error saving setting', 'error');
    }
}

async function saveProjectRateLimit() {
    if (!currentProjectKey) return;
    const value = parseInt(document.getElementById('panel-rate-limit').value) || 30;

    try {
        const res = await fetch(`/api/projects/${currentProjectKey}/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': token },
            body: JSON.stringify({ rate_limit: value })
        });
        const data = await res.json();
        if (data.success) {
            const script = projects.find(s => s.secret_key === currentProjectKey);
            if (script) script.rate_limit = value;
            showToast('Success', 'Rate limit saved', 'success');
        } else {
            showToast('Error', data.error, 'error');
        }
    } catch (e) {
        showToast('Error', 'Error saving setting', 'error');
    }
}

async function resetProjectStats() {
    if (!currentProjectKey) return;

    showConfirm('Reset Statistics', 'Reset all execution statistics for this project?', async (confirmed) => {
        if (!confirmed) return;

        try {
            const res = await fetch(`/api/projects/${currentProjectKey}/reset-stats`, {
                method: 'POST',
                headers: { 'Authorization': token }
            });
            const data = await res.json();
            if (data.success) {
                // Update local project data
                const script = projects.find(s => s.secret_key === currentProjectKey);
                if (script) {
                    script.execution_count = 0;
                    const execCount = document.getElementById('panel-exec-count');
                    if (execCount) execCount.textContent = '0';
                }
                showToast('Success', 'Statistics reset successfully', 'success');
            } else {
                showToast('Error', data.error, 'error');
            }
        } catch (e) {
            showToast('Error', 'Error resetting stats', 'error');
        }
    });
}

function openProjectAdvancedSettings() {
    showAlert('Coming Soon', 'Advanced settings modal will include:\n\n• Custom obfuscation level\n• Webhook notifications\n• Execution logging\n• Geographic restrictions\n• Time-based access');
}

function selectFile(key) {
    const runSelect = () => {
        switchView('editor');
        const script = projects.find((item) => item.secret_key === key);
        if (!script) return;

        currentProjectKey = key;

        // Clear old tabs and models when switching projects
        openTabs.forEach((tab) => {
            const fileId = normalizeFileId(tab.fileId);
            clearAutoSaveTimer(fileId);
            const model = monacoModels.get(fileId);
            if (model) model.dispose();
        });
        openTabs = [];
        monacoModels.clear();
        fileContents.clear();
        lastSavedContent.clear();
        activeFileId = null;

        // Load file tree for this project
        loadFileTree(script.id, { autoOpen: true, preserveTabs: true });

        renderFileList();
        updateProjectInfoSidebar(script);
        updateSettingsPanel(script);
    };

    if (currentProjectKey && currentProjectKey !== key && hasUnsavedTabs()) {
        showConfirm(
            'Unsaved Changes',
            'Save all modified files before switching project? (Confirm = Save all, Cancel = switch without saving)',
            async (confirmed) => {
                if (confirmed) {
                    const allSaved = await saveAllOpenTabs({ silent: true });
                    if (!allSaved) {
                        showToast('Error', 'Some files failed to save. Project was not switched.', 'error');
                        return;
                    }
                }
                runSelect();
            }
        );
        return;
    }

    runSelect();
}

function updateProjectInfoSidebar(script) {
    if (!script) {
        document.getElementById('sidebar-project-name').textContent = 'No project selected';
        document.getElementById('sidebar-project-status').innerHTML = '-';
        document.getElementById('sidebar-project-active').textContent = '-';
        document.getElementById('sidebar-secret-key').textContent = '-';
        document.getElementById('sidebar-loader-url').textContent = '-';
        document.getElementById('sidebar-workspace-url').textContent = '-';
        document.getElementById('sidebar-created-at').textContent = '-';
        document.getElementById('sidebar-updated-at').textContent = '-';
        document.getElementById('sidebar-license-count').textContent = '0';
        document.getElementById('sidebar-content-size').textContent = '0 bytes';
        document.getElementById('sidebar-compressed-size').textContent = '0 bytes';
        document.getElementById('sidebar-compression-ratio').textContent = '-';
        return;
    }

    // Name
    document.getElementById('sidebar-project-name').textContent = script.name;

    // Status Badge
    const statusEl = document.getElementById('sidebar-project-status');
    const statusClass = script.status === 'approved' ? 'approved' : script.status === 'rejected' ? 'rejected' : 'pending';
    const statusIcon = script.status === 'approved' ? 'check-circle' : script.status === 'rejected' ? 'x-circle' : 'clock';
    statusEl.innerHTML = `<span class="status-badge ${statusClass}"><i data-lucide="${statusIcon}" class="w-3 h-3"></i>${script.status}</span>`;

    // Active Status
    const isActive = script.is_active !== 0;
    document.getElementById('sidebar-project-active').innerHTML = isActive
        ? '<span class="text-green-400 flex items-center gap-1"><i data-lucide="power" class="w-3 h-3"></i> Enabled</span>'
        : '<span class="text-gray-500 flex items-center gap-1"><i data-lucide="power-off" class="w-3 h-3"></i> Disabled</span>';

    // Keys & URLs
    const loaderExt = getLoaderExtensionByWorkspaceLanguage(workspaceData?.language);
    document.getElementById('sidebar-secret-key').textContent = script.secret_key;
    document.getElementById('sidebar-loader-url').textContent = `/files/${script.secret_key}.${loaderExt}`;
    document.getElementById('sidebar-workspace-url').textContent = workspaceData?.loader_key ? `/files/${workspaceData.loader_key}.${loaderExt}` : '-';

    // Timestamps
    const createdDate = new Date(script.created_at);
    const updatedDate = new Date(script.updated_at);
    document.getElementById('sidebar-created-at').textContent = createdDate.toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    document.getElementById('sidebar-updated-at').textContent = updatedDate.toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    // Statistics
    const projectLicenses = licenses.filter(l => l.script_id === script.id);
    document.getElementById('sidebar-license-count').textContent = projectLicenses.length;

    // Size statistics with compression info
    const originalSize = new Blob([script.content || '']).size;
    const compressedSize = script.compressed_size || originalSize;
    document.getElementById('sidebar-content-size').textContent = formatFileSize(originalSize);
    document.getElementById('sidebar-compressed-size').textContent = formatFileSize(compressedSize);

    // Compression ratio
    if (compressedSize > 0 && compressedSize < originalSize) {
        const saved = ((1 - compressedSize / originalSize) * 100).toFixed(1);
        document.getElementById('sidebar-compression-ratio').textContent = `${saved}% saved`;
    } else {
        document.getElementById('sidebar-compression-ratio').textContent = '-';
    }

    // Update default button state
    updateDefaultProjectButton();

    lucide.createIcons();
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 bytes';
    const k = 1024;
    const sizes = ['bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getLoaderExtensionByWorkspaceLanguage(language) {
    const lang = String(language || 'python').toLowerCase();
    if (lang === 'node' || lang === 'nodejs' || lang === 'javascript' || lang === 'javascript_nodejs' || lang === 'userscript') {
        return 'js';
    }
    if (lang === 'lua') {
        return 'lua';
    }
    return 'py';
}

async function saveCurrentFile() {
    // If we have an active file in tabs, save that via the file API
    if (activeFileId) {
        const statusEl = document.getElementById('saveStatus');
        statusEl.textContent = 'Saving...';
        const ok = await saveFileById(activeFileId);
        if (ok) {
            statusEl.textContent = 'Saved';
            setTimeout(() => statusEl.textContent = '', 3000);
        } else {
            statusEl.textContent = 'Error';
        }
        return;
    }

    // Fallback to old single-file save behavior (legacy, when no file explorer tabs)
    if (!currentProjectKey) {
        showAlert('Error', 'Please select a file to save!');
        return;
    }
    const content = editor.getValue();
    const statusEl = document.getElementById('saveStatus');
    statusEl.textContent = 'Saving...';

    try {
        const res = await fetch(`/api/projects/${currentProjectKey}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': token },
            body: JSON.stringify({ content })
        });
        const data = await res.json();
        if (data.success) {
            statusEl.textContent = `Saved (${data.status})`;
            const s = projects.find(s => s.secret_key === currentProjectKey);
            if (s) {
                s.content = content;
                s.status = data.status;
                s.updated_at = new Date().toISOString();
                if (data.compressed_size) {
                    s.compressed_size = data.compressed_size;
                    s.is_gzipped = 1;
                }
                updateProjectInfoSidebar(s);
            }
            renderFileList();
            renderProjectsGrid();
            setTimeout(() => statusEl.textContent = '', 3000);
        } else {
            statusEl.textContent = 'Error';
            showAlert('Error', data.error);
        }
    } catch (e) {
        statusEl.textContent = 'Error';
        showAlert('Error', 'Connection error');
    }
}

// --- Project Management ---
function openCreateProjectModal() {
    document.getElementById('createProjectModal').style.display = 'flex';
    document.getElementById('newProjectName').focus();
}

async function createProject() {
    const nameInput = document.getElementById('newProjectName');
    const name = nameInput.value.trim();
    if (!name) {
        showToast('Error', 'Please enter a project name', 'error');
        return;
    }

    // Prevent duplicate submissions
    const createBtn = document.querySelector('#createProjectModal button[onclick="createProject()"]');
    if (createBtn.disabled) return;
    createBtn.disabled = true;
    createBtn.textContent = 'Creating...';

    try {
        console.log('[createProject] Sending request...');
        const res = await fetch(`/api/workspaces/${workspaceIdentifier}/projects`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': token },
            body: JSON.stringify({ name, content: '# New project' })
        });
        console.log('[createProject] Response status:', res.status);
        const data = await res.json();
        console.log('[createProject] Response data:', data);

        // Close modal first
        document.getElementById('createProjectModal').style.display = 'none';
        nameInput.value = '';

        if (data.success) {
            console.log('[createProject] Success, checking if exists...');
            // Check if project already exists in local state
            const exists = projects.find(s => s.secret_key === data.secret_key);
            if (!exists) {
                console.log('[createProject] Adding new project to list...');
                const newProject = {
                    id: data.id,
                    name: name,
                    secret_key: data.secret_key,
                    status: data.status,
                    is_active: 1,
                    content: '# New project',
                    require_license: 0,
                    require_hwid: 0,
                    ip_whitelist_enabled: 0,
                    execution_count: 0,
                    created_at: new Date().toISOString()
                };
                projects.push(newProject);
                renderFileList();
                renderProjectsGrid(); // Update Project Manager view
            }

            console.log('[createProject] Selecting file:', data.secret_key);
            // Auto-select the new project
            selectFile(data.secret_key);
            showToast('Success', 'Project created successfully', 'success');
            console.log('[createProject] Complete!');
        } else {
            showToast('Error', data.error || 'Failed to create project', 'error');
        }
    } catch (e) {
        console.error('[createProject] ERROR:', e.message, e.stack);
        showToast('Error', 'Failed to create project: ' + e.message, 'error');
    } finally {
        createBtn.disabled = false;
        createBtn.textContent = 'Create';
    }
}

// --- License Management ---
function openCreateLicenseModal() {
    const select = document.getElementById('licProjectId');
    select.innerHTML = '<option value="">-- All Projects (Workspace Wide) --</option>' +
        projects.map(s => `<option value="${s.secret_key}">${escapeHtml(s.name)}</option>`).join('');
    document.getElementById('licCount').value = 1;
    document.getElementById('createLicenseModal').style.display = 'flex';
}

async function loadLicenses(showLoading = true, forceReload = false) {
    const tbody = document.getElementById('licenseList');
    if (forceReload || licenses.length === 0) {
        if (showLoading) {
            tbody.innerHTML = '<tr><td colspan="8" class="px-6 py-4 text-center text-gray-500">Loading...</td></tr>';
        }
        try {
            const res = await fetch(`/api/workspaces/${workspaceIdentifier}/licenses`, { headers: { 'Authorization': token } });
            const data = await res.json();
            if (data.success) {
                licenses = data.licenses;
                if (showLoading || document.getElementById('view-licenses').classList.contains('active')) {
                    renderLicenseList();
                }
            } else if (showLoading) {
                tbody.innerHTML = '<tr><td colspan="8" class="px-6 py-4 text-center text-red-500">Failed to load licenses</td></tr>';
            }
        } catch (e) {
            if (showLoading) {
                tbody.innerHTML = `<tr><td colspan="8" class="px-6 py-4 text-center text-red-500">Error: ${escapeHtml(e.message)}</td></tr>`;
            }
        }
    } else if (showLoading) {
        renderLicenseList();
    }
    return licenses;
}

// renderLicenseList is defined at the bottom with pagination and filtering support

let currentLicenseId = null;

function openLicenseInfo(id) {
    const l = licenses.find(x => x.id === id);
    if (!l) return;
    currentLicenseId = id;

    document.getElementById('infoLicKey').textContent = l.key;
    document.getElementById('infoLicStatus').textContent = l.is_active ? 'Active' : 'Inactive';
    document.getElementById('infoLicStatus').className = `text-sm font-medium ${l.is_active ? 'text-green-500' : 'text-red-500'}`;
    document.getElementById('infoLicUsage').textContent = l.usage_count || 0;
    document.getElementById('infoLicHwid').textContent = l.activated_hwid || 'Not Bound';
    document.getElementById('infoLicOs').textContent = l.activated_os || '-';
    document.getElementById('infoLicLastUsed').textContent = l.last_used_at ? new Date(l.last_used_at).toLocaleString() : 'Never';

    const isLocked = l.hwid_lock !== 0; // Default to true if undefined or 1
    const lockStatusEl = document.getElementById('infoLicLockStatus');
    const btnToggle = document.getElementById('btnToggleLock');

    lockStatusEl.textContent = isLocked ? 'Locked' : 'Unlocked';
    lockStatusEl.className = `text-sm ${isLocked ? 'text-green-500' : 'text-yellow-500'}`;

    btnToggle.textContent = isLocked ? 'Unlock' : 'Lock';
    btnToggle.className = `text-xs px-2 py-1 rounded border transition-colors ${isLocked ? 'border-yellow-500/50 text-yellow-500 hover:bg-yellow-500/10' : 'border-green-500/50 text-green-500 hover:bg-green-500/10'}`;

    document.getElementById('licenseInfoModal').style.display = 'flex';
}

async function toggleHwidLock() {
    if (!currentLicenseId) return;
    try {
        const res = await fetch(`/api/licenses/${currentLicenseId}/toggle-lock`, {
            method: 'POST',
            headers: { 'Authorization': token }
        });
        const data = await res.json();
        if (data.success) {
            // Update local state
            const l = licenses.find(x => x.id === currentLicenseId);
            if (l) l.hwid_lock = data.hwid_lock;
            openLicenseInfo(currentLicenseId); // Refresh modal
            showAlert('Success', `HWID Lock ${data.hwid_lock ? 'Enabled' : 'Disabled'}`);
        } else {
            showAlert('Error', data.error);
        }
    } catch (e) {
        showAlert('Error', 'Error toggling lock');
    }
}

async function resetHwid() {
    if (!currentLicenseId) return;
    showConfirm('Reset HWID', 'Are you sure you want to reset the HWID binding for this license?', async (confirmed) => {
        if (!confirmed) return;
        try {
            const res = await fetch(`/api/licenses/${currentLicenseId}/reset-hwid`, {
                method: 'POST',
                headers: { 'Authorization': token }
            });
            const data = await res.json();
            if (data.success) {
                const l = licenses.find(x => x.id === currentLicenseId);
                if (l) l.activated_hwid = null;
                openLicenseInfo(currentLicenseId);
                showAlert('Success', 'HWID binding reset successfully');
            } else {
                showAlert('Error', data.error);
            }
        } catch (e) {
            showAlert('Error', 'Error resetting HWID');
        }
    });
}

function toggleLicenseKeyMode() {
    const mode = document.querySelector('input[name="licKeyMode"]:checked').value;
    const autoOptions = document.getElementById('licAutoOptions');
    const customOptions = document.getElementById('licCustomOptions');

    if (mode === 'custom') {
        autoOptions.classList.add('hidden');
        customOptions.classList.remove('hidden');
    } else {
        autoOptions.classList.remove('hidden');
        customOptions.classList.add('hidden');
    }
}

async function createLicense() {
    const note = document.getElementById('licNote').value;
    const expiration = document.getElementById('licExp').value;
    const projectKey = document.getElementById('licProjectId').value;
    const mode = document.querySelector('input[name="licKeyMode"]:checked')?.value || 'auto';

    try {
        let res, data;

        if (mode === 'custom') {
            // Custom key mode
            const customKey = document.getElementById('licCustomKey').value.trim();
            if (!customKey) {
                showAlert('Error', 'Please enter a custom license key');
                return;
            }

            // Validate custom key (alphanumeric, -, _)
            if (!/^[\w-]+$/.test(customKey)) {
                showAlert('Error', 'Custom key can only contain letters, numbers, hyphens and underscores');
                return;
            }

            res = await fetch(`/api/workspaces/${workspaceIdentifier}/licenses`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': token },
                body: JSON.stringify({
                    note,
                    expiration_date: expiration,
                    script_id: projectKey || null,
                    custom_key: customKey
                })
            });
            data = await res.json();
            if (data.success) {
                document.getElementById('createLicenseModal').style.display = 'none';
                document.getElementById('licNote').value = '';
                document.getElementById('licCustomKey').value = '';
                licenses = [];
                loadLicenses();
                showAlert('Success', `License created: ${data.key}`);
            }
        } else {
            // Auto generate mode
            const count = parseInt(document.getElementById('licCount').value) || 1;
            const prefix = document.getElementById('licPrefix')?.value || '';
            const suffix = document.getElementById('licSuffix')?.value || '';

            if (count > 1) {
                // Batch create
                res = await fetch(`/api/workspaces/${workspaceIdentifier}/licenses/batch`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': token },
                    body: JSON.stringify({
                        note,
                        expiration_date: expiration,
                        script_id: projectKey || null,
                        count: Math.min(count, 100),
                        prefix,
                        suffix
                    })
                });
                data = await res.json();
                if (data.success) {
                    document.getElementById('createLicenseModal').style.display = 'none';
                    document.getElementById('licNote').value = '';
                    document.getElementById('licCount').value = '1';
                    if (document.getElementById('licPrefix')) document.getElementById('licPrefix').value = '';
                    if (document.getElementById('licSuffix')) document.getElementById('licSuffix').value = '';
                    licenses = [];
                    loadLicenses();

                    // Show created keys
                    const keys = data.licenses.map(l => l.key).join('\n');
                    showAlert('Success', `Created ${data.count} licenses:\n\n${keys}`);
                }
            } else {
                // Single create
                res = await fetch(`/api/workspaces/${workspaceIdentifier}/licenses`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': token },
                    body: JSON.stringify({
                        note,
                        expiration_date: expiration,
                        script_id: projectKey || null,
                        prefix,
                        suffix
                    })
                });
                data = await res.json();
                if (data.success) {
                    document.getElementById('createLicenseModal').style.display = 'none';
                    document.getElementById('licNote').value = '';
                    document.getElementById('licCount').value = '1';
                    if (document.getElementById('licPrefix')) document.getElementById('licPrefix').value = '';
                    if (document.getElementById('licSuffix')) document.getElementById('licSuffix').value = '';
                    licenses = [];
                    loadLicenses();
                    showAlert('Success', `License created: ${data.key}`);
                }
            }
        }

        if (!data.success) {
            showAlert('Error', data.error);
        }
    } catch (e) {
        showAlert('Error', 'Error creating license');
    }
}

async function exportLicenses() {
    try {
        await downloadWithAuth(
            `/api/workspaces/${workspaceIdentifier}/licenses/export`,
            `licenses_${workspaceIdentifier}.csv`
        );
    } catch (e) {
        showAlert('Error', e.message || 'Failed to export licenses');
    }
}

async function deleteLicense(id) {
    showConfirm('Delete License', 'Are you sure you want to delete this license?', async (confirmed) => {
        if (!confirmed) return;
        try {
            const res = await fetch(`/api/licenses/${id}`, { method: 'DELETE', headers: { 'Authorization': token } });
            const data = await res.json();
            if (data.success) {
                // Update local state immediately
                licenses = licenses.filter(l => l.id !== id);
                renderLicenseList();

                // Close info modal if open for this license
                if (currentLicenseId === id) {
                    document.getElementById('licenseInfoModal').style.display = 'none';
                    currentLicenseId = null;
                }
            } else {
                showAlert('Error', data.error || 'Failed to delete license');
            }
        } catch (e) {
            showAlert('Error', 'Error deleting license');
        }
    });
}

// --- Access Control Management ---
function openAddAccessModal() {
    document.getElementById('addAccessModal').style.display = 'flex';
}

async function loadAccessList(showLoading = true, forceReload = false) {
    const tbody = document.getElementById('accessList');
    if (forceReload || accessRules.length === 0) {
        if (showLoading) {
            tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-gray-500">Loading...</td></tr>';
        }
        try {
            const res = await fetch(`/api/workspaces/${workspaceIdentifier}/access-lists`, { headers: { 'Authorization': token } });
            const data = await res.json();
            if (data.success) {
                accessRules = data.items;
                if (showLoading || document.getElementById('view-access').classList.contains('active')) {
                    renderAccessList();
                }
            } else if (showLoading) {
                tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-red-500">Failed to load rules</td></tr>';
            }
        } catch (e) {
            if (showLoading) {
                tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-4 text-center text-red-500">Error: ${escapeHtml(e.message)}</td></tr>`;
            }
        }
    } else if (showLoading) {
        renderAccessList();
    }
}

function renderAccessList() {
    const tbody = document.getElementById('accessList');
    if (accessRules.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-gray-500">No rules found</td></tr>';
        return;
    }
    tbody.innerHTML = accessRules.map(i => {
        const typeClass = i.type === 'whitelist' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500';
        return `
        <tr class="hover:bg-[#27272a] transition-colors">
            <td class="px-6 py-4"><span class="px-2 py-1 rounded text-xs font-medium ${typeClass}">${i.type.toUpperCase()}</span></td>
            <td class="px-6 py-4 font-mono text-gray-300">${escapeHtml(i.identifier)}</td>
            <td class="px-6 py-4 text-gray-400">${escapeHtml(i.note || '-')}</td>
            <td class="px-6 py-4 text-gray-500 text-xs">${new Date(i.created_at).toLocaleDateString()}</td>
            <td class="px-6 py-4 text-right">
                <button onclick="deleteAccessRule(${i.id})" class="text-red-500 hover:text-red-400 text-xs font-medium">Delete</button>
            </td>
        </tr>
    `}).join('');
}

async function addAccessRule() {
    const type = document.getElementById('accessType').value;
    const identifier = document.getElementById('accessId').value;
    const note = document.getElementById('accessNote').value;

    if (!identifier) return showAlert('Error', 'Identifier required');

    try {
        const res = await fetch(`/api/workspaces/${workspaceIdentifier}/access-lists`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': token },
            body: JSON.stringify({ type, identifier, note })
        });
        const data = await res.json();
        if (data.success) {
            document.getElementById('addAccessModal').style.display = 'none';
            document.getElementById('accessId').value = '';
            document.getElementById('accessNote').value = '';
            loadAccessList(true, true);
            showAlert('Success', 'Access rule added successfully');
        } else {
            showAlert('Error', data.error);
        }
    } catch (e) {
        showAlert('Error', 'Error adding rule');
    }
}

async function deleteAccessRule(id) {
    showConfirm('Delete Rule', 'Are you sure you want to delete this access rule?', async (confirmed) => {
        if (!confirmed) return;
        try {
            const res = await fetch(`/api/access-lists/${id}`, { method: 'DELETE', headers: { 'Authorization': token } });
            const data = await res.json();
            if (data.success) {
                // Update local state immediately
                accessRules = accessRules.filter(r => r.id !== id);
                renderAccessList();
            } else {
                showAlert('Error', data.error || 'Failed to delete rule');
            }
        } catch (e) { showAlert('Error', 'Error deleting rule'); }
    });
}

// --- Logs ---
async function loadLogs(showLoading = true, forceReload = false) {
    const tbody = document.getElementById('logsList');
    if (forceReload || logs.length === 0) {
        // Only update tbody if showing loading and element exists
        if (showLoading && tbody) {
            tbody.innerHTML = '<tr><td colspan="4" class="px-6 py-4 text-center text-gray-500">Loading...</td></tr>';
        }
        try {
            const res = await fetch(`/api/workspaces/${workspaceIdentifier}/logs`, { headers: { 'Authorization': token } });
            const data = await res.json();
            if (data.success) {
                logs = data.logs;
                if (showLoading || document.getElementById('view-logs').classList.contains('active')) {
                    if (tbody) renderLogsList();
                }
                return logs;
            }
        } catch (e) {
            if (showLoading && tbody) {
                tbody.innerHTML = `<tr><td colspan="4" class="px-6 py-4 text-center text-red-500">Error: ${escapeHtml(e.message)}</td></tr>`;
            }
            console.error('Error loading logs:', e);
        }
    } else {
        if (showLoading && tbody) renderLogsList();
    }
    return logs;
}

// --- Settings ---
function loadSettings() {
    document.getElementById('wsLoaderKey').value = workspaceData.loader_key || 'Not generated yet';
    document.getElementById('discordWebhook').value = workspaceData.discord_webhook || '';

    const select = document.getElementById('defaultProjectSelect');
    select.innerHTML = '<option value="">-- None --</option>' +
        projects.map(s => `<option value="${s.secret_key}" ${s.id === workspaceData.default_project_id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
}

async function saveSettings() {
    const projectKey = document.getElementById('defaultProjectSelect').value;
    const webhook = document.getElementById('discordWebhook').value;

    try {
        const res = await fetch(`/api/workspaces/${workspaceIdentifier}/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': token },
            body: JSON.stringify({
                default_project_id: projectKey || null,
                discord_webhook: webhook || null
            })
        });

        const data = await res.json();
        if (!data.success) {
            showAlert('Error', data.error || 'Error updating settings');
            return;
        }

        workspaceData.default_project_id = projectKey || null;
        workspaceData.discord_webhook = webhook || null;
        showAlert('Success', 'Settings saved successfully');

        if (!workspaceWs || workspaceWs.readyState !== WebSocket.OPEN) {
            await loadWorkspaceData();
        }
    } catch (e) {
        showAlert('Error', 'Error updating settings');
    }
}

async function deleteWorkspace() {
    showPrompt('Delete Workspace', `To confirm deletion, please type the workspace name: "${workspaceData.name}"`, async (confirmName) => {
        if (confirmName !== workspaceData.name) {
            if (confirmName !== null) showAlert('Error', 'Workspace name does not match.');
            return;
        }

        try {
            const res = await fetch(`/api/workspaces/${workspaceIdentifier}`, {
                method: 'DELETE',
                headers: { 'Authorization': token }
            });
            const data = await res.json();
            if (data.success) {
                showAlert('Success', 'Workspace deleted successfully.');
                setTimeout(() => window.location.href = '/dashboard', 1500);
            } else {
                showAlert('Error', 'Error: ' + data.error);
            }
        } catch (e) {
            showAlert('Error', 'Error deleting workspace');
        }
    });
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text);
    showToast('Copied!', 'Text copied to clipboard', 'success');
}

async function downloadWithAuth(url, fallbackFilename) {
    const res = await fetch(url, {
        headers: { 'Authorization': token }
    });

    if (!res.ok) {
        let message = 'Download failed';
        try {
            const data = await res.json();
            if (data?.error) message = data.error;
        } catch {}
        throw new Error(message);
    }

    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') || '';
    const quoted = cd.match(/filename=\"([^\"]+)\"/i);
    const plain = cd.match(/filename=([^;]+)/i);
    const filename = quoted?.[1] || plain?.[1]?.trim() || fallbackFilename || 'download.bin';

    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
}

// --- Loader ---
function showLoaderCode() {
    const host = window.location.origin;
    const key = workspaceData.loader_key || 'MISSING_KEY';
    const lang = (workspaceData.language || 'python').toLowerCase();

    let code = '';
    if (lang === 'python') {
        code = `# IrisAuth Loader v4
LicenseKey = ""  # Optional - delete if not needed
exec(__import__('urllib.request',fromlist=['urlopen']).urlopen("${host}/files/${key}.py").read())`;
    } else if (lang === 'lua') {
        code = `-- IrisAuth Loader v4 (Roblox)
getgenv().LicenseKey = "..."
loadstring(game:HttpGet("${host}/files/${key}.lua"))()`;
    } else if (lang === 'node' || lang === 'nodejs' || lang === 'javascript' || lang === 'javascript_nodejs' || lang === 'userscript') {
        code = `// IrisAuth Loader v4
globalThis.LicenseKey = "";  // Optional - delete if not needed
import('https').then(m=>m.get("${host}/files/${key}.js",r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>eval(d))}));`;
    } else {
        code = `# IrisAuth Loader (${lang}) - Template not available
# Supported: Python, Node.js, Lua
LicenseKey = ""`;
    }

    document.getElementById('loaderCode').value = code;
    document.getElementById('loaderModal').style.display = 'flex';
}

function copyLoaderCode() {
    const el = document.getElementById('loaderCode');
    el.select();
    document.execCommand('copy');
    showToast('Copied!', 'Loader code copied to clipboard', 'success');
}

// ============================================
// VS CODE FILE EXPLORER
// ============================================

// --- File Icon Mapping ---
function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const iconMap = {
        py: { icon: 'file-code', color: 'text-blue-400' },
        js: { icon: 'file-code', color: 'text-yellow-400' },
        ts: { icon: 'file-code', color: 'text-blue-300' },
        jsx: { icon: 'file-code', color: 'text-cyan-400' },
        tsx: { icon: 'file-code', color: 'text-cyan-300' },
        lua: { icon: 'file-code', color: 'text-indigo-400' },
        json: { icon: 'braces', color: 'text-yellow-300' },
        html: { icon: 'file-code', color: 'text-orange-400' },
        css: { icon: 'file-code', color: 'text-purple-400' },
        md: { icon: 'file-text', color: 'text-gray-300' },
        txt: { icon: 'file-text', color: 'text-gray-400' },
        yml: { icon: 'file-cog', color: 'text-pink-400' },
        yaml: { icon: 'file-cog', color: 'text-pink-400' },
        toml: { icon: 'file-cog', color: 'text-orange-300' },
        cfg: { icon: 'file-cog', color: 'text-gray-400' },
        ini: { icon: 'file-cog', color: 'text-gray-400' },
        sh: { icon: 'terminal', color: 'text-green-400' },
        bat: { icon: 'terminal', color: 'text-green-300' },
        sql: { icon: 'database', color: 'text-blue-300' },
        env: { icon: 'file-lock-2', color: 'text-yellow-500' },
    };
    return iconMap[ext] || { icon: 'file', color: 'text-gray-400' };
}

function detectLanguage(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const langMap = {
        py: 'python', js: 'javascript', ts: 'typescript', jsx: 'javascript',
        tsx: 'typescript', lua: 'lua', json: 'json', html: 'html', css: 'css',
        md: 'markdown', txt: 'plaintext', yml: 'yaml', yaml: 'yaml',
        toml: 'ini', cfg: 'ini', ini: 'ini', sh: 'shell', bat: 'bat',
        sql: 'sql', xml: 'xml', java: 'java', c: 'c', cpp: 'cpp',
        h: 'c', rb: 'ruby', go: 'go', rs: 'rust', php: 'php',
    };
    return langMap[ext] || 'plaintext';
}

// --- Build tree from flat array ---
function buildFileTree(files) {
    const map = new Map();
    const roots = [];
    files.forEach(f => map.set(f.id, { ...f, children: [] }));
    files.forEach(f => {
        const node = map.get(f.id);
        if (f.parent_id && map.has(f.parent_id)) {
            map.get(f.parent_id).children.push(node);
        } else {
            roots.push(node);
        }
    });
    // Sort: folders first, then alphabetically
    function sortChildren(nodes) {
        nodes.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        nodes.forEach(n => { if (n.children.length) sortChildren(n.children); });
    }
    sortChildren(roots);
    return roots;
}

// --- Render file tree into DOM ---
let _rootDropBound = false;
function renderFileTree(nodes, container, depth = 0) {
    if (!nodes) nodes = fileTree;
    if (!container) container = document.getElementById('file-tree-container');
    if (!container) return;

    if (depth === 0) container.innerHTML = '';

    if (nodes.length === 0 && depth === 0) {
        container.innerHTML = '<div class="text-center text-gray-600 text-xs py-8">No files yet</div>';
        return;
    }

    // Flatten visible nodes for shift-click range selection
    const flatVisibleIds = [];
    function collectVisible(nodeList) {
        nodeList.forEach(n => {
            flatVisibleIds.push(n.id);
            if (n.type === 'folder' && expandedFolders.has(n.id) && n.children.length) {
                collectVisible(n.children);
            }
        });
    }
    if (depth === 0) collectVisible(fileTree);

    nodes.forEach(node => {
        const div = document.createElement('div');
        div.className = 'file-tree-node';
        div.setAttribute('data-file-id', node.id);
        div.setAttribute('data-type', node.type);
        div.style.paddingLeft = `${8 + depth * 16}px`;
        div.setAttribute('tabindex', '-1');

        const isExpanded = expandedFolders.has(node.id);
        const isActive = normalizeFileId(node.id) === normalizeFileId(activeFileId);
        const isSelected = selectedFileIds.has(node.id);
        const isEntryPoint = node.is_entry_point === 1;

        if (isActive) div.classList.add('active');
        if (isSelected) div.classList.add('selected');

        if (node.type === 'folder') {
            const chevIcon = isExpanded ? 'chevron-down' : 'chevron-right';
            div.innerHTML = `
                <i data-lucide="${chevIcon}" class="w-3 h-3 text-gray-500 flex-shrink-0"></i>
                <i data-lucide="folder${isExpanded ? '-open' : ''}" class="w-3.5 h-3.5 text-yellow-500/70 flex-shrink-0"></i>
                <span class="truncate text-xs file-node-name">${escapeHtml(node.name)}</span>
            `;
            div.addEventListener('click', (e) => {
                e.stopPropagation();
                handleFileTreeClick(node, e, flatVisibleIds);
                toggleFolder(node.id);
            });
        } else {
            const { icon, color } = getFileIcon(node.name);
            const isModified = openTabs.some((tab) => normalizeFileId(tab.fileId) === normalizeFileId(node.id) && tab.modified);
            div.innerHTML = `
                <span class="w-3 flex-shrink-0"></span>
                <i data-lucide="${icon}" class="w-3.5 h-3.5 ${color} flex-shrink-0"></i>
                <span class="truncate text-xs file-node-name">${escapeHtml(node.name)}</span>
                ${isModified ? '<span class="tree-modified-dot"></span>' : ''}
                ${isEntryPoint ? '<i data-lucide="star" class="w-3 h-3 text-yellow-400 flex-shrink-0 ml-auto"></i>' : ''}
            `;
            div.addEventListener('click', (e) => {
                e.stopPropagation();
                handleFileTreeClick(node, e, flatVisibleIds);
                openFileInTab(node.id, node.name);
            });
        }

        // Double-click to inline rename
        div.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            e.preventDefault();
            startInlineRename(div, node);
        });

        // Drag support for all items
        div.draggable = true;
        div.addEventListener('dragstart', (e) => {
            draggedFileId = node.id;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', node.name);
            div.classList.add('dragging');
            // Custom drag image
            const ghost = div.cloneNode(true);
            ghost.style.position = 'absolute';
            ghost.style.top = '-1000px';
            ghost.style.background = 'var(--bg-elevated)';
            ghost.style.borderRadius = '4px';
            ghost.style.padding = '4px 8px';
            ghost.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
            ghost.style.opacity = '0.9';
            document.body.appendChild(ghost);
            e.dataTransfer.setDragImage(ghost, 0, 0);
            setTimeout(() => ghost.remove(), 0);
        });
        div.addEventListener('dragend', () => {
            draggedFileId = null;
            div.classList.remove('dragging');
            document.querySelectorAll('.file-tree-node.drag-over').forEach(el => el.classList.remove('drag-over'));
            document.querySelectorAll('.file-tree-drop-indicator').forEach(el => el.remove());
            document.getElementById('file-tree-container')?.classList.remove('drag-over-root');
        });

        // Drop target for folders
        if (node.type === 'folder') {
            div.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';
                div.classList.add('drag-over');
            });
            div.addEventListener('dragleave', () => div.classList.remove('drag-over'));
            div.addEventListener('drop', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                div.classList.remove('drag-over');
                if (draggedFileId && draggedFileId !== node.id) {
                    await moveFileToFolder(draggedFileId, node.id);
                }
            });
        }

        container.appendChild(div);

        if (node.type === 'folder' && isExpanded && node.children.length > 0) {
            renderFileTree(node.children, container, depth + 1);
        }

        // Right-click context menu
        div.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showContextMenu(e.clientX, e.clientY, node);
        });
    });

    if (depth === 0) {
        try { lucide.createIcons(); } catch (e) {}

        // --- Drop on empty area = move to root (bind only once) ---
        if (!_rootDropBound) {
            _rootDropBound = true;
            container.addEventListener('dragover', (e) => {
                if (!draggedFileId) return;
                if (!e.target.closest('.file-tree-node')) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    container.classList.add('drag-over-root');
                }
            });
            container.addEventListener('dragleave', (e) => {
                if (!container.contains(e.relatedTarget)) {
                    container.classList.remove('drag-over-root');
                }
            });
            container.addEventListener('drop', async (e) => {
                container.classList.remove('drag-over-root');
                if (!e.target.closest('.file-tree-node') && draggedFileId) {
                    e.preventDefault();
                    const file = findProjectFileById(draggedFileId);
                    if (file && file.parent_id !== null) {
                        await moveFileToFolder(draggedFileId, null);
                    }
                }
            });
        }
    }
}

// --- Multi-select click handler ---
function handleFileTreeClick(node, e, flatVisibleIds) {
    if (e.ctrlKey || e.metaKey) {
        // Toggle selection
        if (selectedFileIds.has(node.id)) {
            selectedFileIds.delete(node.id);
        } else {
            selectedFileIds.add(node.id);
        }
        lastClickedFileId = node.id;
        renderFileTree();
    } else if (e.shiftKey && lastClickedFileId) {
        // Range selection
        const startIdx = flatVisibleIds.indexOf(lastClickedFileId);
        const endIdx = flatVisibleIds.indexOf(node.id);
        if (startIdx !== -1 && endIdx !== -1) {
            const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
            selectedFileIds.clear();
            for (let i = from; i <= to; i++) {
                selectedFileIds.add(flatVisibleIds[i]);
            }
            renderFileTree();
        }
    } else {
        selectedFileIds.clear();
        lastClickedFileId = node.id;
    }
}

// --- Inline rename ---
function startInlineRename(div, node) {
    const nameSpan = div.querySelector('.file-node-name');
    if (!nameSpan) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'inline-rename-input';
    input.value = node.name;
    input.style.width = `${Math.max(nameSpan.offsetWidth + 20, 60)}px`;

    const originalText = nameSpan.textContent;
    nameSpan.replaceWith(input);
    input.focus();
    // Select name without extension
    const dotIndex = node.name.lastIndexOf('.');
    if (dotIndex > 0 && node.type === 'file') {
        input.setSelectionRange(0, dotIndex);
    } else {
        input.select();
    }

    // Prevent click from propagating while renaming
    div.draggable = false;

    const finishRename = async () => {
        const newName = input.value.trim();
        div.draggable = true;
        if (newName && newName !== node.name) {
            try {
                const file = findProjectFileById(node.id);
                if (!file) return;
                const res = await fetch(`/api/projects/${file.project_id}/files/${node.id}/rename`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': token },
                    body: JSON.stringify({ name: newName })
                });
                const data = await res.json();
                if (data.success) {
                    const tab = findOpenTab(node.id);
                    if (tab) {
                        tab.name = newName;
                        tab.language = detectLanguage(newName);
                        renderTabs();
                    }
                    await loadFileTree(file.project_id);
                    showToast('Renamed', `Renamed to "${newName}"`, 'success');
                } else {
                    showToast('Error', data.error, 'error');
                    revertRename();
                }
            } catch (e) {
                showToast('Error', 'Failed to rename', 'error');
                revertRename();
            }
        } else {
            revertRename();
        }
    };

    const revertRename = () => {
        const span = document.createElement('span');
        span.className = 'truncate text-xs file-node-name';
        span.textContent = originalText;
        if (input.parentNode) input.replaceWith(span);
        div.draggable = true;
    };

    let finished = false;
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (!finished) { finished = true; finishRename(); }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            finished = true;
            revertRename();
        }
        e.stopPropagation();
    });
    input.addEventListener('blur', () => {
        if (!finished) { finished = true; finishRename(); }
    });
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('dblclick', (e) => e.stopPropagation());
}

// --- Toggle folder expand/collapse ---
function toggleFolder(folderId) {
    if (expandedFolders.has(folderId)) {
        expandedFolders.delete(folderId);
    } else {
        expandedFolders.add(folderId);
    }
    renderFileTree();
}

function collapseAllFolders() {
    expandedFolders.clear();
    renderFileTree();
}

// --- Filter file tree by search ---
function filterFileTreeBySearch(query) {
    if (!query) {
        renderFileTree();
        return;
    }
    const q = query.toLowerCase();
    const matching = projectFiles.filter(f => f.name.toLowerCase().includes(q));
    // Also include parent folders
    const ids = new Set(matching.map(f => f.id));
    matching.forEach(f => {
        let parentId = f.parent_id;
        while (parentId) {
            ids.add(parentId);
            const parent = projectFiles.find(p => p.id === parentId);
            parentId = parent?.parent_id;
            if (parent?.type === 'folder') expandedFolders.add(parent.id);
        }
    });
    const filtered = projectFiles.filter(f => ids.has(f.id));
    const tree = buildFileTree(filtered);
    renderFileTree(tree);
}

function syncOpenTabsWithCurrentFiles() {
    const previousActiveId = normalizeFileId(activeFileId);
    const fileById = new Map(
        projectFiles
            .filter((item) => item.type === 'file')
            .map((item) => [normalizeFileId(item.id), item])
    );

    // Remove cached data for files that no longer exist
    for (const fileId of [...fileContents.keys()]) {
        if (!fileById.has(normalizeFileId(fileId))) fileContents.delete(fileId);
    }
    for (const fileId of [...lastSavedContent.keys()]) {
        if (!fileById.has(normalizeFileId(fileId))) lastSavedContent.delete(fileId);
    }

    openTabs = openTabs
        .map((tab) => {
            const fileId = normalizeFileId(tab.fileId);
            const file = fileById.get(fileId);
            if (!file) {
                clearAutoSaveTimer(fileId);
                const model = monacoModels.get(fileId);
                if (model) {
                    model.dispose();
                    monacoModels.delete(fileId);
                }
                return null;
            }

            const nextName = file.name || tab.name;
            const nextLanguage = detectLanguage(nextName);
            if (tab.language !== nextLanguage) {
                const model = monacoModels.get(fileId);
                if (model && typeof monaco !== 'undefined') {
                    try { monaco.editor.setModelLanguage(model, nextLanguage); } catch {}
                }
            }

            return {
                ...tab,
                fileId,
                name: nextName,
                language: nextLanguage
            };
        })
        .filter(Boolean);

    const activeId = normalizeFileId(activeFileId);
    if (activeFileId && !fileById.has(activeId)) {
        activeFileId = openTabs.length ? openTabs[Math.max(0, openTabs.length - 1)].fileId : null;
    }

    renderTabs();
    openTabs.forEach((tab) => updateTreeModifiedIndicator(tab.fileId, tab.modified));

    if (normalizeFileId(activeFileId) !== previousActiveId) {
        if (activeFileId) {
            switchToTab(activeFileId);
        } else if (editor) {
            editor.setValue('// Select a file to start editing');
            document.getElementById('currentFileName').textContent = 'No file selected';
        }
    }
}

// --- Load file tree for a project ---
async function loadFileTree(projectId, options = {}) {
    const settings = {
        autoOpen: true,
        preserveTabs: true,
        ...options
    };

    try {
        const res = await fetch(`/api/projects/${projectId}/files`, {
            headers: { 'Authorization': token }
        });
        const data = await res.json();
        if (data.success) {
            projectFiles = data.files || [];
            fileTree = buildFileTree(projectFiles);

            // Auto-expand root level
            projectFiles.filter(f => f.type === 'folder' && !f.parent_id).forEach(f => expandedFolders.add(f.id));

            renderFileTree();

            if (settings.preserveTabs) {
                syncOpenTabsWithCurrentFiles();
            } else {
                openTabs = [];
                activeFileId = null;
                renderTabs();
            }

            const shouldAutoOpen = settings.autoOpen && !activeFileId && openTabs.length === 0;
            if (shouldAutoOpen) {
                // If there's an entry point, open it automatically
                const entryPoint = projectFiles.find((file) => Number(file.is_entry_point) === 1 && file.type === 'file');
                if (entryPoint) {
                    openFileInTab(entryPoint.id, entryPoint.name);
                } else if (projectFiles.length > 0) {
                    // Open first file
                    const firstFile = projectFiles.find((file) => file.type === 'file');
                    if (firstFile) openFileInTab(firstFile.id, firstFile.name);
                }
            } else if (activeFileId) {
                revealFileInExplorer(activeFileId);
            }
        }
    } catch (e) {
        console.error('Error loading file tree:', e);
    }
}

// --- Open a file in a tab ---
async function openFileInTab(fileId, fileName) {
    const normalizedFileId = normalizeFileId(fileId);
    if (!normalizedFileId) return;

    // Check if tab already open
    const existingTab = findOpenTab(normalizedFileId);
    if (existingTab) {
        switchToTab(normalizedFileId);
        return;
    }

    // Fetch file content if not cached
    if (!fileContents.has(normalizedFileId)) {
        try {
            const file = findProjectFileById(normalizedFileId);
            if (!file) return;
            const projectId = file.project_id;
            const res = await fetch(`/api/projects/${projectId}/files/${normalizedFileId}/content`, {
                headers: { 'Authorization': token }
            });
            const data = await res.json();
            if (data.success) {
                fileContents.set(normalizedFileId, data.file?.content ?? data.content ?? '');
            } else {
                fileContents.set(normalizedFileId, '# Error loading file');
            }
        } catch (e) {
            fileContents.set(normalizedFileId, '# Error loading file');
        }
    }

    const file = findProjectFileById(normalizedFileId);
    const resolvedName = fileName || file?.name || 'untitled.txt';
    const language = detectLanguage(resolvedName);
    const initialContent = fileContents.get(normalizedFileId) || '';
    if (!lastSavedContent.has(normalizedFileId)) {
        lastSavedContent.set(normalizedFileId, initialContent);
    }

    openTabs.push({ fileId: normalizedFileId, name: resolvedName, language, modified: false });
    renderTabs();
    switchToTab(normalizedFileId);
}

// --- Switch active tab ---
function switchToTab(fileId) {
    const normalizedFileId = normalizeFileId(fileId);
    if (!normalizedFileId) return;

    activeFileId = normalizedFileId;
    const content = fileContents.get(normalizedFileId) || '';
    const tab = findOpenTab(normalizedFileId);
    const language = tab?.language || 'plaintext';

    // Use Monaco multi-model
    if (typeof monaco !== 'undefined') {
        let model = monacoModels.get(normalizedFileId);
        if (!model) {
            const uri = monaco.Uri.parse(`file:///${normalizedFileId}/${encodeURIComponent(tab?.name || 'file')}`);
            model = monaco.editor.createModel(content, language, uri);
            lastSavedContent.set(normalizedFileId, content);
            model.onDidChangeContent(() => {
                const currentTab = findOpenTab(normalizedFileId);
                if (!currentTab) return;
                const currentValue = model.getValue();
                const savedValue = lastSavedContent.get(normalizedFileId) ?? '';
                const isModified = currentValue !== savedValue;
                setTabModifiedState(normalizedFileId, isModified);
                if (isModified) {
                    scheduleAutoSave(normalizedFileId);
                } else {
                    clearAutoSaveTimer(normalizedFileId);
                }
            });
            monacoModels.set(normalizedFileId, model);
        }
        editor.setModel(model);
    } else {
        editor.setValue(content);
    }

    const file = findProjectFileById(normalizedFileId);
    document.getElementById('currentFileName').textContent = file?.name || tab?.name || 'No file';

    renderTabs();
    // Highlight active in file tree and reveal in explorer
    revealFileInExplorer(normalizedFileId);
}

// --- Reveal a file in the explorer (expand parents, highlight, scroll into view) ---
function revealFileInExplorer(fileId) {
    const normalizedFileId = normalizeFileId(fileId);
    if (!normalizedFileId) return;

    // Expand all parent folders
    const file = findProjectFileById(normalizedFileId);
    if (file) {
        let parentId = file.parent_id;
        let needsRerender = false;
        while (parentId) {
            if (!expandedFolders.has(parentId)) {
                expandedFolders.add(parentId);
                needsRerender = true;
            }
            const parent = findProjectFileById(parentId);
            parentId = parent?.parent_id || null;
        }
        if (needsRerender) renderFileTree();
    }

    // Highlight active node
    document.querySelectorAll('.file-tree-node[data-file-id]').forEach((el) => {
        el.classList.toggle('active', normalizeFileId(el.getAttribute('data-file-id')) === normalizedFileId);
    });

    // Scroll into view
    const activeNode = document.querySelector(`.file-tree-node[data-file-id="${normalizedFileId}"]`);
    if (activeNode) {
        const container = document.getElementById('file-tree-container');
        if (container) {
            const nodeRect = activeNode.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            if (nodeRect.top < containerRect.top || nodeRect.bottom > containerRect.bottom) {
                activeNode.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    }
}

// --- Close a tab ---
function closeTab(fileId, force = false) {
    const normalizedFileId = normalizeFileId(fileId);
    const tab = findOpenTab(normalizedFileId);
    if (!tab) return;

    if (tab.modified && !force) {
        showConfirm('Unsaved Changes', `Save changes to ${tab.name}?`, async (confirmed) => {
            if (confirmed) {
                const saved = await saveFileById(normalizedFileId);
                if (!saved) return;
            }
            doCloseTab(normalizedFileId, { trackHistory: true });
        });
        return;
    }
    doCloseTab(normalizedFileId, { trackHistory: true });
}

function doCloseTab(fileId, options = {}) {
    const settings = {
        trackHistory: false,
        ...options
    };
    const normalizedFileId = normalizeFileId(fileId);
    const closeIndex = openTabs.findIndex((tab) => normalizeFileId(tab.fileId) === normalizedFileId);
    if (closeIndex === -1) return;

    const closingTab = openTabs[closeIndex];
    if (settings.trackHistory) {
        rememberClosedTab(closingTab);
    }

    openTabs = openTabs.filter((tab) => normalizeFileId(tab.fileId) !== normalizedFileId);

    clearAutoSaveTimer(normalizedFileId);
    autoSaveInFlight.delete(normalizedFileId);

    // Clean up model
    const model = monacoModels.get(normalizedFileId);
    if (model) {
        model.dispose();
        monacoModels.delete(normalizedFileId);
    }

    if (normalizeFileId(activeFileId) === normalizedFileId) {
        if (openTabs.length > 0) {
            const nextIndex = Math.min(closeIndex, openTabs.length - 1);
            switchToTab(openTabs[nextIndex].fileId);
        } else {
            activeFileId = null;
            if (editor) editor.setValue('// Select a file to start editing');
            document.getElementById('currentFileName').textContent = 'No file selected';
            renderTabs();
        }
        return;
    }
    renderTabs();
}

function moveTab(sourceFileId, targetFileId) {
    const sourceId = normalizeFileId(sourceFileId);
    const targetId = normalizeFileId(targetFileId);
    if (!sourceId || !targetId || sourceId === targetId) return;

    const sourceIndex = openTabs.findIndex((tab) => normalizeFileId(tab.fileId) === sourceId);
    const targetIndex = openTabs.findIndex((tab) => normalizeFileId(tab.fileId) === targetId);
    if (sourceIndex === -1 || targetIndex === -1) return;

    const [moved] = openTabs.splice(sourceIndex, 1);
    openTabs.splice(targetIndex, 0, moved);
    renderTabs();
}

function closeMultipleTabs(fileIds) {
    const targetIds = new Set(fileIds.map((id) => normalizeFileId(id)).filter(Boolean));
    const targets = openTabs.filter((tab) => targetIds.has(normalizeFileId(tab.fileId)));
    if (!targets.length) return;

    const closeNow = () => {
        const closingOrder = [...targets];
        for (const tab of closingOrder) {
            doCloseTab(tab.fileId, { trackHistory: true });
        }
    };

    if (targets.some((tab) => tab.modified)) {
        showConfirm(
            'Unsaved Changes',
            'Save all modified files before closing tabs? (Confirm = Save all, Cancel = close without saving)',
            async (confirmed) => {
                if (confirmed) {
                    const allSaved = await saveAllOpenTabs({ silent: true });
                    if (!allSaved) {
                        showToast('Error', 'Some files failed to save. Tabs were not closed.', 'error');
                        return;
                    }
                }
                closeNow();
            }
        );
        return;
    }

    closeNow();
}

function closeAllTabs() {
    closeMultipleTabs(openTabs.map((tab) => tab.fileId));
}

function closeOtherTabs(fileId) {
    const normalized = normalizeFileId(fileId);
    closeMultipleTabs(
        openTabs
            .map((tab) => tab.fileId)
            .filter((id) => normalizeFileId(id) !== normalized)
    );
    if (findOpenTab(normalized)) switchToTab(normalized);
}

function showTabContextMenu(x, y, fileId) {
    const normalized = normalizeFileId(fileId);
    const tab = findOpenTab(normalized);
    if (!tab) return;

    hideContextMenu();
    contextMenuEl = document.createElement('div');
    contextMenuEl.className = 'context-menu';
    contextMenuEl.style.left = `${x}px`;
    contextMenuEl.style.top = `${y}px`;

    const items = [
        { label: 'Save', icon: 'save', action: () => saveFileById(normalized) },
        { label: 'Save All', icon: 'files', action: () => saveAllOpenTabs() },
        null,
        { label: 'Close', icon: 'x', action: () => closeTab(normalized) },
        { label: 'Close Others', icon: 'x', action: () => closeOtherTabs(normalized) },
        { label: 'Close All', icon: 'x-circle', action: () => closeAllTabs() },
        null,
        { label: 'Reopen Closed Tab', icon: 'history', action: () => reopenLastClosedTab() }
    ];

    contextMenuEl.innerHTML = items.map((item) => {
        if (!item) return '<div class="context-menu-separator"></div>';
        return `
            <div class="context-menu-item" data-action="${item.label}">
                <i data-lucide="${item.icon}" class="w-3.5 h-3.5"></i>
                <span>${item.label}</span>
            </div>
        `;
    }).join('');

    document.body.appendChild(contextMenuEl);
    try { lucide.createIcons(); } catch {}

    const actionItems = items.filter(Boolean);
    contextMenuEl.querySelectorAll('.context-menu-item').forEach((el, index) => {
        el.addEventListener('click', () => {
            actionItems[index]?.action();
            hideContextMenu();
        });
    });

    const rect = contextMenuEl.getBoundingClientRect();
    if (rect.right > window.innerWidth) contextMenuEl.style.left = `${x - rect.width}px`;
    if (rect.bottom > window.innerHeight) contextMenuEl.style.top = `${y - rect.height}px`;

    setTimeout(() => {
        document.addEventListener('click', hideContextMenu, { once: true });
    }, 0);
}

// --- Render tabs UI ---
function renderTabs() {
    const tabBar = document.getElementById('editor-tab-bar');
    if (!tabBar) return;

    tabBar.innerHTML = openTabs.map((tab) => {
        const fileId = normalizeFileId(tab.fileId);
        const isActive = normalizeFileId(activeFileId) === fileId;
        const { icon, color } = getFileIcon(tab.name);
        return `
            <div class="editor-tab ${isActive ? 'active' : ''} ${tab.modified ? 'modified' : ''}" data-file-id="${fileId}" draggable="true">
                <i data-lucide="${icon}" class="w-3.5 h-3.5 ${color}"></i>
                <span class="tab-name">${escapeHtml(tab.name)}</span>
                ${tab.modified ? '<span class="modified-dot"></span>' : ''}
                <button class="tab-close" data-close-id="${fileId}" title="Close">
                    <i data-lucide="x" class="w-3 h-3"></i>
                </button>
            </div>
        `;
    }).join('');

    // Bind events via delegation
    tabBar.querySelectorAll('.editor-tab').forEach((el) => {
        const fid = normalizeFileId(el.getAttribute('data-file-id'));
        el.addEventListener('click', (e) => {
            if (e.target.closest('.tab-close')) return;
            switchToTab(fid);
        });
        el.addEventListener('mousedown', (e) => {
            if (e.button === 1) { e.preventDefault(); closeTab(fid); }
        });
        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            switchToTab(fid);
            showTabContextMenu(e.clientX, e.clientY, fid);
        });
        el.addEventListener('dragstart', (e) => {
            e.dataTransfer?.setData('text/plain', fid);
            e.dataTransfer.effectAllowed = 'move';
            el.classList.add('dragging');
        });
        el.addEventListener('dragend', () => {
            el.classList.remove('dragging');
            tabBar.querySelectorAll('.editor-tab.drag-over').forEach((node) => node.classList.remove('drag-over'));
        });
        el.addEventListener('dragover', (e) => {
            e.preventDefault();
            el.classList.add('drag-over');
        });
        el.addEventListener('dragleave', () => {
            el.classList.remove('drag-over');
        });
        el.addEventListener('drop', (e) => {
            e.preventDefault();
            el.classList.remove('drag-over');
            const sourceId = normalizeFileId(e.dataTransfer?.getData('text/plain'));
            moveTab(sourceId, fid);
        });
        const closeBtn = el.querySelector('.tab-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeTab(fid);
            });
        }
    });
    try { lucide.createIcons(); } catch (e) {}
}

// --- Save file by ID ---
async function saveFileById(fileId, options = {}) {
    const settings = {
        silent: false,
        ...options
    };
    const normalizedFileId = normalizeFileId(fileId);
    if (!normalizedFileId) return false;

    const model = monacoModels.get(normalizedFileId);
    const content = model ? model.getValue() : (fileContents.get(normalizedFileId) ?? null);
    if (content === null) return false;

    const file = findProjectFileById(normalizedFileId);
    if (!file) return false;

    try {
        const res = await fetch(`/api/projects/${file.project_id}/files/${normalizedFileId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': token },
            body: JSON.stringify({ content })
        });
        const data = await res.json();
        if (data.success) {
            fileContents.set(normalizedFileId, content);
            lastSavedContent.set(normalizedFileId, content);
            clearAutoSaveTimer(normalizedFileId);
            setTabModifiedState(normalizedFileId, false);
            return true;
        } else {
            if (!settings.silent) showToast('Error', data.error || 'Failed to save', 'error');
            return false;
        }
    } catch (e) {
        if (!settings.silent) showToast('Error', 'Failed to save file', 'error');
        return false;
    }
}

// --- File CRUD Operations ---
async function createNewFile(parentId = null) {
    if (!currentProjectKey) {
        showToast('Error', 'Open a project first', 'error');
        return;
    }
    const project = projects.find(p => p.secret_key === currentProjectKey);
    if (!project) return;

    showPrompt('New File', 'Enter file name:', async (name) => {
        if (!name) return;
        try {
            const res = await fetch(`/api/projects/${project.id}/files`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': token },
                body: JSON.stringify({ name, type: 'file', parent_id: parentId, content: '' })
            });
            const data = await res.json();
            if (data.success) {
                await loadFileTree(project.id);
                if (data.file) openFileInTab(data.file.id, data.file.name);
                showToast('Created', `File "${name}" created`, 'success');
            } else {
                showToast('Error', data.error, 'error');
            }
        } catch (e) {
            showToast('Error', 'Failed to create file', 'error');
        }
    });
}

async function createNewFolder(parentId = null) {
    if (!currentProjectKey) {
        showToast('Error', 'Open a project first', 'error');
        return;
    }
    const project = projects.find(p => p.secret_key === currentProjectKey);
    if (!project) return;

    showPrompt('New Folder', 'Enter folder name:', async (name) => {
        if (!name) return;
        try {
            const res = await fetch(`/api/projects/${project.id}/files`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': token },
                body: JSON.stringify({ name, type: 'folder', parent_id: parentId })
            });
            const data = await res.json();
            if (data.success) {
                if (data.file) expandedFolders.add(data.file.id);
                await loadFileTree(project.id);
                showToast('Created', `Folder "${name}" created`, 'success');
            } else {
                showToast('Error', data.error, 'error');
            }
        } catch (e) {
            showToast('Error', 'Failed to create folder', 'error');
        }
    });
}

async function deleteFileItem(fileId) {
    const file = findProjectFileById(fileId);
    if (!file) return;

    // Collect all child file IDs for a folder (recursive)
    function collectChildFileIds(parentId) {
        const ids = [];
        projectFiles.forEach(f => {
            if (f.parent_id === parentId) {
                ids.push(f.id);
                if (f.type === 'folder') ids.push(...collectChildFileIds(f.id));
            }
        });
        return ids;
    }

    const label = file.type === 'folder' ? 'folder and all its contents' : 'file';
    showConfirm('Delete', `Delete ${label} "${file.name}"?`, async (confirmed) => {
        if (!confirmed) return;
        try {
            const res = await fetch(`/api/projects/${file.project_id}/files/${fileId}`, {
                method: 'DELETE',
                headers: { 'Authorization': token }
            });
            const data = await res.json();
            if (data.success) {
                // Close tab if open (and child tabs for folders)
                if (file.type === 'folder') {
                    const childIds = collectChildFileIds(fileId);
                    childIds.forEach(cid => {
                        if (findOpenTab(cid)) doCloseTab(cid);
                    });
                }
                if (findOpenTab(fileId)) {
                    doCloseTab(fileId);
                }
                await loadFileTree(file.project_id);
                showToast('Deleted', `"${file.name}" deleted`, 'success');
            } else {
                showToast('Error', data.error, 'error');
            }
        } catch (e) {
            showToast('Error', 'Failed to delete', 'error');
        }
    });
}

async function renameFileItem(fileId) {
    const file = findProjectFileById(fileId);
    if (!file) return;

    showPrompt('Rename', `New name for "${file.name}":`, async (newName) => {
        if (!newName || newName === file.name) return;
        try {
            const res = await fetch(`/api/projects/${file.project_id}/files/${fileId}/rename`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': token },
                body: JSON.stringify({ name: newName })
            });
            const data = await res.json();
            if (data.success) {
                // Update tab name if open
                const tab = findOpenTab(fileId);
                if (tab) {
                    tab.name = newName;
                    tab.language = detectLanguage(newName);
                    renderTabs();
                }
                await loadFileTree(file.project_id);
                showToast('Renamed', `Renamed to "${newName}"`, 'success');
            } else {
                showToast('Error', data.error, 'error');
            }
        } catch (e) {
            showToast('Error', 'Failed to rename', 'error');
        }
    }, file.name);
}

async function moveFileToFolder(fileId, targetFolderId) {
    const file = findProjectFileById(fileId);
    if (!file) return;

    try {
        const res = await fetch(`/api/projects/${file.project_id}/files/${fileId}/move`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': token },
            body: JSON.stringify({ parent_id: targetFolderId })
        });
        const data = await res.json();
        if (data.success) {
            if (targetFolderId) expandedFolders.add(targetFolderId);
            await loadFileTree(file.project_id);
            const dest = targetFolderId ? findProjectFileById(targetFolderId)?.name || 'folder' : 'root';
            showToast('Moved', `Moved "${file.name}" to ${dest}`, 'success');
        } else {
            showToast('Error', data.error, 'error');
        }
    } catch (e) {
        showToast('Error', 'Failed to move file', 'error');
    }
}

async function setEntryPoint(fileId) {
    const file = findProjectFileById(fileId);
    if (!file || file.type !== 'file') return;

    try {
        const res = await fetch(`/api/projects/${file.project_id}/files/${fileId}/entry-point`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': token },
            body: JSON.stringify({ is_entry_point: true })
        });
        const data = await res.json();
        if (data.success) {
            await loadFileTree(file.project_id);
            showToast('Entry Point', `"${file.name}" set as entry point`, 'success');
        } else {
            showToast('Error', data.error, 'error');
        }
    } catch (e) {
        showToast('Error', 'Failed to set entry point', 'error');
    }
}

async function uploadFile() {
    if (!currentProjectKey) {
        showToast('Error', 'Open a project first', 'error');
        return;
    }
    const project = projects.find(p => p.secret_key === currentProjectKey);
    if (!project) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = async () => {
        const files = Array.from(input.files);
        if (files.length === 0) return;

        for (const file of files) {
            const reader = new FileReader();
            reader.onload = async () => {
                const content = reader.result;
                try {
                    const res = await fetch(`/api/projects/${project.id}/files/upload`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': token },
                        body: JSON.stringify({
                            files: [{ name: file.name, content, encoding: 'text' }]
                        })
                    });
                    const data = await res.json();
                    if (data.success) {
                        await loadFileTree(project.id);
                        showToast('Uploaded', `"${file.name}" uploaded`, 'success');
                    } else {
                        showToast('Error', data.error, 'error');
                    }
                } catch (e) {
                    showToast('Error', 'Upload failed', 'error');
                }
            };
            reader.readAsText(file);
        }
    };
    input.click();
}

// --- Context Menu ---
let contextMenuEl = null;

function showContextMenu(x, y, node) {
    hideContextMenu();
    contextMenuEl = document.createElement('div');
    contextMenuEl.className = 'context-menu';
    contextMenuEl.style.left = `${x}px`;
    contextMenuEl.style.top = `${y}px`;

    const items = [];
    if (node.type === 'folder') {
        items.push({ label: 'New File', icon: 'file-plus', action: () => createNewFile(node.id) });
        items.push({ label: 'New Folder', icon: 'folder-plus', action: () => createNewFolder(node.id) });
        items.push(null); // separator
    }
    items.push({ label: 'Rename', icon: 'pencil', action: () => renameFileItem(node.id) });
    if (node.type === 'file') {
        items.push({ label: 'Set as Entry Point', icon: 'star', action: () => setEntryPoint(node.id) });
        items.push({ label: 'Duplicate', icon: 'copy', action: () => {
            const file = findProjectFileById(node.id);
            if (!file) return;
            fetch(`/api/projects/${file.project_id}/files/${node.id}/copy`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': token },
                body: JSON.stringify({})
            }).then(r => r.json()).then(data => {
                if (data.success) {
                    loadFileTree(file.project_id);
                    showToast('Duplicated', `Copied "${file.name}"`, 'success');
                } else {
                    showToast('Error', data.error, 'error');
                }
            }).catch(() => showToast('Error', 'Failed to duplicate', 'error'));
        }});
        items.push({ label: 'Download', icon: 'download', action: () => {
            const file = findProjectFileById(node.id);
            if (!file) return;
            downloadWithAuth(
                `/api/projects/${file.project_id}/files/${node.id}/content?download=true`,
                file.name
            ).catch((e) => showToast('Error', e.message || 'Failed to download file', 'error'));
        }});
    }
    // Move to Root - only show if item is inside a folder
    if (node.parent_id) {
        items.push({ label: 'Move to Root', icon: 'arrow-up-to-line', action: () => moveFileToFolder(node.id, null) });
    }
    items.push({ label: 'Copy Path', icon: 'clipboard', action: () => {
        let path = node.name;
        let parentId = node.parent_id;
        while (parentId) {
            const parent = findProjectFileById(parentId);
            if (parent) { path = parent.name + '/' + path; parentId = parent.parent_id; }
            else break;
        }
        copyToClipboard(path);
    }});
    items.push(null); // separator
    items.push({ label: 'Delete', icon: 'trash-2', action: () => deleteFileItem(node.id), danger: true });

    contextMenuEl.innerHTML = items.map(item => {
        if (!item) return '<div class="context-menu-separator"></div>';
        return `
            <div class="context-menu-item ${item.danger ? 'danger' : ''}" data-action="${item.label}">
                <i data-lucide="${item.icon}" class="w-3.5 h-3.5"></i>
                <span>${item.label}</span>
            </div>
        `;
    }).join('');

    document.body.appendChild(contextMenuEl);
    try { lucide.createIcons(); } catch (e) {}

    // Bind actions
    contextMenuEl.querySelectorAll('.context-menu-item').forEach((el, i) => {
        const actionItems = items.filter(it => it !== null);
        if (actionItems[i]) {
            el.addEventListener('click', () => {
                actionItems[i].action();
                hideContextMenu();
            });
        }
    });

    // Adjust if off screen
    const rect = contextMenuEl.getBoundingClientRect();
    if (rect.right > window.innerWidth) contextMenuEl.style.left = `${x - rect.width}px`;
    if (rect.bottom > window.innerHeight) contextMenuEl.style.top = `${y - rect.height}px`;

    // Close on click outside
    setTimeout(() => {
        document.addEventListener('click', hideContextMenu, { once: true });
    }, 0);
}

function hideContextMenu() {
    if (contextMenuEl) {
        contextMenuEl.remove();
        contextMenuEl = null;
    }
}

function handleProjectSettingsToggleClick(event) {
    if (event) event.stopPropagation();
    toggleProjectSettingsPanel();
}

function toggleProjectSettingsPanel(forceCollapsed = null) {
    const panel = document.getElementById('project-settings-panel');
    const toggleBtn = document.getElementById('settings-panel-toggle');
    if (!panel) return;

    const shouldCollapse = typeof forceCollapsed === 'boolean'
        ? forceCollapsed
        : !panel.classList.contains('collapsed');

    if (shouldCollapse) {
        const currentHeight = panel.offsetHeight;
        if (currentHeight > 80) {
            localStorage.setItem(PANEL_STATE_KEYS.settingsHeight, String(currentHeight));
        }
    }

    panel.classList.toggle('collapsed', shouldCollapse);
    localStorage.setItem(PANEL_STATE_KEYS.settingsCollapsed, JSON.stringify(shouldCollapse));

    if (shouldCollapse) {
        panel.style.height = '';
    } else {
        const savedHeight = parseInt(localStorage.getItem(PANEL_STATE_KEYS.settingsHeight) || '260', 10);
        panel.style.height = `${Math.max(220, savedHeight)}px`;
        if (window.innerWidth > 768 && Number.isFinite(savedHeight) && savedHeight >= 120) {
            panel.style.height = `${savedHeight}px`;
        } else {
            panel.style.height = '';
        }
    }

    if (toggleBtn) {
        const expanded = !shouldCollapse;
        toggleBtn.setAttribute('aria-expanded', String(expanded));
        toggleBtn.setAttribute('title', expanded ? 'Collapse Project Settings' : 'Expand Project Settings');
        toggleBtn.setAttribute('aria-label', expanded ? 'Collapse Project Settings' : 'Expand Project Settings');
    }
}

function toggleProjectInfoSidebar(forceCollapsed = null) {
    const sidebar = document.getElementById('project-info-sidebar');
    const toggleBtn = document.getElementById('project-info-toggle');
    if (!sidebar) return;

    const shouldCollapse = typeof forceCollapsed === 'boolean'
        ? forceCollapsed
        : !sidebar.classList.contains('collapsed');

    if (shouldCollapse) {
        const currentWidth = sidebar.offsetWidth;
        if (currentWidth > 80) {
            localStorage.setItem(PANEL_STATE_KEYS.detailsWidth, String(currentWidth));
        }
    }

    sidebar.classList.toggle('collapsed', shouldCollapse);
    localStorage.setItem(PANEL_STATE_KEYS.detailsCollapsed, JSON.stringify(shouldCollapse));

    if (!shouldCollapse) {
        const savedWidth = parseInt(localStorage.getItem(PANEL_STATE_KEYS.detailsWidth) || '', 10);
        if (window.innerWidth > 1024 && Number.isFinite(savedWidth) && savedWidth >= 220) {
            sidebar.style.width = `${savedWidth}px`;
            sidebar.style.minWidth = `${savedWidth}px`;
        } else {
            sidebar.style.width = '';
            sidebar.style.minWidth = '';
        }
    }

    if (toggleBtn) {
        const expanded = !shouldCollapse;
        toggleBtn.setAttribute('aria-expanded', String(expanded));
        toggleBtn.setAttribute('title', expanded ? 'Collapse Project Details' : 'Expand Project Details');
        toggleBtn.setAttribute('aria-label', expanded ? 'Collapse Project Details' : 'Expand Project Details');
    }
}

function initEditorPanelStates() {
    const settingsCollapsed = localStorage.getItem(PANEL_STATE_KEYS.settingsCollapsed) === 'true';
    const detailsCollapsed = localStorage.getItem(PANEL_STATE_KEYS.detailsCollapsed) === 'true';
    toggleProjectSettingsPanel(settingsCollapsed);
    toggleProjectInfoSidebar(detailsCollapsed);
}

function initProjectSettingsResize() {
    const panel = document.getElementById('project-settings-panel');
    if (!panel || panel.querySelector('.settings-resize-handle')) return;

    const handle = document.createElement('div');
    handle.className = 'settings-resize-handle';
    panel.prepend(handle);

    let isResizing = false;
    let startY = 0;
    let startHeight = 0;

    const onMouseMove = (e) => {
        if (!isResizing) return;

        const deltaY = e.clientY - startY;
        const maxHeight = Math.max(180, Math.floor(window.innerHeight * 0.78));
        const newHeight = Math.max(120, Math.min(maxHeight, startHeight - deltaY));
        panel.style.height = `${newHeight}px`;
    };

    const onMouseUp = () => {
        if (!isResizing) return;

        isResizing = false;
        handle.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem(PANEL_STATE_KEYS.settingsHeight, String(panel.offsetHeight));
    };

    handle.addEventListener('mousedown', (e) => {
        if (window.innerWidth <= 768) return;

        if (panel.classList.contains('collapsed')) {
            toggleProjectSettingsPanel(false);
        }

        const maxHeight = Math.max(180, Math.floor(window.innerHeight * 0.78));
        if (panel.offsetHeight > maxHeight) {
            panel.style.height = `${maxHeight}px`;
        }

        isResizing = true;
        startY = e.clientY;
        startHeight = panel.offsetHeight;
        handle.classList.add('resizing');
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    // Capture phase ensures resize still works when dragging into Monaco/editor area.
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mouseup', onMouseUp, true);
}

function initProjectInfoResize() {
    const sidebar = document.getElementById('project-info-sidebar');
    if (!sidebar || sidebar.querySelector('.project-info-resize-handle')) return;

    const handle = document.createElement('div');
    handle.className = 'project-info-resize-handle';
    sidebar.appendChild(handle);

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    handle.addEventListener('mousedown', (e) => {
        if (window.innerWidth <= 1024) return;

        if (sidebar.classList.contains('collapsed')) {
            toggleProjectInfoSidebar(false);
        }

        isResizing = true;
        startX = e.clientX;
        startWidth = sidebar.offsetWidth;
        handle.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const deltaX = e.clientX - startX;
        const newWidth = Math.max(220, Math.min(560, startWidth - deltaX));
        sidebar.style.width = `${newWidth}px`;
        sidebar.style.minWidth = `${newWidth}px`;
    });

    document.addEventListener('mouseup', () => {
        if (!isResizing) return;

        isResizing = false;
        handle.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem(PANEL_STATE_KEYS.detailsWidth, String(sidebar.offsetWidth));
    });
}

// --- Search Panel ---
function toggleSearchPanel() {
    const explorerPanel = document.getElementById('file-explorer-panel');
    const searchPanel = document.getElementById('search-panel');
    if (!explorerPanel || !searchPanel) return;

    const isSearchVisible = !searchPanel.classList.contains('hidden');
    if (isSearchVisible) {
        searchPanel.classList.add('hidden');
        searchPanel.style.display = 'none';
        explorerPanel.style.display = '';
    } else {
        explorerPanel.style.display = 'none';
        searchPanel.classList.remove('hidden');
        searchPanel.style.display = 'flex';
        document.getElementById('searchPanelInput')?.focus();
    }
}

async function searchAcrossFiles() {
    const query = document.getElementById('searchPanelInput')?.value;
    if (!query || !currentProjectKey) return;

    const project = projects.find(p => p.secret_key === currentProjectKey);
    if (!project) return;

    const resultsContainer = document.getElementById('search-results-container');
    resultsContainer.innerHTML = '<div class="text-center text-gray-500 text-xs py-4">Searching...</div>';

    try {
        const caseSensitive = document.getElementById('searchCaseSensitive')?.checked || false;
        const useRegex = document.getElementById('searchRegex')?.checked || false;

        const res = await fetch(`/api/projects/${project.id}/files/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': token },
            body: JSON.stringify({ query, case_sensitive: caseSensitive, regex: useRegex })
        });
        const data = await res.json();

        if (data.success && data.results && data.results.length > 0) {
            resultsContainer.innerHTML = data.results.map(r => `
                <div class="search-result-group">
                    <div class="search-result-file text-xs text-gray-400 px-2 py-1 font-medium">${escapeHtml(r.name)}</div>
                    ${(r.matches || []).map(m => `
                        <div class="search-result-item px-3 py-1 text-xs cursor-pointer hover:bg-[#27272a] rounded"
                             data-file-id="${escapeHtml(r.fileId)}"
                             data-file-name="${escapeHtml(r.name)}">
                            <span class="text-gray-500 mr-2">${m.line || ''}</span>
                            <span class="text-gray-300">${escapeHtml(m.content || '')}</span>
                        </div>
                    `).join('')}
                </div>
            `).join('');

            resultsContainer.querySelectorAll('.search-result-item[data-file-id]').forEach((item) => {
                item.addEventListener('click', () => {
                    const fileId = item.getAttribute('data-file-id') || '';
                    const name = item.getAttribute('data-file-name') || 'untitled.txt';
                    openFileInTab(fileId, name);
                });
            });
        } else {
            resultsContainer.innerHTML = '<div class="text-center text-gray-500 text-xs py-4">No results found</div>';
        }
    } catch (e) {
        resultsContainer.innerHTML = '<div class="text-center text-red-400 text-xs py-4">Search failed</div>';
    }
}

// --- Explorer Search Input Listener ---
document.addEventListener('DOMContentLoaded', () => {
    initEditorPanelStates();

    const explorerSearch = document.getElementById('explorerSearch');
    if (explorerSearch) {
        let searchTimeout;
        explorerSearch.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                filterFileTreeBySearch(explorerSearch.value);
            }, 200);
        });
    }

    // Search panel listeners
    const searchInput = document.getElementById('searchPanelInput');
    if (searchInput) {
        let debounceTimer;
        searchInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(searchAcrossFiles, 500);
        });
    }

    // --- Keyboard Shortcuts for File Explorer ---
    document.addEventListener('keydown', (e) => {
        // Skip if user is typing in an input/textarea or the editor
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.closest('#editor-container')) return;

        // Only handle if the file explorer panel is visible
        const explorerPanel = document.getElementById('file-explorer-panel');
        if (!explorerPanel || explorerPanel.style.display === 'none') return;

        // F2 - Rename selected/active file
        if (e.key === 'F2') {
            e.preventDefault();
            const targetId = activeFileId || (selectedFileIds.size === 1 ? [...selectedFileIds][0] : null);
            if (targetId) {
                const targetNode = document.querySelector(`.file-tree-node[data-file-id="${targetId}"]`);
                const file = findProjectFileById(targetId);
                if (targetNode && file) startInlineRename(targetNode, file);
            }
        }

        // Delete - Delete selected files
        if (e.key === 'Delete') {
            e.preventDefault();
            if (selectedFileIds.size > 0) {
                selectedFileIds.forEach(id => deleteFileItem(id));
            } else if (activeFileId) {
                deleteFileItem(activeFileId);
            }
        }

        // Ctrl+N - New file
        if ((e.ctrlKey || e.metaKey) && e.key === 'n' && !e.shiftKey) {
            // Only when file explorer is focused area
            if (document.activeElement?.closest('#file-explorer-panel')) {
                e.preventDefault();
                createNewFile();
            }
        }

        // Ctrl+Shift+N - New folder
        if ((e.ctrlKey || e.metaKey) && e.key === 'N' && e.shiftKey) {
            if (document.activeElement?.closest('#file-explorer-panel')) {
                e.preventDefault();
                createNewFolder();
            }
        }

        // Escape - Clear selection
        if (e.key === 'Escape') {
            if (selectedFileIds.size > 0) {
                selectedFileIds.clear();
                renderFileTree();
            }
        }
    });

    // --- Resizable File Explorer Panel ---
    initExplorerResize();
    initProjectSettingsResize();
    initProjectInfoResize();

    window.addEventListener('resize', () => {
        const detailsSidebar = document.getElementById('project-info-sidebar');
        if (detailsSidebar && window.innerWidth <= 1024) {
            detailsSidebar.style.width = '';
            detailsSidebar.style.minWidth = '';
        }

        const settingsPanel = document.getElementById('project-settings-panel');
        if (settingsPanel && window.innerWidth <= 768) {
            settingsPanel.style.height = '';
        }
    });
});

// --- Explorer Resize ---
function initExplorerResize() {
    const explorerPanel = document.getElementById('file-explorer-panel');
    if (!explorerPanel) return;
    if (explorerPanel.querySelector('.explorer-resize-handle')) return;

    const handle = document.createElement('div');
    handle.className = 'explorer-resize-handle';
    explorerPanel.appendChild(handle);

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = explorerPanel.offsetWidth;
        handle.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const delta = e.clientX - startX;
        const newWidth = Math.max(160, Math.min(500, startWidth + delta));
        explorerPanel.style.width = `${newWidth}px`;
        explorerPanel.style.minWidth = `${newWidth}px`;
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            handle.classList.remove('resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });
}

// ============================================
// TOAST NOTIFICATIONS
// ============================================
function showToast(title, message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: 'check',
        error: 'x',
        warning: 'alert-triangle',
        info: 'info'
    };

    toast.innerHTML = `
        <div class="toast-icon">
            <i data-lucide="${icons[type]}" class="w-4 h-4"></i>
        </div>
        <div class="toast-content">
            <div class="toast-title">${escapeHtml(title)}</div>
            <div class="toast-message">${escapeHtml(message)}</div>
        </div>
        <button class="toast-close" onclick="this.parentElement.remove()">
            <i data-lucide="x" class="w-4 h-4"></i>
        </button>
    `;

    container.appendChild(toast);
    lucide.createIcons();

    // Auto remove
    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ============================================
// KEYBOARD SHORTCUTS
// ============================================
document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + S: Save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (e.shiftKey) {
            if (currentProjectKey) saveAllOpenTabs();
        } else {
            if (currentProjectKey) saveCurrentFile();
        }
    }

    // Ctrl/Cmd + N: New File (in editor view)
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        if (document.getElementById('view-editor')?.classList.contains('active')) {
            createNewFile();
        } else {
            openCreateProjectModal();
        }
    }

    // Ctrl/Cmd + W: Close current tab
    if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
        e.preventDefault();
        if (e.shiftKey) closeAllTabs();
        else if (activeFileId) closeTab(activeFileId);
    }

    // Ctrl/Cmd + Shift + F: Search across files
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        if (document.getElementById('view-editor')?.classList.contains('active')) {
            toggleSearchPanel();
        }
    }

    // Ctrl/Cmd + Tab: Next tab
    if ((e.ctrlKey || e.metaKey) && e.key === 'Tab') {
        e.preventDefault();
        if (openTabs.length > 1) {
            const idx = openTabs.findIndex((tab) => normalizeFileId(tab.fileId) === normalizeFileId(activeFileId));
            if (idx === -1) return;
            const next = e.shiftKey ? (idx - 1 + openTabs.length) % openTabs.length : (idx + 1) % openTabs.length;
            switchToTab(openTabs[next].fileId);
        }
    }

    // Ctrl/Cmd + Shift + T: Reopen recently closed tab
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'T' || e.key === 't')) {
        e.preventDefault();
        reopenLastClosedTab();
    }

    // F2: Rename active file
    if (e.key === 'F2') {
        if (activeFileId) {
            e.preventDefault();
            renameFileItem(activeFileId);
        }
    }

    // Ctrl/Cmd + 1-4: Navigate views
    if ((e.ctrlKey || e.metaKey) && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        const views = { '1': 'overview', '2': 'editor', '3': 'licenses', '4': 'logs' };
        switchView(views[e.key]);
    }

    // Ctrl/Cmd + /: Show shortcuts
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        document.getElementById('shortcutsModal').style.display = 'flex';
    }

    // Escape: Close modals and context menu
    if (e.key === 'Escape') {
        hideContextMenu();
        document.querySelectorAll('.fixed[style*="flex"]').forEach(modal => {
            if (!modal.id.includes('alert') && !modal.id.includes('confirm') && !modal.id.includes('prompt')) {
                modal.style.display = 'none';
            }
        });
    }
});

// ============================================
// RENAME PROJECT
// ============================================
function openRenameProjectModal() {
    if (!currentProjectKey) {
        showToast('No Project', 'Please select a project first', 'warning');
        return;
    }
    const script = projects.find(s => s.secret_key === currentProjectKey);
    if (!script) return;

    document.getElementById('renameProjectInput').value = script.name;
    document.getElementById('renameProjectKey').value = currentProjectKey;
    document.getElementById('renameProjectModal').style.display = 'flex';
    document.getElementById('renameProjectInput').focus();
    document.getElementById('renameProjectInput').select();
}

async function renameProject() {
    const key = document.getElementById('renameProjectKey').value;
    const newName = document.getElementById('renameProjectInput').value.trim();

    if (!newName) {
        showToast('Error', 'Please enter a name', 'error');
        return;
    }

    try {
        const res = await fetch(`/api/projects/${key}/rename`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': token },
            body: JSON.stringify({ name: newName })
        });
        const data = await res.json();
        if (data.success) {
            const s = projects.find(s => s.secret_key === key);
            if (s) s.name = newName;
            renderFileList();
            renderProjectsGrid(); // Keep Project Manager in sync
            document.getElementById('currentFileName').textContent = newName;
            document.getElementById('renameProjectModal').style.display = 'none';
            showToast('Renamed', `Project renamed to ${newName}`, 'success');
        } else {
            showToast('Error', data.error, 'error');
        }
    } catch (e) {
        showToast('Error', 'Failed to rename project', 'error');
    }
}

// ============================================
// DUPLICATE PROJECT
// ============================================
async function duplicateCurrentProject() {
    if (!currentProjectKey) {
        showToast('No Project', 'Please select a project first', 'warning');
        return;
    }
    const script = projects.find(s => s.secret_key === currentProjectKey);
    if (!script) return;

    const newName = script.name.replace(/(\.[^.]+)$/, ' (copy)$1');

    try {
        const res = await fetch(`/api/workspaces/${workspaceIdentifier}/projects`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': token },
            body: JSON.stringify({ name: newName, content: script.content })
        });
        const data = await res.json();
        if (data.success) {
            showToast('Duplicated', `Created ${newName}`, 'success');
            loadWorkspaceData();
        } else {
            showToast('Error', data.error, 'error');
        }
    } catch (e) {
        showToast('Error', 'Failed to duplicate project', 'error');
    }
}

// ============================================
// FORMAT CODE (Basic)
// ============================================
function formatCode() {
    if (!editor) return;
    editor.getAction('editor.action.formatDocument')?.run();
    showToast('Formatted', 'Code formatted', 'success');
}

// ============================================
// LICENSE FILTERING & PAGINATION
// ============================================
let licenseCurrentPage = 1;
const licensePageSize = 20;
let filteredLicenses = [];
let licenseFilterActive = false;
let selectedLicenseIds = new Set();

function filterLicenses() {
    const search = document.getElementById('licenseSearch')?.value.toLowerCase() || '';
    const statusFilter = document.getElementById('licenseStatusFilter')?.value || 'all';
    const projectFilter = document.getElementById('licenseProjectFilter')?.value || 'all';
    licenseFilterActive = !!(search || statusFilter !== 'all' || projectFilter !== 'all');

    filteredLicenses = licenses.filter(l => {
        const matchSearch = !search ||
            l.key.toLowerCase().includes(search) ||
            (l.note || '').toLowerCase().includes(search) ||
            (l.activated_hwid || '').toLowerCase().includes(search);

        const matchStatus = statusFilter === 'all' ||
            (statusFilter === 'active' && l.is_active) ||
            (statusFilter === 'inactive' && !l.is_active);

        const matchProject = projectFilter === 'all' ||
            (projectFilter === '' && !l.script_id) ||
            (l.script_id && projects.find(s => s.id === l.script_id)?.secret_key === projectFilter);

        return matchSearch && matchStatus && matchProject;
    });

    licenseCurrentPage = 1;
    renderLicenseList();
}

function updateLicenseProjectFilter() {
    const select = document.getElementById('licenseProjectFilter');
    if (!select) return;
    select.innerHTML = '<option value="all">All Projects</option>' +
        '<option value="">Workspace Wide</option>' +
        projects.map(s => `<option value="${s.secret_key}">${escapeHtml(s.name)}</option>`).join('');
}

function renderLicenseList() {
    const tbody = document.getElementById('licenseList');
    const data = licenseFilterActive ? filteredLicenses : licenses;

    if (data.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="px-6 py-12">
                    <div class="empty-state">
                        <div class="empty-state-icon"><i data-lucide="key" class="w-7 h-7"></i></div>
                        <div class="empty-state-title">No licenses found</div>
                        <div class="empty-state-desc">Create a license to get started with access control</div>
                    </div>
                </td>
            </tr>
        `;
        lucide.createIcons();
        updateLicensePagination(0, 0);
        return;
    }

    // Pagination
    const start = (licenseCurrentPage - 1) * licensePageSize;
    const end = start + licensePageSize;
    const pageData = data.slice(start, end);

    tbody.innerHTML = pageData.map(l => {
        const projectName = l.script_id ? (projects.find(s => s.id === l.script_id)?.name || 'Unknown') : 'All Projects';
        const lastUsed = l.last_used_at ? new Date(l.last_used_at).toLocaleString() : '-';
        const statusClass = l.is_active ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500';
        const osInfo = l.activated_os || '-';
        const usage = l.usage_count || 0;
        const isSelected = selectedLicenseIds.has(l.id);

        return `
        <tr class="hover:bg-[#27272a] transition-colors ${isSelected ? 'bg-indigo-500/5' : ''}">
            <td class="px-4 py-4"><input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleLicenseSelection(${l.id})"></td>
            <td class="px-4 py-4">
                <div class="flex items-center gap-2">
                    <code class="text-gray-300 text-xs">${escapeHtml(l.key)}</code>
                    <button onclick="copyToClipboard('${escapeHtml(l.key)}')" class="text-gray-500 hover:text-gray-300" title="Copy">
                        <i data-lucide="copy" class="w-3 h-3"></i>
                    </button>
                </div>
            </td>
            <td class="px-4 py-4 text-gray-300 text-sm">${escapeHtml(projectName)}</td>
            <td class="px-4 py-4 text-gray-400 text-sm">${escapeHtml(l.note || '-')}</td>
            <td class="px-4 py-4 text-xs">
                <div class="text-gray-400">${osInfo}</div>
                <div class="text-gray-500">Used: ${usage}x</div>
            </td>
            <td class="px-4 py-4">
                <button onclick="toggleLicenseStatus(${l.id})" class="px-2 py-1 rounded text-xs font-medium ${statusClass} hover:opacity-80 transition-opacity">
                    ${l.is_active ? 'Active' : 'Inactive'}
                </button>
            </td>
            <td class="px-4 py-4 text-gray-400 text-xs">${lastUsed}</td>
            <td class="px-4 py-4 text-right">
                <div class="flex justify-end gap-1">
                    <button onclick="openLicenseInfo(${l.id})" class="action-btn p-1.5" title="View Details">
                        <i data-lucide="info" class="w-3.5 h-3.5"></i>
                    </button>
                    <button onclick="deleteLicense(${l.id})" class="action-btn danger p-1.5" title="Delete">
                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                    </button>
                </div>
            </td>
        </tr>
    `}).join('');

    lucide.createIcons();
    updateLicensePagination(start + 1, Math.min(end, data.length), data.length);
    updateBulkBar();
}

function updateLicensePagination(start, end, total) {
    const infoEl = document.getElementById('licensePageInfo');
    const prevBtn = document.getElementById('licensePrevBtn');
    const nextBtn = document.getElementById('licenseNextBtn');

    if (infoEl) infoEl.textContent = total > 0 ? `Showing ${start}-${end} of ${total}` : 'No results';
    if (prevBtn) prevBtn.disabled = licenseCurrentPage <= 1;
    if (nextBtn) nextBtn.disabled = end >= total;
}

function licensePrevPage() {
    if (licenseCurrentPage > 1) {
        licenseCurrentPage--;
        renderLicenseList();
    }
}

function licenseNextPage() {
    const data = licenseFilterActive ? filteredLicenses : licenses;
    if (licenseCurrentPage * licensePageSize < data.length) {
        licenseCurrentPage++;
        renderLicenseList();
    }
}

// License selection for bulk actions
function toggleLicenseSelection(id) {
    if (selectedLicenseIds.has(id)) {
        selectedLicenseIds.delete(id);
    } else {
        selectedLicenseIds.add(id);
    }
    updateBulkBar();
    renderLicenseList();
}

function toggleAllLicenses() {
    const checkbox = document.getElementById('selectAllLicenses');
    const data = licenseFilterActive ? filteredLicenses : licenses;
    const start = (licenseCurrentPage - 1) * licensePageSize;
    const pageData = data.slice(start, start + licensePageSize);

    if (checkbox.checked) {
        pageData.forEach(l => selectedLicenseIds.add(l.id));
    } else {
        pageData.forEach(l => selectedLicenseIds.delete(l.id));
    }

    updateBulkBar();
    renderLicenseList();
}

function clearLicenseSelection() {
    selectedLicenseIds.clear();
    document.getElementById('selectAllLicenses').checked = false;
    updateBulkBar();
    renderLicenseList();
}

function updateBulkBar() {
    const bar = document.getElementById('licenseBulkBar');
    const countEl = document.getElementById('licenseSelectedCount');

    if (selectedLicenseIds.size > 0) {
        bar.classList.remove('hidden');
        countEl.textContent = selectedLicenseIds.size;
    } else {
        bar.classList.add('hidden');
    }
}

async function bulkToggleLicenses() {
    if (selectedLicenseIds.size === 0) return;

    showConfirm('Toggle Licenses', `Toggle status for ${selectedLicenseIds.size} selected licenses?`, async (confirmed) => {
        if (!confirmed) return;

        let successCount = 0;
        for (const id of selectedLicenseIds) {
            try {
                const res = await fetch(`/api/licenses/${id}/toggle`, {
                    method: 'POST',
                    headers: { 'Authorization': token }
                });
                const data = await res.json();
                if (data.success) {
                    const l = licenses.find(x => x.id === id);
                    if (l) l.is_active = data.is_active;
                    successCount++;
                }
            } catch (e) { }
        }

        clearLicenseSelection();
        renderLicenseList();
        showToast('Done', `Toggled ${successCount} licenses`, 'success');
    });
}

async function bulkDeleteLicenses() {
    if (selectedLicenseIds.size === 0) return;

    showConfirm('Delete Licenses', `Delete ${selectedLicenseIds.size} selected licenses? This cannot be undone.`, async (confirmed) => {
        if (!confirmed) return;

        let successCount = 0;
        for (const id of selectedLicenseIds) {
            try {
                const res = await fetch(`/api/licenses/${id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': token }
                });
                const data = await res.json();
                if (data.success) {
                    licenses = licenses.filter(l => l.id !== id);
                    successCount++;
                }
            } catch (e) { }
        }

        clearLicenseSelection();
        filterLicenses();
        showToast('Deleted', `Deleted ${successCount} licenses`, 'success');
    });
}

async function toggleLicenseStatus(id) {
    try {
        const res = await fetch(`/api/licenses/${id}/toggle`, {
            method: 'POST',
            headers: { 'Authorization': token }
        });
        const data = await res.json();
        if (data.success) {
            const l = licenses.find(x => x.id === id);
            if (l) l.is_active = data.is_active;
            renderLicenseList();
            showToast('Updated', `License ${data.is_active ? 'activated' : 'deactivated'}`, 'success');
        } else {
            showToast('Error', data.error, 'error');
        }
    } catch (e) {
        showToast('Error', 'Failed to toggle license', 'error');
    }
}

// ============================================
// LOGS FILTERING & PAGINATION
// ============================================
let logsCurrentPage = 1;
const logsPageSize = 30;
let filteredLogs = [];

function filterLogs() {
    const search = document.getElementById('logsSearch')?.value.toLowerCase() || '';
    const actionFilter = document.getElementById('logsActionFilter')?.value || 'all';
    const dateFilter = document.getElementById('logsDateFilter')?.value || 'all';

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    filteredLogs = logs.filter(l => {
        const matchSearch = !search ||
            l.action.toLowerCase().includes(search) ||
            (l.details || '').toLowerCase().includes(search) ||
            (l.ip || '').toLowerCase().includes(search);

        const matchAction = actionFilter === 'all' ||
            l.action.includes(actionFilter);

        const logDate = new Date(l.created_at);
        let matchDate = true;
        if (dateFilter === 'today') matchDate = logDate >= today;
        else if (dateFilter === 'week') matchDate = logDate >= weekAgo;
        else if (dateFilter === 'month') matchDate = logDate >= monthAgo;

        return matchSearch && matchAction && matchDate;
    });

    logsCurrentPage = 1;
    renderFilteredLogs();
}

function renderFilteredLogs() {
    const tbody = document.getElementById('logsList');
    const data = filteredLogs.length > 0 || document.getElementById('logsSearch')?.value ? filteredLogs : logs;

    if (data.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="px-6 py-12">
                    <div class="empty-state">
                        <div class="empty-state-icon"><i data-lucide="file-text" class="w-7 h-7"></i></div>
                        <div class="empty-state-title">No logs found</div>
                        <div class="empty-state-desc">Activity will appear here when projects are executed</div>
                    </div>
                </td>
            </tr>
        `;
        lucide.createIcons();
        updateLogsPagination(0, 0);
        return;
    }

    // Pagination
    const start = (logsCurrentPage - 1) * logsPageSize;
    const end = start + logsPageSize;
    const pageData = data.slice(start, end);

    tbody.innerHTML = pageData.map(l => {
        const isNew = (new Date() - new Date(l.created_at)) < 5000;
        let actionClass = 'action-badge ';
        if (l.action.includes('LOAD')) actionClass += 'load';
        else if (l.action.includes('CREATE')) actionClass += 'create';
        else if (l.action.includes('UPDATE')) actionClass += 'update';
        else if (l.action.includes('DELETE')) actionClass += 'delete';
        else if (l.action.includes('INVALID')) actionClass += 'invalid';
        else if (l.action.includes('BLOCK')) actionClass += 'block';
        else if (l.action.includes('TOGGLE')) actionClass += 'toggle';
        else if (l.action.includes('LICENSE')) actionClass += 'license';

        return `
        <tr class="hover:bg-[#27272a] transition-colors ${isNew ? 'bg-indigo-500/10' : ''}">
            <td class="px-6 py-4 text-gray-500 text-xs">${new Date(l.created_at).toLocaleString()}</td>
            <td class="px-6 py-4"><span class="${actionClass}">${l.action}</span></td>
            <td class="px-6 py-4 text-gray-400 text-sm max-w-md truncate" title="${l.details || ''}">${l.details || '-'}</td>
            <td class="px-6 py-4 font-mono text-gray-400 text-xs">${l.ip || '-'}</td>
        </tr>
    `}).join('');

    updateLogsPagination(start + 1, Math.min(end, data.length), data.length);
}

function updateLogsPagination(start, end, total) {
    const infoEl = document.getElementById('logsPageInfo');
    const prevBtn = document.getElementById('logsPrevBtn');
    const nextBtn = document.getElementById('logsNextBtn');

    if (infoEl) infoEl.textContent = total > 0 ? `Showing ${start}-${end} of ${total}` : 'No results';
    if (prevBtn) prevBtn.disabled = logsCurrentPage <= 1;
    if (nextBtn) nextBtn.disabled = end >= total;
}

function logsPrevPage() {
    if (logsCurrentPage > 1) {
        logsCurrentPage--;
        renderFilteredLogs();
    }
}

function logsNextPage() {
    const data = filteredLogs.length > 0 ? filteredLogs : logs;
    if (logsCurrentPage * logsPageSize < data.length) {
        logsCurrentPage++;
        renderFilteredLogs();
    }
}

async function exportLogs() {
    const data = filteredLogs.length > 0 ? filteredLogs : logs;
    const csv = 'Time,Action,Details,IP\\n' + data.map(l =>
        `"${new Date(l.created_at).toLocaleString()}","${l.action}","${(l.details || '').replace(/"/g, '""')}","${l.ip || ''}"`
    ).join('\\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs-${workspaceData.name}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported', 'Logs exported to CSV', 'success');
}

async function clearAllLogs() {
    showConfirm('Clear All Logs', 'Are you sure you want to clear all logs? This cannot be undone.', async (confirmed) => {
        if (!confirmed) return;

        try {
            const res = await fetch(`/api/workspaces/${workspaceIdentifier}/logs`, {
                method: 'DELETE',
                headers: { 'Authorization': token }
            });
            const data = await res.json();
            if (data.success) {
                logs = [];
                filteredLogs = [];
                renderFilteredLogs();
                showToast('Cleared', 'All logs have been cleared', 'success');
            } else {
                showToast('Error', data.error || 'Failed to clear logs', 'error');
            }
        } catch (e) {
            showToast('Error', 'Failed to clear logs', 'error');
        }
    });
}

// ============================================
// ACCESS CONTROL FILTERING
// ============================================
let filteredAccess = [];

function filterAccess() {
    const search = document.getElementById('accessSearch')?.value.toLowerCase() || '';
    const typeFilter = document.getElementById('accessTypeFilter')?.value || 'all';

    filteredAccess = accessRules.filter(r => {
        const matchSearch = !search ||
            r.identifier.toLowerCase().includes(search) ||
            (r.note || '').toLowerCase().includes(search);

        const matchType = typeFilter === 'all' || r.type === typeFilter;

        return matchSearch && matchType;
    });

    renderFilteredAccess();
}

function renderFilteredAccess() {
    const tbody = document.getElementById('accessList');
    const data = filteredAccess.length > 0 || document.getElementById('accessSearch')?.value ? filteredAccess : accessRules;

    if (data.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="px-6 py-12">
                    <div class="empty-state">
                        <div class="empty-state-icon"><i data-lucide="shield" class="w-7 h-7"></i></div>
                        <div class="empty-state-title">No access rules</div>
                        <div class="empty-state-desc">Add whitelist or blacklist rules to control access</div>
                    </div>
                </td>
            </tr>
        `;
        lucide.createIcons();
        return;
    }

    tbody.innerHTML = data.map(i => {
        const typeClass = i.type === 'whitelist' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500';
        const typeIcon = i.type === 'whitelist' ? 'check-circle' : 'x-circle';
        return `
        <tr class="hover:bg-[#27272a] transition-colors">
            <td class="px-6 py-4">
                <span class="px-2 py-1 rounded text-xs font-medium ${typeClass} inline-flex items-center gap-1">
                    <i data-lucide="${typeIcon}" class="w-3 h-3"></i>
                    ${i.type.toUpperCase()}
                </span>
            </td>
            <td class="px-6 py-4">
                <div class="flex items-center gap-2">
                    <code class="text-gray-300 text-sm">${escapeHtml(i.identifier)}</code>
                    <button onclick="copyToClipboard('${escapeHtml(i.identifier)}')" class="text-gray-500 hover:text-gray-300">
                        <i data-lucide="copy" class="w-3 h-3"></i>
                    </button>
                </div>
            </td>
            <td class="px-6 py-4 text-gray-400">${escapeHtml(i.note || '-')}</td>
            <td class="px-6 py-4 text-gray-500 text-xs">${new Date(i.created_at).toLocaleDateString()}</td>
            <td class="px-6 py-4 text-right">
                <button onclick="deleteAccessRule(${i.id})" class="action-btn danger p-1.5" title="Delete">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                </button>
            </td>
        </tr>
    `}).join('');
    lucide.createIcons();
}

// Override original render functions to use filtered versions
const _originalRenderLogsList = renderLogsList;
renderLogsList = function () {
    if (document.getElementById('logsSearch')?.value || document.getElementById('logsActionFilter')?.value !== 'all' || document.getElementById('logsDateFilter')?.value !== 'all') {
        filterLogs();
    } else {
        filteredLogs = [];
        renderFilteredLogs();
    }
};

const _originalRenderAccessList = renderAccessList;
renderAccessList = function () {
    if (document.getElementById('accessSearch')?.value || document.getElementById('accessTypeFilter')?.value !== 'all') {
        filterAccess();
    } else {
        filteredAccess = [];
        renderFilteredAccess();
    }
};

// Update project filter when loading licenses
const _originalLoadLicenses = loadLicenses;
loadLicenses = async function (showLoading = true, forceReload = false) {
    await _originalLoadLicenses(showLoading, forceReload);
    updateLicenseProjectFilter();
    filteredLicenses = [];
    licenseFilterActive = false;
    return licenses;
};

// Refresh functions for views
async function refreshLicenses() {
    showToast('Refreshing', 'Loading licenses...', 'info', 1500);
    await loadLicenses(true, true);
    showToast('Done', 'Licenses refreshed', 'success');
}

async function refreshLogs() {
    showToast('Refreshing', 'Loading logs...', 'info', 1500);
    await loadLogs(true, true);
    showToast('Done', 'Logs refreshed', 'success');
}

async function refreshAccess() {
    showToast('Refreshing', 'Loading access rules...', 'info', 1500);
    await loadAccessList(true, true);
    showToast('Done', 'Access rules refreshed', 'success');
}

// ============================================
// TEAM MANAGEMENT
// ============================================

async function loadTeam() {
    try {
        const res = await fetch(`/api/workspaces/${workspaceIdentifier}/team`, {
            headers: { 'Authorization': token }
        });
        const data = await res.json();

        if (!data.success) {
            showToast('Error', data.error, 'error');
            return;
        }

        teamData = data;
        renderTeam();
    } catch (e) {
        showToast('Error', 'Failed to load team', 'error');
    }
}

function renderTeam() {
    const container = document.getElementById('teamMembersList');
    const canManage = ['owner', 'admin'].includes(teamData.currentUserRole);

    // Show/hide invite button based on permission
    const inviteBtn = document.getElementById('inviteBtn');
    if (inviteBtn) {
        inviteBtn.style.display = canManage ? 'flex' : 'none';
    }

    let html = '';

    // Render owner first
    if (teamData.owner) {
        html += renderTeamMemberRow(teamData.owner, true, false);
    }

    // Render members
    if (teamData.members.length === 0 && !teamData.owner) {
        html = '<div class="text-gray-500 text-sm">No team members yet</div>';
    } else {
        teamData.members.forEach(member => {
            html += renderTeamMemberRow(member, false, canManage);
        });
    }

    container.innerHTML = html;
    lucide.createIcons();
}

function renderTeamMemberRow(member, isOwner, canManage) {
    const roleColors = {
        owner: 'amber',
        admin: 'red',
        editor: 'blue',
        viewer: 'gray'
    };
    const roleIcons = {
        owner: 'crown',
        admin: 'shield',
        editor: 'pencil',
        viewer: 'eye'
    };

    const role = member.role || 'viewer';
    const color = roleColors[role] || 'gray';
    const icon = roleIcons[role] || 'user';
    const displayName = member.display_name || member.email?.split('@')[0] || 'Unknown';
    const avatar = member.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=27272a&color=fff&size=40`;

    return `
        <div class="flex items-center justify-between p-3 bg-[#09090b] rounded-lg group hover:bg-[#0f0f11] transition-colors">
            <div class="flex items-center gap-3">
                <img src="${avatar}" alt="${displayName}" class="w-10 h-10 rounded-full object-cover">
                <div>
                    <div class="flex items-center gap-2">
                        <p class="font-medium text-white text-sm">${displayName}</p>
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-${color}-500/10 text-${color}-400">
                            <i data-lucide="${icon}" class="w-3 h-3"></i>
                            ${role.charAt(0).toUpperCase() + role.slice(1)}
                        </span>
                    </div>
                    <p class="text-xs text-gray-500">${member.email || ''}</p>
                </div>
            </div>
            ${!isOwner && canManage ? `
                <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <select onchange="changeRole(${member.id}, this.value)" class="bg-[#18181b] border border-[#27272a] rounded px-2 py-1 text-xs text-gray-300">
                        <option value="viewer" ${role === 'viewer' ? 'selected' : ''}>Viewer</option>
                        <option value="editor" ${role === 'editor' ? 'selected' : ''}>Editor</option>
                        <option value="admin" ${role === 'admin' ? 'selected' : ''}>Admin</option>
                    </select>
                    <button onclick="removeMember(${member.id}, '${displayName}')" class="p-1.5 text-gray-500 hover:text-red-400 transition-colors" title="Remove member">
                        <i data-lucide="user-minus" class="w-4 h-4"></i>
                    </button>
                </div>
            ` : ''}
        </div>
    `;
}

function openInviteModal() {
    document.getElementById('inviteEmail').value = '';
    document.getElementById('inviteRole').value = 'viewer';
    document.getElementById('inviteLinkResult').classList.add('hidden');
    document.getElementById('sendInviteBtn').disabled = false;
    document.getElementById('inviteModal').style.display = 'flex';
    setTimeout(() => document.getElementById('inviteEmail').focus(), 100);
}

function closeInviteModal() {
    document.getElementById('inviteModal').style.display = 'none';
}

async function sendInvite() {
    const email = document.getElementById('inviteEmail').value.trim();
    const role = document.getElementById('inviteRole').value;

    if (!email) {
        showToast('Error', 'Please enter an email address', 'error');
        return;
    }

    if (!email.includes('@')) {
        showToast('Error', 'Please enter a valid email address', 'error');
        return;
    }

    const btn = document.getElementById('sendInviteBtn');
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Sending...';

    try {
        const res = await fetch(`/api/workspaces/${workspaceIdentifier}/team/invite`, {
            method: 'POST',
            headers: {
                'Authorization': token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, role })
        });

        const data = await res.json();

        if (data.success) {
            if (data.added) {
                // User was added directly (already registered)
                showToast('Success', `${email} added to team as ${role}`, 'success');
                closeInviteModal();
                loadTeam();
            } else {
                // Show invite link
                document.getElementById('inviteLinkInput').value = data.inviteLink;
                document.getElementById('inviteLinkResult').classList.remove('hidden');
                showToast('Success', 'Invitation created! Share the link below.', 'success');
                loadTeam();
            }
        } else {
            showToast('Error', data.error, 'error');
        }
    } catch (e) {
        showToast('Error', 'Failed to send invitation', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="send" class="w-4 h-4"></i> Send Invite';
        lucide.createIcons();
    }
}

function copyInviteLink() {
    const link = document.getElementById('inviteLinkInput').value;
    navigator.clipboard.writeText(link).then(() => {
        showToast('Copied', 'Invite link copied to clipboard', 'success');
    });
}

async function changeRole(memberId, newRole) {
    try {
        const res = await fetch(`/api/workspaces/${workspaceIdentifier}/team/${memberId}`, {
            method: 'PUT',
            headers: {
                'Authorization': token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ role: newRole })
        });

        const data = await res.json();

        if (data.success) {
            showToast('Success', `Role updated to ${newRole}`, 'success');
            loadTeam();
        } else {
            showToast('Error', data.error, 'error');
            loadTeam(); // Refresh to revert select
        }
    } catch (e) {
        showToast('Error', 'Failed to update role', 'error');
        loadTeam();
    }
}

async function removeMember(memberId, name) {
    showConfirm('Remove Member', `Are you sure you want to remove ${name} from this workspace?`, async (confirmed) => {
        if (!confirmed) return;

        try {
            const res = await fetch(`/api/workspaces/${workspaceIdentifier}/team/${memberId}`, {
                method: 'DELETE',
                headers: { 'Authorization': token }
            });

            const data = await res.json();

            if (data.success) {
                showToast('Success', `${name} removed from team`, 'success');
                loadTeam();
            } else {
                showToast('Error', data.error, 'error');
            }
        } catch (e) {
            showToast('Error', 'Failed to remove member', 'error');
        }
    });
}

async function cancelInvite(inviteId) {
    try {
        const res = await fetch(`/api/workspaces/${workspaceIdentifier}/invitations/${inviteId}`, {
            method: 'DELETE',
            headers: { 'Authorization': token }
        });

        const data = await res.json();

        if (data.success) {
            showToast('Success', 'Invitation cancelled', 'success');
            loadTeam();
        } else {
            showToast('Error', data.error, 'error');
        }
    } catch (e) {
        showToast('Error', 'Failed to cancel invitation', 'error');
    }
}

async function refreshTeam() {
    showToast('Refreshing', 'Loading team...', 'info', 1500);
    await loadTeam();
    showToast('Done', 'Team refreshed', 'success');
}

// ============================================
// ROLE-BASED UI PERMISSIONS
// ============================================

function applyRolePermissions() {
    console.log('Applying role permissions for:', currentUserRole);

    // Helper to disable element with visual feedback
    function disableElement(selector, reason = '') {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
            el.classList.add('permission-disabled');
            if (reason) el.setAttribute('title', reason);
            el.setAttribute('data-original-title', el.getAttribute('title') || '');
        });
    }

    // Helper to enable element
    function enableElement(selector) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
            el.classList.remove('permission-disabled');
            const originalTitle = el.getAttribute('data-original-title');
            if (originalTitle) el.setAttribute('title', originalTitle);
        });
    }

    // Reset all permissions first
    document.querySelectorAll('.permission-disabled').forEach(el => {
        el.classList.remove('permission-disabled');
    });

    // Update role indicator in sidebar
    const roleIndicator = document.getElementById('roleIndicator');
    const roleText = document.getElementById('roleText');
    const roleIcons = { owner: 'crown', admin: 'shield', editor: 'pencil', viewer: 'eye' };

    if (roleIndicator && currentUserRole !== 'owner') {
        roleIndicator.style.display = 'block';
        const badge = roleIndicator.querySelector('.role-indicator');
        if (badge) {
            badge.className = `role-indicator ${currentUserRole}`;
            const icon = badge.querySelector('i');
            if (icon) {
                icon.setAttribute('data-lucide', roleIcons[currentUserRole] || 'user');
            }
        }
        if (roleText) {
            roleText.textContent = currentUserRole.charAt(0).toUpperCase() + currentUserRole.slice(1);
        }
        try { lucide.createIcons(); } catch (e) { console.warn('lucide.createIcons error:', e); }
    } else if (roleIndicator) {
        roleIndicator.style.display = 'none';
    }

    // If owner, no restrictions
    if (currentUserRole === 'owner') {
        return;
    }

    // VIEWER: Can only view and see logs
    if (currentUserRole === 'viewer') {
        // Disable all editing in sidebar
        disableElement('[onclick="openCreateProjectModal()"]', 'Viewers cannot create projects');

        // Disable editor buttons (save, format, duplicate, rename, delete)
        disableElement('#view-editor .flex.gap-2 button', 'Viewers cannot edit projects');

        // Disable project settings panel
        disableElement('#project-settings-panel #settings-panel-content', 'Viewers cannot change project settings');

        // Disable file list actions (power toggle, delete)
        setTimeout(() => {
            document.querySelectorAll('#fileList button').forEach(btn => {
                btn.classList.add('permission-disabled');
                btn.setAttribute('title', 'Viewers cannot modify projects');
            });
        }, 100);

        // Disable license actions
        disableElement('[onclick="openCreateLicenseModal()"]', 'Viewers cannot create licenses');
        disableElement('[onclick="exportLicenses()"]', 'Viewers cannot export licenses');

        // Disable access control actions
        disableElement('[onclick="openAddAccessModal()"]', 'Viewers cannot add access rules');

        // Disable team management (already handled in renderTeam)
        disableElement('#inviteBtn', 'Viewers cannot invite members');

        // Disable all settings
        disableElement('#view-settings input', 'Viewers cannot change settings');
        disableElement('#view-settings select', 'Viewers cannot change settings');
        disableElement('#view-settings button', 'Viewers cannot change settings');

        // Disable log actions (clear, export)
        disableElement('[onclick="clearAllLogs()"]', 'Viewers cannot clear logs');
    }

    // EDITOR: Can edit scripts and manage licenses, but not access/team/settings
    if (currentUserRole === 'editor') {
        // Disable access control actions
        disableElement('[onclick="openAddAccessModal()"]', 'Editors cannot manage access rules');
        disableElement('#view-access button:not([onclick*="refresh"])', 'Editors cannot manage access rules');

        // Disable team management
        disableElement('#inviteBtn', 'Editors cannot invite members');

        // Disable workspace settings (except viewing)
        disableElement('#view-settings input', 'Editors cannot change workspace settings');
        disableElement('#view-settings select', 'Editors cannot change workspace settings');
        disableElement('#view-settings button:not([onclick*="copy"])', 'Editors cannot change workspace settings');

        // Disable delete workspace
        disableElement('[onclick*="deleteWorkspace"]', 'Editors cannot delete workspace');
    }

    // ADMIN: Can do most things except critical owner actions
    if (currentUserRole === 'admin') {
        // Disable delete workspace
        disableElement('[onclick*="deleteWorkspace"]', 'Only owner can delete workspace');

        // Disable changing critical workspace settings (if any)
        disableElement('#dangerZone', 'Only owner can access danger zone');
    }

    // Reapply icons since some elements may have been modified
    lucide.createIcons();
}

// Re-apply permissions after list renders
const _originalRenderFileList = renderFileList;
renderFileList = function () {
    _originalRenderFileList();
    if (currentUserRole === 'viewer') {
        setTimeout(() => {
            document.querySelectorAll('#fileList button').forEach(btn => {
                btn.classList.add('permission-disabled');
            });
        }, 50);
    }
};

// Override renderLicenseList to apply permissions
const _origRenderLicenseList = renderLicenseList;
renderLicenseList = function () {
    _origRenderLicenseList();
    if (currentUserRole === 'viewer') {
        setTimeout(() => {
            // Disable all license action buttons for viewers
            document.querySelectorAll('#licenseList button').forEach(btn => {
                btn.classList.add('permission-disabled');
            });
            document.querySelectorAll('#licenseList input[type="checkbox"]').forEach(cb => {
                cb.disabled = true;
            });
        }, 50);
    }
};

// Override renderAccessList to apply permissions  
const _origRenderFilteredAccess = typeof renderFilteredAccess !== 'undefined' ? renderFilteredAccess : null;
if (_origRenderFilteredAccess) {
    renderFilteredAccess = function () {
        _origRenderFilteredAccess();
        if (currentUserRole === 'viewer' || currentUserRole === 'editor') {
            setTimeout(() => {
                // Disable all access action buttons for viewers and editors
                document.querySelectorAll('#accessList button').forEach(btn => {
                    btn.classList.add('permission-disabled');
                });
            }, 50);
        }
    };
}

// ============================================
// PIN PROTECTION
// ============================================

// Initialize PIN input auto-focus behavior
function initPinInputs(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const inputs = container.querySelectorAll('.pin-input');
    inputs.forEach((input, index) => {
        // Handle input
        input.addEventListener('input', (e) => {
            // Only allow digits
            e.target.value = e.target.value.replace(/[^0-9]/g, '');

            // Toggle filled class for styling
            if (e.target.value) {
                e.target.classList.add('filled');
            } else {
                e.target.classList.remove('filled');
            }

            if (e.target.value && index < inputs.length - 1) {
                inputs[index + 1].focus();
            }
        });

        // Handle backspace
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !e.target.value && index > 0) {
                inputs[index - 1].focus();
                inputs[index - 1].classList.remove('filled');
            }
            // Handle Enter to submit
            if (e.key === 'Enter') {
                if (containerId === 'pinInputContainer') {
                    savePin();
                } else if (containerId === 'pinVerifyContainer') {
                    submitPinVerification();
                }
            }
        });

        // Handle paste
        input.addEventListener('paste', (e) => {
            e.preventDefault();
            const pasteData = e.clipboardData.getData('text').replace(/[^0-9]/g, '').slice(0, 6);
            pasteData.split('').forEach((char, i) => {
                if (inputs[i]) {
                    inputs[i].value = char;
                    inputs[i].classList.add('filled');
                }
            });
            if (pasteData.length > 0) inputs[Math.min(pasteData.length, 5)].focus();
        });
    });
}

// Get PIN from inputs
function getPinFromInputs(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return '';
    const inputs = container.querySelectorAll('.pin-input');
    return Array.from(inputs).map(i => i.value).join('');
}

// Clear PIN inputs
function clearPinInputs(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('.pin-input').forEach(i => i.value = '');
    container.querySelector('.pin-input')?.focus();
}

// Toggle PIN protection (checkbox change)
function togglePinProtection() {
    const enabled = document.getElementById('pinEnabledToggle').checked;
    const form = document.getElementById('pinSettingsForm');

    if (enabled) {
        form.classList.remove('hidden');
        clearPinInputs('pinInputContainer');
        initPinInputs('pinInputContainer');
    } else {
        form.classList.add('hidden');
        // If PIN was previously enabled, ask to confirm removal
        if (workspaceData.pin_enabled) {
            removePin();
        }
    }
}

// Save PIN
async function savePin() {
    const pin = getPinFromInputs('pinInputContainer');

    if (pin.length !== 6) {
        showToast('Error', 'Please enter all 6 digits', 'error');
        return;
    }

    try {
        const res = await fetch(`/api/workspaces/${workspaceIdentifier}/pin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': token },
            body: JSON.stringify({ pin })
        });
        const data = await res.json();

        if (data.success) {
            workspaceData.pin_enabled = 1;
            showToast('Success', 'PIN protection enabled', 'success');
            clearPinInputs('pinInputContainer');
        } else {
            showToast('Error', data.error || 'Failed to set PIN', 'error');
        }
    } catch (e) {
        showToast('Error', 'Failed to set PIN', 'error');
    }
}

// Remove PIN
async function removePin() {
    showConfirm('Remove PIN', 'Are you sure you want to remove PIN protection?', async (confirmed) => {
        if (!confirmed) {
            document.getElementById('pinEnabledToggle').checked = true;
            document.getElementById('pinSettingsForm').classList.remove('hidden');
            return;
        }

        try {
            const res = await fetch(`/api/workspaces/${workspaceIdentifier}/pin`, {
                method: 'DELETE',
                headers: { 'Authorization': token }
            });
            const data = await res.json();

            if (data.success) {
                workspaceData.pin_enabled = 0;
                document.getElementById('pinEnabledToggle').checked = false;
                document.getElementById('pinSettingsForm').classList.add('hidden');
                showToast('Success', 'PIN protection removed', 'success');
            } else {
                showToast('Error', data.error || 'Failed to remove PIN', 'error');
            }
        } catch (e) {
            showToast('Error', 'Failed to remove PIN', 'error');
        }
    });
}

// Check if PIN verification is required (uses localStorage token and pinVerified flag)
function checkPinRequired() {
    // If already verified this session (via pinVerified flag), skip
    if (pinVerified) return false;

    // If no PIN enabled on workspace, no check needed
    if (!workspaceData.pin_enabled) return false;

    // Check if we have a valid token in localStorage
    const pinToken = localStorage.getItem(`pin_token_${workspaceIdentifier}`);
    const expiresAt = localStorage.getItem(`pin_token_expires_${workspaceIdentifier}`);

    if (pinToken && expiresAt) {
        if (Date.now() < parseInt(expiresAt)) {
            return false; // Token still valid
        }
        // Token expired, remove it
        localStorage.removeItem(`pin_token_${workspaceIdentifier}`);
        localStorage.removeItem(`pin_token_expires_${workspaceIdentifier}`);
    }

    return true; // PIN required
}

// Show PIN verification modal
function showPinVerifyModal() {
    const modal = document.getElementById('pinVerifyModal');
    modal.style.display = 'flex';
    initPinInputs('pinVerifyContainer');
    clearPinInputs('pinVerifyContainer');
    document.getElementById('pinVerifyError').classList.add('hidden');
    lucide.createIcons();
}

// Submit PIN verification
async function submitPinVerification() {
    const pin = getPinFromInputs('pinVerifyContainer');
    const errorEl = document.getElementById('pinVerifyError');

    if (pin.length !== 6) {
        errorEl.textContent = 'Please enter all 6 digits';
        errorEl.classList.remove('hidden');
        return;
    }

    try {
        const res = await fetch(`/api/workspaces/${workspaceIdentifier}/pin/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': token },
            body: JSON.stringify({ pin })
        });
        const data = await res.json();

        if (data.success && data.verified) {
            // Store token in localStorage for API requests
            localStorage.setItem(`pin_token_${workspaceIdentifier}`, data.token);

            // Also store expiry for cleanup
            localStorage.setItem(`pin_token_expires_${workspaceIdentifier}`, data.expiresAt.toString());

            // Mark as verified for this session
            pinVerified = true;

            // Hide modal
            document.getElementById('pinVerifyModal').style.display = 'none';
            showToast('Success', 'PIN verified', 'success');

            // Reset lock and reload workspace data with verified token
            isLoadingWorkspace = false;
            await loadWorkspaceData();
        } else {
            // Show error with shake animation
            errorEl.textContent = data.error || 'Invalid PIN';
            errorEl.classList.remove('hidden');
            document.querySelectorAll('#pinVerifyContainer .pin-input').forEach(i => {
                i.classList.add('error');
                setTimeout(() => i.classList.remove('error'), 400);
            });
            clearPinInputs('pinVerifyContainer');
        }
    } catch (e) {
        errorEl.textContent = 'Verification failed';
        errorEl.classList.remove('hidden');
    }
}

// Initialize PIN settings in workspace settings page
function initPinSettings() {
    // Only show for owner
    if (currentUserRole !== 'owner') {
        document.getElementById('pinProtectionSection').style.display = 'none';
        return;
    }

    document.getElementById('pinProtectionSection').style.display = 'block';

    const toggle = document.getElementById('pinEnabledToggle');
    const form = document.getElementById('pinSettingsForm');

    toggle.checked = workspaceData.pin_enabled === 1;

    if (toggle.checked) {
        form.classList.remove('hidden');
    } else {
        form.classList.add('hidden');
    }

    initPinInputs('pinInputContainer');
}

// Update loadSettings to include PIN init
const _originalLoadSettings = typeof loadSettings === 'function' ? loadSettings : () => { };
loadSettings = function () {
    _originalLoadSettings();
    initPinSettings();
};

// ========================================
// PRIVACY BLUR PROTECTION
// ========================================

let privacyWarningEl = null;

// Create privacy warning overlay
function createPrivacyWarning() {
    if (document.getElementById('privacyWarning')) return;

    const warning = document.createElement('div');
    warning.id = 'privacyWarning';
    warning.className = 'privacy-warning';
    warning.style.display = 'none';
    warning.innerHTML = `
        <div class="privacy-warning-icon">
            <i data-lucide="shield-alert"></i>
        </div>
        <h3>Content Protected</h3>
        <p>Click anywhere to reveal content</p>
    `;
    document.body.appendChild(warning);
    privacyWarningEl = warning;
    lucide.createIcons();
}

// Activate privacy blur
function activatePrivacyBlur() {
    if (!privacyModeEnabled) return;

    document.body.classList.add('privacy-blur-active');
    if (privacyWarningEl) {
        privacyWarningEl.style.display = 'block';
    }
}

// Deactivate privacy blur
function deactivatePrivacyBlur() {
    document.body.classList.remove('privacy-blur-active');
    if (privacyWarningEl) {
        privacyWarningEl.style.display = 'none';
    }
}

// Toggle privacy mode setting
function togglePrivacyMode() {
    privacyModeEnabled = !privacyModeEnabled;
    localStorage.setItem('privacyMode', privacyModeEnabled);

    const toggle = document.getElementById('privacyToggle');
    if (toggle) {
        toggle.classList.toggle('active', privacyModeEnabled);
    }

    showToast(
        privacyModeEnabled ? 'Privacy Mode Enabled' : 'Privacy Mode Disabled',
        privacyModeEnabled ? 'Content will blur when tab loses focus during screen share' : 'Privacy blur protection is now off',
        privacyModeEnabled ? 'success' : 'info'
    );

    // If disabling, make sure to remove any active blur
    if (!privacyModeEnabled) {
        deactivatePrivacyBlur();
    }
}

// Initialize privacy mode listeners
function initPrivacyMode() {
    createPrivacyWarning();

    // Update toggle button state
    const toggle = document.getElementById('privacyToggle');
    if (toggle) {
        toggle.classList.toggle('active', privacyModeEnabled);
    }

    // Visibility change - tab switching, minimizing
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            activatePrivacyBlur();
        } else {
            // Small delay before removing blur to catch screenshot attempts
            setTimeout(deactivatePrivacyBlur, 150);
        }
    });

    // Window blur - losing focus to another app
    window.addEventListener('blur', () => {
        activatePrivacyBlur();
    });

    // Window focus - returning to window
    window.addEventListener('focus', () => {
        setTimeout(deactivatePrivacyBlur, 150);
    });

    // Click to dismiss blur (useful for false positives)
    document.addEventListener('click', (e) => {
        if (document.body.classList.contains('privacy-blur-active')) {
            if (e.target.closest('.privacy-warning') || e.target === document.body) {
                deactivatePrivacyBlur();
            }
        }
    });

    // Escape key to dismiss
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.body.classList.contains('privacy-blur-active')) {
            deactivatePrivacyBlur();
        }
    });
}

// Initialize privacy mode on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    installWorkspaceFetchGuard();
    initPrivacyMode();

    const retryButton = document.getElementById('networkRetryButton');
    if (retryButton) {
        retryButton.addEventListener('click', retryWorkspaceConnection);
    }

    window.addEventListener('offline', () => {
        setWorkspaceNetworkBanner(true, 'You are offline. Reconnect to continue syncing.');
    });
    window.addEventListener('online', () => {
        setWorkspaceNetworkBanner(false);
    });

    // Mobile sidebar toggle
    const sidebarToggle = document.getElementById('mobileSidebarToggle');
    const sidebarBackdrop = document.getElementById('mobileSidebarBackdrop');
    if (sidebarToggle) {
        sidebarToggle.setAttribute('aria-expanded', 'false');
        sidebarToggle.addEventListener('click', toggleMobileSidebar);
    }
    sidebarBackdrop?.addEventListener('click', closeMobileSidebar);
    window.addEventListener('resize', closeMobileSidebar);

    // Escape closes sidebar on mobile
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeMobileSidebar();
    });

    // Close modals on backdrop click
    document.querySelectorAll('[id$="Modal"]').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.style.display = 'none';
        });
    });
});

window.addEventListener('beforeunload', (event) => {
    if (hasUnsavedTabs()) {
        event.preventDefault();
        event.returnValue = '';
    }

    openTabs.forEach((tab) => clearAutoSaveTimer(tab.fileId));
    disconnectWorkspaceWebSocket({ allowReconnect: false });
});
