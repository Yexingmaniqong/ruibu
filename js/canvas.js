/* =========================================================
 * canvas.js — 无限画布引擎
 * 纯 DOM + SVG 实现，零依赖
 *  · 单指空白处拖动 = 平移
 *  · 单指节点上拖动 = 移动节点
 *  · 双指捏合 = 缩放（以双指中点为锚）
 *  · 节点选中后底部工具条：连线 / 编辑 / 复制 / 删除
 * 参考 Obsidian Canvas 的交互与 JSON Canvas 数据规范
 * ========================================================= */
(function (global) {
  'use strict';

  var markerSeq = 0;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var EDGE_COLORS = {
    default: '#5b6779',
    accent: '#f97316',
    blue: '#3b82f6',
    green: '#10b981',
    purple: '#8b5cf6',
    red: '#ef4444'
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function CanvasBoard(host, opts) {
    this.host = host;
    this.opts = opts || {};
    this.view = { x: 0, y: 0, scale: 1 };
    this.nodes = [];
    this.edges = [];
    this.selectedId = null;
    this.linkingFrom = null;
    this.editingId = null;
    this._nodeEls = Object.create(null);
    this._gesture = null;
    this._pointers = new Map();
    this._markerId = 'arw' + (++markerSeq);
    this._destroyed = false;
    this.armed = false;
    this._wake = null;
    // 用 AbortController 统一解绑：destroy() 时一次 abort，避免旧实例的事件
    // 残留在复用的 host 上（否则每次打开笔记都会多挂一套手势，点击节点边框会崩）
    this._ac = (typeof AbortController === 'function') ? new AbortController() : null;

    this._build();
    this._bind();
  }

  /* ================= 构建 DOM ================= */
  CanvasBoard.prototype.arm = function () {
    if (this.armed) return;
    this.armed = true;
    if (this._armHint) this._armHint.style.display = 'none';
    if (this.host) this.host.classList.add('cv-armed');
  };

  CanvasBoard.prototype._build = function () {
    var host = this.host;
    host.innerHTML = '';
    var armHint = document.createElement('div');
    armHint.className = 'cv-arm-hint';
    armHint.textContent = '点一下画布开始编辑';
    host.appendChild(armHint);
    this._armHint = armHint;

    var world = document.createElement('div');
    world.className = 'cv-world';

    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'cv-edges');

    var defs = document.createElementNS(SVG_NS, 'defs');
    Object.keys(EDGE_COLORS).forEach(function (key) {
      var m = document.createElementNS(SVG_NS, 'marker');
      m.setAttribute('id', this._markerId + '-' + key);
      m.setAttribute('markerWidth', '12');
      m.setAttribute('markerHeight', '12');
      m.setAttribute('refX', '10.2');
      m.setAttribute('refY', '4');
      m.setAttribute('orient', 'auto');
      m.setAttribute('markerUnits', 'userSpaceOnUse');
      var p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', 'M1.4,1 L10.6,4 L1.4,7 Z');
      p.setAttribute('fill', EDGE_COLORS[key]);
      p.setAttribute('stroke', EDGE_COLORS[key]);
      p.setAttribute('stroke-width', '0.8');
      p.setAttribute('stroke-linejoin', 'round');
      m.appendChild(p);
      defs.appendChild(m);
    }, this);
    svg.appendChild(defs);

    var edgeLayer = document.createElementNS(SVG_NS, 'g');
    svg.appendChild(edgeLayer);

    var nodeLayer = document.createElement('div');
    nodeLayer.className = 'cv-nodes';
    nodeLayer.style.position = 'absolute';
    nodeLayer.style.left = '0';
    nodeLayer.style.top = '0';
    nodeLayer.style.width = '0';
    nodeLayer.style.height = '0';

    world.appendChild(svg);
    world.appendChild(nodeLayer);
    host.appendChild(world);

    this.world = world;
    this.svg = svg;
    this.edgeLayer = edgeLayer;
    this.nodeLayer = nodeLayer;
    this._applyView();
  };

  /* ================= 数据 ================= */
  CanvasBoard.prototype.setData = function (data) {
    this.nodes = (data && data.nodes) ? data.nodes : [];
    this.edges = (data && data.edges) ? data.edges : [];
    if (data && data.view) {
      this.view = { x: data.view.x || 0, y: data.view.y || 0, scale: data.view.scale || 1 };
    }
    this.render();
  };

  CanvasBoard.prototype.getData = function () {
    return {
      nodes: this.nodes,
      edges: this.edges,
      view: { x: this.view.x, y: this.view.y, scale: this.view.scale }
    };
  };

  CanvasBoard.prototype._changed = function () {
    if (this.opts.onChange) this.opts.onChange(this.getData());
  };

  CanvasBoard.prototype._viewChanged = function () {
    if (this.opts.onViewChange) this.opts.onViewChange(this.getData());
    else this._changed();
  };

  /* ================= 视图 ================= */
  CanvasBoard.prototype._applyView = function () {
    if (!this.world || !this.host) return;
    this.world.style.transform =
      'translate(' + this.view.x + 'px,' + this.view.y + 'px) scale(' + this.view.scale + ')';
    var s = this.view.scale;
    // 手柄 / 缩放手柄按 1/缩放 反算，保证屏幕上的点击热区大小恒定（缩小时也好点）
    this.host.style.setProperty('--cv-zoom', String(s || 1));
    this.host.style.backgroundSize = (24 * s) + 'px ' + (24 * s) + 'px';
    this.host.style.backgroundPosition = this.view.x + 'px ' + this.view.y + 'px';
  };

  CanvasBoard.prototype.screenToWorld = function (clientX, clientY) {
    var r = this.host.getBoundingClientRect();
    return {
      x: (clientX - r.left - this.view.x) / this.view.scale,
      y: (clientY - r.top - this.view.y) / this.view.scale
    };
  };

  CanvasBoard.prototype.viewCenterWorld = function () {
    var r = this.host.getBoundingClientRect();
    return this.screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
  };

  CanvasBoard.prototype.zoomTo = function (scale, anchorClientX, anchorClientY) {
    var r = this.host.getBoundingClientRect();
    if (anchorClientX === undefined) anchorClientX = r.left + r.width / 2;
    if (anchorClientY === undefined) anchorClientY = r.top + r.height / 2;
    var before = this.screenToWorld(anchorClientX, anchorClientY);
    this.view.scale = clamp(scale, 0.12, 3.5);
    this.view.x = (anchorClientX - r.left) - before.x * this.view.scale;
    this.view.y = (anchorClientY - r.top) - before.y * this.view.scale;
    this._applyView();
    this._viewChanged();
  };

  CanvasBoard.prototype.fitView = function (animate) {
    var nodes = this.nodes;
    var r = this.host.getBoundingClientRect();
    if (!nodes.length) {
      this.view = { x: r.width / 2, y: r.height / 2, scale: 1 };
      this._applyView(); this._viewChanged();
      return;
    }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(function (n) {
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h);
    });
    var pad = 40;
    var bw = maxX - minX, bh = maxY - minY;
    // 自适应时不要把内容缩成缩略图（0.12 那种根本没法学），最低 0.32，其余靠拖动画布看
    var scale = clamp(Math.min((r.width - pad * 2) / bw, (r.height - pad * 2) / bh), 0.35, 1.2);
    this.view.scale = scale;
    this.view.x = (r.width - bw * scale) / 2 - minX * scale;
    this.view.y = (r.height - bh * scale) / 2 - minY * scale;
    this._applyView();
    this._viewChanged();
  };

  /* ================= 渲染 ================= */
  CanvasBoard.prototype.render = function () {
    if (this.editingId) return; // 编辑中不重建，避免丢失焦点
    var self = this;
    var alive = Object.create(null);

    this.nodes.forEach(function (n) {
      alive[n.id] = 1;
      var el = self._nodeEls[n.id];
      if (!el) {
        el = self._mountNode(n);
        self._nodeEls[n.id] = el;
      } else {
        self._updateNodeEl(el, n);
      }
    });

    // 移除已删除的
    Object.keys(this._nodeEls).forEach(function (id) {
      if (!alive[id]) {
        var el = self._nodeEls[id];
        if (el && el.parentNode) el.parentNode.removeChild(el);
        delete self._nodeEls[id];
      }
    });

    this._renderEdges();
    this._applySelection();
    this._applyView();
  };

  CanvasBoard.prototype._mountNode = function (n) {
    var el = document.createElement('div');
    el.className = 'cv-node';
    el.dataset.id = n.id;
    this.nodeLayer.appendChild(el);
    this._updateNodeEl(el, n, true);
    return el;
  };

  CanvasBoard.prototype._updateNodeEl = function (el, n, fresh) {
    if (!el || !n) return;
    el.style.left = n.x + 'px';
    el.style.top = n.y + 'px';
    el.style.width = n.w + 'px';
    el.style.height = n.h + 'px';

    var want = n.type + ':' + (n.imageId || n.noteId || (n.text || '').slice(0, 20)) + ':' + n.w + 'x' + n.h;
    if (!fresh && el.dataset.sig === want) return;
    el.dataset.sig = want;

    if (n.type === 'image') {
      var src = Store.getImage(n.imageId);
      var img = el.querySelector('img');
      if (!img) {
        el.innerHTML = '';
        img = document.createElement('img');
        img.draggable = false;
        el.appendChild(img);
      }
      if (img.getAttribute('src') !== src) img.setAttribute('src', src);
    } else if (n.type === 'text') {
      var t = el.querySelector('.cv-text');
      if (!t) {
        el.innerHTML = '';
        t = document.createElement('div');
        t.className = 'cv-text';
        el.appendChild(t);
      }
      if (t.textContent !== (n.text || '')) t.textContent = n.text || '';
    } else if (n.type === 'note') {
      this._renderNoteNode(el, n);
    }

    // 缩放手柄（仅图片/文字，且可编辑）
    if (this.opts.editable !== false && !el.querySelector('.cv-node-resize')) {
      var rz = document.createElement('div');
      rz.className = 'cv-node-resize';
      el.appendChild(rz);
    }
    // 连线手柄：选中后从边缘圆点拖出箭头
    if (this.opts.editable !== false) this._ensureHandles(el);
  };

  CanvasBoard.prototype._renderNoteNode = function (el, n) {
    var note = Store.getNote(n.noteId);
    el.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'cv-note';

    if (!note) {
      wrap.innerHTML = '<div class="cv-note-body" style="color:var(--text-3)">笔记已删除</div>';
      el.appendChild(wrap);
      return;
    }

    if (note.tags && note.tags.length) {
      var tag = document.createElement('div');
      tag.className = 'cv-note-tag';
      tag.textContent = '#' + note.tags[0];
      wrap.appendChild(tag);
    }

    var body = document.createElement('div');
    body.className = 'cv-note-body';
    body.textContent = note.text || '(无文字)';
    wrap.appendChild(body);

    if (note.imageIds && note.imageIds.length) {
      var thumbs = document.createElement('div');
      thumbs.className = 'cv-note-thumbs';
      note.imageIds.slice(0, 3).forEach(function (id) {
        var im = document.createElement('img');
        im.src = Store.getImage(id);
        im.draggable = false;
        thumbs.appendChild(im);
      });
      wrap.appendChild(thumbs);
    }

    var foot = document.createElement('div');
    foot.className = 'cv-note-foot';
    var d = new Date(note.createdAt);
    foot.innerHTML = '<span>' + (d.getMonth() + 1) + '月' + d.getDate() + '日</span><span>打开 ›</span>';
    wrap.appendChild(foot);

    el.appendChild(wrap);
    var rz = document.createElement('div');
    rz.className = 'cv-node-resize';
    el.appendChild(rz);
  };

  CanvasBoard.prototype._anchor = function (node, tx, ty) {
    var cx = node.x + node.w / 2, cy = node.y + node.h / 2;
    var dx = tx - cx, dy = ty - cy;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return { x: cx, y: cy };
    var k = 1 / Math.max(Math.abs(dx) / (node.w / 2), Math.abs(dy) / (node.h / 2));
    return { x: cx + dx * k, y: cy + dy * k };
  };

  CanvasBoard.prototype._renderEdges = function () {
    var self = this;
    var map = Object.create(null);
    this.nodes.forEach(function (n) { map[n.id] = n; });

    this.edgeLayer.innerHTML = '';
    this._edgeEls = Object.create(null);
    this.edges.forEach(function (e) {
      var a = map[e.from], b = map[e.to];
      if (!a || !b) return;

      var g = self._edgeGeometry(a, b);
      var colorKey = e.color || 'default';
      var path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', self._edgePathD(g));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', EDGE_COLORS[colorKey] || EDGE_COLORS.default);
      path.setAttribute('stroke-width', e.width || 2.2);
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('marker-end', 'url(#' + self._markerId + '-' + (EDGE_COLORS[colorKey] ? colorKey : 'default') + ')');
      self.edgeLayer.appendChild(path);
      self._edgeEls[e.id] = path;

      if (e.label) {
        var m = self._edgeMid(g);
        var text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute('x', m.x);
        text.setAttribute('y', m.y - 7);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('class', 'cv-edge-label');
        text.setAttribute('font-size', '11');
        text.setAttribute('fill', '#6b7280');
        text.textContent = e.label;
        self.edgeLayer.appendChild(text);
      }
    });
  };

  /* ---------- 连线几何 ----------
   * 以前是「中点为圆心、永远往同一侧鼓」的二次曲线，节点上下排列时
   * 所有箭头都朝同一边弯，看着别扭。现在改成从节点边缘垂直出发、
   * 三次贝塞尔收到目标边缘：上下连接近直线，左右连是标准 S 弯。 */
  CanvasBoard.prototype._edgeGeometry = function (a, b) {
    var acx = a.x + a.w / 2, acy = a.y + a.h / 2;
    var bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
    var dx = bcx - acx, dy = bcy - acy;
    var p1, p2, c1, c2, k;

    if (Math.abs(dx) >= Math.abs(dy)) {
      var sx = dx >= 0 ? 1 : -1;
      p1 = { x: sx > 0 ? a.x + a.w : a.x, y: acy };
      p2 = { x: sx > 0 ? b.x : b.x + b.w, y: bcy };
      k = clamp(Math.abs(dx) * 0.5, 26, 170);
      c1 = { x: p1.x + sx * k, y: p1.y };
      c2 = { x: p2.x - sx * k, y: p2.y };
    } else {
      var sy = dy >= 0 ? 1 : -1;
      p1 = { x: acx, y: sy > 0 ? a.y + a.h : a.y };
      p2 = { x: bcx, y: sy > 0 ? b.y : b.y + b.h };
      k = clamp(Math.abs(dy) * 0.5, 26, 170);
      c1 = { x: p1.x, y: p1.y + sy * k };
      c2 = { x: p2.x, y: p2.y - sy * k };
    }
    return { p1: p1, p2: p2, c1: c1, c2: c2 };
  };

  CanvasBoard.prototype._edgePathD = function (g) {
    return 'M' + g.p1.x + ',' + g.p1.y +
      ' C' + g.c1.x + ',' + g.c1.y +
      ' ' + g.c2.x + ',' + g.c2.y +
      ' ' + g.p2.x + ',' + g.p2.y;
  };

  CanvasBoard.prototype._edgeMid = function (g) {
    return {
      x: 0.125 * g.p1.x + 0.375 * g.c1.x + 0.375 * g.c2.x + 0.125 * g.p2.x,
      y: 0.125 * g.p1.y + 0.375 * g.c1.y + 0.375 * g.c2.y + 0.125 * g.p2.y
    };
  };

  /* 拖动节点时只重画和这个节点相关的连线（整屏重画会卡） */
  CanvasBoard.prototype._renderEdgesFor = function (id) {
    if (!this._edgeEls) return;
    var self = this;
    var map = Object.create(null);
    this.nodes.forEach(function (n) { map[n.id] = n; });
    this.edges.forEach(function (e) {
      if (e.from !== id && e.to !== id) return;
      var p = self._edgeEls[e.id];
      var a = map[e.from], b = map[e.to];
      if (!p || !a || !b) return;
      p.setAttribute('d', self._edgePathD(self._edgeGeometry(a, b)));
    });
  };

  CanvasBoard.prototype._applySelection = function () {
    var self = this;
    Object.keys(this._nodeEls).forEach(function (id) {
      var el = self._nodeEls[id];
      el.classList.toggle('selected', id === self.selectedId);
      el.classList.toggle('linking-source', id === self.linkingFrom);
    });
    if (this.opts.onSelectionChange) this.opts.onSelectionChange(this.selectedId, this.getNode(this.selectedId));
  };

  /* ---------- 连线手柄（可拖拽拉出箭头） ---------- */
  CanvasBoard.prototype._ensureHandles = function (el) {
    if (el.querySelector('.cv-handle')) return;
    ['top', 'right', 'bottom', 'left'].forEach(function (dir) {
      var h = document.createElement('div');
      h.className = 'cv-handle ' + dir;
      h.dataset.dir = dir;
      el.appendChild(h);
    });
  };

  CanvasBoard.prototype._showTempEdge = function (fromNode, worldPt) {
    if (!this._tempPath) {
      var p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', '#36c66c');
      p.setAttribute('stroke-width', '2.2');
      p.setAttribute('stroke-dasharray', '7 6');
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('marker-end', 'url(#' + this._markerId + '-green)');
      this.svg.appendChild(p);
      this._tempPath = p;
    }
    this._updateTempEdge(worldPt, fromNode);
  };

  CanvasBoard.prototype._updateTempEdge = function (worldPt, fromNode) {
    if (!this._tempPath) return;
    var g0 = this._gesture;
    var n = fromNode || (g0 ? this.getNode(g0.fromId) : null);
    if (!n || !worldPt) return;
    // 把光标当成一个零尺寸的节点，复用同一套连线几何
    var ghost = { x: worldPt.x, y: worldPt.y, w: 0, h: 0 };
    this._tempPath.setAttribute('d', this._edgePathD(this._edgeGeometry(n, ghost)));
  };

  CanvasBoard.prototype._clearTempEdge = function () {
    if (this._tempPath && this._tempPath.parentNode) {
      this._tempPath.parentNode.removeChild(this._tempPath);
    }
    this._tempPath = null;
  };

  CanvasBoard.prototype._highlightTarget = function (id, excludeId) {
    var self = this;
    Object.keys(this._nodeEls).forEach(function (nid) {
      self._nodeEls[nid].classList.toggle('link-target', !!id && nid === id && nid !== excludeId);
    });
  };

  CanvasBoard.prototype.getNode = function (id) {
    for (var i = 0; i < this.nodes.length; i++) if (this.nodes[i].id === id) return this.nodes[i];
    return null;
  };

  CanvasBoard.prototype.select = function (id) {
    this.selectedId = id;
    this._applySelection();
  };

  /* ================= 节点操作 ================= */
  CanvasBoard.prototype.addNode = function (node) {
    node.id = node.id || Store.uid('nd_');
    node.w = node.w || 220;
    node.h = node.h || 120;
    this.nodes.push(node);
    this.render();
    this._changed();
    return node;
  };

  CanvasBoard.prototype.removeNode = function (id) {
    this.nodes = this.nodes.filter(function (n) { return n.id !== id; });
    this.edges = this.edges.filter(function (e) { return e.from !== id && e.to !== id; });
    if (this.selectedId === id) this.selectedId = null;
    if (this.linkingFrom === id) this.linkingFrom = null;
    this.render();
    this._changed();
  };

  CanvasBoard.prototype.duplicateNode = function (id) {
    var n = this.getNode(id);
    if (!n) return;
    var copy = JSON.parse(JSON.stringify(n));
    copy.id = Store.uid('nd_');
    copy.x = n.x + 26;
    copy.y = n.y + 26;
    this.nodes.push(copy);
    this.render();
    this._changed();
  };

  CanvasBoard.prototype.addEdge = function (from, to, label) {
    if (from === to) return null;
    var exists = this.edges.some(function (e) { return e.from === from && e.to === to; });
    if (exists) return null;
    var e = { id: Store.uid('e_'), from: from, to: to, label: label || '', color: 'default', bow: 1 };
    this.edges.push(e);
    this._renderEdges();
    this._changed();
    return e;
  };

  /** 在视口中心附近找一个空位放新节点 */
  CanvasBoard.prototype.nextPlacement = function (w, h) {
    var c = this.viewCenterWorld();
    var x = c.x - w / 2, y = c.y - h / 2;
    var tries = 0;
    while (tries < 40) {
      var hit = this.nodes.some(function (n) {
        return Math.abs(n.x - x) < 30 && Math.abs(n.y - y) < 30;
      });
      if (!hit) break;
      x += 28; y += 28; tries++;
    }
    return { x: x, y: y };
  };

  CanvasBoard.prototype.addTextNode = function (text, w, h) {
    w = w || 150; h = h || 46;
    var p = this.nextPlacement(w, h);
    return this.addNode({ type: 'text', text: text || '', x: p.x, y: p.y, w: w, h: h });
  };

  CanvasBoard.prototype.addImageNode = function (imageId, naturalW, naturalH) {
    var maxW = 300;
    var ratio = (naturalH && naturalW) ? naturalH / naturalW : 0.75;
    var w = Math.min(maxW, naturalW || maxW);
    var h = Math.round(w * ratio);
    if (h > 400) { h = 400; w = Math.round(h / ratio); }
    var p = this.nextPlacement(w, h);
    return this.addNode({ type: 'image', imageId: imageId, x: p.x, y: p.y, w: w, h: h });
  };

  CanvasBoard.prototype.addNoteNode = function (noteId) {
    var w = 250, h = 200;
    var p = this.nextPlacement(w, h);
    return this.addNode({ type: 'note', noteId: noteId, x: p.x, y: p.y, w: w, h: h });
  };

  /* ================= 编辑文字 ================= */
  CanvasBoard.prototype.startEdit = function (id) {
    var n = this.getNode(id);
    if (!n) return;
    if (n.type === 'note') {
      if (this.opts.onOpenNote) this.opts.onOpenNote(n.noteId);
      return;
    }
    if (n.type === 'image') return;
    var el = this._nodeEls[id];
    if (!el) return;
    var t = el.querySelector('.cv-text');
    if (!t) return;

    this.editingId = id;
    t.setAttribute('contenteditable', 'true');
    t.focus();

    // 光标移到末尾
    try {
      var range = document.createRange();
      range.selectNodeContents(t);
      range.collapse(false);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (err) { /* ignore */ }

    var self = this;
    // 边输入边同步到数据，避免失焦前被重绘吞掉
    var onInput = function () {
      n.text = t.textContent || '';
      self._changed();
    };
    t.addEventListener('input', onInput);

    var finish = function () {
      if (self.editingId !== id) return;
      var txt = t.textContent || '';
      n.text = txt;
      t.removeAttribute('contenteditable');
      t.removeEventListener('input', onInput);
      self.editingId = null;
      // 内容比框高时自动增高，避免文字被截
      var need = t.scrollHeight + 2;
      if (need > n.h) {
        n.h = need;
        var el2 = self._nodeEls[id];
        if (el2) el2.style.height = need + 'px';
        self._renderEdges();
      }
      self._changed();
      self.render();
    };
    t.addEventListener('blur', finish, { once: true });
  };

  /* ================= 手势 ================= */
  CanvasBoard.prototype._bind = function () {
    var self = this;
    var host = this.host;
    var SIG = this._ac ? { signal: this._ac.signal } : undefined;
    var SIG_PASSIVE_FALSE = this._ac ? { signal: this._ac.signal, passive: false } : { passive: false };

    function dist(p1, p2) {
      var dx = p1.x - p2.x, dy = p1.y - p2.y;
      return Math.sqrt(dx * dx + dy * dy);
    }
    function mid(p1, p2) {
      return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    }

    host.addEventListener('pointerdown', function (e) {
      if (self._destroyed) return;
      if (self.editingId) return;
      if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
      // 未唤醒：只接受"点一下"来激活，避免滑动屏幕时误拖节点
      if (!self.armed) {
        self._wake = { x: e.clientX, y: e.clientY, id: e.pointerId };
        return;
      }
      try { host.setPointerCapture(e.pointerId); } catch (err) { }

      self._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (self._pointers.size === 2) {
        var pts = Array.from(self._pointers.values());
        self._gesture = {
          type: 'pinch',
          startDist: dist(pts[0], pts[1]),
          startScale: self.view.scale,
          anchor: self.screenToWorld(mid(pts[0], pts[1]).x, mid(pts[0], pts[1]).y),
          startMid: mid(pts[0], pts[1])
        };
        return;
      }
      if (self._pointers.size > 2) return;

      var nodeEl = e.target.closest ? e.target.closest('.cv-node') : null;
      var isResize = e.target.classList && e.target.classList.contains('cv-node-resize');
      var isHandle = e.target.classList && e.target.classList.contains('cv-handle');

      // 从节点边缘的连接点拖出箭头
      if (isHandle && nodeEl && self.opts.editable !== false) {
        var hn = self.getNode(nodeEl.dataset.id);
        if (!hn) return;
        self.select(hn.id);
        var hw = self.screenToWorld(e.clientX, e.clientY);
        self._gesture = { type: 'connect', fromId: hn.id, cur: hw };
        self._showTempEdge(hn, hw);
        return;
      }

      if (isResize && nodeEl) {
        var rn = self.getNode(nodeEl.dataset.id);
        if (!rn) return;
        self._gesture = {
          type: 'resize',
          nodeId: rn.id,
          startW: rn.w, startH: rn.h,
          start: self.screenToWorld(e.clientX, e.clientY)
        };
        return;
      }

      if (nodeEl && self.opts.editable !== false) {
        var id = nodeEl.dataset.id;
        var node = self.getNode(id);
        if (!node) return;

        if (self.linkingFrom && self.linkingFrom !== id) {
          self._finishLink(id);
          return;
        }

        var wasSelected = self.selectedId === id;
        self.select(id);
        var w = self.screenToWorld(e.clientX, e.clientY);
        self._gesture = {
          type: 'node',
          nodeId: id,
          wasSelected: wasSelected,
          offsetX: w.x - node.x,
          offsetY: w.y - node.y,
          baseX: node.x,
          baseY: node.y,
          startX: e.clientX,
          startY: e.clientY,
          moved: false
        };
        return;
      }

      // 空白处 → 平移
      self._gesture = {
        type: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        viewX: self.view.x,
        viewY: self.view.y,
        moved: false
      };
      host.classList.add('grabbing');
    }, SIG);

    host.addEventListener('pointermove', function (e) {
      if (self._destroyed) return;
      if (!self._pointers.has(e.pointerId)) return;
      self._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      var g = self._gesture;
      if (!g) return;

      if (g.type === 'pinch' && self._pointers.size >= 2) {
        var pts = Array.from(self._pointers.values());
        var d = dist(pts[0], pts[1]);
        var m = mid(pts[0], pts[1]);
        var scale = clamp(g.startScale * (d / g.startDist), 0.12, 3.5);
        var r = host.getBoundingClientRect();
        self.view.scale = scale;
        self.view.x = (m.x - r.left) - g.anchor.x * scale;
        self.view.y = (m.y - r.top) - g.anchor.y * scale;
        self._applyView();
        return;
      }

      if (g.type === 'connect') {
        var cp = self.screenToWorld(e.clientX, e.clientY);
        g.cur = cp;
        self._updateTempEdge(cp);
        var under = document.elementFromPoint(e.clientX, e.clientY);
        var tgt = under && under.closest ? under.closest('.cv-node') : null;
        self._highlightTarget(tgt ? tgt.dataset.id : null, g.fromId);
        return;
      }

      if (g.type === 'pan') {
        var dx = e.clientX - g.startX, dy = e.clientY - g.startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) g.moved = true;
        self.view.x = g.viewX + dx;
        self.view.y = g.viewY + dy;
        self._applyView();
        return;
      }

      if (g.type === 'node') {
        var wp = self.screenToWorld(e.clientX, e.clientY);
        var node = self.getNode(g.nodeId);
        if (!node) return;
        if (Math.abs(e.clientX - g.startX) > 3 || Math.abs(e.clientY - g.startY) > 3) g.moved = true;

        var nx = wp.x - g.offsetX, ny = wp.y - g.offsetY;
        var ddx = nx - g.baseX, ddy = ny - g.baseY;
        node.x = nx; node.y = ny;

        var el = self._nodeEls[g.nodeId];
        if (el) {
          // 用 transform 移动：不改 left/top，避免每帧重排
          if (!el.__dragOn) { el.__dragOn = true; el.style.willChange = 'transform'; el.style.contain = 'layout style'; }
          el.style.transform = 'translate3d(' + ddx + 'px,' + ddy + 'px,0)';
        }
        if (!g.raf) {
          g.raf = requestAnimationFrame(function () {
            g.raf = 0;
            self._renderEdgesFor(g.nodeId);
          });
        }
        return;
      }

      if (g.type === 'resize') {
        var p = self.screenToWorld(e.clientX, e.clientY);
        var nd = self.getNode(g.nodeId);
        if (!nd) return;
        var nw = Math.max(80, g.startW + (p.x - g.start.x));
        var nh = Math.max(60, g.startH + (p.y - g.start.y));
        // 图片保持比例
        if (nd.type === 'image') {
          var ratio = g.startH / g.startW;
          nh = Math.round(nw * ratio);
        }
        nd.w = nw; nd.h = nh;
        var rEl = self._nodeEls[g.nodeId];
        if (rEl) { rEl.style.width = nw + 'px'; rEl.style.height = nh + 'px'; }
        self._renderEdges();
        return;
      }
    }, SIG);

    function endPointer(e) {
      if (self._destroyed) return;
      var wk = self._wake;
      if (wk && wk.id === e.pointerId) {
        self._wake = null;
        if (Math.abs(e.clientX - wk.x) < 14 && Math.abs(e.clientY - wk.y) < 14) self.arm();
        return;
      }
      self._pointers.delete(e.pointerId);
      var g = self._gesture;

      if (self._pointers.size === 1) {
        // 从双指退回单指：重置手势为平移，避免跳变
        var remain = Array.from(self._pointers.values())[0];
        self._gesture = {
          type: 'pan',
          startX: remain.x, startY: remain.y,
          viewX: self.view.x, viewY: self.view.y, moved: true
        };
        return;
      }
      if (self._pointers.size > 1) return;

      self._gesture = null;
      host.classList.remove('grabbing');

      if (!g) return;

      if (g.type === 'pan') {
        if (!g.moved) {
          // 点空白 → 取消选中 / 取消连线
          if (self.linkingFrom) { self.linkingFrom = null; self._applySelection(); }
          else self.select(null);
        }
        self._viewChanged();
      } else if (g.type === 'connect') {
        self._clearTempEdge();
        self._highlightTarget(null);
        var el2 = document.elementFromPoint(e.clientX, e.clientY);
        var tn = el2 && el2.closest ? el2.closest('.cv-node') : null;
        if (tn && tn.dataset.id !== g.fromId) {
          var made = self.addEdge(g.fromId, tn.dataset.id, '');
          if (made && global.UI) global.UI.toast('已连线');
        }
      } else if (g.type === 'node') {
        var el3 = self._nodeEls[g.nodeId];
        var n3 = self.getNode(g.nodeId);
        if (g.raf) { cancelAnimationFrame(g.raf); g.raf = 0; }
        if (el3) {
          el3.style.transform = '';
          el3.style.willChange = '';
          el3.style.contain = '';
          el3.__dragOn = false;
          if (n3) { el3.style.left = n3.x + 'px'; el3.style.top = n3.y + 'px'; }
        }
        if (n3) self._renderEdgesFor(n3.id);
        if (!g.moved) {
          // 单击已经选中的图片 → 直接看大图（首次点击只是选中，方便拖拽/连线）
          var n = n3;
          if (n && n.type === 'image' && g.wasSelected && self.opts.onOpenImage) {
            self.opts.onOpenImage(n.imageId);
            return;
          }
        }
        self._changed();
      } else if (g.type === 'resize') {
        self._changed();
      } else if (g.type === 'pinch') {
        self._viewChanged();
      }
    }

    host.addEventListener('pointerup', endPointer, SIG);
    host.addEventListener('pointercancel', endPointer, SIG);

    // 双击节点：编辑文字 / 打开笔记
    host.addEventListener('dblclick', function (e) {
      if (self._destroyed) return;
      var nodeEl = e.target.closest ? e.target.closest('.cv-node') : null;
      if (!nodeEl) {
        var wp = self.screenToWorld(e.clientX, e.clientY);
        self.addTextNode('', 150, 46);
        return;
      }
      var id = nodeEl.dataset.id;
      var n = self.getNode(id);
      if (!n) return;
      if (n.type === 'note') {
        if (self.opts.onOpenNote) self.opts.onOpenNote(n.noteId);
      } else if (n.type === 'text') {
        self.startEdit(id);
      } else if (n.type === 'image') {
        if (self.opts.onOpenImage) self.opts.onOpenImage(n.imageId);
      }
    }, SIG);

    // 桌面滚轮缩放
    host.addEventListener('wheel', function (e) {
      if (self._destroyed) return;
      if (!e.ctrlKey && Math.abs(e.deltaY) < 2) return;
      e.preventDefault();
      var factor = e.ctrlKey ? (1 - e.deltaY * 0.01) : (1 - e.deltaY * 0.0015);
      self.zoomTo(self.view.scale * factor, e.clientX, e.clientY);
    }, SIG_PASSIVE_FALSE);

    // 双击空白新建文字卡（移动端用底部按钮）
    this.host.addEventListener('contextmenu', function (e) { e.preventDefault(); }, SIG);
  };

  /* ================= 连线流程 ================= */
  CanvasBoard.prototype.beginLink = function (id) {
    this.linkingFrom = id;
    this._applySelection();
    if (this.opts.onLinkStart) this.opts.onLinkStart();
  };

  CanvasBoard.prototype.cancelLink = function () {
    this.linkingFrom = null;
    this._applySelection();
  };

  CanvasBoard.prototype._finishLink = function (toId) {
    var from = this.linkingFrom;
    this.linkingFrom = null;
    this._applySelection();
    if (this.opts.onLinkEnd) this.opts.onLinkEnd(from, toId, this);
    else this.addEdge(from, toId);
  };

  CanvasBoard.prototype.destroy = function () {
    this._destroyed = true;
    // 关键：把挂在 host 上的所有手势解绑，host 是复用的 DOM 元素
    if (this._ac) { try { this._ac.abort(); } catch (e) { } this._ac = null; }
    this._pointers.clear();
    this._gesture = null;
    this.host.innerHTML = '';
    this._nodeEls = Object.create(null);
  };

  global.CanvasBoard = CanvasBoard;
  global.EDGE_COLORS = EDGE_COLORS;
})(window);
