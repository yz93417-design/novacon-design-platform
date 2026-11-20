/**
 * 设计排期台 — 轻量日历 / 时间轴看板
 * 单端口 HTTP 服务：静态页 + 极简 JSON API（卡片级合并，支持多人同时编辑）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'state.json');
const MAX_BODY = 40 * 1024 * 1024; // 40MB，图片以 dataURL 内联

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function defaultChannels() {
  return ['诺康莱-天猫', '诺康莱-京东', '诺康莱-抖音', '诺康莱-小红书',
          '诺惠跨境-天猫', '诺惠跨境-京东', '诺惠跨境-抖音', '诺惠跨境-小红书']
    .map((name, i) => ({ id: 'ch_default_' + i, name, updatedAt: 0, deleted: false }));
}

function emptyState() {
  return {
    version: 1,
    systems: [{ id: 'sys_main', name: '诺康莱集团设计中台管理系统', createdAt: Date.now(), updatedAt: Date.now(), deleted: false }],
    channels: defaultChannels(),
    designers: [],
    issues: [],
    gallery: [],
    boards: [
      {
        id: 'board_' + Date.now(),
        name: '双11 设计排期',
        systemId: 'sys_main',
        columns: 2,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
        cards: [],
      },
    ],
  };
}

/* 旧数据升级：补齐 systems / channels / designers / issues，给无 systemId 的页面挂到第一个系统 */
function upgrade(raw) {
  if (!Array.isArray(raw.systems) || !raw.systems.length) {
    raw.systems = [{ id: 'sys_main', name: '诺康莱集团设计中台管理系统', createdAt: Date.now(), updatedAt: Date.now(), deleted: false }];
  }
  if (!Array.isArray(raw.channels) || !raw.channels.length) raw.channels = defaultChannels();
  if (!Array.isArray(raw.designers)) raw.designers = [];
  if (!Array.isArray(raw.contacts)) raw.contacts = [];
  if (!Array.isArray(raw.issues)) raw.issues = [];
  if (!Array.isArray(raw.gallery)) raw.gallery = [];
  const firstSys = raw.systems.find((s) => s && !s.deleted);
  (raw.boards || []).forEach((b) => { if (!b.systemId) b.systemId = firstSys ? firstSys.id : 'sys_main'; });
  return raw;
}

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!raw || !Array.isArray(raw.boards)) return emptyState();
    if (typeof raw.version !== 'number') raw.version = 1;
    return upgrade(raw);
  } catch (e) {
    const s = emptyState();
    persist(s);
    return s;
  }
}

let state = loadState();

function persist(s) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(s));
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) {
    console.error('persist failed', e.message);
  }
}

function newer(a, b) {
  return (a.updatedAt || 0) >= (b.updatedAt || 0) ? a : b;
}

/** 列表类数据（卡片 / 备注）合并：同 id 取较新；保留墓碑，避免旧客户端复活已删项 */
function mergeList(a, b) {
  const map = new Map();
  (a || []).forEach((c) => map.set(c.id, c));
  (b || []).forEach((c) => {
    const cur = map.get(c.id);
    if (!cur || (c.updatedAt || 0) > (cur.updatedAt || 0)) map.set(c.id, c);
  });
  return Array.from(map.values());
}

/** 日期标色合并：按日期取较新的 { color, updatedAt }；兼容旧版纯字符串值 */
function mergeDateColors(a, b) {
  const map = new Map();
  const norm = (v) => (typeof v === 'string' ? { color: v, updatedAt: 0 } : v || { color: null, updatedAt: 0 });
  Object.keys(a || {}).forEach((k) => map.set(k, norm(a[k])));
  Object.keys(b || {}).forEach((k) => {
    const next = norm(b[k]);
    const cur = map.get(k);
    if (!cur || (next.updatedAt || 0) > (cur.updatedAt || 0)) map.set(k, next);
  });
  const out = {};
  map.forEach((v, k) => (out[k] = v));
  return out;
}

function mergeBoard(x, y) {
  const base = newer(x, y);
  return Object.assign({}, base, {
    cards: mergeList(x.cards, y.cards),
    notes: mergeList(x.notes, y.notes),
    dateColors: mergeDateColors(x.dateColors, y.dateColors),
  });
}

/** 项目标题合并：取较新的 { text, updatedAt } */
function mergeTitle(a, b) {
  const na = a && a.text ? a : null;
  const nb = b && b.text ? b : null;
  if (!na) return nb || null;
  if (!nb) return na;
  return (na.updatedAt || 0) >= (nb.updatedAt || 0) ? na : nb;
}

function mergeStates(local, server) {
  const map = new Map();
  (server.boards || []).forEach((b) => map.set(b.id, b));
  (local.boards || []).forEach((b) => {
    const cur = map.get(b.id);
    map.set(b.id, cur ? mergeBoard(cur, b) : b);
  });
  return {
    version: (server.version || 0) + 1,
    boards: Array.from(map.values()),
    title: mergeTitle(local.title, server.title),
    stats: mergeList(local.stats, server.stats),
    systems: mergeList(local.systems, server.systems),
    channels: mergeList(local.channels, server.channels),
    designers: mergeList(local.designers, server.designers),
    issues: mergeList(local.issues, server.issues),
    gallery: mergeList(local.gallery, server.gallery),
    savedAt: Date.now(),
  };
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA 兜底
      return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
        if (e2) {
          res.writeHead(404);
          return res.end('Not found');
        }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(html);
      });
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function readBody(req, cb) {
  let size = 0;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) {
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    try {
      cb(null, JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch (e) {
      cb(e);
    }
  });
  req.on('error', (e) => cb(e));
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/api/state' && req.method === 'GET') {
    return sendJSON(res, 200, state);
  }

  if (url === '/api/state' && req.method === 'POST') {
    return readBody(req, (err, payload) => {
      if (err || !payload || !payload.state || !Array.isArray(payload.state.boards)) {
        return sendJSON(res, 400, { error: 'bad payload' });
      }
      state = mergeStates(payload.state, state);
      persist(state);
      sendJSON(res, 200, state);
    });
  }

  if (url === '/api/health') {
    return sendJSON(res, 200, { ok: true, boards: state.boards.length, version: state.version });
  }

  if (req.method !== 'GET') {
    res.writeHead(405);
    return res.end('Method not allowed');
  }
  serveStatic(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('设计排期台 listening on ' + PORT);
});
