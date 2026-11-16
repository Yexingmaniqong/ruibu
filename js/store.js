/* =========================================================
 * store.js — 数据模型 / 增删改 / 图片压缩 / 导入导出
 * ========================================================= */
(function (global) {
  'use strict';

  var STATE_KEY = 'state';
  var imgCache = Object.create(null);   // imageId -> dataURL
  var saveTimer = null;
  var changeCbs = [];

  var state = {
    version: 1,
    notes: [],
    boards: [],
    tomb: {},              // id -> 删除时间，用于多端同步时不复活已删条目
    ui: { lastTab: 'notes' }
  };

  /* ---------- 工具 ---------- */
  function uid(prefix) {
    return (prefix || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function now() { return Date.now(); }

  function extractTags(text) {
    var out = [];
    var re = /#([^\s#，。,.!?、:：;；()（）\[\]【】]+)/g;
    var m;
    while ((m = re.exec(text || '')) !== null) {
      var t = m[1].trim();
      if (t && out.indexOf(t) === -1) out.push(t);
    }
    return out;
  }

  /* ---------- 图片 ---------- */
  function readFileAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = src;
    });
  }

  /**
   * 压缩图片：长边不超过 maxDim，输出 jpeg。
   * 小体积 PNG 直接原样保留，避免损失。
   */
  async function compressImage(file, maxDim) {
    maxDim = maxDim || 1600;
    var raw = await readFileAsDataURL(file);

    // 小图 / 小文件 原样保留
    if (file.size < 420 * 1024 && !/^image\/(jpeg|jpg)$/i.test(file.type)) {
      return raw;
    }

    var img = await loadImage(raw);
    var w = img.naturalWidth, h = img.naturalHeight;
    var scale = Math.min(1, maxDim / Math.max(w, h));
    var tw = Math.max(1, Math.round(w * scale));
    var th = Math.max(1, Math.round(h * scale));

    var cv = document.createElement('canvas');
    cv.width = tw; cv.height = th;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#0b0d11';
    ctx.fillRect(0, 0, tw, th);
    ctx.drawImage(img, 0, 0, tw, th);

    var out = cv.toDataURL('image/jpeg', 0.84);
    // 压缩反而变大就用原图
    return out.length < raw.length ? out : raw;
  }

  /** 新增图片，返回 imageId */
  async function addImage(file) {
    var dataUrl = await compressImage(file);
    var id = uid('img_');
    imgCache[id] = dataUrl;
    await DB.set('images', id, dataUrl);
    return id;
  }

  function getImage(id) { return imgCache[id] || ''; }

  async function loadAllImages() {
    var keys = await DB.keys('images');
    for (var i = 0; i < keys.length; i++) {
      var v = await DB.get('images', keys[i]);
      if (v) imgCache[keys[i]] = v;
    }
  }

  /* ---------- 持久化 ---------- */
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      DB.set('kv', STATE_KEY, state).catch(function (e) {
        console.error('保存失败', e);
      });
    }, 220);
    if (changeCbs.length) {
      changeCbs.forEach(function (cb) {
        try { cb(); } catch (e) { /* ignore */ }
      });
    }
  }

  /* 数据变更回调（同步模块用） */
  function onChange(cb) { changeCbs.push(cb); }

  function saveNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    return DB.set('kv', STATE_KEY, state);
  }

  async function init() {
    var loaded = await DB.get('kv', STATE_KEY);
    if (loaded && loaded.version) {
      state = Object.assign(state, loaded);
      state.notes = state.notes || [];
      state.boards = state.boards || [];
      state.tomb = state.tomb || {};
    }
    await loadAllImages();
    normalizeAll();
    return state;
  }

  /* ---------- 笔记 ---------- */

  /* 图文混排：
     note.blocks = [
       {id, type:'text', items:[{t:'text',v} | {t:'img',imageId,w} | {t:'tag',v}]},
       {id, type:'image', imageId}        // 旧版整块图片，仍然兼容
     ]
     文字块里的图片是「行内图」，可以夹在文字中间；tag 是行内标签板块。
     text / imageIds / tags 都是推导出来的，供搜索、卡片预览、画布使用。 */
  function blockPlainText(b) {
    if (!b || b.type === 'image') return '';
    if (b.items && b.items.length) {
      return b.items.map(function (it) {
        if (it.t === 'text') return it.v || '';
        if (it.t === 'tag') return '#' + (it.v || '');
        return '';
      }).join('');
    }
    return b.text || '';
  }

  function normalizeBlock(b) {
    if (!b.id) b.id = uid('b_');
    if (b.type === 'image') return b;
    b.type = 'text';
    if (!b.items || !b.items.length) {
      b.items = [{ t: 'text', v: b.text || '' }];
    }
    b.items = b.items.filter(function (it) {
      return it && (it.t === 'text' || it.t === 'tag' || it.t === 'img');
    });
    // 去掉空文字项，合并相邻文字项
    var merged = [];
    b.items.forEach(function (it) {
      if (it.t === 'text') {
        if (!it.v) return;
        var last = merged[merged.length - 1];
        if (last && last.t === 'text') { last.v += it.v; return; }
      }
      merged.push(it);
    });
    if (!merged.length) merged = [{ t: 'text', v: '' }];
    b.items = merged;
    b.text = blockPlainText(b);
    return b;
  }

  function syncDerived(n) {
    var texts = [], imgs = [], inline = [];
    (n.blocks || []).forEach(function (b) {
      if (!b.id) b.id = uid('b_');
      if (b.type === 'image') {
        if (b.imageId) imgs.push(b.imageId);
        return;
      }
      texts.push(blockPlainText(b));
      (b.items || []).forEach(function (it) {
        if (it.t === 'img' && it.imageId) inline.push(it.imageId);
      });
    });
    n.text = texts.join('\n').trim();
    n.imageIds = imgs.concat(inline);
    n.tags = extractTags(n.text);
    if (!n.kind) n.kind = 'note';
    return n;
  }

  function normalizeNote(n) {
    if (!n) return n;
    if (!n.blocks || !n.blocks.length) {
      var blocks = [];
      if (n.text && n.text.trim()) blocks.push({ id: uid('b_'), type: 'text', items: [{ t: 'text', v: n.text }] });
      (n.imageIds || []).forEach(function (iid) {
        blocks.push({ id: uid('b_'), type: 'image', imageId: iid });
      });
      n.blocks = blocks;
    }
    n.blocks.forEach(normalizeBlock);
    return syncDerived(n);
  }
  function normalizeAll() {
    (state.notes || []).forEach(normalizeNote);
  }

  function setBlocks(id, blocks) {
    var n = getNote(id);
    if (!n) return null;
    n.blocks = (blocks || []).map(normalizeBlock);
    syncDerived(n);
    n.updatedAt = now();
    scheduleSave();
    return n;
  }

  function newBlock(type, data) {
    var b = { id: uid('b_'), type: type };
    if (type === 'text') {
      b.items = (data && data.items) || [{ t: 'text', v: (data && data.text) || '' }];
      normalizeBlock(b);
    }
    else if (type === 'image') b.imageId = data && data.imageId;
    return b;
  }

  function createNote(data) {
    data = data || {};
    var note = {
      id: uid('n_'),
      blocks: null,
      text: '',
      imageIds: [],
      tags: [],
      kind: data.kind || 'note',
      createdAt: data.createdAt || now(),
      updatedAt: now(),
      canvas: data.canvas || null
    };

    if (data.blocks && data.blocks.length) {
      note.blocks = data.blocks.map(normalizeBlock);
    } else {
      note.blocks = [];
      if (data.text && data.text.trim()) note.blocks.push(normalizeBlock({ id: uid('b_'), type: 'text', text: data.text }));
      (data.imageIds || []).forEach(function (iid) {
        note.blocks.push({ id: uid('b_'), type: 'image', imageId: iid });
      });
      note.blocks = note.blocks.map(normalizeBlock);
    }
    syncDerived(note);
    state.notes.unshift(note);
    scheduleSave();
    return note;
  }

  function updateNote(id, patch) {
    var n = getNote(id);
    if (!n) return null;
    Object.assign(n, patch);
    if (patch.blocks !== undefined || patch.text !== undefined || patch.imageIds !== undefined) {
      if (patch.text !== undefined && patch.blocks === undefined) {
        // 只改文字：写回第一个文字块（没有就新建）
        var tb = (n.blocks || []).filter(function (b) { return b.type === 'text'; })[0];
        if (tb) tb.text = patch.text;
        else n.blocks = [{ id: uid('b_'), type: 'text', text: patch.text }].concat(n.blocks || []);
      }
      syncDerived(n);
    }
    n.updatedAt = now();
    scheduleSave();
    return n;
  }

  function getNote(id) {
    for (var i = 0; i < state.notes.length; i++) {
      if (state.notes[i].id === id) return state.notes[i];
    }
    return null;
  }

  function deleteNote(id) {
    state.notes = state.notes.filter(function (n) { return n.id !== id; });
    state.tomb[id] = now();
    // 清理引用该笔记的画布节点
    state.boards.forEach(function (b) {
      b.nodes = (b.nodes || []).filter(function (nd) { return !(nd.type === 'note' && nd.noteId === id); });
      var alive = {};
      b.nodes.forEach(function (nd) { alive[nd.id] = 1; });
      b.edges = (b.edges || []).filter(function (e) { return alive[e.from] && alive[e.to]; });
    });
    scheduleSave();
  }

  function allTags() {
    var map = Object.create(null);
    state.notes.forEach(function (n) {
      (n.tags || []).forEach(function (t) { map[t] = (map[t] || 0) + 1; });
    });
    return Object.keys(map).sort(function (a, b) { return map[b] - map[a]; })
      .map(function (t) { return { tag: t, count: map[t] }; });
  }

  function queryNotes(opts) {
    opts = opts || {};
    var list = state.notes.slice();
    if (opts.tag) list = list.filter(function (n) { return (n.tags || []).indexOf(opts.tag) !== -1; });
    if (opts.keyword) {
      var k = opts.keyword.toLowerCase();
      list = list.filter(function (n) {
        return (n.text || '').toLowerCase().indexOf(k) !== -1 ||
          (n.tags || []).some(function (t) { return t.toLowerCase().indexOf(k) !== -1; });
      });
    }
    list.sort(function (a, b) { return b.createdAt - a.createdAt; });
    return list;
  }

  /* ---------- 画布 ---------- */
  function createBoard(title) {
    var b = {
      id: uid('b_'),
      title: title || '未命名画布',
      nodes: [],
      edges: [],
      view: { x: 0, y: 0, scale: 1 },
      createdAt: now(),
      updatedAt: now()
    };
    state.boards.unshift(b);
    scheduleSave();
    return b;
  }

  function getBoard(id) {
    for (var i = 0; i < state.boards.length; i++) {
      if (state.boards[i].id === id) return state.boards[i];
    }
    return null;
  }

  function deleteBoard(id) {
    state.boards = state.boards.filter(function (b) { return b.id !== id; });
    state.tomb[id] = now();
    scheduleSave();
  }

  /* ---------- 多端同步：快照 / 合并 ---------- */
  function collectImages() {
    var imgs = {};
    function take(id) { if (id && imgCache[id]) imgs[id] = imgCache[id]; }
    state.notes.forEach(function (n) {
      (n.imageIds || []).forEach(take);
      ((n.canvas && n.canvas.nodes) || []).forEach(function (nd) { take(nd.imageId); });
    });
    state.boards.forEach(function (b) {
      (b.nodes || []).forEach(function (nd) { take(nd.imageId); });
    });
    return imgs;
  }

  function snapshot() {
    return { app: 'mindnote', version: 1, exportedAt: now(), state: state, images: collectImages() };
  }

  /**
   * 合并另一份快照：按 id + updatedAt 取新，删除以墓碑时间为准。
   * 返回 { added, updated, removed, pulledImages }
   */
  async function mergeSnapshot(obj) {
    if (!obj || !obj.state) return { added: 0, updated: 0, removed: 0, pulledImages: 0 };
    var res = { added: 0, updated: 0, removed: 0, pulledImages: 0 };

    if (obj.images) {
      for (var k in obj.images) {
        if (!imgCache[k]) {
          imgCache[k] = obj.images[k];
          await DB.set('images', k, obj.images[k]);
          res.pulledImages++;
        }
      }
    }

    state.tomb = state.tomb || {};
    var inTomb = (obj.state.tomb || {});
    for (var tid in inTomb) {
      if (!state.tomb[tid] || inTomb[tid] > state.tomb[tid]) state.tomb[tid] = inTomb[tid];
    }

    function mergeList(key, localArr, incomingArr) {
      var map = Object.create(null);
      localArr.forEach(function (x) { map[x.id] = x; });
      var out = [];
      Object.keys(map).forEach(function (id) {
        var cur = map[id];
        var deadAt = state.tomb[id];
        if (deadAt && deadAt >= (cur.updatedAt || 0)) { res.removed++; return; }
        out.push(cur);
      });
      var seen = Object.create(null);
      out.forEach(function (x) { seen[x.id] = x; });
      (incomingArr || []).forEach(function (n) {
        var deadAt = state.tomb[n.id];
        if (deadAt && deadAt >= (n.updatedAt || 0)) return;
        var cur = seen[n.id];
        if (!cur) { out.push(n); seen[n.id] = n; res.added++; }
        else if ((n.updatedAt || 0) > (cur.updatedAt || 0)) {
          for (var p in n) cur[p] = n[p];
          res.updated++;
        }
      });
      return out;
    }

    state.notes = mergeList('notes', state.notes, obj.state.notes);
    state.notes.sort(function (a, b) { return b.createdAt - a.createdAt; });
    state.boards = mergeList('boards', state.boards, obj.state.boards);
    normalizeAll();

    await saveNow();
    return res;
  }

  /* ---------- 导出 ---------- */
  function download(filename, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 800);
  }

  function exportJSON() {
    var imgs = collectImages();
    var payload = { app: 'mindnote', version: 1, exportedAt: now(), state: state, images: imgs };
    var d = new Date();
    var stamp = d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2) + '-' + ('0' + d.getHours()).slice(-2) + ('0' + d.getMinutes()).slice(-2);
    download('mindnote-backup-' + stamp + '.json', JSON.stringify(payload));
  }

  async function importJSON(obj) {
    if (!obj || !obj.state) throw new Error('文件格式不正确');
    if (obj.images) {
      for (var k in obj.images) {
        imgCache[k] = obj.images[k];
        await DB.set('images', k, obj.images[k]);
      }
    }
    var incoming = obj.state;
    // 合并：按 id 去重
    var noteMap = Object.create(null);
    state.notes.forEach(function (n) { noteMap[n.id] = n; });
    (incoming.notes || []).forEach(function (n) { noteMap[n.id] = n; });
    state.notes = Object.keys(noteMap).map(function (k) { return noteMap[k]; });

    var boardMap = Object.create(null);
    state.boards.forEach(function (b) { boardMap[b.id] = b; });
    (incoming.boards || []).forEach(function (b) { boardMap[b.id] = b; });
    state.boards = Object.keys(boardMap).map(function (k) { return boardMap[k]; });

    state.notes.sort(function (a, b) { return b.createdAt - a.createdAt; });
    await saveNow();
  }

  /* ---------- 导出 JSON Canvas（Obsidian 规范） ---------- */
  function toJsonCanvas(board) {
    var nodes = (board.nodes || []).map(function (n) {
      var base = { id: n.id, x: Math.round(n.x), y: Math.round(n.y), width: Math.round(n.w), height: Math.round(n.h) };
      if (n.type === 'text') {
        base.type = 'text';
        base.text = n.text || '';
      } else if (n.type === 'note') {
        var nt = getNote(n.noteId);
        base.type = 'text';
        base.text = nt ? ('# ' + new Date(nt.createdAt).toLocaleDateString() + '\n\n' + (nt.text || '')) : '(笔记已删除)';
      } else {
        base.type = 'text';
        base.text = '![图片](附件)';
      }
      return base;
    });
    var edges = (board.edges || []).map(function (e) {
      return {
        id: e.id,
        fromNode: e.from,
        toNode: e.to,
        fromSide: 'right',
        toSide: 'left',
        label: e.label || ''
      };
    });
    return { nodes: nodes, edges: edges };
  }

  function exportCanvas(board) {
    var data = toJsonCanvas(board);
    download((board.title || 'canvas') + '.canvas', JSON.stringify(data, null, 2));
  }

  /* ---------- 导入 flomo 导出文件 ---------- */
  /**
   * flomo 导出的 HTML：形如 <div class="memo">...<div class="time">...</div>
   * 也兼容纯文本（按空行分段）与 CSV
   */
  async function parseFlomoFile(file) {
    var text = await file.text();
    var items = [];

    if (/\.csv$/i.test(file.name)) {
      items = parseCSV(text);
    } else if (/\.html?$/i.test(file.name)) {
      var doc = new DOMParser().parseFromString(text, 'text/html');
      var nodes = doc.querySelectorAll('.memo, .note, article');
      if (nodes.length) {
        nodes.forEach(function (el) {
          var contentEl = el.querySelector('.content, .memo-content, .text') || el;
          var timeEl = el.querySelector('.time, .date, time');
          var t = (contentEl.innerText || contentEl.textContent || '').trim();
          if (t) {
            items.push({
              text: t,
              createdAt: timeEl ? (Date.parse(timeEl.textContent.trim()) || null) : null
            });
          }
        });
      } else {
        // 退化：整页文本
        items = splitParagraphs(doc.body.innerText || '');
      }
    } else {
      items = splitParagraphs(text);
    }

    var added = 0;
    items.forEach(function (it) {
      if (!it.text || !it.text.trim()) return;
      createNote({ text: it.text.trim(), createdAt: it.createdAt || undefined });
      added++;
    });
    await saveNow();
    return added;
  }

  function splitParagraphs(text) {
    return String(text).split(/\n\s*\n/).map(function (p) {
      return { text: p.trim() };
    }).filter(function (p) { return p.text; });
  }

  function parseCSV(text) {
    var lines = text.split(/\r?\n/).filter(Boolean);
    if (!lines.length) return [];
    // 跳过表头
    var start = /content|内容/i.test(lines[0]) ? 1 : 0;
    var out = [];
    for (var i = start; i < lines.length; i++) {
      var line = lines[i];
      // 简单 CSV：取第一个字段
      var m = line.match(/^"((?:[^"]|"")*)"|^([^,]*)/);
      var content = m ? (m[1] !== undefined ? m[1].replace(/""/g, '"') : m[2]) : line;
      if (content && content.trim()) out.push({ text: content.trim() });
    }
    return out;
  }

  async function clearAll() {
    // 先给现有条目打删除墓碑，否则同步会把它们从服务端再拉回来
    var ts = now();
    state.notes.forEach(function (n) { state.tomb[n.id] = ts; });
    state.boards.forEach(function (b) { state.tomb[b.id] = ts; });
    var tomb = state.tomb;
    await DB.clear('kv');
    await DB.clear('images');
    imgCache = Object.create(null);
    state = { version: 1, notes: [], boards: [], tomb: tomb, ui: { lastTab: 'notes' } };
    await saveNow();
    scheduleSave();   // 通知同步模块把删除推给服务端
  }

  /* ---------- 导出接口 ---------- */
  global.Store = {
    init: init,
    get state() { return state; },
    save: scheduleSave,
    saveNow: saveNow,
    uid: uid,
    extractTags: extractTags,

    addImage: addImage,
    getImage: getImage,
    compressImage: compressImage,
    readFileAsDataURL: readFileAsDataURL,

    createNote: createNote,
    updateNote: updateNote,
    setBlocks: setBlocks,
    newBlock: newBlock,
    normalizeAll: normalizeAll,
    normalizeNote: normalizeNote,
    getNote: getNote,
    deleteNote: deleteNote,
    queryNotes: queryNotes,
    allTags: allTags,

    createBoard: createBoard,
    getBoard: getBoard,
    deleteBoard: deleteBoard,

    exportJSON: exportJSON,
    importJSON: importJSON,
    snapshot: snapshot,
    mergeSnapshot: mergeSnapshot,
    onChange: onChange,
    exportCanvas: exportCanvas,
    toJsonCanvas: toJsonCanvas,
    parseFlomoFile: parseFlomoFile,
    download: download,
    clearAll: clearAll
  };
})(window);
