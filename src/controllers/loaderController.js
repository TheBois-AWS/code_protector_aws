import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { jsonResponse, parseJsonBody, textResponse } from '../utils/http.js';
import { appConfigRepo, projectsRepo, accessListsRepo, licensesRepo, projectFilesRepo } from '../services/repositories.js';
import { getClientIp } from '../utils/http.js';
import { checkRateLimit } from '../utils/rateLimit.js';
import { nowIso, sortByDateDesc } from '../utils/common.js';
import {
  base64UrlEncode,
  deriveAesKey,
  deriveSharedSecret,
  encryptWithAesGcmBytes,
  generateX25519KeyPair,
  hmacHex,
  sha256,
  xorEncrypt
} from '../utils/crypto.js';
import { resolveWorkspace } from '../utils/workspace.js';
import { logAction } from './workspaceController.js';
import { generateJsBundle, generateLuaBundle, generatePyBundle, resolveFileContent } from './fileController.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

let unifiedLoaderPy = '';
let unifiedLoaderJs = '';
let unifiedLoaderLua = '';
try {
  unifiedLoaderPy = readFileSync(join(rootDir, 'templates', 'python', 'unified-loader.py'), 'utf-8');
} catch {}
try {
  unifiedLoaderJs = readFileSync(join(rootDir, 'templates', 'javascript_nodejs', 'unified-loader.txt'), 'utf-8');
} catch {}
try {
  unifiedLoaderLua = readFileSync(join(rootDir, 'templates', 'lua', 'unified-loader.lua'), 'utf-8');
} catch {}

const LOADER_SECRET_KEY = 'loader_encrypt_secret';

async function getOrCreateLoaderSecret() {
  const existing = await appConfigRepo.get(LOADER_SECRET_KEY);
  if (existing) return String(existing);
  const created = sha256(`${Date.now()}:${Math.random()}:${process.env.AWS_LAMBDA_FUNCTION_NAME || 'local'}`);
  await appConfigRepo.set(LOADER_SECRET_KEY, created);
  return created;
}

function getOrigin(request) {
  const host = request.headers.host || request.headers.Host || 'localhost:3001';
  const proto = (request.headers['x-forwarded-proto'] || request.headers['X-Forwarded-Proto'] || 'https').split(',')[0].trim();
  return `${proto}://${host}`;
}

function safeHeader(request, name) {
  return request.headers[name] || request.headers[name.toLowerCase()] || request.headers[name.toUpperCase()] || '';
}

function errorPy(message, statusCode = 403) {
  return textResponse(statusCode, `print('[code_protector_aws] ${message}')`, { 'content-type': 'text/x-python; charset=utf-8' });
}

function errorJs(message, statusCode = 403) {
  return textResponse(statusCode, `console.error('[code_protector_aws] ${message}');`, { 'content-type': 'application/javascript; charset=utf-8' });
}

function errorLua(message, statusCode = 403) {
  return textResponse(statusCode, `print('[code_protector_aws] ${message}')`, { 'content-type': 'text/x-lua; charset=utf-8' });
}

function generateBanner(name, comment = '#') {
  const safeName = String(name || 'code_protector_aws').slice(0, 48);
  const line = `${comment} ============================================================`;
  return `${comment}\n${line}\n${comment} Protected by code_protector_aws\n${comment} Workspace: ${safeName}\n${line}\n`;
}

function browserLoaderPage({ type, codeSnippet, id }) {
  const title = type === 'python' ? 'Python Loader' : type === 'lua' ? 'Lua Loader' : 'Node.js Loader';
  const fileName = type === 'python' ? 'main.py' : type === 'lua' ? 'main.lua' : 'main.js';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:system-ui;background:#09090b;color:#fff;padding:24px}pre{background:#111;padding:16px;border-radius:10px;overflow:auto}button{background:#2563eb;color:white;border:0;padding:8px 12px;border-radius:8px;cursor:pointer}</style></head><body><h1>${title}</h1><p>Loader ID: <code>${id}</code></p><p>Create <code>${fileName}</code> and run it.</p><pre id="code">${String(codeSnippet).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre><button onclick="navigator.clipboard.writeText(document.getElementById('code').textContent)">Copy</button></body></html>`;
}

