(function (global) {
  'use strict';

  var providers = {
    deepseek: { name: 'DeepSeek', model: 'deepseek-flash' },
    openai: { name: 'OpenAI · GPT', model: 'gpt-5.4-mini' },
    anthropic: { name: 'Anthropic · Claude', model: 'claude-sonnet-4-6' },
    doubao: { name: '火山方舟 · 豆包', model: 'doubao-seed-2-1-pro-260915' },
    xai: { name: 'xAI · Grok', model: 'grok-4.3' }
  };
  var AI = { providers: providers, busy: false, history: [] };
  var LS_PROFILES = 'ruibu.ai.profiles';
  var LS_PROVIDER = 'ruibu.ai.provider';
  var LS_HIST = 'ruibu.ai.history';

  function read(k, fallback) {
    try { return localStorage.getItem(k) || fallback; } catch (e) { return fallback; }
  }
  function write(k, value) {
    try { localStorage.setItem(k, value); } catch (e) { }
  }
  function json(k, fallback) {
    try { return JSON.parse(read(k, 'null')) || fallback; } catch (e) { return fallback; }
  }

  function active() {
    var id = read(LS_PROVIDER, 'deepseek');
    return Object.hasOwn(providers, id) ? id : 'deepseek';
  }
  function select(id) {
    if (Object.hasOwn(providers, id)) write(LS_PROVIDER, id);
  }
  function config(id) {
    id = id || active();
    var profile = json(LS_PROFILES, {})[id];
    if (!profile && id === 'deepseek') {
      var model = read('ruibu.ai.model', '');
      if (model === 'deepseek-chat' || model === 'deepseek-reasoner') model = 'deepseek-flash';
      profile = { key: read('ruibu.ai.key', ''), model: model };
    }
    return { provider: id, key: (profile && profile.key) || '', model: (profile && profile.model) || providers[id].model };
  }
  function save(id, key, model) {
    var profiles = json(LS_PROFILES, {});
    profiles[id] = { key: key.trim(), model: model.trim() || providers[id].model };
    write(LS_PROFILES, JSON.stringify(profiles));
  }

  function claudePayload(model, messages) {
    var system = messages.filter(function (m) { return m.role === 'system'; }).map(function (m) { return m.content; });
    var content = messages.filter(function (m) { return m.role === 'user' || m.role === 'assistant'; }).map(function (m) {
      var blocks = m.content;
      if (Array.isArray(blocks)) {
        blocks = blocks.map(function (part) {
          if (part.type === 'text') return part;
          var image = /^data:(image\/(?:jpeg|png|gif|webp));base64,([a-zA-Z0-9+/=]+)$/.exec(part.image_url && part.image_url.url || '');
          if (!image) return null;
          return { type: 'image', source: { type: 'base64', media_type: image[1], data: image[2] } };
        }).filter(Boolean);
      }
      return { role: m.role, content: blocks };
    });
    return { model: model, system: system.join('\n'), messages: content, max_tokens: 4096 };
  }

  async function chat(messages, settings) {
    settings = settings || config();
    var provider = settings.provider;
    var model = settings.model;
    if (!settings.key) return { ok: false, error: '先在设置里填写 ' + providers[provider].name + ' 的 API Key' };
    var payload = provider === 'anthropic' ? claudePayload(model, messages) : { model: model, messages: messages, stream: false };
    // DeepSeek 的思考模式需要在多轮请求中回传推理字段。这里使用普通对话。
    if (provider === 'deepseek') payload.thinking = { type: 'disabled' };
    try {
      var response = await fetch('api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: provider, key: settings.key, payload: payload })
      });
      var result = await response.json();
      if (!response.ok || result.error) {
        var error = result.error && (result.error.message || result.error);
        return { ok: false, error: response.status === 401 ? 'API Key 无效或已失效' : String(error || ('HTTP ' + response.status)) };
      }
      var answer = provider === 'anthropic'
        ? (result.content || []).filter(function (block) { return block.type === 'text'; }).map(function (block) { return block.text; }).join('\n')
        : result.choices && result.choices[0] && result.choices[0].message.content;
      if (typeof answer !== 'string' || !answer.trim()) return { ok: false, error: '模型没有返回文字' };
      return { ok: true, text: answer.trim(), model: result.model || model, usage: result.usage };
    } catch (err) {
      return { ok: false, error: '无法从本机 AI 服务读取响应，请检查网络和服务状态' };
    }
  }

  AI.config = config;
  AI.active = active;
  AI.select = select;
  AI.save = save;
  AI.hasKey = function () { return !!config().key; };
  AI.chat = chat;
  AI.label = function (id, model) { return (providers[id] || providers.deepseek).name + (model ? ' · ' + model : ''); };
  AI.toNoteText = function (question, answer) { return (question ? 'Q：' + question.trim() + '\n' : '') + answer.trim(); };
  AI.loadHistory = function () {
    var history = json(LS_HIST, []);
    AI.history = Array.isArray(history) ? history : [];
  };
  AI.saveHistory = function () { write(LS_HIST, JSON.stringify(AI.history.slice(-40))); };
  AI.clearHistory = function () { AI.history = []; write(LS_HIST, '[]'); };
  global.AI = AI;
})(window);
