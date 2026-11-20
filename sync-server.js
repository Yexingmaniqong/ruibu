/* =========================================================
 * sync-server.js — 把电脑当「云」的局域网同步服务
 *
 * 用法：  node sync-server.js [端口]
 *        默认端口 8899
 *
 * 电脑上运行后，手机 / 平板 / 电脑连同一个 Wi-Fi，
 * 用浏览器打开终端里打印的地址（http://192.168.x.x:8899）即可，
 * 三端数据自动同步。数据存在同目录的 sync-data.json。
 * ========================================================= */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

let ROOT = __dirname;
let PORT = parseInt(process.argv[2] || process.env.PORT || '8899', 10);
let DATA_FILE = path.join(ROOT, 'sync-data.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

/* ---------------- 数据存储 ---------------- */
let db = { state: { version: 1, notes: [], boards: [], tomb: {}, ui: {} }, images: {} };

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const obj = JSON.parse(raw);
      if (obj && obj.state) db = obj;
    }
  } catch (e) {
    console.error('读取数据失败：', e.message);
  }
  if (!db.state.tomb) db.state.tomb = {};
}

let saveTimer = null;
function save() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DATA_FILE, JSON.stringify(db), err => {
      if (err) console.error('写入数据失败：', err.message);
    });
  }, 200);
}

/* ---------------- 合并 ---------------- */
function merge(incoming) {
  if (!incoming || !incoming.state) return { added: 0, updated: 0, removed: 0 };

  if (incoming.images) {
    for (const k in incoming.images) {
      if (!db.images[k]) db.images[k] = incoming.images[k];
    }
  }

  const tomb = db.state.tomb || (db.state.tomb = {});
  const inTomb = incoming.state.tomb || {};
  for (const id in inTomb) {
    if (!tomb[id] || inTomb[id] > tomb[id]) tomb[id] = inTomb[id];
  }

  const res = { added: 0, updated: 0, removed: 0 };

  function mergeList(key, incomingArr) {
    const cur = db.state[key] || [];
    const alive = cur.filter(x => {
      const deadAt = tomb[x.id];
      if (deadAt && deadAt >= (x.updatedAt || 0)) { res.removed++; return false; }
      return true;
    });
    const map = new Map(alive.map(x => [x.id, x]));
    (incomingArr || []).forEach(n => {
      const deadAt = tomb[n.id];
      if (deadAt && deadAt >= (n.updatedAt || 0)) return;
      const old = map.get(n.id);
      if (!old) { map.set(n.id, n); res.added++; }
      else if ((n.updatedAt || 0) > (old.updatedAt || 0)) { map.set(n.id, n); res.updated++; }
    });
    db.state[key] = Array.from(map.values());
  }

  mergeList('notes', incoming.state.notes);
  mergeList('boards', incoming.state.boards);
  db.state.notes.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  save();
  return res;
}

/* ---------------- HTTP ---------------- */
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';

  const file = path.join(ROOT, rel);
  // 防目录穿越
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('403'); }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    const ext = path.extname(file).toLowerCase();
    const isCode = ['.html', '.js', '.css', '.json'].includes(ext);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      // 代码文件不缓存，避免改了看不到
      'Cache-Control': isCode ? 'no-store' : 'public, max-age=86400'
    });
    fs.createReadStream(file).pipe(res);
  });
}

function createServer() {
  return http.createServer((req, res) => {
  const u = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const p = u.pathname;

  if (p === '/api/ping') {
    return sendJSON(res, 200, {
      app: 'mindnote-sync',
      version: 1,
      notes: db.state.notes.length,
      boards: db.state.boards.length,
      images: Object.keys(db.images).length
    });
  }

  if (p === '/api/ai') {
    return handleAI(req, res);
  }

  if (p === '/api/snapshot') {
    if (req.method === 'GET') {
      return sendJSON(res, 200, { state: db.state, images: db.images });
    }
    if (req.method === 'POST') {
      let body = '';
      let tooBig = false;
      req.on('data', c => {
        body += c;
        if (body.length > 200 * 1024 * 1024) { tooBig = true; req.destroy(); }
      });
      req.on('end', () => {
        if (tooBig) return;
        let obj;
        try { obj = JSON.parse(body); } catch (e) {
          return sendJSON(res, 400, { error: 'bad json' });
        }
        const r = merge(obj);
        console.log(`[同步] +${r.added} 新增 / ${r.updated} 更新 / -${r.removed} 删除`);
        sendJSON(res, 200, { ok: true, merged: r, state: db.state, images: db.images });
      });
      return;
    }
    res.writeHead(405); return res.end();
  }

  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  serveStatic(req, res, p);
  });
}