async function resolveProjectByIdentifier(id) {
  const workspace = await resolveWorkspace(String(id));
  if (workspace) {
    const projects = sortByDateDesc(await projectsRepo.listByWorkspace(String(workspace.id)));
    let selected = null;
    if (workspace.default_project_id || workspace.default_script_id) {
      const wanted = String(workspace.default_project_id || workspace.default_script_id);
      selected = projects.find((item) => String(item.id) === wanted || String(item.secret_key) === wanted) || null;
    }
    if (!selected) selected = projects[0] || null;
    return { workspace, project: selected };
  }

  const direct = await projectsRepo.findBySecretKey(String(id));
  if (direct) {
    const ws = await resolveWorkspace(String(direct.workspace_id));
    return { workspace: ws, project: direct };
  }

  const byId = await projectsRepo.getById(String(id));
  if (byId) {
    const ws = await resolveWorkspace(String(byId.workspace_id));
    return { workspace: ws, project: byId };
  }

  return { workspace: null, project: null };
}

async function resolveScriptContent(id, licenseKey) {
  const found = await resolveProjectByIdentifier(id);
  let workspace = found.workspace;
  let project = found.project;

  if (!workspace || !project) {
    return { error: 'Invalid ID', status: 404 };
  }

  if (licenseKey) {
    const license = await licensesRepo.findByKey(String(licenseKey));
    if (license && String(license.workspace_id) === String(workspace.id)) {
      const targetId = String(license.project_id || license.script_id || '');
      if (targetId) {
        const licensedProject = await projectsRepo.getById(targetId);
        if (licensedProject && String(licensedProject.workspace_id) === String(workspace.id)) {
          project = licensedProject;
        }
      }
    }
  }

  if (String(project.status || 'approved') !== 'approved') {
    return { error: `Project ${project.status || 'pending'}`, status: 403 };
  }
  if (Number(project.is_active ?? 1) === 0) {
    return { error: 'Project disabled', status: 403 };
  }

  const allFiles = await projectFilesRepo.listByProject(String(project.id));
  const sourceFiles = allFiles.filter((item) => item.type === 'file');
  if (sourceFiles.length > 1) {
    const entry = sourceFiles.find((item) => Number(item.is_entry_point) === 1) || sourceFiles[0];

    const filesById = new Map(allFiles.map((item) => [String(item.id), item]));
    const getPath = (node) => {
      if (!node) return '';
      if (!node.parent_id) return String(node.name);
      const parent = filesById.get(String(node.parent_id));
      return `${getPath(parent)}/${node.name}`;
    };

    const fileContents = {};
    let entryPath = '';
    for (const file of sourceFiles) {
      const path = getPath(file);
      fileContents[path] = await resolveFileContent(file, workspace.id);
      if (String(file.id) === String(entry.id)) entryPath = path;
    }

    const workspaceLanguage = String(workspace.language || '').toLowerCase();
    const jsLanguages = new Set(['node', 'nodejs', 'javascript', 'javascript_nodejs', 'userscript']);
    const bundle = jsLanguages.has(workspaceLanguage)
      ? generateJsBundle(fileContents, entryPath)
      : workspaceLanguage === 'lua'
        ? generateLuaBundle(fileContents, entryPath)
        : generatePyBundle(fileContents, entryPath);

    return { workspace, project, finalContent: bundle };
  }

  if (sourceFiles.length === 1) {
    return { workspace, project, finalContent: await resolveFileContent(sourceFiles[0], workspace.id) };
  }

  if (!project.content) return { error: 'No content', status: 404 };

  return { workspace, project, finalContent: await resolveFileContent({ content: project.content, is_encrypted: project.is_encrypted }, workspace.id) };
}

