import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.DOCS_MOCK_API_PORT || 4181);
const TOKEN = 'docs-demo-token';
const PIN_TOKEN = 'docs-pin-token';
const NOW = new Date('2026-03-25T08:00:00.000Z');

const db = {
  users: {
    'user-docs': { id: 'user-docs', email: 'demo@guardscript.local', display_name: 'Ari Blueprint', role: 'owner', status: 'active', created_at: '2025-11-12T10:00:00.000Z' }
  },
  workspaces: {
    'ws-alpha': { id: 'ws-alpha', user_id: 'user-docs', name: 'Atlas Workspace', loader_key: 'atlas-loader-01', language: 'python', default_project_id: 'proj-main', default_script_id: 'proj-main', discord_webhook: '', pin_hash: null, pin_enabled: 0, created_at: '2026-02-18T09:00:00.000Z' },
    'ws-pin': { id: 'ws-pin', user_id: 'user-docs', name: 'Vault Workspace', loader_key: 'vault-loader-01', language: 'javascript', default_project_id: 'proj-vault', default_script_id: 'proj-vault', discord_webhook: '', pin_hash: 'pin-hash', pin_enabled: 1, created_at: '2026-02-24T09:00:00.000Z' }
  },
  members: [
    { id: 'mem-ops', workspace_id: 'ws-alpha', user_id: 'user-ops', role: 'admin', created_at: '2026-02-21T10:30:00.000Z' },
    { id: 'mem-qa', workspace_id: 'ws-alpha', user_id: 'user-qa', role: 'editor', created_at: '2026-02-22T12:15:00.000Z' }
  ],
  usersExtra: {
    'user-ops': { id: 'user-ops', email: 'ops@guardscript.local', display_name: 'Ops Relay', role: 'user', status: 'active', created_at: '2025-08-18T08:00:00.000Z' },
    'user-qa': { id: 'user-qa', email: 'qa@guardscript.local', display_name: 'QA Beacon', role: 'user', status: 'active', created_at: '2025-09-05T08:00:00.000Z' }
  },
  invitations: [
    { id: 'invite-1', workspace_id: 'ws-alpha', email: 'partner@guardscript.local', role: 'viewer', token: 'invite-1-token', invited_by: 'user-docs', expires_at: '2026-04-01T12:00:00.000Z', created_at: '2026-03-20T11:45:00.000Z' }
  ],
  projects: {
    'proj-main': { id: 'proj-main', workspace_id: 'ws-alpha', name: 'Core Loader', content: 'r2:proj-main.gz', secret_key: 'proj-main-secret', status: 'approved', is_active: 1, is_encrypted: 1, require_license: 1, require_hwid: 1, ip_whitelist_enabled: 1, max_executions: 1000, rate_limit: 60, execution_count: 128, created_at: '2026-02-19T10:00:00.000Z' },
    'proj-tools': { id: 'proj-tools', workspace_id: 'ws-alpha', name: 'Telemetry Tools', content: 'r2:proj-tools.gz', secret_key: 'proj-tools-secret', status: 'approved', is_active: 1, is_encrypted: 0, require_license: 0, require_hwid: 0, ip_whitelist_enabled: 0, max_executions: null, rate_limit: 30, execution_count: 34, created_at: '2026-02-23T10:00:00.000Z' },
    'proj-vault': { id: 'proj-vault', workspace_id: 'ws-pin', name: 'Vault Runner', content: 'r2:proj-vault.gz', secret_key: 'proj-vault-secret', status: 'approved', is_active: 1, is_encrypted: 1, require_license: 1, require_hwid: 1, ip_whitelist_enabled: 0, max_executions: 250, rate_limit: 45, execution_count: 16, created_at: '2026-02-25T09:45:00.000Z' }
  },
  files: {
    'proj-main': [
      { id: 'file-main', project_id: 'proj-main', parent_id: null, name: 'main.py', type: 'file', content: 'r2:file-main.gz', is_encrypted: 1, size: 1220, language: 'python', sort_order: 0, is_entry_point: 1, created_at: '2026-02-19T10:05:00.000Z', updated_at: '2026-03-23T10:00:00.000Z' },
      { id: 'folder-src', project_id: 'proj-main', parent_id: null, name: 'src', type: 'folder', content: null, is_encrypted: 0, size: 0, language: null, sort_order: 1, is_entry_point: 0, created_at: '2026-02-19T10:06:00.000Z', updated_at: '2026-03-23T10:00:00.000Z' },
      { id: 'file-helper', project_id: 'proj-main', parent_id: 'folder-src', name: 'helper.py', type: 'file', content: 'r2:file-helper.gz', is_encrypted: 0, size: 860, language: 'python', sort_order: 0, is_entry_point: 0, created_at: '2026-02-19T10:07:00.000Z', updated_at: '2026-03-24T08:10:00.000Z' },
      { id: 'file-config', project_id: 'proj-main', parent_id: null, name: 'config.json', type: 'file', content: 'r2:file-config.gz', is_encrypted: 0, size: 240, language: 'json', sort_order: 2, is_entry_point: 0, created_at: '2026-02-19T10:08:00.000Z', updated_at: '2026-03-24T08:15:00.000Z' }
    ],
    'proj-tools': [
      { id: 'file-tools', project_id: 'proj-tools', parent_id: null, name: 'telemetry.js', type: 'file', content: 'r2:file-tools.gz', is_encrypted: 0, size: 640, language: 'javascript', sort_order: 0, is_entry_point: 1, created_at: '2026-02-23T10:05:00.000Z', updated_at: '2026-03-24T09:30:00.000Z' }
    ],
    'proj-vault': [
      { id: 'file-vault', project_id: 'proj-vault', parent_id: null, name: 'runner.js', type: 'file', content: 'r2:file-vault.gz', is_encrypted: 1, size: 940, language: 'javascript', sort_order: 0, is_entry_point: 1, created_at: '2026-02-25T09:50:00.000Z', updated_at: '2026-03-24T11:00:00.000Z' }
    ]
  },
  licenses: [
    { id: 'lic-1', workspace_id: 'ws-alpha', key: 'ATLAS-LIC-A1B2C3D4-E5F6A7B8', note: 'Partner launch', expiration_date: '2026-06-30', script_id: 'proj-main', project_id: 'proj-main', is_active: 1, hwid_lock: 1, activated_hwid: 'HWID-ALPHA-1288-9A2F', activated_os: 'Windows 11', last_used_at: '2026-03-25T07:15:00.000Z', usage_count: 38, created_at: '2026-03-01T09:00:00.000Z' },
    { id: 'lic-2', workspace_id: 'ws-alpha', key: 'ATLAS-LIC-0F12AA99-BC34DD55', note: 'QA seat', expiration_date: '2026-05-15', script_id: 'proj-tools', project_id: 'proj-tools', is_active: 1, hwid_lock: 0, activated_hwid: null, activated_os: null, last_used_at: '2026-03-24T21:00:00.000Z', usage_count: 9, created_at: '2026-03-05T09:00:00.000Z' },
    { id: 'lic-3', workspace_id: 'ws-alpha', key: 'ATLAS-LIC-77EE44AA-11BB22CC', note: 'Internal test', expiration_date: '2026-07-12', script_id: 'proj-main', project_id: 'proj-main', is_active: 0, hwid_lock: 1, activated_hwid: 'HWID-BETA-2211-FF00', activated_os: 'macOS 14', last_used_at: '2026-03-23T10:00:00.000Z', usage_count: 4, created_at: '2026-03-10T09:00:00.000Z' }
  ],
  accessLists: [
    { id: 'acc-1', workspace_id: 'ws-alpha', type: 'whitelist', identifier: '203.0.113.10', note: 'Primary office IP', created_at: '2026-03-02T09:10:00.000Z' },
    { id: 'acc-2', workspace_id: 'ws-alpha', type: 'blacklist', identifier: '198.51.100.23', note: 'Blocked test host', created_at: '2026-03-11T09:10:00.000Z' },
    { id: 'acc-3', workspace_id: 'ws-alpha', type: 'whitelist', identifier: 'HWID-ALPHA-1288-9A2F', note: 'Field engineer laptop', created_at: '2026-03-15T09:10:00.000Z' }
  ],
  logs: [
    { id: 'log-1', workspace_id: 'ws-alpha', action: 'EXECUTE_SUCCESS', details: 'core_loader.py executed successfully', ip: '203.0.113.10', country: 'US', timestamp: Date.parse('2026-03-25T07:20:00.000Z'), created_at: '2026-03-25T07:20:00.000Z' },
    { id: 'log-2', workspace_id: 'ws-alpha', action: 'EXECUTE_BLOCKED', details: 'License expired for ATLAS-LIC-77EE44AA-11BB22CC', ip: '198.51.100.23', country: 'SG', timestamp: Date.parse('2026-03-25T06:30:00.000Z'), created_at: '2026-03-25T06:30:00.000Z' },
    { id: 'log-3', workspace_id: 'ws-alpha', action: 'LICENSE_CREATED', details: 'Created new launch seat', ip: '203.0.113.10', country: 'US', timestamp: Date.parse('2026-03-25T06:00:00.000Z'), created_at: '2026-03-25T06:00:00.000Z' },
    { id: 'log-4', workspace_id: 'ws-alpha', action: 'TEAM_INVITE_SENT', details: 'Invited partner@guardscript.local as viewer', ip: '203.0.113.10', country: 'US', timestamp: Date.parse('2026-03-25T05:00:00.000Z'), created_at: '2026-03-25T05:00:00.000Z' }
  ],
  pins: new Map()
};

