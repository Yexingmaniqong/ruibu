/* =========================================================
 * app.js — 主逻辑 / 路由 / 视图渲染（flomo 风格 · 三端自适应）
 * ========================================================= */
(function () {
  'use strict';

  var App = {
    board: null,
    inlineBoard: null,
    ctx: null,              // { mode:'note'|'board', noteId, boardId }
    tab: 'notes',
    tag: null,
    keyword: '',
    noteId: null,
    composeImgs: [],
    imgTarget: null,
    imgMode: 'album',
    suppressClick: false,
    activeBlock: null,      // 正在编辑的文字块
    pendingNoteId: null,
    insertAfterBlock: null,
    composeDraft: null,
    viewer: null
  };
  window.App = App;

  var $ = function (id) { return document.getElementById(id); };
  var BUILD = '1.0.4';
  window.__BUILD = BUILD;
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function fmtDate(ts) {
    var d = new Date(ts);
    var now = new Date();
    var pad = function (n) { return ('0' + n).slice(-2); };
    var hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    var ymd = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    if (d.toDateString() === now.toDateString()) return '今天 ' + hm;
    var y = new Date(now.getTime() - 86400000);
    if (d.toDateString() === y.toDateString()) return '昨天 ' + hm;
    return ymd + ' ' + hm;
  }

  /* ================= 导航 ================= */
  function switchTab(tab) {
    App.tab = tab;
    ['notes', 'diary', 'todos', 'ai', 'boards', 'settings'].forEach(function (t) {
      $('view-' + t).classList.toggle('hidden', t !== tab);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.nav-item'), function (b) {
      b.classList.toggle('active', b.dataset.nav === tab);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-nav-icon]'), function (b) {
      b.classList.toggle('active', b.dataset.navIcon === tab);
    });

    updateTitle();
    // 手机底部输入条只在笔记页显示
    $('mobile-composer').classList.toggle('hidden', tab !== 'notes');
    if (tab === 'boards') renderBoards();
    if (tab === 'diary') renderDiary();
    if (tab === 'todos') Todos.render();
    if (tab === 'ai') { renderAI(); updateAISend(); }
    if (window.__aiFillSettings && (tab === 'settings')) window.__aiFillSettings();
    closeSidebar();
  }

  function updateTitle() {
    var t = '全部笔记';
    if (App.tab === 'diary') t = '日记';
    else if (App.tab === 'todos') t = '待办';
    else if (App.tab === 'ai') t = 'AI 问答';
    else if (App.tab === 'boards') t = '关系画布';
    else if (App.tab === 'settings') t = '设置';
    else if (App.tag) t = '#' + App.tag;
    else if (App.keyword) t = '搜索：' + App.keyword;
    $('page-title').textContent = t;
  }

  function openSidebar() {
    $('sidebar').classList.add('open');
    $('side-overlay').classList.remove('hidden');
  }
  function closeSidebar() {
    $('sidebar').classList.remove('open');
    $('side-overlay').classList.add('hidden');
  }

  /* ================= 侧栏：统计 / 热力图 / 标签 ================= */
  function renderSidebar() {
    var notes = Store.state.notes;
    $('stat-notes').textContent = notes.length;

    var tags = Store.allTags();
    $('stat-tags').textContent = tags.length;
    $('tags-count').textContent = tags.length ? tags.length + ' 个' : '';

    // 使用天数
    var days = 0;
    if (notes.length) {
      var oldest = notes.reduce(function (min, n) { return Math.min(min, n.createdAt); }, Infinity);
      var d0 = new Date(oldest); d0.setHours(0, 0, 0, 0);
      var d1 = new Date(); d1.setHours(0, 0, 0, 0);
      days = Math.round((d1 - d0) / 86400000) + 1;
    }
    $('stat-days').textContent = days;

    renderHeatmap();
    renderSideTags(tags);
  }

  function renderHeatmap() {
    var counts = Object.create(null);
    Store.state.notes.forEach(function (n) {
      var d = new Date(n.createdAt); d.setHours(0, 0, 0, 0);
      counts[d.getTime()] = (counts[d.getTime()] || 0) + 1;
    });

    var today = new Date(); today.setHours(0, 0, 0, 0);
    // 从「两个月前的 1 号」开始，正好覆盖近三个月
    var start = new Date(today.getFullYear(), today.getMonth() - 2, 1);
    var total = Math.round((today - start) / 86400000) + 1;
    var cols = Math.ceil(total / 7);

    var wrap = $('heatmap');
    // 用宽高比撑开高度，否则 grid 里 1fr 的行高会塌陷成 0
    wrap.style.aspectRatio = cols + ' / 7';
    clear(wrap);

    var frag = document.createDocumentFragment();
    for (var i = 0; i < total; i++) {
      var d = new Date(start.getTime() + i * 86400000);
      var c = counts[d.getTime()] || 0;
      var cell = document.createElement('div');
      var lv = c === 0 ? 0 : (c === 1 ? 1 : (c === 2 ? 2 : (c <= 4 ? 3 : 4)));
      cell.className = 'hm-cell' + (lv ? ' l' + lv : '');
      cell.title = (d.getMonth() + 1) + '月' + d.getDate() + '日 · ' + c + ' 条';
      frag.appendChild(cell);
    }
    wrap.appendChild(frag);

    // 轴标签：起始月 / 次月 / 当月
    var axis = $('heatmap-axis');
    clear(axis);
    [0, 1, 2].forEach(function (k) {
      var m = new Date(start.getFullYear(), start.getMonth() + k, 1).getMonth() + 1;
      var s = document.createElement('span');
      s.textContent = m + '月';
      axis.appendChild(s);
    });
  }

  function renderSideTags(tags) {
    var list = $('side-tag-list');
    clear(list);

    if (!tags.length) {
      var none = document.createElement('div');
      none.style.cssText = 'font-size:12.5px;color:#a0a6ad;padding:6px 12px;';
      none.textContent = '还没有标签';
      list.appendChild(none);
      return;
    }

    tags.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'tag-item' + (App.tag === t.tag ? ' active' : '');
      b.innerHTML = '<svg class="ico"><use href="#i-hash"/></svg>' +
        '<span class="t-name">' + escapeHtml(t.tag) + '</span>' +
        '<span class="t-count">' + t.count + '</span>';
      b.addEventListener('click', function () {
        App.tag = t.tag;
        renderAll(); switchTab('notes');
      });
      list.appendChild(b);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ================= 标签条（移动端/内容区顶部） ================= */
  function renderTags() {
    var bar = $('tag-bar');
    clear(bar);
    var tags = Store.allTags();
    if (!tags.length) { bar.style.display = 'none'; return; }
    bar.style.display = '';

    tags.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'tag-chip' + (App.tag === t.tag ? ' active' : '');
      b.textContent = '#' + t.tag;
      b.addEventListener('click', function () {
        App.tag = (App.tag === t.tag) ? null : t.tag;
        renderAll(); switchTab('notes');
      });
      bar.appendChild(b);
    });
  }

  /* ================= 笔记列表 ================= */
  function renderNotes() {
    var list = $('note-list');
    clear(list);
    var notes = Store.queryNotes({ tag: App.tag, keyword: App.keyword });

    if (!notes.length) {
      var empty = document.createElement('div');
      empty.className = 'empty-state';
      var isFiltered = !!(App.keyword || App.tag);
      empty.innerHTML = '<svg class="ico"><use href="#i-note"/></svg>' +
        '<div class="t">' + (isFiltered ? '没有匹配的笔记' : '还没有笔记') + '</div>' +
        '<div class="s">' + (isFiltered ? '换个关键词或标签试试' :
          '在上面写下第一条想法<br>用 #标签 分类，之后就能在画布里连线') + '</div>';
      list.appendChild(empty);
      return;
    }

    notes.forEach(function (n) { list.appendChild(noteCard(n)); });
  }

  /** 一条笔记的卡片：图文预览 + 右键/长按菜单 */
  function noteCard(n) {
    var card = document.createElement('div');
    card.className = 'note-card';
    card.dataset.id = n.id;

    var head = document.createElement('div');
    head.className = 'note-card-head';
    var time = document.createElement('span');
    time.className = 'note-time';
    time.textContent = fmtDate(n.createdAt);
    head.appendChild(time);
    if (n.kind === 'diary') {
      var kd = document.createElement('span');
      kd.className = 'note-kind';
      kd.textContent = '日记';
      head.appendChild(kd);
    }
    if (n.canvas) {
      var badge = document.createElement('span');
      badge.className = 'note-badge';
      badge.innerHTML = '<svg class="ico"><use href="#i-grid"/></svg>画布';
      head.appendChild(badge);
    }
    card.appendChild(head);

    // 文字：取第一个文字块
    var tb = (n.blocks || []).filter(function (b) { return b.type === 'text' && (b.text || '').trim(); })[0];
    if (tb) {
      var body = document.createElement('div');
      body.className = 'note-body';
      body.innerHTML = cardText(tb.text);
      card.appendChild(body);
    }

    // 图片：最多 6 张
    var imgs = (n.blocks || []).filter(function (b) { return b.type === 'image' && b.imageId; });
    if (imgs.length) {
      var thumbs = document.createElement('div');
      thumbs.className = 'note-thumbs';
      thumbs.dataset.n = imgs.length >= 4 ? '4' : String(imgs.length);
      imgs.slice(0, 6).forEach(function (b) {
        var im = document.createElement('img');
        im.src = Store.getImage(b.imageId);
        im.loading = 'lazy';
        im.draggable = false;
        im.addEventListener('click', function (e) {
          e.stopPropagation();
          if (card.__suppress) return;
          viewImage(this.src);
        });
        thumbs.appendChild(im);
      });
      card.appendChild(thumbs);
    }

    card.addEventListener('click', function () {
      if (card.__suppress || App.suppressClick) return;
      openNote(n.id);
    });
    attachCardMenu(card, n);
    return card;
  }

  /** 卡片里的文字：限制长度，公式/粗体正常渲染 */
  function cardText(text) {
    var s = String(text || '');
    var cut = s.length > 420 ? s.slice(0, 420) + '…' : s;
    return RUIBU.inline(cut);
  }

  /* ---------- 右键 / 长按 ---------- */
  function attachCardMenu(el, note) {
    el.addEventListener('contextmenu', function (e) {
      if (e.target.closest('img') && e.ctrlKey) return;
      e.preventDefault();
      App.suppressClick = true;
      openCtxMenu(e.clientX, e.clientY, noteMenuItems(note));
      setTimeout(function () { App.suppressClick = false; }, 500);
    });

    var timer = null, sx = 0, sy = 0;
    el.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      timer = setTimeout(function () {
        App.suppressClick = true;
        if (navigator.vibrate) try { navigator.vibrate(12); } catch (err) { }
        openCtxMenu(sx, sy, noteMenuItems(note));
      }, 520);
    }, { passive: true });
    el.addEventListener('touchmove', function (e) {
      if (Math.abs(e.touches[0].clientX - sx) > 10 || Math.abs(e.touches[0].clientY - sy) > 10) {
        clearTimeout(timer);
      }
    }, { passive: true });
    el.addEventListener('touchend', function () {
      clearTimeout(timer);
      setTimeout(function () { App.suppressClick = false; }, 450);
    });
    el.addEventListener('touchcancel', function () { clearTimeout(timer); });
  }

  function noteMenuItems(note) {
    var items = [
      { label: '打开', icon: 'i-note', onClick: function () { openNote(note.id); } },
      {
        label: '加图片', icon: 'i-image', onClick: function () {
          App.imgTarget = 'note';
          App.pendingNoteId = note.id;
          pickImages('album');
        }
      },
      {
        label: note.kind === 'diary' ? '取消「日记」' : '设为日记', icon: 'i-calendar', onClick: function () {
          Store.updateNote(note.id, { kind: note.kind === 'diary' ? 'note' : 'diary' });
          renderAll();
          UI.toast(note.kind === 'diary' ? '已取消日记' : '已加入日记');
        }
      }
    ];
    items.push({ sep: true });
    items.push({
      label: '删除', icon: 'i-trash', danger: true, onClick: function () {
        UI.confirm('删除这条笔记？', '笔记及其画布都会被删除，无法恢复。', '删除').then(function (ok) {
          if (!ok) return;
          Store.deleteNote(note.id);
          if (App.noteId === note.id) closeNote(true);
          renderAll();
          UI.toast('已删除');
        });
      }
    });
    return items;
  }

  function openCtxMenu(x, y, items, above) {
    var mask = $('ctx-mask'), menu = $('ctx-menu');
    clear(menu);
    items.forEach(function (it) {
      if (it.sep) {
        var sp = document.createElement('div');
        sp.className = 'ctx-sep';
        menu.appendChild(sp);
        return;
      }
      var b = document.createElement('button');
      b.className = 'ctx-item' + (it.danger ? ' danger' : '');
      b.innerHTML = '<svg class="ico"><use href="#' + (it.icon || 'i-more') + '"/></svg><span></span>';
      b.lastChild.textContent = it.label;
      // 保留正文的焦点和选区，软键盘打开时也能插入标签。
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        hideCtxMenu();
        it.onClick();
      });
      menu.appendChild(b);
    });

    mask.classList.remove('hidden');
    // 先显示再量尺寸，避免超出屏幕
    var viewport = window.visualViewport;
    var startY = viewport ? viewport.offsetTop : 0;
    var bottom = viewport ? startY + viewport.height : window.innerHeight;
    menu.style.maxHeight = Math.max(90, (above ? y : bottom) - startY - 20) + 'px';
    menu.style.left = '0px';
    menu.style.top = '0px';
    var r = menu.getBoundingClientRect();
    var vw = window.innerWidth;
    var left = Math.min(x, vw - r.width - 12);
    var top = Math.min(above ? y - r.height : y, bottom - r.height - 12);
    menu.style.left = Math.max(10, left) + 'px';
    menu.style.top = Math.max(startY + 10, top) + 'px';
    if (navigator.vibrate) { /* noop */ }
  }

  function hideCtxMenu() {
    $('ctx-mask').classList.add('hidden');
  }

  /* ================= 图片查看器 ================= */
  function viewImage(src) {
    if (!src) return;
    var mask = document.createElement('div');
    mask.className = 'img-viewer';
    var img = document.createElement('img');
    img.src = src;
    var close = document.createElement('div');
    close.className = 'iv-close';
    close.innerHTML = '<svg class="ico"><use href="#i-close"/></svg>';
    mask.appendChild(img);
    mask.appendChild(close);

    function shut() {
      if (mask.parentNode) mask.parentNode.removeChild(mask);
      App.viewer = null;
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') { popLayer(); } }

    mask.addEventListener('click', function () { popLayer(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(mask);
    App.viewer = { close: shut };
    pushLayer('image', shut);
  }

  /* ================= 层级栈：多级返回 ================= */
  var layerStack = [];

  function pushLayer(kind, close) {
    layerStack.push({ kind: kind, close: close });
    try { history.pushState({ layer: kind, depth: layerStack.length }, ''); } catch (e) { }
  }

  function popLayer() {
    var top = layerStack.pop();
    if (top && typeof top.close === 'function') {
      try { top.close(); } catch (e) { console.error(e); }
    }
    return !!top;
  }

  /** 一次性关掉所有浮层（点侧边栏切换页面时用） */
  function closeAllLayers() {
    while (layerStack.length) {
      var top = layerStack.pop();
      if (top && typeof top.close === 'function') {
        try { top.close(); } catch (e) { console.error(e); }
      }
    }
  }

  /** 返回按钮 / 安卓返回键：关掉最上面一层 */
  function goBack() {
    if (!layerStack.length) return false;
    try { history.back(); } catch (e) { popLayer(); }
    return true;
  }

  window.__ruibuBack = function () { return goBack() ? 'ok' : ''; };
  window.__ruibuHasLayer = function () { return layerStack.length; };

  /* ================= 笔记详情 ================= */
  function openNote(id) {
    var note = Store.getNote(id);
    if (!note) return;
    var already = (App.noteId === id) && !$('sheet-note').classList.contains('hidden');
    App.noteId = id;
    Store.normalizeNote(note);
    $('note-date').textContent = fmtDate(note.createdAt) + (note.kind === 'diary' ? ' · 日记' : '');

    renderBlocks(note);

    var isDiary = note.kind === 'diary';
    $('note-canvas-hint').classList.toggle('hidden', isDiary || !!note.canvas);
    $('note-canvas-btn').classList.toggle('hidden', isDiary);
    $('sheet-note').classList.remove('hidden');
    renderInlineCanvas(note);

    if (!already) {
      pushLayer('note', function () { closeNote(true); });
    }
  }

  function closeNote(silent) {
    cancelImageDrag();
    var note = App.noteId ? Store.getNote(App.noteId) : null;
    if (note && App.activeBlock && App.activeBlock.el && App.activeBlock.el.isContentEditable) {
      saveBlockEdits(App.activeBlock.el, note, App.activeBlock.block);
    }
    App.activeBlock = null;
    App.noteId = null;
    destroyInline();
    dropEmptyDraft();
    $('sheet-note').classList.add('hidden');
    if (App.tab === 'diary') renderDiary();
    renderAll();
  }

  /* ---------- 文字块：显示 / 编辑 ---------- */
  function textBlockEl(note, b) {
    var el = document.createElement('div');
    el.className = 'blk blk-text';
    el.dataset.bid = b.id;
    paintRich(el, b);

    el.addEventListener('click', function (e) {
      if (el.isContentEditable) return;
      if (e.target.closest('.inline-img') || e.target.closest('.inline-img-el')) return;
      startEditBlock(el, note, b);
    });
    return el;
  }

  function paintRich(el, b) {
    el.contentEditable = 'false';
    el.classList.remove('editing');
    el.innerHTML = RUIBU.rich(b.items || []);
  }

  /* ---------- 笔记图片拖动 ---------- */
  var IMAGE_HANDLE = '.inline-img, .inline-img-el, .img-cell, .blk-image';
  var imageDrag = null;
  var blockDragClick = false;

  function bindImageDrag() {
    var box = $('note-blocks');
    var scroller = box.closest('.sheet-scroll');

    document.addEventListener('pointerdown', function () { blockDragClick = false; }, true);
    box.addEventListener('pointerdown', function (e) {
      var handle = imageHandle(e.target);
      if (!handle || e.button !== 0) return;
      // Chromium 的编辑器会尝试选中图片或移动插入光标。
      e.preventDefault();
      if (e.pointerType === 'touch' || imageDrag) return;
      startImageDrag(handle, e.pointerId, e.clientX, e.clientY, false);
    }, true);
    box.addEventListener('touchstart', function (e) {
      var handle = imageHandle(e.target);
      if (!handle || imageDrag || e.touches.length !== 1) return;
      var touch = e.changedTouches[0];
      startImageDrag(handle, touch.identifier, touch.clientX, touch.clientY, true);
    }, { passive: true });

    box.addEventListener('contextmenu', function (e) {
      if (imageDrag || imageHandle(e.target)) e.preventDefault();
    }, true);
    box.addEventListener('click', function (e) {
      if (blockDragClick && e.detail) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      var handle = imageHandle(e.target);
      if (!handle) return;
      var img = handle.matches('img') ? handle : handle.querySelector('img');
      if (img && img.getAttribute('src')) viewImage(img.src);
      e.stopPropagation();
    }, true);
    scroller.addEventListener('scroll', function () {
      if (imageDrag && !imageDrag.active) cancelImageDrag();
      if (imageDrag && imageDrag.active) queueImageDrag(imageDrag);
    });
    window.addEventListener('blur', cancelImageDrag);
  }

  function imageHandle(node) {
    if (!node.closest || node.closest('.blk-del')) return null;
    return node.closest(IMAGE_HANDLE);
  }

  function startImageDrag(handle, pointerId, x, y, touch) {
    var note = Store.getNote(App.noteId);
    var img = handle.matches('img') ? handle : handle.querySelector('img');
    var blockEl = handle.closest('[data-bid]');
    if (!note || !img || !blockEl || !img.getAttribute('src')) return;
    var ordinal = Array.from(blockEl.querySelectorAll('.inline-img, .inline-img-el')).indexOf(handle);
    var rect = handle.getBoundingClientRect();
    var st = {
      handle: handle, img: img, grid: handle.closest('.img-grid'),
      noteId: note.id, blockId: blockEl.dataset.bid, ordinal: ordinal,
      width: rect.width,
      startX: x, startY: y, x: x, y: y, active: false, moved: false,
      listeners: new AbortController(), preview: null, frame: 0, tick: 0
    };
    imageDrag = st;
    var opts = { capture: true, signal: st.listeners.signal };

    function update(point, event) {
      st.x = point.clientX;
      st.y = point.clientY;
      var distance = Math.hypot(st.x - st.startX, st.y - st.startY);
      if (!st.active) {
        if (distance < (touch ? 9 : 6)) return;
        if (touch) { cancelImageDrag(); return; }
        liftImage(st);
      }
      if (event.cancelable) event.preventDefault();
      if (distance >= 6) st.moved = true;
      queueImageDrag(st);
    }
    function findTouch(e) {
      return Array.from(e.changedTouches).find(function (t) { return t.identifier === pointerId; });
    }

    if (touch) {
      st.hold = setTimeout(function () { liftImage(st); }, 420);
      document.addEventListener('touchstart', function (e) {
        if (e.touches.length > 1) cancelImageDrag();
      }, opts);
      document.addEventListener('touchmove', function (e) {
        var point = findTouch(e);
        if (point) update(point, e);
      }, { capture: true, passive: false, signal: opts.signal });
      document.addEventListener('touchend', function (e) {
        var point = findTouch(e);
        if (!point) return;
        if (st.active && e.cancelable) e.preventDefault();
        finishImageDrag(st, point);
      }, { capture: true, passive: false, signal: opts.signal });
      document.addEventListener('touchcancel', function (e) {
        if (findTouch(e)) cancelImageDrag();
      }, opts);
    } else {
      document.addEventListener('pointermove', function (e) {
        if (e.pointerId === pointerId) update(e, e);
      }, opts);
      document.addEventListener('pointerup', function (e) {
        if (e.pointerId === pointerId) finishImageDrag(st, e);
      }, opts);
      document.addEventListener('pointercancel', function (e) {
        if (e.pointerId === pointerId) cancelImageDrag();
      }, opts);
    }
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      cancelImageDrag();
    }, opts);
  }

  function liftImage(st) {
    if (!st.handle.isConnected || App.noteId !== st.noteId) { cancelImageDrag(); return; }
    st.active = true;
    blockDragClick = true;
    st.handle.classList.add('drag-source');
    document.body.classList.add('img-drag-mode');
    st.ghost = document.createElement('div');
    st.ghost.className = 'image-drag-ghost';
    var img = new Image();
    img.src = st.img.src;
    st.ghost.appendChild(img);
    document.body.appendChild(st.ghost);
    st.caret = document.createElement('div');
    st.caret.className = 'image-drop-caret';
    st.caret.hidden = true;
    document.body.appendChild(st.caret);
    st.bin = $('image-drop-bin');
    st.bin.hidden = false;
    updateImageDrag(st, 0);
  }

  function queueImageDrag(st) {
    if (!st.frame) st.frame = requestAnimationFrame(function (time) { updateImageDrag(st, time); });
  }

  function updateImageDrag(st, time) {
    st.frame = 0;
    var box = $('note-blocks');
    var scroller = box.closest('.sheet-scroll');
    var sheet = $('sheet-note');
    var viewport = window.visualViewport;
    var bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
    st.bin.style.bottom = Math.max(0, sheet.getBoundingClientRect().bottom - bottom) + 'px';
    var thumbnail = 45;
    var left = st.x + 17;
    if (left + thumbnail > window.innerWidth - 8) left = st.x - thumbnail - 17;
    var top = st.y - thumbnail - 15;
    if (top < (viewport ? viewport.offsetTop : 0) + 8) top = st.y + 15;
    st.ghost.style.transform = 'translate3d(' + left + 'px,' + top + 'px,0)';

    var drop = imageDropTarget(st, box);
    previewImageGrid(st, drop && drop.kind === 'reorder' ? drop : null);
    st.bin.classList.toggle('is-over', !!drop && drop.kind === 'delete');
    var line = drop && drop.line;
    st.caret.hidden = !line;
    if (line) {
      st.caret.classList.toggle('is-slot', !!line.slot);
      st.caret.style.transform = 'translate3d(' + line.x + 'px,' + line.y + 'px,0)';
      st.caret.style.width = line.w + 'px';
      st.caret.style.height = line.h + 'px';
    }

    if (!st.moved || (drop && drop.kind === 'delete')) { st.tick = 0; return; }
    var scrollRect = scroller.getBoundingClientRect();
    var bin = st.bin.getBoundingClientRect();
    var shownBottom = Math.min(scrollRect.bottom, bin.top);
    var edge = Math.min(52, (shownBottom - scrollRect.top) / 4);
    if (edge <= 0 || st.x < scrollRect.left || st.x > scrollRect.right) return;
    var delta = st.y < scrollRect.top + edge && st.y >= scrollRect.top - 8
      ? -Math.min(1, (scrollRect.top + edge - st.y) / edge)
      : st.y > shownBottom - edge && st.y <= shownBottom
        ? (st.y - shownBottom + edge) / edge : 0;
    if (!delta) { st.tick = 0; return; }
    var previous = scroller.scrollTop;
    var elapsed = st.tick ? Math.min(32, time - st.tick) : 16;
    st.tick = time;
    scroller.scrollTop += delta * elapsed * 0.75;
    if (scroller.scrollTop !== previous) queueImageDrag(st);
  }

  function cancelImageDrag() {
    var st = imageDrag;
    if (!st) return;
    imageDrag = null;
    clearTimeout(st.hold);
    cancelAnimationFrame(st.frame);
    st.listeners.abort();
    if (!st.active) return;
    previewImageGrid(st, null);
    st.handle.classList.remove('drag-source');
    document.body.classList.remove('img-drag-mode');
    st.ghost.remove();
    st.caret.remove();
    st.bin.hidden = true;
    st.bin.classList.remove('is-over');
  }

  function finishImageDrag(st, point) {
    st.x = point.clientX;
    st.y = point.clientY;
    // 以抬手坐标重新计算，避免提交上一帧的预览位置。
    var moved = st.moved || Math.hypot(st.x - st.startX, st.y - st.startY) >= 6;
    var drop = st.active && moved ? imageDropTarget(st, $('note-blocks')) : null;
    var textItems = drop && drop.kind === 'text' ? itemsAtImageDrop(drop) : null;
    cancelImageDrag();
    if (drop) applyImageDrop(st, drop, textItems);
  }

  function containsPoint(rect, x, y) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function imageDropTarget(st, box) {
    var x = st.x, y = st.y;
    if (containsPoint(st.bin.getBoundingClientRect(), x, y)) return { kind: 'delete' };
    var under = document.elementFromPoint(x, y);
    var scroller = box.closest('.sheet-scroll');
    if (!under || under.closest('.sheet-scroll') !== scroller) return null;
    var bounds = box.getBoundingClientRect();
    if (x < bounds.left - 8 || x > bounds.right + 8 || y < bounds.top - 12 || y > bounds.bottom + 38) return null;

    var grid = under.closest('.img-grid');
    if (grid && grid.parentElement === box) return gridImageDrop(grid, st);
    var el = under.closest('.blk-text');
    if (el && el.parentElement === box) return textImageDrop(el, under, x, y);

    var children = Array.from(box.querySelectorAll(':scope > .blk-text, :scope > .img-grid'));
    var next = children.find(function (child) { return y < child.getBoundingClientRect().top; });
    var anchor = next || children[children.length - 1];
    if (!anchor) return null;
    var edge = anchor.matches('.img-grid') ? (next ? anchor.firstElementChild : anchor.lastElementChild) : anchor;
    var rect = anchor.getBoundingClientRect();
    return { kind: 'block', id: edge.dataset.bid, after: !next,
      line: { x: rect.left, y: (next ? rect.top : rect.bottom) - 9, w: 18, h: 18, slot: true } };
  }

  function gridImageDrop(grid, st) {
    var cells = Array.from(grid.children);
    var rect = grid.getBoundingClientRect();
    // offsetLeft/Top 不受预览 transform 影响，指针总是命中固定格位。
    var slots = cells.map(function (cell) {
      return { x: rect.left + cell.offsetLeft, y: rect.top + cell.offsetTop,
        w: cell.offsetWidth, h: cell.offsetHeight };
    });
    var index = 0, rowDistance = Infinity, columnDistance = Infinity;
    slots.forEach(function (slot, i) {
      var dy = Math.abs(st.y - slot.y - slot.h / 2);
      var dx = Math.abs(st.x - slot.x - slot.w / 2);
      if (dy < rowDistance || (dy === rowDistance && dx < columnDistance)) {
        index = i; rowDistance = dy; columnDistance = dx;
      }
    });
    if (grid === st.grid) {
      return { kind: 'reorder', id: cells[index].dataset.bid, after: index > cells.indexOf(st.handle),
        cells: cells, index: index, slots: slots, grid: grid };
    }
    var slot = slots[index];
    var after = st.x >= slot.x + slot.w / 2;
    return { kind: 'block', id: cells[index].dataset.bid, after: after,
      line: { x: (after ? slot.x + slot.w : slot.x) - 9, y: slot.y + (slot.h - 18) / 2,
        w: 18, h: 18, slot: true } };
  }

  function previewImageGrid(st, drop) {
    if (!drop) {
      if (st.preview) st.preview.cells.forEach(function (cell) { cell.style.transform = ''; });
      st.preview = null;
      return;
    }
    if (st.preview && st.preview.grid === drop.grid && st.preview.index === drop.index) return;
    st.preview = drop;
    var order = drop.cells.slice();
    order.splice(order.indexOf(st.handle), 1);
    order.splice(drop.index, 0, st.handle);
    order.forEach(function (cell, i) {
      var source = drop.slots[drop.cells.indexOf(cell)], slot = drop.slots[i];
      cell.style.transform = 'translate(' + (slot.x - source.x) + 'px,' + (slot.y - source.y) + 'px)';
    });
  }

  function rangeFromPoint(x, y) {
    if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
    if (document.caretPositionFromPoint) {
      var position = document.caretPositionFromPoint(x, y);
      if (position) {
        var range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
        range.collapse(true);
        return range;
      }
    }
    return null;
  }

  function textImageDrop(el, under, x, y) {
    var atomic = under.closest('.inline-img, .inline-img-el, [data-tag]');
    var range, rect;
    if (atomic && el.contains(atomic)) {
      rect = atomic.getBoundingClientRect();
      range = document.createRange();
      if (x < rect.left + rect.width / 2) range.setStartBefore(atomic);
      else range.setStartAfter(atomic);
      range.collapse(true);
      return { kind: 'text', el: el, range: range,
        line: { x: x < rect.left + rect.width / 2 ? rect.left - 2 : rect.right,
          y: Math.min(Math.max(y - 10, rect.top), Math.max(rect.top, rect.bottom - 20)), w: 3, h: 20 } };
    }
    range = rangeFromPoint(x, y);
    if (!range || !el.contains(range.startContainer)) {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }
    rect = range.getBoundingClientRect();
    var bounds = el.getBoundingClientRect();
    return { kind: 'text', el: el, range: range,
      line: { x: rect.height ? rect.left - 1 : bounds.left, y: rect.height ? rect.top : bounds.top,
        w: 3, h: Math.min(23, Math.max(18, rect.height)) } };
  }

  function itemsAtImageDrop(drop) {
    var el = drop.el, range = drop.range;
    if (el.isContentEditable) {
      // 克隆编辑器并标记实际 DOM 边界，保留换行、标签和图片的相对顺序。
      var node = range.startContainer, path = [];
      while (node !== el) {
        path.unshift(Array.prototype.indexOf.call(node.parentNode.childNodes, node));
        node = node.parentNode;
      }
      var clone = el.cloneNode(true);
      var cloneNode = path.reduce(function (parent, index) { return parent.childNodes[index]; }, clone);
      var marker = document.createElement('span');
      marker.dataset.dropMarker = '';
      // 分离的 DOM Range 也能插到文字节点内部。
      var at = document.createRange();
      at.setStart(cloneNode, range.startOffset);
      at.collapse(true);
      at.insertNode(marker);
      return serializeBlock(clone);
    }

    var note = Store.getNote(App.noteId);
    var block = note.blocks.find(function (b) { return b.id === el.dataset.bid; });
    var items = block.items.slice();
    var container = range.startContainer;
    if (container === el) {
      var next = el.childNodes[range.startOffset];
      var index = next && next.dataset ? Number(next.dataset.dropItem) : items.length;
      items.splice(index, 0, { t: 'drop' });
      return items;
    }
    var element = container.nodeType === 1 ? container : container.parentElement;
    var itemEl = element.closest('[data-drop-item]');
    var i = itemEl ? Number(itemEl.dataset.dropItem) : items.length;
    var item = items[i];
    if (item && item.t === 'text') {
      var prefix = range.cloneRange();
      prefix.setStart(itemEl, 0);
      var fragment = document.createElement('span');
      fragment.appendChild(prefix.cloneContents());
      fragment.querySelectorAll('br').forEach(function (br) { br.replaceWith('\n'); });
      var plain = fragment.textContent;
      var raw = item.v || '';
      var offset = raw.length;
      if (raw.startsWith(plain)) {
        offset = plain.length;
      } else if (container.nodeType === 3 && container.parentElement === itemEl) {
        // 富文本标记留在源数据里。仍可在标记旁的普通文字间落子。
        var start = raw.indexOf(container.nodeValue);
        if (start >= 0) offset = start + range.startOffset;
      }
      items.splice(i, 1, { t: 'text', v: raw.slice(0, offset) }, { t: 'drop' }, { t: 'text', v: raw.slice(offset) });
    } else {
      items.splice(i, 0, { t: 'drop' });
    }
    return items;
  }

  function applyImageDrop(st, drop, textItems) {
    var note = Store.getNote(st.noteId);
    if (!note || App.noteId !== note.id || drop.id === st.blockId && st.ordinal < 0) return;
    var source = note.blocks.find(function (b) { return b.id === st.blockId; });
    var dest = note.blocks.find(function (b) { return b.id === (drop.el ? drop.el.dataset.bid : drop.id); });
    if (!source || (drop.kind !== 'delete' && !dest)) return;
    var active = App.activeBlock;
    var sourceItems = source === dest && textItems ? textItems : (
      active && active.block === source ? serializeBlock(active.el) : source.items);
    var img, imageIndex;
    if (source.type === 'image') {
      img = { t: 'img', imageId: source.imageId, w: source.w || Math.round(st.width) };
    } else {
      var ordinal = st.ordinal;
      imageIndex = sourceItems.findIndex(function (item) { return item.t === 'img' && ordinal-- === 0; });
      if (imageIndex < 0) return;
      img = sourceItems[imageIndex];
    }
    if (textItems && !textItems.some(function (item) { return item.t === 'drop'; })) return;

    if (active && active.el.__finishEdit) active.el.__finishEdit();
    if (source.type === 'image') {
      note.blocks.splice(note.blocks.indexOf(source), 1);
    } else {
      source.items = sourceItems.slice();
      source.items.splice(imageIndex, 1);
      if (source === dest && textItems) textItems = source.items;
    }
    if (textItems) {
      var at = textItems.findIndex(function (item) { return item.t === 'drop'; });
      textItems.splice(at, 1, img);
      dest.items = textItems;
    } else if (drop.kind !== 'delete') {
      var block = source.type === 'image' ? source : Store.newBlock('image', { imageId: img.imageId });
      block.w = img.w;
      note.blocks.splice(note.blocks.indexOf(dest) + (drop.after ? 1 : 0), 0, block);
    }

    Store.setBlocks(note.id, note.blocks);
    renderBlocks(note);
    renderAll();
  }

  function insertImgAtRange(range, iid, w) {
    var img = document.createElement('img');
    img.className = 'inline-img-el';
    img.dataset.iid = iid;
    img.dataset.w = w;
    img.src = Store.getImage(iid);
    img.contentEditable = 'false';
    img.draggable = false;
    var sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(range.cloneRange()); }
    range.deleteContents();
    range.insertNode(img);
    var sp = document.createTextNode('\u200b');
    img.parentNode.insertBefore(sp, img.nextSibling);
    var r3 = document.createRange();
    r3.setStart(sp, 1);
    r3.collapse(true);
    if (sel) { sel.removeAllRanges(); sel.addRange(r3); }
  }

  /* ---------- 编辑态 ---------- */
  function startEditBlock(el, note, b) {
    el.contentEditable = 'true';
    el.classList.add('editing');
    el.innerHTML = itemsToEditable(b.items || []);
    el.focus();
    placeCaretEnd(el);
    App.activeBlock = { el: el, note: note, block: b };

    var timer = null;
    function onInput() {
      if (makeTagChip(el)) { /* 刚生成了标签板块 */ }
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        saveBlockEdits(el, note, b, true);
      }, 400);
    }
    function onKey(e) {
      if (e.key === 'Backspace') {
        // 删掉紧邻的标签/图片整体
        var sel = window.getSelection();
        if (sel && sel.rangeCount && sel.isCollapsed) {
          var r = sel.getRangeAt(0);
          var prev = r.startContainer;
          if (r.startOffset === 0 && prev.parentElement) {
            var chipEl = prev.previousSibling;
            if (chipEl && chipEl.nodeType === 1 && (chipEl.dataset.tag || chipEl.tagName === 'IMG')) {
              e.preventDefault();
              chipEl.remove();
              saveBlockEdits(el, note, b, true);
            }
          }
        }
      }
    }
    function onOutside(e) {
      if (el.contains(e.target)) return;
      // 底栏按钮不抢焦点：交给它自己的 click 处理
      if (e.target.closest && e.target.closest('#editor-bar, #ctx-menu')) return;
      finish();
    }
    function finish() {
      el.removeEventListener('input', onInput);
      el.removeEventListener('blur', onBlur);
      el.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onOutside, true);
      if (timer) clearTimeout(timer);
      saveBlockEdits(el, note, b);
      if (el.__finishEdit) el.__finishEdit = null;
      if (App.activeBlock && App.activeBlock.el === el) App.activeBlock = null;
    }
    function onBlur() { finish(); }
    el.__finishEdit = finish;

    el.addEventListener('input', onInput);
    el.addEventListener('blur', onBlur);
    el.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onOutside, true);
  }

  function itemsToEditable(items) {
    return items.map(function (it) {
      if (it.t === 'text') return RUIBU.esc(it.v || '').replace(/\n/g, '<br>');
      if (it.t === 'tag') {
        return '<span class="inline-tag" contenteditable="false" data-tag="' + RUIBU.esc(it.v) + '">#' + RUIBU.esc(it.v) + '</span>';
      }
      if (it.t === 'img') {
        var w = it.w || 130;
        return '<img class="inline-img-el" contenteditable="false" draggable="false" data-iid="' + RUIBU.esc(it.imageId) + '" data-w="' + w +
          '" src="' + Store.getImage(it.imageId) + '">';
      }
      return '';
    }).join('');
  }

  function serializeBlock(el) {
    var items = [], buf = '', dropOffset = null;
    function flush() {
      if (dropOffset !== null) {
        if (dropOffset) items.push({ t: 'text', v: buf.slice(0, dropOffset) });
        items.push({ t: 'drop' });
        buf = buf.slice(dropOffset);
        dropOffset = null;
      }
      if (buf) { items.push({ t: 'text', v: buf }); buf = ''; }
    }
    (function walk(node) {
      for (var i = 0; i < node.childNodes.length; i++) {
        var n = node.childNodes[i];
        if (n.nodeType === 3) { buf += n.nodeValue; continue; }
        if (n.nodeType !== 1) continue;
        if (n.tagName === 'BR') { buf += '\n'; continue; }
        if (n.hasAttribute('data-drop-marker')) {
          dropOffset = buf.length;
          continue;
        }
        if (n.tagName === 'IMG') {
          flush();
          items.push({ t: 'img', imageId: n.dataset.iid, w: parseInt(n.dataset.w || n.style.width || 130, 10) || 130 });
          continue;
        }
        if (n.dataset && n.dataset.tag) {
          flush();
          items.push({ t: 'tag', v: n.dataset.tag });
          continue;
        }
        if (n.tagName === 'DIV' || n.tagName === 'P') {
          if (buf && buf.slice(-1) !== '\n') buf += '\n';
          walk(n);
          if (buf && buf.slice(-1) !== '\n') buf += '\n';
          continue;
        }
        walk(n);
      }
    })(el);
    flush();
    // 去掉末尾空文字
    while (items.length && items[items.length - 1].t === 'text' && !items[items.length - 1].v) items.pop();
    if (!items.length) items = [{ t: 'text', v: '' }];
    // 合并相邻文字
    var merged = [];
    items.forEach(function (it) {
      var last = merged[merged.length - 1];
      if (it.t === 'text' && last && last.t === 'text') { last.v += it.v; return; }
      merged.push(it);
    });
    return merged;
  }

  function saveBlockEdits(el, note, b, silent) {
    b.items = serializeBlock(el);
    Store.setBlocks(note.id, note.blocks);
    if (!silent) {
      paintRich(el, b);
      renderAll();
    }
  }

  /** 输入 "#标签 " 后按空格 → 变成标签板块，空格后面是正文 */
  function makeTagChip(el) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return false;
    var r = sel.getRangeAt(0);
    var node = r.startContainer;
    if (node.nodeType !== 3) return false;
    var off = r.startOffset;
    var before = node.nodeValue.slice(0, off);
    var m = /(^|[\s\u00a0])#([^\s#]{1,24})[\s\u00a0]$/.exec(before);
    if (!m) return false;

    var keep = m[1];
    var tagName = m[2];
    var cutFrom = off - m[0].length + keep.length;
    var rest = node.nodeValue.slice(off);
    node.nodeValue = node.nodeValue.slice(0, cutFrom) + rest;

    var chip = document.createElement('span');
    chip.className = 'inline-tag';
    chip.contentEditable = 'false';
    chip.dataset.tag = tagName;
    chip.textContent = '#' + tagName;

    var space = document.createTextNode(' ');
    node.parentNode.insertBefore(chip, node.nextSibling);
    node.parentNode.insertBefore(space, chip.nextSibling);

    var r2 = document.createRange();
    r2.setStart(space, 1);
    r2.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r2);
    return true;
  }

  function placeCaretEnd(el) {
    try {
      var r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      var s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    } catch (e) { }
  }

  /* ---------- 整块图片（旧数据 / 拖到块之间） ---------- */
  function imageBlockEl(note, b) {
    var el = document.createElement('div');
    el.className = 'blk blk-image';
    el.dataset.bid = b.id;

    var img = document.createElement('img');
    img.src = Store.getImage(b.imageId);
    img.dataset.iid = b.imageId;
    img.draggable = false;
    el.appendChild(img);

    var del = document.createElement('button');
    del.className = 'blk-del';
    del.title = '删除这张图';
    del.innerHTML = '✕';
    del.addEventListener('click', function (e) {
      e.stopPropagation();
      note.blocks = note.blocks.filter(function (x) { return x.id !== b.id; });
      Store.setBlocks(note.id, note.blocks);
      renderBlocks(note);
      renderAll();
    });
    el.appendChild(del);

    return el;
  }

  /* ---------- 渲染 ---------- */
  function renderBlocks(note) {
    var box = $('note-blocks');
    cancelImageDrag();
    clear(box);

    if (!note.blocks || !note.blocks.length) {
      note.blocks = [Store.newBlock('text', { text: '' })];
    }
    // 旧版本会把从空编辑器添加的相册照片保存为行内图。
    // 只迁移纯图片块，保留真正的图文混排和图片顺序。
    var changed = false;
    note.blocks = note.blocks.flatMap(function (block) {
      if (block.type !== 'text') return [block];
      var items = block.items || [];
      var images = items.filter(function (item) { return item.t === 'img'; });
      var hasText = items.some(function (item) {
        return item.t === 'tag' || item.t === 'text' && (item.v || '').replace(/\u200b/g, '').trim();
      });
      if (!images.length || hasText) return [block];
      changed = true;
      return images.map(function (item) {
        var image = Store.newBlock('image', { imageId: item.imageId });
        image.w = item.w;
        return image;
      });
    });
    // 只保留一个空的文字块（避免出现一摞「写点什么…」）
    var empties = [];
    note.blocks.forEach(function (b) {
      if (b.type === 'text' && blockIsEmpty(b)) empties.push(b);
    });
    if (empties.length > 1) {
      var keep = empties[empties.length - 1];
      note.blocks = note.blocks.filter(function (b) {
        return empties.indexOf(b) === -1 || b === keep;
      });
      changed = true;
    }
    if (changed) Store.setBlocks(note.id, note.blocks);

    // 连续的整块图片合成「一行四个」的网格
    var i = 0;
    while (i < note.blocks.length) {
      var b = note.blocks[i];
      if (b.type === 'image') {
        var run = [];
        while (i < note.blocks.length && note.blocks[i].type === 'image') {
          run.push(note.blocks[i]);
          i++;
        }
        box.appendChild(imageGridEl(note, run));
      } else {
        box.appendChild(textBlockEl(note, b));
        i++;
      }
    }
    if (note.blocks[note.blocks.length - 1].type === 'image') {
      var addText = document.createElement('button');
      addText.type = 'button';
      addText.className = 'note-add-text';
      addText.textContent = '继续写文字…';
      addText.addEventListener('click', function () { ensureActiveBlock(note, true); });
      box.appendChild(addText);
    }
  }

  function imageGridEl(note, run) {
    var grid = document.createElement('div');
    grid.className = 'img-grid';
    run.forEach(function (b) {
      var cell = document.createElement('div');
      cell.className = 'img-cell';
      cell.dataset.bid = b.id;

      var img = document.createElement('img');
      img.src = Store.getImage(b.imageId);
      img.dataset.iid = b.imageId;
      img.draggable = false;
      cell.appendChild(img);

      var del = document.createElement('button');
      del.className = 'blk-del';
      del.title = '删除这张图';
      del.innerHTML = '✕';
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        note.blocks = note.blocks.filter(function (x) { return x.id !== b.id; });
        Store.setBlocks(note.id, note.blocks);
        renderBlocks(note);
        renderAll();
      });
      cell.appendChild(del);

      grid.appendChild(cell);
    });
    return grid;
  }

  function blockIsEmpty(b) {
    return !(b.items || []).some(function (it) {
      return (it.t === 'text' && (it.v || '').trim()) || it.t === 'img' || it.t === 'tag';
    });
  }

  /* ================= 编辑工具条 ================= */
  function bindEditorBar() {
    var bar = $('editor-bar');
    if (!bar) return;
    bar.addEventListener('mousedown', function (e) {
      if (e.target.closest('.ed-btn')) e.preventDefault();
    });
    bar.addEventListener('click', function (e) {
      var btn = e.target.closest('.ed-btn');
      if (!btn) return;
      var note = App.noteId ? Store.getNote(App.noteId) : null;
      if (!note) return;
      var act = btn.dataset.ed;

      if (act === 'album' || act === 'camera') {
        App.imgTarget = 'note';
        pickImages(act);
        return;
      }
      if (act === 'more') {
        var r = btn.getBoundingClientRect();
        openCtxMenu(r.left, r.top - 8, noteMoreMenu(note));
        return;
      }
      if (act === 'tag') {
        var tags = Store.allTags();
        var r2 = btn.getBoundingClientRect();
        var menuItems = tags.map(function (tg) {
          return {
            label: '#' + tg.tag,
            icon: 'i-hash',
            onClick: function () { insertNoteTag(note, tg.tag); }
          };
        });
        menuItems.unshift({
          label: '输入新标签', icon: 'i-plus',
          onClick: function () { insertNoteTag(note); }
        });
        openCtxMenu(r2.left, r2.top - 8, menuItems, true);
        return;
      }
    });
  }

  function insertNoteTag(note, tag) {
    var ab = ensureActiveBlock(note);
    if (!ab) return;
    var el = ab.el;
    el.focus();
    var input = document.createTextNode(tag ? ' ' : '#');
    var sel = window.getSelection();
    var range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    if (!range || !el.contains(range.startContainer) || !el.contains(range.endContainer)) {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }
    range.collapse(false);
    range.insertNode(input);
    if (tag) {
      var chip = document.createElement('span');
      chip.className = 'inline-tag';
      chip.contentEditable = 'false';
      chip.dataset.tag = tag;
      chip.textContent = '#' + tag;
      input.before(chip);
    }
    range.setStart(input, input.length);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    saveBlockEdits(el, note, ab.block, true);
  }

  function ensureActiveBlock(note, append) {
    if (App.activeBlock && App.activeBlock.note.id === note.id && App.activeBlock.el.isContentEditable) {
      if (!append) return App.activeBlock;
      App.activeBlock.el.__finishEdit();
    }
    var last = note.blocks[note.blocks.length - 1];
    if (last && last.type !== 'text') last = null;
    if (!last) {
      last = Store.newBlock('text', { text: '' });
      note.blocks = (note.blocks || []).concat([last]);
      Store.setBlocks(note.id, note.blocks);
    }
    renderBlocks(note);
    var el = $('note-blocks').querySelector('[data-bid="' + last.id + '"]');
    if (!el) return null;
    startEditBlock(el, note, last);
    return App.activeBlock;
  }

  function noteMoreMenu(note) {
    var items = [
      {
        label: '加画布 / 打开画布', icon: 'i-grid', onClick: function () {
          openCanvas({ mode: 'note', noteId: note.id });
        }
      },
      {
        label: note.kind === 'diary' ? '取消「日记」' : '设为日记', icon: 'i-calendar', onClick: function () {
          Store.updateNote(note.id, { kind: note.kind === 'diary' ? 'note' : 'diary' });
          $('note-date').textContent = fmtDate(note.createdAt) + (note.kind === 'diary' ? ' · 日记' : '');
          renderAll();
        }
      },
      {
        label: '清理重复图片', icon: 'i-image', onClick: function () {
          var r = dedupeNoteImages(note);
          if (!r.dup && !r.nodes) { UI.toast('没有重复图片'); return; }
          renderBlocks(note);
          if (note.canvas) renderInlineCanvas(note);
          renderAll();
          UI.toast('已清理 ' + r.dup + ' 张重复图片');
        }
      },
      { sep: true },
      {
        label: '删除笔记', icon: 'i-trash', danger: true, onClick: function () {
          UI.confirm('删除这条笔记？', '笔记及其画布都会被删除，无法恢复。', '删除').then(function (ok) {
            if (!ok) return;
            Store.deleteNote(note.id);
            closeNote(true);
            renderAll();
            UI.toast('已删除');
          });
        }
      }
    ];
    return items;
  }

  /* ================= 选图（相册 / 拍照） ================= */
  function pickImages(mode) {
    App.imgMode = mode || 'album';
    if (mode === 'camera' && !/Android|iPhone|iPad/i.test(navigator.userAgent)) {
      openComputerCamera();
      return;
    }
    var input = (mode === 'camera') ? $('file-camera') : $('file-image');
    if (!input) return;
    input.value = '';
    input.click();
  }

  async function openComputerCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      UI.toast('当前页面无法访问摄像头');
      return;
    }
    var stream;
    var noteId = App.noteId;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      if (App.noteId !== noteId) return;
      var view = document.createElement('video');
      view.className = 'camera-preview';
      view.autoplay = true;
      view.muted = true;
      view.playsInline = true;
      view.srcObject = stream;
      var canvas = await UI.modal({
        title: '拍照', bodyNode: view, actions: [
          { label: '取消', value: null },
          { label: '拍照', cls: 'primary', onClick: function () {
            if (!view.videoWidth) return false;
            var frame = document.createElement('canvas');
            frame.width = view.videoWidth;
            frame.height = view.videoHeight;
            frame.getContext('2d').drawImage(view, 0, 0);
            return frame;
          } }
        ]
      });
      if (canvas && App.noteId === noteId) {
        var blob = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', .9); });
        if (blob && App.noteId === noteId) {
          await onFilesPicked([new File([blob], 'photo.jpg', { type: 'image/jpeg' })]);
        }
      }
    } catch (e) {
      UI.toast('无法打开摄像头，请检查权限和设备');
    } finally {
      if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
    }
  }

  /** 图片插进当前笔记：有正在编辑的块就插在光标处，否则追加一个新块 */
  async function insertImagesIntoNote(note, items) {
    if (!note || !items.length) return;
    var ab = App.activeBlock;
    var editing = ab && ab.note.id === note.id && ab.el.isConnected && ab.el.isContentEditable;
    if (editing && items.length === 1 && serializeBlock(ab.el).some(function (item) {
      return item.t === 'tag' || item.t === 'text' && item.v.trim();
    })) {
      items.forEach(function (it) {
        var sel = window.getSelection();
        var range = (sel && sel.rangeCount) ? sel.getRangeAt(0) : null;
        if (range && ab.el.contains(range.startContainer)) {
          insertImgAtRange(range, it.id, 130);
        } else {
          var img = document.createElement('img');
          img.className = 'inline-img-el';
          img.dataset.iid = it.id;
          img.dataset.w = 130;
          img.src = Store.getImage(it.id);
          img.contentEditable = 'false';
          ab.el.appendChild(img);
        }
      });
      saveBlockEdits(ab.el, note, ab.block, true);
      return;
    }
    if (editing) ab.el.__finishEdit();
    var blocks = (note.blocks || []).slice();
    var news = items.map(function (it) { return Store.newBlock('image', { imageId: it.id }); });
    blocks = blocks.concat(news);
    note.blocks = blocks;
    Store.setBlocks(note.id, blocks);
    renderBlocks(note);
    renderAll();
  }

  async function appendImagesToNote(noteId, ids) {
    var note = Store.getNote(noteId);
    if (!note) return;
    await insertImagesIntoNote(note, ids.map(function (id) { return { id: id }; }));

    if (note.canvas) {
      var nodes = note.canvas.nodes || (note.canvas.nodes = []);
      var maxY = 0;
      nodes.forEach(function (n) { if (n.y + n.h > maxY) maxY = n.y + n.h; });
      var cellW = 250, cellH = 200, gap = 26;
      var cols = ids.length <= 2 ? Math.max(1, ids.length) : 3;
      var startY = maxY + gap;
      for (var i = 0; i < ids.length; i++) {
        var s = await imgSize(Store.getImage(ids[i]));
        var ratio = s.h / s.w;
        var w = cellW, h = Math.round(w * ratio);
        if (h > cellH) { h = cellH; w = Math.round(h / ratio); }
        nodes.push({
          id: Store.uid('nd_'), type: 'image', imageId: ids[i],
          x: (i % cols) * (cellW + gap),
          y: startY + Math.floor(i / cols) * (cellH + gap),
          w: w, h: h
        });
      }
      Store.save();
    }
  }

  /* ================= 清理重复图片 ================= */
  function imgFingerprint(src) {
    if (!src) return 'g:empty';
    var h = 5381, n = src.length;
    for (var i = 0; i < n; i++) h = ((h * 33) ^ src.charCodeAt(i)) >>> 0;
    return 'g:' + n + ':' + h;
  }

  function dedupeNoteImages(note) {
    var seen = Object.create(null), removed = Object.create(null), dup = 0;
    (note.blocks || []).forEach(function (b) {
      var iid = b.type === 'image' ? b.imageId : null;
      if (iid) {
        var k0 = imgFingerprint(Store.getImage(iid));
        if (seen[k0]) { removed[iid] = 1; dup++; }
        else seen[k0] = 1;
      }
      (b.items || []).forEach(function (it) {
        if (it.t !== 'img') return;
        var k = imgFingerprint(Store.getImage(it.imageId));
        if (seen[k]) { removed[it.imageId] = 1; dup++; }
        else seen[k] = 1;
      });
    });

    var blocks = (note.blocks || []).slice();
    blocks = blocks.filter(function (b) {
      if (b.type === 'image' && removed[b.imageId]) return false;
      return true;
    }).map(function (b) {
      if (b.type !== 'text') return b;
      var seen2 = Object.create(null);
      b.items = (b.items || []).filter(function (it) {
        if (it.t !== 'img') return true;
        var k = imgFingerprint(Store.getImage(it.imageId));
        if (seen2[k]) { dup++; return false; }
        seen2[k] = 1;
        return true;
      });
      if (!b.items.length) b.items = [{ t: 'text', v: '' }];
      return b;
    });

    var canvas = note.canvas;
    var removedNodes = 0;
    if (canvas && (canvas.nodes || []).length) {
      var seenImg = Object.create(null), keepNodes = [], dead = Object.create(null);
      canvas.nodes.forEach(function (n) {
        if (n.type === 'image' && n.imageId) {
          if (removed[n.imageId]) { dead[n.id] = 1; removedNodes++; return; }
          if (seenImg[n.imageId]) { dead[n.id] = 1; removedNodes++; return; }
          seenImg[n.imageId] = 1;
        }
        keepNodes.push(n);
      });
      if (removedNodes) {
        canvas.nodes = keepNodes;
        canvas.edges = (canvas.edges || []).filter(function (e) { return !dead[e.from] && !dead[e.to]; });
      }
    }

    if (!dup && !removedNodes) return { dup: 0, nodes: 0 };
    note.blocks = blocks;
    var patch = { blocks: blocks };
    if (removedNodes) patch.canvas = canvas;
    Store.updateNote(note.id, patch);
    return { dup: dup, nodes: removedNodes };
  }

  /* ================= 内嵌画布（笔记下方） ================= */
  function destroyInline() {
    if (App.inlineBoard) { App.inlineBoard.destroy(); App.inlineBoard = null; }
    var tb = $('ic-toolbar');
    if (tb) tb.classList.add('hidden');
  }

  function renderInlineCanvas(note) {
    var wrap = $('note-canvas-inline');
    destroyInline();
    if (!note || !note.canvas) { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var host = $('ic-host');
        if (!host) return;
        App.inlineBoard = new CanvasBoard(host, {
          editable: true,
          onChange: function (d) { Store.updateNote(note.id, { canvas: d }); },
          onViewChange: function (d) { note.canvas = d; Store.save(); },
          onOpenImage: function (imgId) { viewImage(Store.getImage(imgId)); },
          onSelectionChange: function (sid) {
            $('ic-toolbar').classList.toggle('hidden', !sid);
            var n = sid && App.inlineBoard ? App.inlineBoard.getNode(sid) : null;
            $('ic-toolbar').dataset.img = n && n.type === 'image' ? '1' : '0';
          }
        });

        var d = note.canvas;
        App.inlineBoard.setData(d);
        var hasContent = (d.nodes || []).length > 0;
        var hasView = d.view && (d.view.x !== 0 || d.view.y !== 0 || d.view.scale !== 1);

        if (!hasContent) {
          var r = host.getBoundingClientRect();
          App.inlineBoard.view = { x: r.width / 2, y: r.height / 2, scale: 1 };
          App.inlineBoard._applyView();
        } else if (!hasView || !contentFits(App.inlineBoard, host) || App.inlineBoard.view.scale < 0.35) {
          App.inlineBoard.fitView();
        }
      });
    });
  }

  /* 新增图片后，等内嵌画布重建完再把视角拉回全部内容 */
  function fitInlineSoon() {
    setTimeout(function () { if (App.inlineBoard) App.inlineBoard.fitView(); }, 220);
  }

  /* ================= 画布 ================= */
  function openCanvas(ctx) {
    App.ctx = ctx;
    $('sheet-canvas').classList.remove('hidden');
    pushLayer('canvas', function () { closeCanvas(); });

    var title = '', data = null;
    if (ctx.mode === 'note') {
      var note = Store.getNote(ctx.noteId);
      title = '笔记画布';
      data = note.canvas;
    } else {
      var b = Store.getBoard(ctx.boardId);
      title = b.title;
      data = { nodes: b.nodes, edges: b.edges, view: b.view };
    }
    $('canvas-title').textContent = title;
    $('dock-add-note').classList.toggle('hidden', ctx.mode !== 'board');

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (App.board) { App.board.destroy(); App.board = null; }
        App.board = new CanvasBoard($('canvas-host'), {
          editable: true,
          onChange: function (d) { saveCanvas(d, true); },
          onViewChange: function (d) { saveCanvas(d); },
          onOpenNote: function (noteId) {
            if (ctx.mode === 'board') {
              $('sheet-canvas').classList.add('hidden');
              openNote(noteId);
            }
          },
          onOpenImage: function (imageId) { viewImage(Store.getImage(imageId)); },
          onSelectionChange: function (id) {
            $('node-toolbar').classList.toggle('hidden', !id);
            var n = id && App.board ? App.board.getNode(id) : null;
            $('node-toolbar').dataset.img = n && n.type === 'image' ? '1' : '0';
          }
        });

        if (data) {
          App.board.setData(data);
          var hasContent = (data.nodes || []).length > 0;
          var hasView = data.view && (data.view.x !== 0 || data.view.y !== 0 || data.view.scale !== 1);
          if (!hasContent) {
            centerCanvas();
          } else if (!hasView || !nodesVisible() || App.board.view.scale < 0.35) {
            // 换了设备/窗口尺寸后，旧的视角可能把内容推到屏幕外
            App.board.fitView();
          }
        } else {
          centerCanvas();
        }
      });
    });
  }

  /** 当前视角下是否还有节点可见（至少 40px 露出） */
  function contentVisible(board, hostEl) {
    if (!board || !board.nodes.length || !hostEl) return false;
    var r = hostEl.getBoundingClientRect();
    return board.nodes.some(function (n) {
      var sx = board.view.x + n.x * board.view.scale;
      var sy = board.view.y + n.y * board.view.scale;
      var sw = n.w * board.view.scale, sh = n.h * board.view.scale;
      var ox = Math.min(sx + sw, r.width) - Math.max(sx, 0);
      var oy = Math.min(sy + sh, r.height) - Math.max(sy, 0);
      return ox > 40 && oy > 40;
    });
  }

  /* 全部节点是否都完整落在视口内（内嵌画布用，换设备后自动复位） */
  function contentFits(board, hostEl) {
    if (!board || !board.nodes.length || !hostEl) return false;
    var r = hostEl.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    return board.nodes.every(function (n) {
      var sx = board.view.x + n.x * board.view.scale;
      var sy = board.view.y + n.y * board.view.scale;
      var sw = n.w * board.view.scale, sh = n.h * board.view.scale;
      return sx >= -8 && sy >= -8 && sx + sw <= r.width + 8 && sy + sh <= r.height + 8;
    });
  }

  function nodesVisible() {
    return contentVisible(App.board, $('canvas-host'));
  }

  function centerCanvas() {
    var r = $('canvas-host').getBoundingClientRect();
    App.board.view = { x: r.width / 2, y: r.height / 2, scale: 1 };
    App.board._applyView();
  }

  /**
   * bump=true 表示内容真的变了（会更新 updatedAt，从而同步到其他设备）；
   * 只是平移/缩放视角时不 bump，避免各端视角互相打架。
   */
  function saveCanvas(d, bump) {
    if (!App.ctx) return;
    if (App.ctx.mode === 'note') {
      var note = Store.getNote(App.ctx.noteId);
      if (!note) return;
      if (bump) {
        Store.updateNote(note.id, { canvas: d });
      } else {
        note.canvas = d;
        Store.save();
      }
    } else {
      var b = Store.getBoard(App.ctx.boardId);
      if (b) {
        b.nodes = d.nodes; b.edges = d.edges; b.view = d.view;
        if (bump) b.updatedAt = Date.now();
        Store.save();
      }
    }
  }

  function closeCanvas() {
    var wasNote = App.ctx && App.ctx.mode === 'note';
    var nid = App.noteId;
    if (App.board) { App.board.destroy(); App.board = null; }
    $('sheet-canvas').classList.add('hidden');
    $('node-toolbar').classList.add('hidden');
    App.ctx = null;
    renderAll();
    // 从笔记里打开的画布：退回去时把笔记页恢复出来（不再压入新层级）
    if (wasNote && nid) {
      var note = Store.getNote(nid);
      if (note) {
        App.noteId = nid;
        renderBlocks(note);
        $('note-canvas-hint').classList.toggle('hidden', !!note.canvas);
        $('sheet-note').classList.remove('hidden');
        renderInlineCanvas(note);
      }
    }
  }

  async function buildNoteCanvas(note) {
    var imgs = note.imageIds || [];
    var nodes = [];
    var cols = imgs.length <= 2 ? 1 : (imgs.length <= 6 ? 2 : 3);
    var gapX = 26, gapY = 26, cellW = 250, cellH = 200;

    var sizes = await Promise.all(imgs.map(function (id) {
      return new Promise(function (resolve) {
        var im = new Image();
        im.onload = function () { resolve({ w: im.naturalWidth, h: im.naturalHeight }); };
        im.onerror = function () { resolve({ w: 4, h: 3 }); };
        im.src = Store.getImage(id);
      });
    }));

    imgs.forEach(function (id, i) {
      var s = sizes[i];
      var ratio = s.h / s.w;
      var w = cellW;
      var h = Math.round(w * ratio);
      if (h > cellH) { h = cellH; w = Math.round(h / ratio); }
      var col = i % cols, row = Math.floor(i / cols);
      nodes.push({
        id: Store.uid('nd_'), type: 'image', imageId: id,
        x: col * (cellW + gapX), y: row * (cellH + gapY), w: w, h: h
      });
    });

    if (!nodes.length) {
      nodes.push({
        id: Store.uid('nd_'), type: 'text',
        text: '在这里放图片、写关键词，用箭头连起来',
        x: 0, y: 0, w: 200, h: 70
      });
    }
    return { nodes: nodes, edges: [], view: { x: 0, y: 0, scale: 1 } };
  }

  /* ================= AI 问答（DeepSeek） ================= */
  function renderAI() {
    var log = $('ai-log');
    if (!log) return;
    clear(log);
    if (AI.history.length) {
      var bar = document.createElement('div');
      bar.className = 'ai-bar';
      var cnt = document.createElement('span');
      cnt.textContent = '共 ' + AI.history.length + ' 条记录';
      var clr = document.createElement('button');
      clr.className = 'ai-clearbtn';
      clr.textContent = '清空对话';
      clr.addEventListener('click', function () {
        UI.confirm('清空 AI 对话？', '只清空聊天记录，不影响笔记。', '清空').then(function (ok) {
          if (!ok) return;
          AI.clearHistory();
          App.aiImgs = [];
          renderAI();
          renderAiAttach();
        });
      });
      bar.appendChild(cnt);
      bar.appendChild(clr);
      log.appendChild(bar);
    }
    if (!AI.history.length) {
      var h = document.createElement('div');
      h.className = 'ai-hello';
      h.innerHTML = AI.hasKey()
        ? '直接问就行。<br>回答里可以<b>选中一段</b>点浮出来的「加到笔记」，也可以整条加到任意一条记录里。<br>公式照 <span class="k">\\dfrac{dy}{dx}</span> 这样写，它会自动排版。'
        : '还没有配置 API Key：<br>去 <b>设置 → AI（DeepSeek）</b> 填一个 <span class="k">sk-…</span> 就能用了。<br>Key 只保存在这台设备上。';
      log.appendChild(h);
    }
    AI.history.forEach(function (m) {
      log.appendChild(aiMsgEl(m));
    });
    log.scrollTop = log.scrollHeight;
    AI.saveHistory();
  }

  function aiMsgEl(m) {
    var wrap = document.createElement('div');
    wrap.className = 'ai-msg ' + (m.role === 'user' ? 'user' : 'bot');
    var av = document.createElement('div');
    av.className = 'ai-avatar';
    av.textContent = m.role === 'user' ? '我' : 'AI';

    var body = document.createElement('div');
    body.className = 'ai-body';
    var name = document.createElement('div');
    name.className = 'ai-name';
    name.textContent = m.role === 'user' ? '你' : 'DeepSeek';
    var text = document.createElement('div');
    text.className = 'ai-text';
    if (m.role === 'user') text.textContent = m.content;
    else text.innerHTML = RUIBU.inline(m.content);

    body.appendChild(name);
    body.appendChild(text);

    if (m.images && m.images.length) {
      var iw = document.createElement('div');
      iw.className = 'ai-imgs';
      m.images.forEach(function (iid) {
        var im = document.createElement('img');
        im.src = Store.getImage(iid);
        im.draggable = false;
        iw.appendChild(im);
      });
      body.appendChild(iw);
    }

    if (m.role === 'assistant' && m.content.indexOf('⚠️') !== 0) {
      var acts = document.createElement('div');
      acts.className = 'ai-acts';

      var add = document.createElement('button');
      add.className = 'ai-act primary';
      add.innerHTML = '<svg class="ico"><use href="#i-plus"/></svg><span>加到笔记</span>';
      add.addEventListener('click', function () {
        addTextToNote(AI.toNoteText(m.q || '', m.content), text, acts);
      });

      var copy = document.createElement('button');
      copy.className = 'ai-act';
      copy.innerHTML = '<svg class="ico"><use href="#i-note"/></svg><span>复制</span>';
      copy.addEventListener('click', function () {
        copyText(m.content).then(function () { UI.toast('已复制'); });
      });

      acts.appendChild(add);
      acts.appendChild(copy);
      body.appendChild(acts);
    }

    wrap.appendChild(av);
    wrap.appendChild(body);
    return wrap;
  }

  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t);
    return new Promise(function (resolve) {
      var ta = document.createElement('textarea');
      ta.value = t;
      ta.style.cssText = 'position:fixed;left:-9999px;';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) { }
      document.body.removeChild(ta);
      resolve();
    });
  }

  /** 输入框上方：待发送的图片缩略图 */
  function renderAiAttach() {
    var row = $('ai-attach');
    if (!row) return;
    clear(row);
    var imgs = App.aiImgs || [];
    row.classList.toggle('hidden', !imgs.length);
    imgs.forEach(function (iid, idx) {
      var wrap = document.createElement('div');
      wrap.className = 'ai-attach-item';
      var im = document.createElement('img');
      im.src = Store.getImage(iid);
      im.draggable = false;
      var x = document.createElement('button');
      x.textContent = '✕';
      x.addEventListener('click', function () {
        App.aiImgs.splice(idx, 1);
        renderAiAttach();
      });
      wrap.appendChild(im);
      wrap.appendChild(x);
      row.appendChild(wrap);
    });
  }
  function appendTyping() {
    var log = $('ai-log');
    var wrap = document.createElement('div');
    wrap.className = 'ai-msg bot';
    wrap.innerHTML = '<div class="ai-avatar">AI</div>' +
      '<div class="ai-body"><div class="ai-name">DeepSeek</div>' +
      '<div class="ai-typing"><i></i><i></i><i></i><span style="margin-left:6px">正在想…</span></div></div>';
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
    return wrap;
  }

  function updateAISend() {
    var btn = $('ai-send');
    if (btn) btn.disabled = AI.busy;
  }

  async function aiSend() {
    var ta = $('ai-text');
    if (!ta || AI.busy) return;
    var q = ta.value.trim();
    if (!q) return;
    if (!AI.hasKey()) {
      UI.toast('先去 设置 → AI 填 API Key');
      switchTab('settings');
      return;
    }
    ta.value = '';
    ta.style.height = 'auto';

    var imgs = (App.aiImgs || []).slice();
    App.aiImgs = [];
    renderAiAttach();

    AI.history.push({ role: 'user', content: q, images: imgs });
    renderAI();
    AI.busy = true;
    updateAISend();
    var typing = appendTyping();

    var sys = '你是学习助手。回答尽量简洁、分段清楚；数学公式统一用 LaTeX（例如 \\dfrac{dy}{dx}）。' +
      '不要用 Markdown 表格。';
    var msgs = [{ role: 'system', content: sys }].concat(
      AI.history.slice(-9).map(function (m) {
        if (m.role === 'user' && m.images && m.images.length) {
          return {
            role: 'user',
            content: [{ type: 'text', text: m.content }].concat(m.images.map(function (iid) {
              return { type: 'image_url', image_url: { url: Store.getImage(iid) } };
            }))
          };
        }
        return { role: m.role, content: m.content };
      })
    );

    var r = await AI.chat(msgs);
    AI.busy = false;
    if (typing && typing.parentNode) typing.parentNode.removeChild(typing);

    if (!r.ok) {
      AI.history.push({ role: 'assistant', content: '⚠️ ' + r.error });
    } else {
      AI.history.push({ role: 'assistant', content: r.text, q: q });
    }
    renderAI();
    updateAISend();
  }

  /** 把一段文字加进某条笔记（优先当前打开的笔记） */
  async function addTextToNote(text, sourceEl, actsEl) {
    if (!text || !text.trim()) { UI.toast('没有内容'); return; }
    var notes = Store.state.notes;
    if (!notes.length) {
      var n = Store.createNote({ text: text, kind: 'note' });
      Store.save();
      renderAll();
      UI.toast('已新建一条笔记');
      return;
    }

    var items = notes.map(function (n) {
      var preview = RUIBU.prettyPlain(n.text || '', 34) || '（只有图片）';
      if (n.id === App.noteId) preview += '  ← 正在编辑';
      if (n.kind === 'diary') preview = '日记 · ' + preview;
      return {
        id: n.id,
        text: preview,
        createdAt: n.createdAt,
        tags: n.tags,
        imageIds: n.imageIds
      };
    });

    var picked = await UI.pick(items, '加到哪条笔记');
    if (!picked || !picked.id) return;
    var note = Store.getNote(picked.id);
    if (!note) return;

    var block = Store.newBlock('text', { text: text });
    note.blocks = (note.blocks || []).concat([block]);
    Store.setBlocks(note.id, note.blocks);

    if (App.noteId === note.id) renderBlocks(Store.getNote(note.id));
    renderAll();
    UI.toast('已加到「' + (RUIBU.prettyPlain(note.text || '', 12) || '笔记') + '」');
  }

  /* 选中回答里的文字 → 浮出「加到笔记」 */
  var selFloat = null, selTimer = null;

  function hideSelFloat() {
    if (selFloat && selFloat.parentNode) selFloat.parentNode.removeChild(selFloat);
    selFloat = null;
  }

  function onAINoteSelection() {
    if (selTimer) clearTimeout(selTimer);
    selTimer = setTimeout(function () {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed) { hideSelFloat(); return; }
      var text = String(sel);
      if (!text.trim()) { hideSelFloat(); return; }
      var range = sel.getRangeAt(0);
      var node = range.commonAncestorContainer;
      var el = node.nodeType === 1 ? node : node.parentElement;
      if (!el || !el.closest || !el.closest('#ai-log .ai-text')) { hideSelFloat(); return; }

      var rect = range.getBoundingClientRect();
      hideSelFloat();
      selFloat = document.createElement('div');
      selFloat.className = 'sel-float';

      var b1 = document.createElement('button');
      b1.innerHTML = '<svg class="ico"><use href="#i-plus"/></svg><span>加到笔记</span>';
      b1.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b1.addEventListener('click', function () {
        var t = String(sel).trim();
        hideSelFloat();
        addTextToNote(t, null, null);
      });

      var b2 = document.createElement('button');
      b2.innerHTML = '<svg class="ico"><use href="#i-note"/></svg><span>复制</span>';
      b2.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b2.addEventListener('click', function () {
        var t = String(sel).trim();
        hideSelFloat();
        copyText(t).then(function () { UI.toast('已复制'); });
      });

      selFloat.appendChild(b1);
      selFloat.appendChild(b2);
      document.body.appendChild(selFloat);

      var w = selFloat.offsetWidth, h = selFloat.offsetHeight;
      var left = Math.min(Math.max(8, rect.left + rect.width / 2 - w / 2), window.innerWidth - w - 8);
      var top = rect.top - h - 8;
      if (top < 8) top = rect.bottom + 8;
      selFloat.style.left = left + 'px';
      selFloat.style.top = top + 'px';
    }, 160);
  }

  function bindAI() {
    var ta = $('ai-text');
    var send = $('ai-send');
    if (!ta || !send) return;

    var autoGrow = function () {
      ta.style.height = 'auto';
      ta.style.height = Math.min(140, ta.scrollHeight) + 'px';
    };
    ta.addEventListener('input', autoGrow);
    ta.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        aiSend();
      }
    });
    send.addEventListener('click', aiSend);

    var addImg = $('ai-addimg');
    if (addImg) {
      addImg.addEventListener('click', function () {
        App.imgTarget = 'ai';
        pickImages('album');
      });
    }

    document.addEventListener('selectionchange', function () {
      if (!$('view-ai') || $('view-ai').classList.contains('hidden')) return;
      onAINoteSelection();
    });
    document.addEventListener('pointerdown', function (e) {
      if (selFloat && !selFloat.contains(e.target)) hideSelFloat();
    }, true);
    window.addEventListener('scroll', hideSelFloat, true);

    // 设置：读取 / 保存 / 测试
    var keyEl = $('ai-key'), modelEl = $('ai-model');
    function fillAISettings() {
      AI.cfg();
      if (keyEl) keyEl.value = AI.key || '';
      if (modelEl) modelEl.value = AI.model || 'deepseek-chat';
    }
    $('btn-ai-save').addEventListener('click', function () {
      AI.save({ key: (keyEl.value || '').trim(), model: modelEl.value });
      fillAISettings();
      UI.toast('已保存');
    });
    $('btn-ai-test').addEventListener('click', async function () {
      AI.save({ key: (keyEl.value || '').trim(), model: modelEl.value });
      fillAISettings();
      UI.toast('正在测试…', 3000);
      var r = await AI.chat([
        { role: 'system', content: '回复"连接正常"四个字。' },
        { role: 'user', content: '在吗' }
      ], { temperature: 0 });
      UI.toast(r.ok ? '连接正常：' + r.text.slice(0, 20) : '失败：' + r.error, 4000);
    });

    // 切到设置页时把已存的 Key 填上
    var origSwitch = window.__aiFillSettings;
    window.__aiFillSettings = fillAISettings;
  }

  /* ================= 日记 ================= */
  function dayKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function renderDiary() {
    var list = $('diary-list');
    if (!list) return;
    clear(list);

    var all = Store.state.notes.filter(function (n) { return n.kind === 'diary'; });
    all.sort(function (a, b) { return b.createdAt - a.createdAt; });

    // 顶部日期条：最近 14 天
    var strip = $('diary-strip');
    clear(strip);
    var wd = ['日', '一', '二', '三', '四', '五', '六'];
    var have = Object.create(null);
    all.forEach(function (n) { have[dayKey(n.createdAt)] = (have[dayKey(n.createdAt)] || 0) + 1; });
    for (var i = 13; i >= 0; i--) {
      var d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      var key = dayKey(d.getTime());
      var b = document.createElement('button');
      b.className = 'diary-day' + (have[key] ? ' has' : '');
      b.innerHTML = '<b>' + d.getDate() + '</b><span>' + (i === 0 ? '今天' : i === 1 ? '昨天' : '周' + wd[d.getDay()]) + '</span>';
      b.dataset.day = key;
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(strip.querySelectorAll('.diary-day'), function (x) {
          x.classList.remove('active');
        });
        this.classList.add('active');
        var target = list.querySelector('[data-day="' + this.dataset.day + '"]');
        if (target) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        else UI.toast('这天还没有日记');
      });
      strip.appendChild(b);
    }

    if (!all.length) {
      var e = document.createElement('div');
      e.className = 'empty-state';
      e.innerHTML = '<svg class="ico"><use href="#i-calendar"/></svg>' +
        '<div class="t">还没有日记</div><div class="s">点右上角「写日记」，或者把任意笔记设成日记<br>一天可以写很多条，按时间排在一起</div>';
      list.appendChild(e);
      return;
    }

    var groups = [], cur = null;
    all.forEach(function (n) {
      var k = dayKey(n.createdAt);
      if (!cur || cur.key !== k) { cur = { key: k, ts: n.createdAt, items: [] }; groups.push(cur); }
      cur.items.push(n);
    });

    groups.forEach(function (g) {
      var row = document.createElement('div');
      row.className = 'diary-row';
      row.dataset.day = g.key;
      var d = new Date(g.ts);
      var rail = document.createElement('div');
      rail.className = 'diary-rail';
      rail.innerHTML = '<b>' + d.getDate() + '</b>' + (d.getMonth() + 1) + '月 周' + wd[d.getDay()];
      var node = document.createElement('div');
      node.className = 'diary-node';

      g.items.forEach(function (n) {
        var card = document.createElement('div');
        card.className = 'diary-card';
        var tb = (n.blocks || []).filter(function (b) { return b.type === 'text' && (b.text || '').trim(); })[0];
        var imgs = (n.blocks || []).filter(function (b) { return b.type === 'image' && b.imageId; });

        var dt = document.createElement('div');
        dt.className = 'dt';
        dt.textContent = fmtDate(n.createdAt).split(' ').pop();
        card.appendChild(dt);

        var body = document.createElement('div');
        body.className = 'db';
        body.innerHTML = tb ? RUIBU.inline(tb.text) : '<span style="color:#9ca3af">（只有图片）</span>';
        card.appendChild(body);

        if (imgs.length) {
          var dz = document.createElement('div');
          dz.className = 'dz';
          imgs.slice(0, 6).forEach(function (b) {
            var im = document.createElement('img');
            im.src = Store.getImage(b.imageId);
            im.loading = 'lazy';
            im.draggable = false;
            dz.appendChild(im);
          });
          card.appendChild(dz);
        }

        card.addEventListener('click', function () { openNote(n.id); });
        attachCardMenu(card, n);
        node.appendChild(card);
      });

      row.appendChild(rail);
      row.appendChild(node);
      list.appendChild(row);
    });
  }

  function openDiaryCompose() {
    openCompose(null, 'diary');
  }

  /* ================= 画布列表 ================= */
  function renderBoards() {
    var list = $('board-list');
    clear(list);
    var boards = Store.state.boards;

    if (!boards.length) {
      var e = document.createElement('div');
      e.className = 'empty-state';
      e.innerHTML = '<svg class="ico"><use href="#i-graph"/></svg>' +
        '<div class="t">还没有画布</div><div class="s">点右上角「新建画布」开始</div>';
      list.appendChild(e);
      return;
    }

    boards.forEach(function (b) {
      var card = document.createElement('div');
      card.className = 'board-card';
      var icon = document.createElement('div');
      icon.className = 'board-icon';
      icon.innerHTML = '<svg class="ico"><use href="#i-graph"/></svg>';
      var info = document.createElement('div');
      info.className = 'board-info';
      var name = document.createElement('div');
      name.className = 'board-name';
      name.textContent = b.title;
      var sub = document.createElement('div');
      sub.className = 'board-sub';
      sub.textContent = (b.nodes || []).length + ' 个卡片 · ' + (b.edges || []).length + ' 条连线 · ' + fmtDate(b.updatedAt || b.createdAt);
      info.appendChild(name); info.appendChild(sub);
      card.appendChild(icon); card.appendChild(info);

      card.addEventListener('click', function () {
        openCanvas({ mode: 'board', boardId: b.id });
      });
      card.addEventListener('contextmenu', function (ev) {
        ev.preventDefault(); boardMenu(b.id);
      });
      list.appendChild(card);
    });
  }

  function boardMenu(boardId) {
    var b = Store.getBoard(boardId);
    if (!b) return;
    UI.modal({
      title: b.title,
      bodyHTML: '<div>重命名、导出或删除这张画布。</div>',
      actions: [
        {
          label: '重命名', onClick: function () {
            UI.prompt('画布名称', b.title).then(function (v) {
              if (v) { b.title = v; Store.save(); renderBoards(); }
            });
            return false;
          }
        },
        { label: '导出 .canvas', onClick: function () { Store.exportCanvas(b); return true; } },
        {
          label: '删除', cls: 'danger', onClick: function () {
            UI.confirm('删除画布？', '「' + b.title + '」将被删除，笔记本身不受影响。', '删除').then(function (ok) {
              if (ok) { Store.deleteBoard(b.id); renderBoards(); UI.toast('已删除'); }
            });
            return false;
          }
        },
        { label: '关闭', value: null }
      ]
    });
  }

  /* ================= 新建笔记（全屏编辑，不再是弹窗） ================= */
  function openCompose(prefillTag, kind) {
    var text = prefillTag ? '#' + prefillTag + ' ' : '';
    var note = Store.createNote({ text: text, kind: kind === 'diary' ? 'diary' : 'note' });
    Store.saveNow();
    App.composeDraft = note.id;
    openNote(note.id);
    // 直接进入第一个文字块的编辑态，键盘弹出来就能打
    setTimeout(function () {
      var cur = Store.getNote(note.id);
      if (!cur) return;
      var el = $('note-blocks').querySelector('.blk-text');
      if (el) startEditBlock(el, cur, cur.blocks[0]);
    }, 160);
  }

  /** 草稿笔记：什么都没写就关掉 → 删掉，不留空笔记 */
  function dropEmptyDraft() {
    if (!App.composeDraft) return;
    var id = App.composeDraft;
    App.composeDraft = null;
    var n = Store.getNote(id);
    if (!n) return;
    var empty = !(n.blocks || []).some(function (b) {
      if (b.type === 'image') return true;
      return (b.items || []).some(function (it) {
        return it.t === 'img' || it.t === 'tag' || (it.t === 'text' && (it.v || '').trim());
      });
    });
    if (empty) {
      Store.deleteNote(id);
      Store.saveNow();
    }
  }

  /* ================= 图片处理（多选 / 拖拽） ================= */
  function imgSize(src) {
    return new Promise(function (resolve) {
      var im = new Image();
      im.onload = function () { resolve({ w: im.naturalWidth, h: im.naturalHeight }); };
      im.onerror = function () { resolve({ w: 4, h: 3 }); };
      im.src = src;
    });
  }

  async function processImageFiles(files, target) {
    if (!files || !files.length) return [];
    UI.toast('处理图片中…', 5000);
    var added = [];
    for (var i = 0; i < files.length; i++) {
      try {
        var id = await Store.addImage(files[i]);
        var dataUrl = Store.getImage(id);
        added.push({ id: id, dataUrl: dataUrl });

        if (target === 'canvas' && App.board) {
          var s1 = await imgSize(dataUrl);
          App.board.addImageNode(id, s1.w, s1.h);
        } else if (target === 'inline' && App.inlineBoard) {
          var s2 = await imgSize(dataUrl);
          App.inlineBoard.addImageNode(id, s2.w, s2.h);
        }
      } catch (err) { console.error(err); }
    }
    return added;
  }

  /* 相册 / 拍照 两个入口共用这套处理 */
  async function onFilesPicked(files) {
    if (!files || !files.length) return;
    var target = App.imgTarget;
    if (target === 'inline') target = 'note';

    var added = await processImageFiles(files, target);
    var ids = added.map(function (x) { return x.id; });

    if (target === 'ai') {
      App.aiImgs = (App.aiImgs || []).concat(ids);
      renderAiAttach();
      App.imgTarget = null;
      if (ids.length) UI.toast('已添加 ' + ids.length + ' 张，发送时会一起给 AI');
      return;
    }
    if (target === 'compose' && App.onComposeImages) {
      App.onComposeImages(added);
    } else if (App.noteId && (target === 'note' || !target)) {
      await appendImagesToNote(App.noteId, ids);
      if (ids.length && App.inlineBoard) fitInlineSoon();
    } else if (App.pendingNoteId) {
      await appendImagesToNote(App.pendingNoteId, ids);
      App.pendingNoteId = null;
    }
    App.imgTarget = null;
    App.insertAfterBlock = null;
    if (ids.length) UI.toast('已添加 ' + added.length + ' 张');
  }

  function bindFileInputs() {
    ['file-image', 'file-camera'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('change', async function (e) {
        var files = Array.prototype.slice.call(e.target.files || []);
        e.target.value = '';
        if (!files.length) return;
        await onFilesPicked(files);
      });
    });
  }

  /* 桌面端：把图片直接拖进窗口 */
  // 应用内图片一律禁止浏览器原生拖拽：原生拖拽会把图片当成文件再丢回来，从而复制出一份
  document.addEventListener('dragstart', function (e) {
    if (e.target && e.target.tagName === 'IMG') { e.preventDefault(); return false; }
  }, true);

  document.addEventListener('dragover', function (e) {
    if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') === -1) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  document.addEventListener('drop', async function (e) {
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault();
    var files = Array.prototype.slice.call(e.dataTransfer.files).filter(function (f) {
      return /^image\//.test(f.type);
    });
    if (!files.length) { UI.toast('只支持图片文件'); return; }

    if (!$('sheet-canvas').classList.contains('hidden')) {
      var a1 = await processImageFiles(files, 'canvas');
      UI.toast('已添加 ' + a1.length + ' 张到画布');
    } else if (!$('sheet-note').classList.contains('hidden') && App.noteId) {
      var a2 = await processImageFiles(files, 'note');
      await appendImagesToNote(App.noteId, a2.map(function (x) { return x.id; }));
      openNote(App.noteId);
      if (a2.length) fitInlineSoon();
      UI.toast('已添加 ' + a2.length + ' 张');
    } else {
      var a3 = await processImageFiles(files, null);
      Store.createNote({ text: '', imageIds: a3.map(function (x) { return x.id; }) });
      renderAll();
      UI.toast('已新建一条笔记，含 ' + a3.length + ' 张图');
    }
  });

  /* ================= 事件绑定 ================= */
  function bind() {
    // 侧栏导航
    Array.prototype.forEach.call(document.querySelectorAll('.nav-item'), function (b) {
      b.addEventListener('click', function () {
        if (layerStack.length) closeAllLayers();   // 笔记/画布开着时先退出来
        if (b.dataset.nav === 'notes' && App.tag) {
          App.tag = null;
          renderAll();
        }
        switchTab(b.dataset.nav);
      });
    });
    bindImageDrag();

    // 顶栏图标导航（手机上代替抽屉里的菜单）
    Array.prototype.forEach.call(document.querySelectorAll('[data-nav-icon]'), function (b) {
      b.addEventListener('click', function () {
        if (layerStack.length) closeAllLayers();
        switchTab(b.dataset.navIcon);
      });
    });

    // AI 问答
    bindAI();

    // 日记：写一条
    $('btn-new-diary').addEventListener('click', openDiaryCompose);

    // 右键/长按菜单：点空白关掉
    $('ctx-mask').addEventListener('click', hideCtxMenu);
    $('ctx-mask').addEventListener('contextmenu', function (e) { e.preventDefault(); hideCtxMenu(); });
    window.addEventListener('scroll', hideCtxMenu, true);
    window.addEventListener('resize', hideCtxMenu);
    $('btn-menu').addEventListener('click', openSidebar);    $('side-close').addEventListener('click', closeSidebar);
    $('side-overlay').addEventListener('click', closeSidebar);

    // 搜索
    var main = $('main');
    $('btn-search-m').addEventListener('click', function () {
      main.classList.add('searching');
      $('search-input').focus();
    });
    $('search-input').addEventListener('input', function () {
      App.keyword = this.value.trim();
      renderNotes(); updateTitle();
    });
    $('search-input').addEventListener('blur', function () {
      if (!this.value.trim()) {
        main.classList.remove('searching');
        App.keyword = ''; renderNotes(); updateTitle();
      }
    });

    // 新建笔记入口
    $('composer-open').addEventListener('click', function () { openCompose(App.tag); });
    $('composer-send').addEventListener('click', function () { openCompose(App.tag); });
    $('composer-img').addEventListener('click', function () { openCompose(App.tag); });
    $('composer-tag').addEventListener('click', function () { openCompose(App.tag); });
    $('mc-plus').addEventListener('click', function () { openCompose(App.tag); });
    $('mobile-composer').addEventListener('click', function (e) {
      if (e.target.closest('#mc-plus')) return;
      openCompose(App.tag);
    });

    // 笔记详情
    $('note-back').addEventListener('click', function () { goBack(); });
    bindEditorBar();
    bindFileInputs();

    $('note-menu-btn').addEventListener('click', function () {
      var note = Store.getNote(App.noteId);
      if (!note) return;
      var r = this.getBoundingClientRect();
      openCtxMenu(r.right - 190, r.bottom + 6, noteMoreMenu(note));
    });

    async function enterNoteCanvas() {
      var note = Store.getNote(App.noteId);
      if (!note) return;
      if (!note.canvas) {
        UI.toast('正在生成画布…', 1200);
        Store.updateNote(note.id, { canvas: await buildNoteCanvas(note) });
        await Store.saveNow();
      }
      destroyInline();
      $('sheet-note').classList.add('hidden');
      openCanvas({ mode: 'note', noteId: note.id });
    }

    /** 创建画布后直接显示在笔记下方，不跳走 */
    async function createCanvasInline() {
      var note = Store.getNote(App.noteId);
      if (!note) return;
      if (!note.canvas) {
        UI.toast('正在生成画布…', 1500);
        Store.updateNote(note.id, { canvas: await buildNoteCanvas(note) });
        await Store.saveNow();
      }
      openNote(note.id);
      setTimeout(function () {
        var el = $('note-canvas-inline');
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 280);
    }

    $('note-canvas-btn').addEventListener('click', enterNoteCanvas);
    $('note-create-canvas').addEventListener('click', createCanvasInline);

    // 内嵌画布：头部工具
    $('note-canvas-inline').addEventListener('click', function (e) {
      var btn = e.target.closest('.ic-btn');
      if (!btn) return;
      var act = btn.dataset.ic;
      if (act === 'full') { enterNoteCanvas(); return; }
      if (!App.inlineBoard) return;
      if (act === 'text') {
        var n = App.inlineBoard.addTextNode('');
        setTimeout(function () { App.inlineBoard.startEdit(n.id); }, 60);
      } else if (act === 'image') {
        App.imgTarget = 'inline';
        $('file-image').click();
      } else if (act === 'fit') {
        App.inlineBoard.fitView();
      }
    });

    // 内嵌画布：选中节点后的操作
    $('ic-toolbar').addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn || !App.inlineBoard) return;
      var id = App.inlineBoard.selectedId;
      if (!id) return;
      if (btn.dataset.icact === 'view') {
        var vn = App.inlineBoard.getNode(id);
        if (vn && vn.type === 'image') viewImage(Store.getImage(vn.imageId));
      }
      else if (btn.dataset.icact === 'edit') App.inlineBoard.startEdit(id);
      else if (btn.dataset.icact === 'del') App.inlineBoard.removeNode(id);
    });

    // 画布
    $('canvas-back').addEventListener('click', function () {
      if (App.board && App.board.linkingFrom) { App.board.cancelLink(); return; }
      goBack();
    });

    $('canvas-fit').addEventListener('click', function () {
      if (App.board) App.board.fitView();
    });

    $('canvas-menu').addEventListener('click', function () {
      if (!App.ctx) return;
      var isBoard = App.ctx.mode === 'board';
      var b = isBoard ? Store.getBoard(App.ctx.boardId) : null;
      var actions = [];
      if (isBoard) {
        actions.push({
          label: '重命名', onClick: function () {
            UI.prompt('画布名称', b.title).then(function (v) {
              if (v) { b.title = v; $('canvas-title').textContent = v; Store.save(); }
            });
            return false;
          }
        });
      }
      actions.push({
        label: '导出 .canvas', onClick: function () {
          var data = App.board.getData();
          Store.exportCanvas({ title: isBoard ? b.title : '笔记画布', nodes: data.nodes, edges: data.edges });
          return true;
        }
      });
      actions.push({
        label: '清空画布', cls: 'danger', onClick: function () {
          UI.confirm('清空画布？', '画布上的卡片和连线都会被移除（笔记本身不受影响）。', '清空').then(function (ok) {
            if (!ok) return;
            App.board.nodes = [];
            App.board.edges = [];
            App.board.selectedId = null;
            App.board.render();
            saveCanvas(App.board.getData());
            UI.toast('已清空');
          });
          return false;
        }
      });
      actions.push({ label: '关闭', value: null });
      UI.modal({
        title: '画布操作',
        bodyHTML: '<div>当前 ' + App.board.nodes.length + ' 个卡片 · ' + App.board.edges.length + ' 条连线</div>',
        actions: actions
      });
    });

    $('node-toolbar').addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn || !App.board) return;
      var id = App.board.selectedId;
      if (!id) return;
      var act = btn.dataset.act;
      if (act === 'view') {
        var vn = App.board.getNode(id);
        if (vn && vn.type === 'image') viewImage(Store.getImage(vn.imageId));
      }
      else if (act === 'link') { App.board.beginLink(id); UI.toast('再点另一个卡片完成连线'); }
      else if (act === 'edit') App.board.startEdit(id);
      else if (act === 'dup') App.board.duplicateNode(id);
      else if (act === 'del') App.board.removeNode(id);
    });

    $('canvas-dock').addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn || !App.board) return;
      var act = btn.dataset.act;

      if (act === 'add-text') {
        var n = App.board.addTextNode('');
        setTimeout(function () { App.board.startEdit(n.id); }, 60);
      } else if (act === 'add-image') {
        App.imgTarget = 'canvas';
        $('file-image').click();
      } else if (act === 'add-note') {
        var notes = Store.queryNotes({});
        if (!notes.length) { UI.toast('先去写几条笔记'); return; }
        UI.pick(notes, '把笔记放进画布').then(function (it) {
          if (it && App.board) { App.board.addNoteNode(it.id); UI.toast('已加入画布'); }
        });
      } else if (act === 'center') {
        App.board.fitView();
      }
    });

    // 新建画布
    $('btn-new-board').addEventListener('click', function () {
      UI.prompt('新画布名称', '思维导图 ' + (Store.state.boards.length + 1)).then(function (v) {
        if (v === null) return;
        var b = Store.createBoard(v || '未命名画布');
        renderBoards();
        openCanvas({ mode: 'board', boardId: b.id });
      });
    });

    // 设置
    $('btn-export-json').addEventListener('click', function () {
      Store.exportJSON(); UI.toast('已导出备份');
    });
    $('btn-import-json').addEventListener('click', function () { $('file-json').click(); });
    $('file-json').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      var fr = new FileReader();
      fr.onload = async function () {
        try {
          await Store.importJSON(JSON.parse(fr.result));
          renderAll(); UI.toast('导入成功');
        } catch (err) {
          UI.modal({ title: '导入失败', bodyHTML: '<div>' + err.message + '</div>', actions: [{ label: '好', value: null }] });
        }
      };
      fr.readAsText(f);
    });

    $('btn-export-canvas').addEventListener('click', function () {
      if (!Store.state.boards.length) { UI.toast('还没有画布'); return; }
      var b = Store.state.boards[0];
      Store.exportCanvas(b);
      UI.toast('已导出「' + b.title + '」');
    });

    $('btn-import-flomo').addEventListener('click', function () { $('file-html').click(); });
    $('file-html').addEventListener('change', async function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      UI.toast('解析中…', 3000);
      try {
        var n = await Store.parseFlomoFile(f);
        renderAll();
        UI.modal({ title: '导入完成', bodyHTML: '<div>新增 ' + n + ' 条笔记。</div>', actions: [{ label: '好', value: null }] });
      } catch (err) {
        UI.modal({ title: '导入失败', bodyHTML: '<div>' + err.message + '</div>', actions: [{ label: '好', value: null }] });
      }
    });

    // 版本信息 + 强制更新
    var verEl = $('ver-info');
    if (verEl) {
      verEl.innerHTML = '当前构建：<code>' + BUILD + '</code>';
    }
    $('btn-hard-reload').addEventListener('click', async function () {
      UI.toast('正在清除缓存…', 3000);
      try {
        if ('serviceWorker' in navigator) {
          var regs = await navigator.serviceWorker.getRegistrations();
          for (var i = 0; i < regs.length; i++) await regs[i].unregister();
        }
        if (window.caches) {
          var keys = await caches.keys();
          for (var j = 0; j < keys.length; j++) await caches.delete(keys[j]);
        }
      } catch (e) { /* ignore */ }
      location.reload();
    });

    $('btn-clear-all').addEventListener('click', function () {
      UI.confirm('清空全部数据？', '所有笔记、图片和画布都会被删除，且无法恢复。建议先导出备份。', '我确定清空').then(function (ok) {
        if (!ok) return;
        Store.clearAll().then(function () { renderAll(); UI.toast('已清空'); });
      });
    });

    // 键盘：桌面 Esc 返回
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('sheet-canvas').classList.contains('hidden')) {
        if (App.board && App.board.linkingFrom) App.board.cancelLink();
        else $('canvas-back').click();
      } else if (!$('sheet-note').classList.contains('hidden')) {
        closeNote();
      } else if (!$('modal-mask').classList.contains('hidden')) {
        UI.close();
      }
    });

    // 桌面快捷键：Cmd/Ctrl+K 搜索
    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        main.classList.add('searching');
        $('search-input').focus();
      }
    });

    window.addEventListener('resize', function () {
      if (window.innerWidth > 820) closeSidebar();
    });

    window.addEventListener('popstate', function () {
      // 多级返回：图片 → 画布 → 笔记，一层一层退
      popLayer();
    });
  }

  /* ================= 初始化 ================= */
  function renderAll() {
    renderSidebar();
    if (App.tab === 'diary') renderDiary();
    renderTags();
    renderNotes();
    renderBoards();
    updateTitle();
    updateStorageInfo();
    Todos.refresh();
  }

  function updateStorageInfo() {
    DB.estimate().then(function (est) {
      if (!est) return;
      var used = (est.usage / 1024 / 1024).toFixed(1);
      $('storage-info').textContent =
        '已用存储：' + used + ' MB · 笔记 ' + Store.state.notes.length + ' 条 · 画布 ' + Store.state.boards.length + ' 张';
      $('side-foot').textContent = '本机存储 · ' + used + ' MB · 离线可用';
    });
  }

  async function boot() {
    try {
      await Store.init();
      // 第一次打开（本地还没有笔记）时，把随包的种子数据导进来
      if (!Store.state.notes.length) {
        try {
          var r = await fetch('sync-data.json', { cache: 'no-store' });
          if (r.ok) {
            var seed = await r.json();
            if (seed && seed.state && (seed.state.notes || []).length) {
              await Store.mergeSnapshot(seed);
              await Store.saveNow();
            }
          }
        } catch (e) { /* 没有种子文件也没关系 */ }
      }
    } catch (e) {
      if (window.__showBootError) window.__showBootError('存储初始化失败：' + e.message);
      return;
    }
    try {
      bind();
      if (window.AI && AI.loadHistory) { AI.loadHistory(); App.aiImgs = []; }
      renderAll();
      switchTab('notes');
      Todos.init(function () {
        if (layerStack.length) closeAllLayers();
        switchTab('todos');
      });
      try { history.pushState({}, ''); } catch (e) { }
    } catch (e) {
      if (window.__showBootError) window.__showBootError('渲染失败：' + e.message + '\n' + (e.stack || ''));
      throw e;
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) Store.saveNow();
    });

  }

  /* 同步拉到新数据后刷新界面 */
  App.refreshAfterSync = function () {
    if (App.board || App.inlineBoard) {
      // 正在画布/详情里操作时不打断，只更新列表
      renderAll();
      return;
    }
    renderAll();
    if (App.noteId) openNote(App.noteId);
  };

  boot();
})();