async function checkAccessPolicy({ request, workspace, project, licenseKey, hwid, platform }) {
  const clientIp = getClientIp(request);
  const country = safeHeader(request, 'cf-ipcountry') || 'Unknown';

  if (project.max_executions && Number(project.execution_count || 0) >= Number(project.max_executions)) {
    await logAction(workspace.id, 'BLOCK_ACCESS', `Max executions reached for ${project.id}`, request, country);
    return { error: 'Execution limit reached', status: 403 };
  }

  const rules = await accessListsRepo.listByWorkspace(String(workspace.id));
  const blacklist = rules.filter((item) => item.type === 'blacklist').map((item) => String(item.identifier));
  const whitelist = rules.filter((item) => item.type === 'whitelist').map((item) => String(item.identifier));

  if (blacklist.includes(clientIp)) {
    await logAction(workspace.id, 'BLOCK_ACCESS', `Blocked IP ${clientIp}`, request, country);
    return { error: 'IP Blocked', status: 403 };
  }

  if (Number(project.ip_whitelist_enabled || 0) === 1 && whitelist.length > 0 && !whitelist.includes(clientIp)) {
    await logAction(workspace.id, 'BLOCK_ACCESS', `IP not whitelisted ${clientIp}`, request, country);
    return { error: 'IP Not Allowed', status: 403 };
  }

  if (Number(project.require_license || 0) === 1) {
    if (!licenseKey) return { error: 'License Required', status: 403 };
    const license = await licensesRepo.findByKey(String(licenseKey));
    if (!license || String(license.workspace_id) !== String(workspace.id)) {
      await logAction(workspace.id, 'INVALID_LICENSE', `Invalid key ${licenseKey}`, request, country);
      return { error: 'Invalid License', status: 403 };
    }
    if (Number(license.is_active ?? 1) === 0) return { error: 'License Inactive', status: 403 };
    if (license.expiration_date && new Date(license.expiration_date).getTime() < Date.now()) return { error: 'License Expired', status: 403 };
    if ((license.project_id || license.script_id) && String(license.project_id || license.script_id) !== String(project.id)) return { error: 'Wrong License', status: 403 };

    const needHwid = Number(project.require_hwid || 0) === 1 || Number(license.hwid_lock ?? 1) === 1;
    if (needHwid && license.activated_hwid && String(license.activated_hwid) !== String(hwid)) {
      await logAction(workspace.id, 'INVALID_HWID', `HWID mismatch ${hwid}`, request, country);
      return { error: 'HWID Mismatch', status: 403 };
    }

    await licensesRepo.update(String(license.id), {
      activated_hwid: license.activated_hwid || hwid,
      activated_os: platform,
      last_used_at: nowIso(),
      usage_count: Number(license.usage_count || 0) + 1
    });
  }

  await projectsRepo.update(String(project.id), { execution_count: Number(project.execution_count || 0) + 1 });
  return null;
}

async function computeExpectedSignature({ loaderSecret, id, licenseKey, hwid, timestamp, nonce, clientPublicKey = '' }) {
  const parts = [id, licenseKey, hwid, String(timestamp), nonce];
  if (clientPublicKey) parts.push(clientPublicKey);
  const sigData = parts.join(':');
  const derivedSecret = sha256(`${loaderSecret}:loader:${id}`).slice(0, 32);
  const sigKey = sha256(`${derivedSecret}:${nonce}:${id}`);
  return hmacHex(sigKey.slice(0, 32), sigData).slice(0, 32);
}