const content = {
  'proj-main.gz': 'print("Atlas loader ready")\n',
  'proj-tools.gz': 'console.log("Telemetry tools ready")\n',
  'proj-vault.gz': 'console.log("Vault runner loaded")\n',
  'file-main.gz': ['from pathlib import Path', '', 'APP_NAME = "Atlas Loader"', 'BUILD_DATE = "2026-03-25"', '', 'def main():', '    print("Hello from Atlas")', '', 'if __name__ == "__main__":', '    main()'].join('\n'),
  'file-helper.gz': ['def format_payload(value: str) -> str:', '    return value.strip().lower()', '', 'def build_context(user: str) -> dict:', '    return {"user": user, "environment": "docs"}'].join('\n'),
  'file-config.gz': JSON.stringify({ project: 'Atlas Loader', timezone: 'UTC', build: '2026-03-25' }, null, 2),
  'file-tools.gz': ['export function trackEvent(name) {', '  return `tracked:${name}`;', '}'].join('\n'),
  'file-vault.gz': ['const session = {', '  mode: "vault",', '  allowed: true,', '};'].join('\n')
};

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const text = (res, code, body, type = 'text/plain; charset=utf-8') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
const bodyText = (req) => new Promise((resolve, reject) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => resolve(Buffer.concat(c).toString('utf-8'))); req.on('error', reject); });
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const auth = (req, res) => {
  const header = String(req.headers.authorization || '');
  const cookie = String(req.headers.cookie || '');
  if (header.includes(TOKEN) || cookie.includes(`token=${TOKEN}`)) return 'user-docs';
  json(res, 401, { success: false, error: 'Unauthorized' });
  return null;
};
const ws = (id) => db.workspaces[id];
const projects = (wid) => Object.values(db.projects).filter((p) => p.workspace_id === wid);
const licenses = (wid) => db.licenses.filter((l) => l.workspace_id === wid);
const access = (wid) => db.accessLists.filter((a) => a.workspace_id === wid);
const logs = (wid) => db.logs.filter((l) => l.workspace_id === wid).sort((a, b) => b.timestamp - a.timestamp);
const members = (wid) => db.members.filter((m) => m.workspace_id === wid);
const user = (id) => db.users[id] || db.usersExtra[id] || null;
const files = (pid) => db.files[pid] || [];
const fileById = (pid, fid) => files(pid).find((f) => f.id === fid) || null;

