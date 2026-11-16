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
  var BUILD = '1.0.0';
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
    ['notes', 'diary', 'ai', 'boards', 'settings'].forEach(function (t) {
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
    if (tab === 'ai') { renderAI(); updateAISend(); }
    if (window.__aiFillSettings && (tab === 'settings')) window.__aiFillSettings();
    closeSidebar();
  }

  function updateTitle() {
    var t = '全部笔记';
    if (App.tab === 'diary') t = '日记';
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

  function openCtxMenu(x, y, items) {
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
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        hideCtxMenu();
        it.onClick();
      });
      menu.appendChild(b);
    });

    mask.classList.remove('hidden');
    // 先显示再量尺寸，避免超出屏幕
    menu.style.left = '0px';
    menu.style.top = '0px';
    var r = menu.getBoundingClientRect();
    var vw = window.innerWidth, vh = window.innerHeight;
    var left = Math.min(x, vw - r.width - 12);
    var top = Math.min(y, vh - r.height - 12);
    menu.style.left = Math.max(10, left) + 'px';
    menu.style.top = Math.max(10, top) + 'px';
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
      if (App.suppressBlockClick) return;             // 刚拖完图，别顺手进编辑态
      if (e.target.closest('.inline-img') || e.target.closest('.inline-img-el')) return;
      startEditBlock(el, note, b);
    });
    return el;
  }

  function paintRich(el, b) {
    el.contentEditable = 'false';
    el.classList.remove('editing');
    el.innerHTML = RUIBU.rich(b.items || []);
    bindInlineImages(el, b);
  }

  /* ---------- 图片拖动：长按 → 虚影跟随 → 绿线指示落点 ---------- */
  var dragState = null;

  function bindInlineImages(root, b) {
    var nodes = [];
    if (root.matches && root.matches('.inline-img, .blk-image, .img-cell, .inline-img-el')) nodes.push(root);
    Array.prototype.forEach.call(root.querySelectorAll('.inline-img, .blk-image, .img-cell, .inline-img-el'), function (n) {
      nodes.push(n);
    });
    nodes.forEach(function (wrap) {
      if (wrap.__bound) return;
      wrap.__bound = true;
      var img = wrap.tagName === 'IMG' ? wrap : wrap.querySelector('img');
      if (!img) return;

      img.addEventListener('pointerdown', function (e) {
        if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
        e.preventDefault();
        startImageDrag(e, wrap, img, b);
      });
      img.addEventListener('click', function (e) { e.stopPropagation(); });
    });
  }

  function startImageDrag(e, wrap, img, b) {
    if (dragState) return;
    var rect = wrap.getBoundingClientRect();
    var st = {
      pointerId: e.pointerId,
      sx: e.clientX, sy: e.clientY,
      wrap: wrap, img: img, block: b,
      iid: img.dataset.iid || (b && b.imageId),
      src: img.src,
      w: Math.round(rect.width),          // 记住拖走前的显示宽度
      active: false,
      timer: null
    };
    dragState = st;

    if (e.pointerType === 'touch') {
      st.timer = setTimeout(function () { beginDrag(st); }, 240);
    }

    function onMove(ev) {
      if (ev.pointerId !== st.pointerId) return;
      if (!st.active) {
        if (st.timer) {
          if (Math.abs(ev.clientX - st.sx) > 10 || Math.abs(ev.clientY - st.sy) > 10) {
            clearTimeout(st.timer); st.timer = null;
          }
          return;
        }
        if (Math.abs(ev.clientX - st.sx) < 7 && Math.abs(ev.clientY - st.sy) < 7) return;
        beginDrag(st);
      }
      moveGhost(st, ev.clientX, ev.clientY);
      showDropIndicator(ev.clientX, ev.clientY, st);
    }

    function onUp(ev) {
      if (ev.pointerId !== st.pointerId) return;
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
      if (st.timer) clearTimeout(st.timer);
      var tgt = DragTarget;          // 先记住落点，收线会把它清掉
      var wasActive = st.active;
      var point = { x: ev.clientX, y: ev.clientY };
      hideDropIndicator();
      endDrag(st);
      if (wasActive) {
        App.suppressBlockClick = true;
        setTimeout(function () { App.suppressBlockClick = false; }, 400);
        completeDrop(st, point.x, point.y, tgt);
      } else if (st.src) {
        viewImage(st.src);
      }
      dragState = null;
    }

    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
  }

  function beginDrag(st) {
    if (st.active) return;
    st.active = true;
    st.timer = null;
    st.img.classList.add('img-dragging');
    st.img.style.pointerEvents = 'none';
    document.body.classList.add('img-drag-mode');
    makeGhost(st);
  }

  function makeGhost(st) {
    var g = document.getElementById('drag-ghost');
    if (!g) {
      g = document.createElement('div');
      g.id = 'drag-ghost';
      document.body.appendChild(g);
    }
    g.innerHTML = '';
    var im = new Image();
    im.src = st.src;
    g.appendChild(im);
    var size = Math.max(64, Math.min(120, st.w || 90));
    g.style.width = size + 'px';
    g.style.height = size + 'px';
    g.style.display = 'block';
  }

  function moveGhost(st, x, y) {
    var g = document.getElementById('drag-ghost');
    if (!g) return;
    var w = g.offsetWidth || 90;
    g.style.left = (x - w / 2) + 'px';
    g.style.top = (y - w / 2) + 'px';
  }

  function endDrag(st) {
    if (st.img) {
      st.img.classList.remove('img-dragging');
      st.img.style.pointerEvents = '';
    }
    document.body.classList.remove('img-drag-mode');
    var g = document.getElementById('drag-ghost');
    if (g) g.style.display = 'none';
  }

  /* ---------- 落点指示：文字里是竖线，图片之间是竖线，块之间是横线 ---------- */
  function indEl() {
    var line = document.getElementById('drop-caret');
    if (!line) {
      line = document.createElement('div');
      line.id = 'drop-caret';
      document.body.appendChild(line);
    }
    return line;
  }

  function showDropIndicator(x, y, st) {
    var line = indEl();
    var under = document.elementFromPoint(x, y);
    var grid = under && under.closest ? under.closest('.img-grid') : null;

    // 1) 落在图片网格里
    if (grid) {
      var cells = Array.prototype.slice.call(grid.querySelectorAll('.img-cell'));
      clearSwapHint();
      if (!cells.length) {
        line.className = 'drop-caret';
        line.style.width = '3px';
        line.style.left = grid.getBoundingClientRect().left + 'px';
        line.style.top = grid.getBoundingClientRect().top + 'px';
        line.style.height = grid.getBoundingClientRect().height + 'px';
        line.style.display = 'block';
        DragTarget = { kind: 'grid', grid: grid, index: 0 };
        return;
      }
      // 先看落在哪个格子里
      var hitIdx = -1;
      for (var ci = 0; ci < cells.length; ci++) {
        var r0 = cells[ci].getBoundingClientRect();
        if (x >= r0.left && x <= r0.right && y >= r0.top && y <= r0.bottom) { hitIdx = ci; break; }
      }
      // 落在格子中间 50% 区域 → 交换；靠近左右边缘 → 插到那个缝隙
      if (hitIdx >= 0) {
        var rr = cells[hitIdx].getBoundingClientRect();
        var rel = (x - rr.left) / rr.width;
        if (rel > 0.28 && rel < 0.72) {
          cells[hitIdx].classList.add('swapping');
          DragTarget = { kind: 'swap', grid: grid, cell: cells[hitIdx], index: hitIdx, block: st ? st.block : null };
          line.style.display = 'none';
          return;
        }
      }
      // 插入位置：按列边界算
      var idx = cells.length, baseCell = cells[cells.length - 1], after = true;
      for (var k2 = 0; k2 < cells.length; k2++) {
        var rk = cells[k2].getBoundingClientRect();
        if (x < rk.left + rk.width / 2) { idx = k2; baseCell = cells[k2]; after = false; break; }
      }
      var rb = baseCell.getBoundingClientRect();
      line.className = 'drop-caret';
      line.style.width = '3px';
      line.style.left = (after ? rb.right + 1 : rb.left - 3) + 'px';
      line.style.top = rb.top + 'px';
      line.style.height = rb.height + 'px';       // 只画这一行，不画整列
      line.style.display = 'block';
      DragTarget = { kind: 'grid', grid: grid, index: idx, block: st ? st.block : null };
      return;
    }

    // 2) 落在文字里 → 字符之间画竖线
    var textEl = under && under.closest ? under.closest('.blk-text') : null;
    if (textEl) {
      var range = rangeFromPoint(x, y);
      var rect = null;
      if (range) {
        try { rect = range.getBoundingClientRect(); } catch (e) { rect = null; }
        if (rect && (rect.height === 0 || (rect.width === 0 && rect.height === 0))) rect = null;
      }
      if (rect) {
        line.className = 'drop-caret';
        line.style.width = '3px';
        line.style.left = (rect.left - 1) + 'px';
        line.style.top = rect.top + 'px';
        line.style.height = Math.max(20, Math.min(34, rect.height || 22)) + 'px';
        line.style.display = 'block';
        DragTarget = { kind: 'text', el: textEl, blockId: textEl.dataset.bid, range: range, x: x, y: y };
        return;
      }
      // 文字块边缘（拿不到 caret）→ 当作插到这一块后面
      var tr2 = textEl.getBoundingClientRect();
      line.className = 'drop-caret horizontal';
      line.style.left = tr2.left + 'px';
      line.style.width = tr2.width + 'px';
      line.style.top = (tr2.bottom + 2) + 'px';
      line.style.height = '3px';
      line.style.display = 'block';
      DragTarget = { kind: 'after-block', blockId: textEl.dataset.bid };
      return;
    }

    // 3) 块与块之间 → 横线
    var blocks = document.querySelectorAll('#note-blocks .blk');
    var top3 = 0, left3 = 0, width3 = 0, found = false;
    for (var k = 0; k < blocks.length; k++) {
      var br = blocks[k].getBoundingClientRect();
      if (y < br.top + br.height / 2) {
        top3 = br.top - 4; left3 = br.left; width3 = br.width; found = true;
        DragTarget = { kind: 'block-index', index: k };
        break;
      }
    }
    if (!found && blocks.length) {
      var last = blocks[blocks.length - 1].getBoundingClientRect();
      top3 = last.bottom + 4; left3 = last.left; width3 = last.width;
      DragTarget = { kind: 'block-index', index: blocks.length };
    }
    line.className = 'drop-caret horizontal';
    line.style.left = left3 + 'px';
    line.style.top = top3 + 'px';
    line.style.width = width3 + 'px';
    line.style.height = '3px';
    line.style.display = 'block';
  }

  var DragTarget = null;

  function clearSwapHint() {
    Array.prototype.forEach.call(document.querySelectorAll('.img-cell.swapping'), function (el) {
      el.classList.remove('swapping');
    });
  }

  function hideDropIndicator() {
    clearSwapHint();
    var line = document.getElementById('drop-caret');
    if (line) line.style.display = 'none';
    DragTarget = null;
  }

  function rangeFromPoint(x, y) {
    if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
    if (document.caretPositionFromPoint) {
      var p = document.caretPositionFromPoint(x, y);
      if (p) {
        var r = document.createRange();
        r.setStart(p.offsetNode, p.offset);
        r.collapse(true);
        return r;
      }
    }
    return null;
  }

  /** 从原位置摘掉图片（整块 / 网格里的整块 / 行内） */
  function detachImage(note, st) {
    var src = st.block;
    var iid = st.iid;
    if (!src) return;
    if (src.type === 'image') {
      note.blocks = note.blocks.filter(function (b) { return b.id !== src.id; });
      return;
    }
    var idx = -1;
    (src.items || []).forEach(function (it, i) {
      if (idx < 0 && it.t === 'img' && it.imageId === iid) idx = i;
    });
    if (idx >= 0) {
      src.items.splice(idx, 1);
      if (!src.items.length) src.items = [{ t: 'text', v: '' }];
    }
  }

  /** 把 caret 换算成文字块里的纯字符偏移 */
  function caretOffset(el, range) {
    try {
      var r = document.createRange();
      r.setStart(el, 0);
      r.setEnd(range.startContainer, range.startOffset);
      return r.toString().length;
    } catch (e) {
      return 0;
    }
  }

  /** 在文字块的 items 里按字符偏移插入图片（先摘掉原来的位置），返回是否成功 */
  function placeInlineImage(note, b, iid, w, offset) {
    var items = (b.items || [{ t: 'text', v: '' }]).slice();
    // 1) 先摘掉同 id 的旧图（可能就在这个块里）
    var removedW = w;
    for (var i = items.length - 1; i >= 0; i--) {
      if (items[i].t === 'img' && items[i].imageId === iid) {
        removedW = items[i].w || w;
        items.splice(i, 1);
      }
    }
    // 2) 找到偏移所在的文字项并拆开
    var acc = 0, placed = false;
    for (var j = 0; j < items.length; j++) {
      var it = items[j];
      if (it.t !== 'text') continue;
      var len = (it.v || '').length;
      if (offset <= acc + len) {
        var local = offset - acc;
        var head = (it.v || '').slice(0, local);
        var tail = (it.v || '').slice(local);
        var repl = [];
        if (head) repl.push({ t: 'text', v: head });
        repl.push({ t: 'img', imageId: iid, w: removedW });
        if (tail) repl.push({ t: 'text', v: tail });
        items.splice.apply(items, [j, 1].concat(repl));
        placed = true;
        break;
      }
      acc += len;
    }
    if (!placed) items.push({ t: 'img', imageId: iid, w: removedW });
    // 3) 合并相邻文字项
    var merged = [];
    items.forEach(function (x) {
      var last = merged[merged.length - 1];
      if (x.t === 'text' && last && last.t === 'text') { last.v += x.v; return; }
      merged.push(x);
    });
    if (!merged.length) merged = [{ t: 'text', v: '' }];
    b.items = merged;
    return true;
  }

  function completeDrop(st, x, y, target) {
    var note = App.noteId ? Store.getNote(App.noteId) : null;
    if (!note) return;
    // 源块如果正在编辑，先把 DOM 内容写回数据，避免摘图时对不上
    if (st.block && st.block.type === 'text') {
      var srcEl = document.querySelector('#note-blocks .blk-text[data-bid="' + st.block.id + '"]');
      if (srcEl && srcEl.__finishEdit) {
        var fin = srcEl.__finishEdit;
        srcEl.__finishEdit = null;
        fin();
      }
    }
    var iid = st.iid;
    if (!iid) return;
    var keepW = Math.max(80, Math.min(240, st.w || 130));

    // 0) 拖到另一张图中间 → 交换两张图的位置
    if (target && target.kind === 'swap') {
      var bId = target.cell ? target.cell.dataset.bid : null;
      var srcId = st.block ? st.block.id : null;
      var ia = -1, ib = -1;
      if (srcId && bId) {
        for (var q = 0; q < note.blocks.length; q++) {
          if (note.blocks[q].id === srcId) ia = q;
          if (note.blocks[q].id === bId) ib = q;
        }
      }
      if (ia >= 0 && ib >= 0 && ia !== ib) {
        var tmp = note.blocks[ia];
        note.blocks[ia] = note.blocks[ib];
        note.blocks[ib] = tmp;
        Store.setBlocks(note.id, note.blocks);
        renderBlocks(note);
        renderAll();
        return;
      }
      // 源是文字里的行内图：退化成插入
      target = { kind: 'grid', grid: target.grid, index: target.index };
    }

    // 1) 插到图片网格的某个位置（按锚点块定位，避免 detach 后索引错位）
    if (target && target.kind === 'grid') {
      var cells = Array.prototype.slice.call(target.grid.querySelectorAll('.img-cell'));
      var anchorId = (target.index < cells.length) ? cells[target.index].dataset.bid : null;
      detachImage(note, st);
      var at2;
      if (anchorId) {
        at2 = note.blocks.findIndex(function (b) { return b.id === anchorId; });
        if (at2 < 0) at2 = note.blocks.length;
      } else {
        // 追加到这组图片的最后
        var lastImg = cells.length ? cells[cells.length - 1].dataset.bid : null;
        at2 = note.blocks.length;
        if (lastImg) {
          var li = note.blocks.findIndex(function (b) { return b.id === lastImg; });
          if (li >= 0) at2 = li + 1;
        }
      }
      note.blocks.splice(at2, 0, { id: Store.uid('b_'), type: 'image', imageId: iid });
      Store.setBlocks(note.id, note.blocks);
      renderBlocks(note);
      renderAll();
      return;
    }

    // 2) 插到文字里（按字符偏移插到 items 里，不依赖浏览器 range 的可靠性）
    if (target && target.kind === 'text') {
      var el = target.el;
      var b = (note.blocks || []).filter(function (x2) { return x2.id === target.blockId; })[0];
      if (!b) return;
      // 先把落点换算成纯字符偏移（在可编辑 DOM 上算，图片不占字符）
      if (!el.isContentEditable) startEditBlock(el, note, b);
      var range = rangeFromPoint(x, y);
      var offset = null;
      if (range && el.contains(range.startContainer)) offset = caretOffset(el, range);
      if (offset === null) {
        offset = (b.items || []).reduce(function (acc, it) {
          return acc + (it.t === 'text' ? (it.v || '').length : 0);
        }, 0);
      }
      // 同步结束编辑（把 DOM 里的文字写回 items），再走数据层插入
      if (el.__finishEdit) { var fin = el.__finishEdit; el.__finishEdit = null; fin(); }
      App.activeBlock = null;
      detachImage(note, st);
      placeInlineImage(note, b, iid, keepW, offset);
      Store.setBlocks(note.id, note.blocks);
      renderBlocks(note);
      renderAll();
      return;
    }

    // 3) 插到块之间
    var at = (target && target.kind === 'block-index') ? target.index : note.blocks.length;
    detachImage(note, st);
    note.blocks.splice(Math.min(at, note.blocks.length), 0, { id: Store.uid('b_'), type: 'image', imageId: iid });
    Store.setBlocks(note.id, note.blocks);
    renderBlocks(note);
    renderAll();
  }

  function insertImgAtRange(range, iid, w) {
    var img = document.createElement('img');
    img.className = 'inline-img-el';
    img.dataset.iid = iid;
    img.dataset.w = w;
    img.style.width = w + 'px';
    img.src = Store.getImage(iid);
    img.contentEditable = 'false';
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
    bindInlineImages(el, b);       // 编辑态里的图片同样可以拖
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
      if (e.target.closest && e.target.closest('#editor-bar')) return;
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
        return '<img class="inline-img-el" contenteditable="false" data-iid="' + RUIBU.esc(it.imageId) + '" data-w="' + w +
          '" style="width:' + w + 'px" src="' + Store.getImage(it.imageId) + '">';
      }
      return '';
    }).join('');
  }

  function serializeBlock(el) {
    var items = [], buf = '';
    function flush() {
      if (buf) { items.push({ t: 'text', v: buf }); buf = ''; }
    }
    (function walk(node) {
      for (var i = 0; i < node.childNodes.length; i++) {
        var n = node.childNodes[i];
        if (n.nodeType === 3) { buf += n.nodeValue; continue; }
        if (n.nodeType !== 1) continue;
        if (n.tagName === 'BR') { buf += '\n'; continue; }
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
      bindInlineImages($('note-blocks'), b);
      renderAll();
    }
  }

  /** 输入 "#标签 " 后按空格 → 变成标签板块，空格后面是正文 */
  function makeTagChip(el) {
    if (App.composeDraft) return false;   // 新建页面里不自动生成标签板块
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

    bindInlineImages(el, b);
    return el;
  }

  /* ---------- 渲染 ---------- */
  function renderBlocks(note) {
    var box = $('note-blocks');
    clear(box);
    var oldCaret = document.getElementById('drop-caret');
    if (oldCaret) oldCaret.style.display = 'none';

    if (!note.blocks || !note.blocks.length) {
      note.blocks = [Store.newBlock('text', { text: '' })];
    }
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
      Store.setBlocks(note.id, note.blocks);
    }

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
        box.appendChild(imageGridEl(note, run, i - run.length));
      } else {
        box.appendChild(textBlockEl(note, b));
        i++;
      }
    }
  }

  function imageGridEl(note, run, startIdx) {
    var grid = document.createElement('div');
    grid.className = 'img-grid';
    grid.dataset.n = String(Math.min(4, run.length));
    grid.dataset.start = String(startIdx || 0);
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

      bindInlineImages(cell, b);
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
        App.insertIntoBlock = App.activeBlock ? App.activeBlock.block.id : null;
        pickImages(act);
        return;
      }
      if (act === 'more') {
        var r = btn.getBoundingClientRect();
        openCtxMenu(r.left, r.top - 8, noteMoreMenu(note));
        return;
      }
      if (act === 'tag') {
        if (App.composeDraft) {
          var ab0 = ensureActiveBlock(note);
          if (ab0) insertAtCaret('#');
          return;
        }
        var tags = Store.allTags();
        if (!tags.length) {
          UI.toast('还没有标签：打 #名字 再按空格就生成一个');
          return;
        }
        var r2 = btn.getBoundingClientRect();
        var menuItems = tags.map(function (tg) {
          return {
            label: '#' + tg.tag,
            icon: 'i-hash',
            onClick: function () { insertTagChip(note, tg.tag); }
          };
        });
        if (menuItems.length > 8) menuItems = menuItems.slice(0, 8);
        openCtxMenu(r2.left, r2.top - 8, menuItems);
        return;
      }
    });
  }

  function insertTagChip(note, tag) {
    var ab = ensureActiveBlock(note);
    if (!ab) return;
    var el = ab.el;
    el.focus();
    var chip = document.createElement('span');
    chip.className = 'inline-tag';
    chip.contentEditable = 'false';
    chip.dataset.tag = tag;
    chip.textContent = '#' + tag;
    var space = document.createTextNode(' ');
    var sel = window.getSelection();
    if (sel && sel.rangeCount) {
      var r = sel.getRangeAt(0);
      r.deleteContents();
      r.insertNode(chip);
      chip.parentNode.insertBefore(space, chip.nextSibling);
      var r2 = document.createRange();
      r2.setStart(space, 1);
      r2.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r2);
    } else {
      el.appendChild(chip);
      el.appendChild(space);
    }
    saveBlockEdits(el, note, ab.block, true);
  }

  function ensureActiveBlock(note) {
    if (App.activeBlock && App.activeBlock.el && App.activeBlock.el.isConnected) return App.activeBlock;
    var last = (note.blocks || []).filter(function (x) { return x.type === 'text'; }).pop();
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
    var input = (mode === 'camera') ? $('file-camera') : $('file-image');
    if (!input) return;
    input.value = '';
    input.click();
  }

  /** 图片插进当前笔记：有正在编辑的块就插在光标处，否则追加一个新块 */
  async function insertImagesIntoNote(note, items) {
    if (!note || !items.length) return;
    var ab = App.activeBlock;
    if (ab && ab.el && ab.el.isConnected && ab.el.isContentEditable) {
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
          img.style.width = '130px';
          img.src = Store.getImage(it.id);
          img.contentEditable = 'false';
          ab.el.appendChild(img);
        }
      });
      saveBlockEdits(ab.el, note, ab.block);
      return;
    }
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
    // 插入线兜底：任何点击/滚动都收掉\n    document.addEventListener('pointerup', hideDropIndicator, true);\n    document.addEventListener('pointercancel', hideDropIndicator, true);\n    document.addEventListener('touchstart', hideDropIndicator, { capture: true, passive: true });\n    window.addEventListener('scroll', hideDropIndicator, true);\n\n    // 顶栏图标导航（手机上代替抽屉里的菜单）
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
