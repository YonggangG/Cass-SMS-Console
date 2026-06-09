const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const DEFAULT_CONFIG = {
  phoneBaseUrl: 'http://192.168.1.23:8080',
  token: '',
  host: '0.0.0.0',
  port: 3000,
  syncIntervalMs: 3000,
  csvPath: './data/sms-records.csv',
  hiddenMessagesPath: ''
};

const ENV_MAP = {
  CASS_PHONE_BASE_URL: 'phoneBaseUrl',
  CASS_TOKEN: 'token',
  CASS_HOST: 'host',
  CASS_PORT: 'port',
  CASS_SYNC_INTERVAL_MS: 'syncIntervalMs',
  CASS_CSV_PATH: 'csvPath',
  CASS_HIDDEN_MESSAGES_PATH: 'hiddenMessagesPath'
};

let config = loadConfig();
let lastStatus = { ok: false, error: 'Not checked yet', checkedAt: null };
let lastMessages = [];
let knownKeys = new Set();
let hiddenMessageIds = new Set();
let syncTimer = null;

function loadConfig() {
  let fileConfig = {};
  if (fs.existsSync(CONFIG_PATH)) {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    fileConfig = JSON.parse(raw);
  }

  const envConfig = {};
  for (const [envName, key] of Object.entries(ENV_MAP)) {
    if (process.env[envName] != null && process.env[envName] !== '') {
      envConfig[key] = process.env[envName];
    }
  }

  const merged = { ...DEFAULT_CONFIG, ...fileConfig, ...envConfig };
  merged.port = Number(merged.port) || DEFAULT_CONFIG.port;
  merged.syncIntervalMs = Number(merged.syncIntervalMs) || DEFAULT_CONFIG.syncIntervalMs;
  if (!merged.hiddenMessagesPath) {
    merged.hiddenMessagesPath = path.join(path.dirname(merged.csvPath), 'hidden-message-ids.json');
  }
  return merged;
}

function publicConfig() {
  return {
    phoneBaseUrl: config.phoneBaseUrl,
    tokenConfigured: Boolean(config.token),
    syncIntervalMs: config.syncIntervalMs,
    csvPath: config.csvPath,
    hiddenMessagesPath: config.hiddenMessagesPath
  };
}

function gatewayUrl(apiPath) {
  const base = config.phoneBaseUrl.replace(/\/+$/, '');
  const sep = apiPath.includes('?') ? '&' : '?';
  return `${base}${apiPath}${sep}token=${encodeURIComponent(config.token || '')}`;
}