function workspacePayload(workspace, includePin = true) {
  return { success: true, workspace: { ...workspace }, projects: includePin ? [] : projects(workspace.id).map((p) => ({ ...p, file_count: files(p.id).length })), userRole: 'owner', requirePin: includePin };
}

function route(req, res, url, body) {
  const { pathname: p } = url;
  const m = req.method.toUpperCase();
  if (m === 'GET' && p === '/api/health') return json(res, 200, { success: true, service: 'docs-mock-api' });
  if (m === 'GET' && p === '/api/ws/config') return json(res, 200, { success: true, endpoint: 'ws://127.0.0.1:4181/ws' });
  if (m === 'POST' && p === '/api/login') return json(res, 200, { success: true, token: TOKEN, user: { id: 'user-docs', email: db.users['user-docs'].email, name: db.users['user-docs'].display_name }, message: 'Login successful' });
  if (m === 'POST' && p === '/api/register') return json(res, 201, { success: true, message: 'Account created' });
  if (m === 'GET' && p === '/api/user/profile') { const uid = auth(req, res); if (!uid) return; const u = user(uid); return json(res, 200, { success: true, user: { id: u.id, email: u.email, display_name: u.display_name, role: u.role || 'user', status: u.status || 'active', created_at: u.created_at } }); }
  if (m === 'GET' && p === '/api/user/stats') { const uid = auth(req, res); if (!uid) return; const owned = Object.values(db.workspaces).filter((w) => w.user_id === uid); const ids = new Set(owned.map((w) => w.id)); let pc = 0, lc = 0, lg = 0; ids.forEach((id) => { pc += projects(id).length; lc += licenses(id).length; lg += logs(id).length; }); return json(res, 200, { success: true, stats: { workspaces: ids.size, projects: pc, scripts: pc, licenses: lc, logs: lg } }); }
  if (m === 'GET' && p === '/api/workspaces') { const uid = auth(req, res); if (!uid) return; return json(res, 200, { success: true, workspaces: Object.values(db.workspaces).filter((w) => w.user_id === uid).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map((w) => ({ ...w, role: 'owner', projects: projects(w.id).map((p) => ({ id: p.id, name: p.name, secret_key: p.secret_key, created_at: p.created_at, status: p.status, execution_count: p.execution_count })), project_count: projects(w.id).length, license_count: licenses(w.id).length, team_count: 1 + members(w.id).length })) }); }
  if (m === 'POST' && p === '/api/workspaces') { const uid = auth(req, res); if (!uid) return; const payload = parse(body) || {}; const id = `ws-${String(payload.name || 'new').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`; db.workspaces[id] = { id, user_id: uid, name: String(payload.name || 'New Workspace'), loader_key: `${id}-loader`, language: String(payload.language || 'python'), default_project_id: null, default_script_id: null, discord_webhook: '', pin_hash: null, pin_enabled: 0, created_at: NOW.toISOString() }; return json(res, 200, { success: true, workspace: db.workspaces[id] }); }
  if (p.startsWith('/api/workspaces/') && p.endsWith('/settings') && m === 'GET') { const uid = auth(req, res); if (!uid) return; const w = ws(p.split('/')[3]); return w ? json(res, 200, { success: true, workspace: w }) : json(res, 404, { success: false, error: 'Workspace not found' }); }
  if (p.startsWith('/api/workspaces/') && p.endsWith('/settings') && m === 'PUT') { const uid = auth(req, res); if (!uid) return; const w = ws(p.split('/')[3]); return w ? json(res, 200, { success: true, workspace: w }) : json(res, 404, { success: false, error: 'Workspace not found' }); }
  if (p.startsWith('/api/workspaces/') && p.endsWith('/logs') && m === 'GET') { const uid = auth(req, res); if (!uid) return; return json(res, 200, { success: true, logs: logs(p.split('/')[3]) }); }
  if (p.startsWith('/api/workspaces/') && p.endsWith('/licenses') && m === 'GET') { const uid = auth(req, res); if (!uid) return; return json(res, 200, { success: true, licenses: licenses(p.split('/')[3]) }); }
  if (p.startsWith('/api/workspaces/') && p.endsWith('/access-lists') && m === 'GET') { const uid = auth(req, res); if (!uid) return; return json(res, 200, { success: true, items: access(p.split('/')[3]) }); }
  if (p.startsWith('/api/workspaces/') && p.endsWith('/team') && m === 'GET') { const uid = auth(req, res); if (!uid) return; const wid = p.split('/')[3]; return json(res, 200, { success: true, owner: { id: db.workspaces[wid].user_id, email: db.users['user-docs'].email, display_name: db.users['user-docs'].display_name, role: 'owner' }, members: members(wid).map((mbr) => ({ id: mbr.id, role: mbr.role, created_at: mbr.created_at, user_id: mbr.user_id, email: user(mbr.user_id)?.email || '', display_name: user(mbr.user_id)?.display_name || '' })), invitations: db.invitations.filter((i) => i.workspace_id === wid), currentUserRole: 'owner' }); }
  if (p.startsWith('/api/workspaces/') && p.endsWith('/pin/verify') && m === 'POST') { const uid = auth(req, res); if (!uid) return; const wid = p.split('/')[3]; const payload = parse(body) || {}; if (String(payload.pin || '') !== '246810') return json(res, 401, { success: false, error: 'Invalid PIN' }); db.pins.set(`${wid}:${uid}:${PIN_TOKEN}`, { expiresAt: Date.now() + 3600000 }); return json(res, 200, { success: true, verified: true, token: PIN_TOKEN, expiresAt: Date.now() + 3600000 }); }
  if (p.startsWith('/api/workspaces/') && p.endsWith('/pin') && m === 'POST') { const uid = auth(req, res); if (!uid) return; return json(res, 200, { success: true, message: 'PIN set successfully' }); }
  if (p.startsWith('/api/workspaces/') && p.endsWith('/pin') && m === 'DELETE') { const uid = auth(req, res); if (!uid) return; return json(res, 200, { success: true, message: 'PIN removed successfully' }); }
  if (m === 'GET' && p.startsWith('/api/workspaces/')) { const uid = auth(req, res); if (!uid) return; const wid = p.split('/')[3]; const workspace = ws(wid); if (!workspace) return json(res, 404, { success: false, error: 'Workspace not found' }); if (workspace.pin_enabled && !db.pins.has(`${wid}:${uid}:${PIN_TOKEN}`)) return json(res, 200, { success: true, workspace, projects: [], userRole: 'owner', requirePin: true }); return json(res, 200, workspacePayload(workspace, false)); }
  if (p.startsWith('/api/projects/') && p.endsWith('/files') && m === 'GET') { const uid = auth(req, res); if (!uid) return; const pid = p.split('/')[3]; return json(res, 200, { success: true, files: files(pid) }); }
  if (p.startsWith('/api/projects/') && p.includes('/files/') && p.endsWith('/content') && m === 'GET') { const uid = auth(req, res); if (!uid) return; const pid = p.split('/')[3]; const fid = p.split('/')[5]; const file = fileById(pid, fid); return file ? json(res, 200, { success: true, file: { id: file.id, name: file.name, language: file.language, content: content[file.content.slice(3)] || '', updated_at: file.updated_at } }) : json(res, 404, { success: false, error: 'File not found' }); }
  if (m === 'GET' && p.startsWith('/api/projects/') && p.endsWith('/settings')) { const uid = auth(req, res); if (!uid) return; const project = db.projects[p.split('/')[3]]; return project ? json(res, 200, { success: true, project }) : json(res, 404, { success: false, error: 'Project not found' }); }
  return json(res, 404, { success: false, error: `No mock route for ${m} ${p}` });
}

export function startMockApiServer(port = PORT) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${port}`}`);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS', 'access-control-allow-headers': 'Authorization,Content-Type,X-Pin-Token' });
      return res.end();
    }
    const body = await bodyText(req);
    try { return route(req, res, url, body); } catch (error) { console.error(error); return json(res, 500, { success: false, error: 'Internal mock API error' }); }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => { console.log(`Mock API server listening on http://127.0.0.1:${port}`); resolve(server); }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startMockApiServer().catch((error) => { console.error(error); process.exitCode = 1; });
}