export async function getUnifiedLoader(request, id) {
  if (!id) return textResponse(404, 'Not Found', { 'content-type': 'text/plain; charset=utf-8' });

  const origin = getOrigin(request);
  const ua = safeHeader(request, 'user-agent');
  const isPythonClient = ua.includes('Python-urllib') || ua.includes('Python/');
  const resolved = await resolveProjectByIdentifier(id);
  if (!resolved.workspace && !resolved.project) {
    return textResponse(404, '# Invalid loader ID', { 'content-type': 'text/plain; charset=utf-8' });
  }

  if (!isPythonClient) {
    const snippet = `LicenseKey = ""\nexec(__import__('urllib.request',fromlist=['urlopen']).urlopen("${origin}/files/${id}.py").read())`;
    return textResponse(200, browserLoaderPage({ type: 'python', codeSnippet: snippet, id }), { 'content-type': 'text/html; charset=utf-8' });
  }

  const loaderSecret = await getOrCreateLoaderSecret();
  const signKey = sha256(`${loaderSecret}:loader:${id}`).slice(0, 32);
  const context = `_k='${id}'\n_o='${origin}'\n_s='${signKey}'\n`;
  const clean = String(unifiedLoaderPy || '').replace(/^#.*\n?/gm, '');
  const banner = generateBanner(resolved.workspace?.name || resolved.project?.name || 'code_protector_aws', '#');
  return textResponse(200, `${banner}${context}${clean}`, {
    'content-type': 'text/x-python; charset=utf-8',
    'cache-control': 'no-store, no-cache, must-revalidate',
    'access-control-allow-origin': '*'
  });
}

export async function getUnifiedLoaderJS(request, id) {
  if (!id) return textResponse(404, 'Not Found', { 'content-type': 'text/plain; charset=utf-8' });

  const origin = getOrigin(request);
  const accept = safeHeader(request, 'accept');
  const isBrowser = accept.includes('text/html');
  const resolved = await resolveProjectByIdentifier(id);
  if (!resolved.workspace && !resolved.project) {
    return textResponse(404, '// Invalid loader ID', { 'content-type': 'application/javascript; charset=utf-8' });
  }

  if (isBrowser) {
    const snippet = `globalThis.LicenseKey = "";\nimport('https').then(m=>m.get("${origin}/files/${id}.js",r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>eval(d))}));`;
    return textResponse(200, browserLoaderPage({ type: 'nodejs', codeSnippet: snippet, id }), { 'content-type': 'text/html; charset=utf-8' });
  }

  const loaderSecret = await getOrCreateLoaderSecret();
  const signKey = sha256(`${loaderSecret}:loader:${id}`).slice(0, 32);
  const context = `global._k='${id}';\nglobal._o='${origin}';\nglobal._s='${signKey}';\n`;
  const clean = String(unifiedLoaderJs || '').replace(/^\/\/.*\n?/gm, '');
  const banner = generateBanner(resolved.workspace?.name || resolved.project?.name || 'code_protector_aws', '//');
  return textResponse(200, `${banner}${context}${clean}`, {
    'content-type': 'application/javascript; charset=utf-8',
    'cache-control': 'no-store, no-cache, must-revalidate',
    'access-control-allow-origin': '*'
  });
}

export async function getUnifiedLoaderLua(request, id) {
  if (!id) return textResponse(404, 'Not Found', { 'content-type': 'text/plain; charset=utf-8' });

  const origin = getOrigin(request);
  const accept = safeHeader(request, 'accept');
  const isBrowser = accept.includes('text/html');
  const resolved = await resolveProjectByIdentifier(id);
  if (!resolved.workspace && !resolved.project) {
    return textResponse(404, '-- Invalid loader ID', { 'content-type': 'text/x-lua; charset=utf-8' });
  }

  if (isBrowser) {
    const snippet = `-- IrisAuth Loader v4 (Roblox)\ngetgenv().LicenseKey = "..."\nloadstring(game:HttpGet("${origin}/files/${id}.lua"))()`;
    return textResponse(200, browserLoaderPage({ type: 'lua', codeSnippet: snippet, id }), { 'content-type': 'text/html; charset=utf-8' });
  }

  if (!unifiedLoaderLua) return errorLua('Lua loader template missing', 500);

  const loaderSecret = await getOrCreateLoaderSecret();
  const signKey = sha256(`${loaderSecret}:loader:${id}`).slice(0, 32);
  const context = `_k='${id}'\n_o='${origin}'\n_s='${signKey}'\nLicenseKey = LicenseKey or _l or ''\n`;
  const banner = generateBanner(resolved.workspace?.name || resolved.project?.name || 'code_protector_aws', '--');
  return textResponse(200, `${banner}${context}${String(unifiedLoaderLua)}`, {
    'content-type': 'text/x-lua; charset=utf-8',
    'cache-control': 'no-store, no-cache, must-revalidate',
    'access-control-allow-origin': '*'
  });
}

export async function executeScript(request) {
  const id = String(request.query.id || '');
  const licenseKey = String(request.query.l || '');
  const hwid = String(request.query.h || 'unknown');
  const timestamp = Number(request.query.t || 0);
  const signature = String(request.query.s || '');
  const nonce = String(request.query.n || '');
  const platform = String(request.query.p || 'unknown');

  const userAgent = safeHeader(request, 'user-agent');
  const isPython = userAgent.includes('Python-urllib') || userAgent.includes('Python/');
  const errorHandler = isPython ? errorPy : errorJs;

  if (!id || !nonce || !signature || !timestamp) return errorHandler('Missing params', 400);

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) return errorHandler('Request expired');

  const clientIp = getClientIp(request);
  const globalRl = await checkRateLimit(`loader:${clientIp}`, 60, 120);
  if (!globalRl.allowed) return errorHandler('Rate limited', 429);

  const loaderSecret = await getOrCreateLoaderSecret();
  const expected = await computeExpectedSignature({ loaderSecret, id, licenseKey, hwid, timestamp, nonce });
  if (signature !== expected) {
    await logAction(null, 'INVALID_SIGNATURE', `Sig mismatch from ${clientIp}`, request);
    return errorHandler('Invalid signature');
  }

  const resolved = await resolveScriptContent(id, licenseKey);
  if (resolved.error) return errorHandler(resolved.error, resolved.status || 403);

  const scriptRl = await checkRateLimit(`exec:${resolved.project.id}:${clientIp}`, 60, Math.max(1, Math.min(Number(resolved.project.rate_limit || 30), 600)));
  if (!scriptRl.allowed) return errorHandler('Rate limited', 429);

  const accessError = await checkAccessPolicy({ request, workspace: resolved.workspace, project: resolved.project, licenseKey, hwid, platform });
  if (accessError) return errorHandler(accessError.error, accessError.status);

  await logAction(resolved.workspace.id, 'LOAD_SCRIPT', `Project ${resolved.project.id}, HWID ${hwid}`, request);

  const responseTime = Math.floor(Date.now() / 1000);
  const contentBytes = Buffer.from(String(resolved.finalContent), 'utf-8');
  const header = Buffer.alloc(16);
  // Legacy execute protocol magic expected by existing loaders.
  header.writeUInt32BE(0x49524953, 0); // "IRIS"
  header.writeUInt32BE(contentBytes.length, 4);
  header.writeUInt32BE(responseTime, 8);
  header.writeUInt32BE(Math.floor(Math.random() * 0xffffffff), 12);

  const loaderDerivedSecret = sha256(`${loaderSecret}:loader:${id}`).slice(0, 32);
  const encKey = sha256(`${loaderDerivedSecret}:${hwid}:${nonce}:${id}`).slice(0, 64);
  const encryptedBytes = xorEncrypt(Buffer.concat([header, contentBytes]), encKey);
  const encryptedBase64 = Buffer.from(encryptedBytes).toString('base64');
  const verifyKey = sha256(`${loaderDerivedSecret}:${nonce}:${hwid}`);
  const responseSig = hmacHex(verifyKey.slice(0, 32), encryptedBase64 + String(responseTime)).slice(0, 32);

  return jsonResponse(200, { e: encryptedBase64, s: responseSig, t: responseTime, v: 2 }, {
    'cache-control': 'no-store',
    'access-control-allow-origin': '*'
  });
}

