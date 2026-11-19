/* 待办、提醒和系统通知入口 */
(function (global) {
  'use strict';

  var bridge = global.RuibuReminders;
  var list = document.getElementById('todo-list');
  var permissions = document.getElementById('todo-permissions');
  var format = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  });
  var started = false;
  var timer = 0;
  var lastPayload;

  function element(tag, text, className) {
    var el = document.createElement(tag);
    if (text) el.textContent = text;
    if (className) el.className = className;
    return el;
  }

  function button(text, className, onClick) {
    var el = element('button', text, className);
    el.type = 'button';
    el.addEventListener('click', onClick);
    return el;
  }

  function renderPermissions() {
    permissions.replaceChildren();
    if (bridge) {
      var settings = JSON.parse(bridge.status());
      if (!settings.notifications) {
        permissions.append(element('span', '开启通知后，待办到点可以弹出提醒并震动。'),
          button('开启通知', 'todo-link', function () { bridge.openSettings('notifications'); }));
      } else if (!settings.exact) {
        permissions.append(element('span', '系统可能延后提醒。开启「闹钟和提醒」可按设定时间提醒。'),
          button('允许准时提醒', 'todo-link', function () { bridge.openSettings('exact'); }));
      }
    } else {
      permissions.append(element('span', '保留 RUIBU 运行，才能收到此设备上的到点提醒。'));
    }
    permissions.hidden = !permissions.childElementCount;
  }

  function render() {
    renderPermissions();
    list.replaceChildren();
    var tasks = Store.state.todos;
    var active = tasks.filter(function (task) { return !task.doneAt; });
    var completed = tasks.filter(function (task) { return task.doneAt; });
    active.sort(function (a, b) { return (a.dueAt || Infinity) - (b.dueAt || Infinity) || b.updatedAt - a.updatedAt; });
    completed.sort(function (a, b) { return b.doneAt - a.doneAt; });
    if (!active.length) list.append(element('p', '没有未完成的待办', 'todo-empty'));
    active.forEach(function (task) { list.append(taskRow(task)); });
    if (completed.length) {
      var section = element('details', '', 'todo-completed');
      section.append(element('summary', '已完成（' + completed.length + '）'));
      completed.forEach(function (task) { section.append(taskRow(task)); });
      list.append(section);
    }
  }

  function taskRow(task) {
    var row = element('article', '', 'todo-row');
    var check = element('input');
    check.type = 'checkbox';
    check.checked = !!task.doneAt;
    check.setAttribute('aria-label', (task.doneAt ? '恢复待办：' : '完成待办：') + task.title);
    check.addEventListener('change', function () {
      task.doneAt = check.checked ? Date.now() : null;
      task.updatedAt = Date.now();
      save();
    });
    var overdue = !task.doneAt && task.dueAt && task.dueAt <= Date.now();
    var info = element('div', '', 'todo-info');
    info.append(element('div', task.title, 'todo-title'));
    info.append(element('span', task.dueAt ? (overdue ? '已到期 · ' : '') + format.format(task.dueAt) : '无时间限制',
      overdue ? 'todo-overdue' : 'todo-time'));
    var actions = element('div', '', 'todo-actions');
    actions.append(button('编辑', 'todo-link', function () { edit(task); }),
      button('删除', 'todo-link', async function () {
        if (await UI.confirm('删除这项待办？', '对应的提醒也会取消。', '删除')) {
          Store.state.todos = Store.state.todos.filter(function (item) { return item.id !== task.id; });
          save();
        }
      }));
    row.append(check, info, actions);
    return row;
  }

  function edit(task) {
    var fields = element('div', '', 'todo-fields');
    var title = element('input');
    title.type = 'text';
    title.maxLength = 160;
    title.placeholder = '要做什么？';
    title.value = task ? task.title : '';
    title.setAttribute('aria-label', '待办内容');
    var dateLabel = element('label', '提醒时间（留空则无时间限制）');
    var date = element('input');
    date.type = 'datetime-local';
    date.step = 60;
    if (task && task.dueAt) {
      var local = new Date(task.dueAt);
      date.value = new Date(task.dueAt - local.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }
    dateLabel.append(date);
    var clearDate = button('清空时间', 'todo-link todo-clear-date', function () { date.value = ''; });
    var error = element('p', '', 'todo-overdue');
    error.setAttribute('role', 'alert');
    fields.append(title, dateLabel, clearDate, error);
    UI.modal({
      title: task ? '编辑待办' : '新建待办',
      bodyNode: fields,
      actions: [
        { label: '取消', value: null },
        { label: '保存', cls: 'primary', onClick: function () {
          if (!title.value.trim()) { error.textContent = '请输入待办内容'; return false; }
          var dueAt = date.value ? new Date(date.value).getTime() : null;
          if (dueAt !== null && (!Number.isFinite(dueAt) || dueAt <= Date.now() && (!task || task.dueAt !== dueAt))) {
            error.textContent = '请选择以后的提醒时间，或清空时间。';
            return false;
          }
          return { title: title.value.trim(), dueAt: dueAt };
        } }
      ]
    }).then(function (result) {
      if (!result) return;
      if (!task) {
        task = { id: Store.uid('todo_'), doneAt: null };
        Store.state.todos.push(task);
      }
      if (task.dueAt !== result.dueAt) task.remindedAt = null;
      Object.assign(task, result, { updatedAt: Date.now() });
      save();
    });
  }

  function save() {
    Store.saveNow().then(refresh).catch(function () { UI.toast('待办保存失败，请重试'); });
    render();
  }

  function refresh() {
    if (!started) return;
    if (App.tab === 'todos') render();
    var timed = Store.state.todos.filter(function (task) { return !task.doneAt && task.dueAt; });
    if (bridge) {
      var payload = JSON.stringify(timed.map(function (task) {
        return { id: task.id, title: task.title, at: task.dueAt };
      }));
      if (payload !== lastPayload && bridge.replace(payload)) lastPayload = payload;
      return;
    }
    clearTimeout(timer);
    var now = Date.now();
    var next = Infinity;
    var ready = [];
    var changed = false;
    timed.forEach(function (task) {
      if (task.remindedAt === task.dueAt) return;
      if (task.dueAt > now) { next = Math.min(next, task.dueAt); return; }
      if (now - task.dueAt <= 600000) ready.push(task.title);
      task.remindedAt = task.dueAt;
      changed = true;
    });
    if (ready.length) UI.toast('待办提醒：' + ready.join('、'), 10000);
    if (changed) Store.saveNow().catch(function () { UI.toast('提醒记录保存失败'); });
    if (next < Infinity) timer = setTimeout(refresh, Math.min(2147483647, Math.max(0, next - Date.now())));
  }

  function init(openTodos) {
    started = true;
    document.getElementById('todo-add').addEventListener('click', function () { edit(null); });
    function resume() {
      refresh();
      if (bridge && bridge.consumeOpenTodos()) openTodos();
    }
    global.addEventListener('ruibu-reminders-resume', resume);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) resume(); });
    resume();
  }

  global.Todos = { init: init, render: render, refresh: refresh };
})(window);
