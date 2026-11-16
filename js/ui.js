/* =========================================================
 * ui.js — 通用弹层 / 提示 / 选择器
 * ========================================================= */
(function (global) {
  'use strict';

  var mask = document.getElementById('modal-mask');
  var modalTitle = document.getElementById('modal-title');
  var modalBody = document.getElementById('modal-body');
  var modalActions = document.getElementById('modal-actions');

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function close() {
    mask.classList.add('hidden');
    clear(modalBody);
    clear(modalActions);
  }

  /**
   * opts: { title, bodyHTML | bodyNode, actions:[{label, value, cls}] }
   * 返回 Promise，resolve 为被点按钮的 value
   */
  function modal(opts) {
    return new Promise(function (resolve) {
      modalTitle.textContent = opts.title || '';
      clear(modalBody);
      if (typeof opts.bodyHTML === 'string') {
        modalBody.innerHTML = opts.bodyHTML;
      } else if (opts.bodyNode) {
        modalBody.appendChild(opts.bodyNode);
      }
      clear(modalActions);

      (opts.actions || [{ label: '关闭', value: null }]).forEach(function (a) {
        var b = document.createElement('button');
        b.textContent = a.label;
        if (a.cls) b.className = a.cls;
        b.addEventListener('click', function () {
          var val = a.value;
          if (a.onClick) {
            var r = a.onClick(modalBody);
            if (r === false) return;
            if (r !== undefined) val = r;
          }
          close();
          resolve(val);
        });
        modalActions.appendChild(b);
      });

      mask.classList.remove('hidden');
    });
  }

  function prompt(title, value, placeholder, multiline) {
    var node = document.createElement('div');
    var input;
    if (multiline) {
      input = document.createElement('textarea');
      input.value = value || '';
      input.placeholder = placeholder || '';
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.value = value || '';
      input.placeholder = placeholder || '';
    }
    node.appendChild(input);
    setTimeout(function () { input.focus(); }, 60);

    return modal({
      title: title,
      bodyNode: node,
      actions: [
        { label: '取消', value: null },
        {
          label: '确定', cls: 'primary',
          onClick: function () { return input.value; }
        }
      ]
    });
  }

  function confirm(title, text, okLabel) {
    return modal({
      title: title,
      bodyHTML: '<div>' + (text || '') + '</div>',
      actions: [
        { label: '取消', value: false },
        { label: okLabel || '确定', cls: 'primary', value: true }
      ]
    });
  }

  function toast(msg, duration) {
    var el = document.getElementById('canvas-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'canvas-toast';
      el.id = 'canvas-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.add('hidden'); }, duration || 1600);
  }

  /* ---------- 笔记选择器 ---------- */
  var pickerMask = document.getElementById('picker-mask');
  var pickerList = document.getElementById('picker-list');
  var pickerSearch = document.getElementById('picker-search');
  var pickerTitle = document.getElementById('picker-title');
  var pickerResolve = null;
  var pickerItems = [];

  function renderPicker(keyword) {
    clear(pickerList);
    var k = (keyword || '').toLowerCase();
    var list = pickerItems.filter(function (it) {
      if (!k) return true;
      return (it.text || '').toLowerCase().indexOf(k) !== -1;
    });
    if (!list.length) {
      var empty = document.createElement('div');
      empty.className = 'picker-item';
      empty.style.color = 'var(--text-3)';
      empty.textContent = '没有匹配的笔记';
      pickerList.appendChild(empty);
      return;
    }
    list.forEach(function (it) {
      var el = document.createElement('div');
      el.className = 'picker-item';
      var t = document.createElement('div');
      t.className = 'picker-item-t';
      t.textContent = it.text || '(无文字)';
      var s = document.createElement('div');
      s.className = 'picker-item-s';
      var d = new Date(it.createdAt);
      s.textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日' +
        (it.tags && it.tags.length ? ' · #' + it.tags.join(' #') : '') +
        (it.imageIds && it.imageIds.length ? ' · ' + it.imageIds.length + ' 图' : '');
      el.appendChild(t); el.appendChild(s);
      el.addEventListener('click', function () {
        pickerMask.classList.add('hidden');
        if (pickerResolve) { var r = pickerResolve; pickerResolve = null; r(it); }
      });
      pickerList.appendChild(el);
    });
  }

  function pick(items, title) {
    pickerItems = items;
    pickerTitle.textContent = title || '选择笔记';
    pickerSearch.value = '';
    renderPicker('');
    pickerMask.classList.remove('hidden');
    return new Promise(function (resolve) { pickerResolve = resolve; });
  }

  pickerSearch.addEventListener('input', function () { renderPicker(this.value); });
  document.getElementById('picker-close').addEventListener('click', function () {
    pickerMask.classList.add('hidden');
    if (pickerResolve) { pickerResolve(null); pickerResolve = null; }
  });

  global.UI = {
    modal: modal,
    prompt: prompt,
    confirm: confirm,
    toast: toast,
    pick: pick,
    close: close,
    clear: clear
  };
})(window);