export async function ecdhHandshake(request) {
  const body = parseJsonBody(request);
  if (!body) return errorPy('Invalid request', 400);

  const id = String(body.id || '');
  const licenseKey = String(body.l || '');
  const hwid = String(body.h || 'unknown');
  const timestamp = Number(body.t || 0);
  const signature = String(body.s || '');
  const nonce = String(body.n || '');
  const platform = String(body.p || 'unknown');
  const clientPublicKey = String(body.pk || '');

  if (!id || !nonce || !signature || !timestamp || !clientPublicKey) return errorPy('Missing params', 400);
  if (clientPublicKey.length < 40 || clientPublicKey.length > 64) return errorPy('Invalid public key', 400);

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) return errorPy('Request expired');

  const clientIp = getClientIp(request);
  const globalRl = await checkRateLimit(`ecdh:${clientIp}`, 60, 60);
  if (!globalRl.allowed) return errorPy('Rate limited', 429);

  const loaderSecret = await getOrCreateLoaderSecret();
  const expected = await computeExpectedSignature({ loaderSecret, id, licenseKey, hwid, timestamp, nonce, clientPublicKey });
  if (signature !== expected) {
    await logAction(null, 'INVALID_SIGNATURE', `ECDH signature mismatch from ${clientIp}`, request);
    return errorPy('Invalid signature');
  }

  const resolved = await resolveScriptContent(id, licenseKey);
  if (resolved.error) return errorPy(resolved.error, resolved.status || 403);

  const scriptRl = await checkRateLimit(`exec:${resolved.project.id}:${clientIp}`, 60, Math.max(1, Math.min(Number(resolved.project.rate_limit || 30), 600)));
  if (!scriptRl.allowed) return errorPy('Rate limited', 429);

  const accessError = await checkAccessPolicy({ request, workspace: resolved.workspace, project: resolved.project, licenseKey, hwid, platform });
  if (accessError) return errorPy(accessError.error, accessError.status);

  await logAction(resolved.workspace.id, 'ECDH_HANDSHAKE', `Project ${resolved.project.id}, HWID ${hwid}`, request);

  const pair = generateX25519KeyPair();
  const shared = deriveSharedSecret(pair.privateKeyDer, clientPublicKey);
  const aesKey = deriveAesKey(shared, `IrisAuth-${nonce}`);
  const encryptedScript = encryptWithAesGcmBytes(String(resolved.finalContent), aesKey);
  const responseTime = Math.floor(Date.now() / 1000);

  const loaderDerivedSecret = sha256(`${loaderSecret}:loader:${id}`).slice(0, 32);
  const responseKey = sha256(`${loaderDerivedSecret}:${nonce}:${hwid}`);
  const responseSig = hmacHex(responseKey.slice(0, 32), `${pair.publicKeyBase64}:${encryptedScript}:${responseTime}`).slice(0, 32);

  return jsonResponse(200, { pk: pair.publicKeyBase64, e: encryptedScript, t: responseTime, s: responseSig, v: 3 }, {
    'cache-control': 'no-store',
    'access-control-allow-origin': '*'
  });
}