async function callGateway(apiPath, options = {}, timeoutMs = 8000) {
  if (!config.token) throw new Error('Missing token. Set CASS_TOKEN or pc-console/config.json');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(gatewayUrl(apiPath), { ...options, signal: controller.signal });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) throw new Error(`Gateway HTTP ${res.status}: ${text.slice(0, 200)}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function messageKey(m) {
  return [m.timestamp, m.direction, m.phone, m.subscriptionId, m.status, m.text].map(v => String(v ?? '')).join('|');
}

function visibleMessageKey(m) {
  return [m.direction, m.phone, m.subscriptionId, m.status, m.text].map(v => String(v ?? '')).join('|');
}

function hiddenMessagesPath() {
  return path.resolve(ROOT, config.hiddenMessagesPath);
}

function loadHiddenMessages() {
  const filePath = hiddenMessagesPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    hiddenMessageIds = new Set();
    return filePath;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const ids = JSON.parse(raw || '[]');
    hiddenMessageIds = new Set(Array.isArray(ids) ? ids.map(String).filter(Boolean) : []);
  } catch (err) {
    throw new Error(`Failed to read hidden messages file: ${err.message || String(err)}`);
  }
  return filePath;
}

function saveHiddenMessages() {
  const filePath = hiddenMessagesPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify([...hiddenMessageIds].sort(), null, 2) + '\n');
}

function visibleMessages() {
  return dedupeAdjacentMessages(lastMessages.filter(m => !hiddenMessageIds.has(messageKey(m))));
}

function dedupeAdjacentMessages(messages) {
  const deduped = [];
  let previousKey = null;
  for (const message of messages) {
    const key = visibleMessageKey(message);
    if (key === previousKey) continue;
    deduped.push(message);
    previousKey = key;
  }
  return deduped;
}

function ensureCsv() {
  const csvPath = path.resolve(ROOT, config.csvPath);
  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  if (!fs.existsSync(csvPath)) {
    fs.writeFileSync(csvPath, 'id,timestamp_iso,timestamp_ms,direction,phone,text,subscriptionId,status\n');
  } else {
    const rows = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).slice(1).filter(Boolean);
    for (const row of rows) {
      const cols = parseCsvLine(row);
      if (cols[0]) knownKeys.add(cols[0]);
    }
  }
  return csvPath;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q && c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
    else if (c === '"') q = !q;
    else if (!q && c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function appendMessages(messages) {
  const csvPath = ensureCsv();
  const rows = [];
  for (const m of messages) {
    const key = messageKey(m);
    if (knownKeys.has(key)) continue;
    knownKeys.add(key);
    const ms = Number(m.timestamp) || Date.now();
    rows.push([
      key,
      new Date(ms).toISOString(),
      ms,
      m.direction,
      m.phone,
      m.text,
      m.subscriptionId,
      m.status
    ].map(csvEscape).join(','));
  }
  if (rows.length) fs.appendFileSync(csvPath, rows.join('\n') + '\n');
  return rows.length;
}

async function syncOnce() {
  const checkedAt = new Date().toISOString();
  try {
    const status = await callGateway('/api/status');
    const data = await callGateway('/api/messages');
    const messages = Array.isArray(data.messages) ? data.messages : [];
    const appended = appendMessages(messages);
    lastMessages = messages.slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    lastStatus = { ok: true, checkedAt, status, messageCount: messages.length, appended };
    return lastStatus;
  } catch (err) {
    lastStatus = { ok: false, checkedAt, error: err.message || String(err) };
    return lastStatus;
  }
}

function startSync() {
  ensureCsv();
  loadHiddenMessages();
  syncOnce();
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(syncOnce, Math.max(1000, Number(config.syncIntervalMs) || 3000));
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  try {
    if (req.method === 'GET' && url.pathname === '/api/config') {
      return sendJson(res, 200, publicConfig());
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const live = url.searchParams.get('live') === '1';
      const data = live ? await syncOnce() : lastStatus;
      return sendJson(res, 200, data);
    }
    if (req.method === 'GET' && url.pathname === '/api/messages') {
      return sendJson(res, 200, { messages: visibleMessages(), backup: publicConfig(), status: lastStatus });
    }
    if (req.method === 'POST' && url.pathname === '/api/messages/delete') {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      if (!payload.id) return sendJson(res, 400, { ok: false, error: 'id is required' });
      hiddenMessageIds.add(String(payload.id));
      saveHiddenMessages();
      return sendJson(res, 200, { ok: true, hiddenCount: hiddenMessageIds.size });
    }
    if (req.method === 'POST' && url.pathname === '/api/send') {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      if (!payload.to || !payload.text) return sendJson(res, 400, { ok: false, error: 'to and text are required' });
      callGateway('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(() => syncOnce()).catch(err => {
        lastStatus = { ...lastStatus, sendWarning: err.message || String(err), sendWarningAt: new Date().toISOString() };
      });
      return sendJson(res, 200, {
        ok: true,
        submitted: true,
        to: payload.to,
        subscriptionId: payload.subscriptionId,
        message: 'SMS send request submitted to the phone gateway.'
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/sync') {
      return sendJson(res, 200, await syncOnce());
    }
    sendJson(res, 404, { ok: false, error: 'Not found' });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message || String(err) });
  }
}

function serveStatic(req, res, url) {
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  file = path.normalize(file).replace(/^\.\.(\/|\\|$)/, '');
  const full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(full).toLowerCase();
    const type = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.css' ? 'text/css; charset=utf-8' : ext === '.js' ? 'application/javascript; charset=utf-8' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  serveStatic(req, res, url);
});

if (require.main === module) {
  startSync();
  server.listen(config.port, config.host, () => {
    console.log(`Cass SMS PC Console running at http://${config.host}:${config.port}`);
    console.log(`Gateway: ${config.phoneBaseUrl}`);
    console.log(`CSV backup: ${path.resolve(ROOT, config.csvPath)}`);
  });
}

module.exports = { dedupeAdjacentMessages, messageKey, visibleMessageKey };
