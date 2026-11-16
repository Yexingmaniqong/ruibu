/* =========================================================
 * ai.js —— DeepSeek 问答
 *  · Key / 模型存在本地（IndexedDB 的 state.ai），不上传任何服务器
 *  · 优先走本机同步服务的 /api/ai 代理（避开浏览器 CORS），
 *    没有服务端时退回直连 api.deepseek.com
 * ========================================================= */
(function (global) {
  'use strict';

  var ENDPOINT = 'https://api.deepseek.com/chat/completions';

  var AI = {
    model: 'deepseek-chat',
    key: '',
    busy: false,
    history: []            // [{role:'user'|'assistant', content}]
  };

  var LS_KEY = 'ruibu.ai.key';
  var LS_MODEL = 'ruibu.ai.model';
  var LS_HIST = 'ruibu.ai.history';

  function readLS(k, d) {
    try {
      var v = localStorage.getItem(k);
      return v === null ? d : v;
    } catch (e) {
      return d;
    }
  }
  function writeLS(k, v) {
    try { localStorage.setItem(k, v); } catch (e) { }
  }

  /** 读配置。Key 只放 localStorage —— 不写进 Store，避免随同步数据上传到服务器 */
  function cfg() {
    AI.key = readLS(LS_KEY, '');
    AI.model = readLS(LS_MODEL, 'deepseek-chat');
    return AI;
  }

  function save(patch) {
    patch = patch || {};
    if (patch.key !== undefined) writeLS(LS_KEY, patch.key || '');
    if (patch.model !== undefined) writeLS(LS_MODEL, patch.model || 'deepseek-chat');
    cfg();
    return AI;
  }

  function hasKey() { cfg(); return !!AI.key; }

  /** 调一次模型，返回 {ok:true, text} 或 {ok:false, error} */
  async function chat(messages, opts) {
    cfg();
    opts = opts || {};
    if (!AI.key) return { ok: false, error: '还没有填 DeepSeek API Key（设置 → AI）' };

    var payload = {
      key: AI.key,
      model: opts.model || AI.model,
      messages: messages,
      temperature: opts.temperature === undefined ? 0.6 : opts.temperature
    };

    // 1) 先试本机服务端代理
    try {
      var r = await fetch('api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (r.status === 404) throw new Error('no-proxy');
      var j = await r.json();
      var out = parse(j);
      if (out) return out;
    } catch (e) {
      if (e.message !== 'no-proxy' && e.name !== 'TypeError') {
        // 代理有回应但内容不对，继续尝试直连
      }
    }

    // 2) 直连（浏览器/WebView 允许跨域时可用）
    try {
      var r2 = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + AI.key
        },
        body: JSON.stringify({
          model: payload.model,
          messages: messages,
          temperature: payload.temperature,
          stream: false
        })
      });
      var j2 = await r2.json();
      var out2 = parse(j2);
      if (out2) return out2;
      return { ok: false, error: '响应无法解析' };
    } catch (e2) {
      return { ok: false, error: '请求失败：' + (e2.message || e2) + '（可能是跨域被拦，试试用电脑上的同步服务打开）' };
    }
  }

  function parse(j) {
    if (!j) return { ok: false, error: '空响应' };
    if (j.error) {
      var msg = j.error.message || j.error;
      if (/401|invalid.*key|api key/i.test(String(msg))) msg = 'API Key 无效，检查一下设置里的 Key';
      return { ok: false, error: String(msg) };
    }
    var c = j.choices && j.choices[0];
    var text = c && c.message && c.message.content;
    if (!text) return { ok: false, error: '模型没有返回内容' };
    return { ok: true, text: String(text).trim(), usage: j.usage || null };
  }

  /** 把一条回答整理成可写进笔记的文字（保留公式与要点结构） */
  function toNoteText(question, answer) {
    var q = String(question || '').trim();
    var a = String(answer || '').trim();
    var out = '';
    if (q) out += 'Q：' + q + '\n';
    out += a;
    return out;
  }

  /** 对话记录持久化：关掉后台/重开也还在 */
  function loadHistory() {
    try {
      var raw = localStorage.getItem(LS_HIST);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function saveHistory() {
    try {
      var arr = AI.history.slice(-40);
      localStorage.setItem(LS_HIST, JSON.stringify(arr));
    } catch (e) { }
  }

  function clearHistory() {
    AI.history = [];
    try { localStorage.removeItem(LS_HIST); } catch (e) { }
  }

  AI.loadHistory = function () { AI.history = loadHistory(); return AI.history; };
  AI.saveHistory = saveHistory;
  AI.clearHistory = clearHistory;

  AI.cfg = cfg;
  AI.save = save;
  AI.hasKey = hasKey;
  AI.chat = chat;
  AI.toNoteText = toNoteText;

  global.AI = AI;
})(window);