function lanIPs() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const ni of ifs[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

const AI_ENDPOINTS = {
  deepseek: 'https://api.deepseek.com/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
  xai: 'https://api.x.ai/v1/chat/completions'
};

function handleAI(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405);
    return res.end();
  }
  let body = '';
  let tooBig = false;
  req.on('data', c => {
    if (tooBig) return;
    body += c;
    if (body.length > 12 * 1024 * 1024) {
      tooBig = true;
      body = '';
      sendJSON(res, 413, { error: { message: '图片数据过大，请减少附件再试' } });
    }
  });
  req.on('end', async () => {
    if (tooBig) return;
    let obj;
    try {
      obj = JSON.parse(body);
    } catch (e) {
      return sendJSON(res, 400, { error: { message: '请求格式不对' } });
    }
    if (!obj || typeof obj.key !== 'string' || !obj.key) return sendJSON(res, 400, { error: { message: '缺少 API Key' } });
    const provider = obj.provider || 'deepseek';
    if (!Object.hasOwn(AI_ENDPOINTS, provider)) return sendJSON(res, 400, { error: { message: '未知 AI 服务' } });
    const payload = obj.payload || { model: obj.model || 'deepseek-flash', messages: obj.messages || [], stream: false };
    if (!payload || typeof payload.model !== 'string' || !Array.isArray(payload.messages)) {
      return sendJSON(res, 400, { error: { message: '模型或消息格式不正确' } });
    }

    try {
      const auth = provider === 'anthropic'
        ? { 'x-api-key': obj.key, 'anthropic-version': '2023-06-01' }
        : { Authorization: 'Bearer ' + obj.key };
      const r = await fetch(AI_ENDPOINTS[provider], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify(payload),
        redirect: 'error',
        signal: AbortSignal.timeout(120000)
      });
      const text = await r.text();
      res.writeHead(r.status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(text),
        'Cache-Control': 'no-store'
      });
      res.end(text);
    } catch (e) {
      sendJSON(res, 502, { error: { message: '无法连接所选 AI 服务' } });
    }
  });
}

/**
 * 启动同步服务（也可被桌面端 require 后以自定义端口 / 数据目录启动）
 * @param {{port?:number, root?:string, dataFile?:string, quiet?:boolean}} opts
 */
function start(opts) {
  opts = opts || {};
  if (opts.port) PORT = opts.port;
  if (opts.root) ROOT = opts.root;
  if (opts.dataFile) DATA_FILE = opts.dataFile;

  load();
  const srv = createServer();

  return new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(PORT, '0.0.0.0', () => {
      if (!opts.quiet) {
        const ips = lanIPs();
        console.log('');
        console.log('  flomo 画布 · 同步服务已启动');
        console.log('  ─────────────────────────────────────');
        console.log('  本机：      http://127.0.0.1:' + PORT);
        ips.forEach(ip => {
          console.log('  手机/平板： http://' + ip + ':' + PORT);
        });
        console.log('');
        console.log('  手机和电脑连同一个 Wi-Fi，用上面的「手机/平板」地址打开即可。');
        console.log('  数据文件：' + DATA_FILE);
        console.log('  按 Ctrl+C 停止。');
        console.log('');
      }
      resolve({ server: srv, port: PORT, url: 'http://127.0.0.1:' + PORT });
    });
  });
}

if (require.main === module) {
  start({ port: PORT }).catch(err => {
    console.error('启动失败：' + (err && err.message ? err.message : err));
    process.exit(1);
  });
}

module.exports = { start };
