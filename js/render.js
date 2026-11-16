/* =========================================================
 * render.js —— 极简富文本渲染
 *  · **粗体**
 *  · #标签（行内高亮，不吞掉原文）
 *  · - 列表 / 1. 列表
 *  · 数学公式：$$…$$、$…$，以及「裸写的 LaTeX」\dfrac{dy}{dx}
 * 依赖：vendor/katex（离线，缺了会优雅降级成原文）
 * ========================================================= */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function hasKatex() {
    return !!(global.katex && global.katex.renderToString);
  }

  function renderMath(tex, display) {
    if (!hasKatex()) return esc(tex);
    try {
      return global.katex.renderToString(tex, {
        displayMode: !!display,
        throwOnError: false,
        strict: 'ignore',
        output: 'html'
      });
    } catch (e) {
      return esc(tex);
    }
  }

  /* 从 pos 开始吃掉 {…} 组（支持嵌套一层）与 ^ _ 参数，返回结束位置 */
  function consumeArgs(s, pos) {
    var i = pos;
    var guard = 0;
    while (i < s.length && guard++ < 12) {
      var c = s[i];
      if (c === '{') {
        var depth = 0, j = i;
        for (; j < s.length; j++) {
          if (s[j] === '{') depth++;
          else if (s[j] === '}') { depth--; if (depth === 0) { j++; break; } }
        }
        if (depth !== 0) return i;
        i = j;
      } else if (c === '^' || c === '_') {
        i++;
        if (s[i] === '{') continue;
        i += 1;
      } else if (c === ' ') {
        // 名字后面直接跟空格就结束（\cdot 这类零参命令）
        break;
      } else {
        break;
      }
    }
    return i;
  }

  /* 把「裸写的 LaTeX」切成公式 token：
     例如 "1. 一阶导数写成 \dfrac{dy}{dx}" */
  function splitBareMath(text) {
    var out = [];
    var buf = '';
    var i = 0;
    while (i < text.length) {
      var c = text[i];
      if (c === '\\' && /[a-zA-Z]/.test(text[i + 1] || '')) {
        var m = /^\\[a-zA-Z]+/.exec(text.slice(i));
        if (m) {
          var end = consumeArgs(text, i + m[0].length);
          if (end > i + m[0].length) {
            if (buf) { out.push({ t: 'text', v: buf }); buf = ''; }
            out.push({ t: 'math', v: text.slice(i, end) });
            i = end;
            continue;
          }
        }
      }
      buf += c;
      i++;
    }
    if (buf) out.push({ t: 'text', v: buf });
    return out;
  }

  /* 先把 $…$ / $$…$$ 抽出来，再处理裸 LaTeX */
  function tokenize(text) {
    var tokens = [];
    var re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
    var last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) tokens = tokens.concat(splitBareMath(text.slice(last, m.index)));
      tokens.push({ t: 'math', v: (m[1] !== undefined ? m[1] : m[2]), display: m[1] !== undefined });
      last = m.index + m[0].length;
    }
    if (last < text.length) tokens = tokens.concat(splitBareMath(text.slice(last)));
    return tokens;
  }

  function inlineText(str) {
    var html = esc(str);
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/#([^\s#，。,.!?、:：;；()（）\[\]【】<>]+)/g,
      '<span class="inline-tag">#$1</span>');
    return html;
  }

  function inlinePart(str) {
    return inlineText(str);
  }

  /** 渲染一段文字（可含换行）为 HTML */
  function inline(text) {
    if (!text) return '';
    // 先按行处理列表前缀，再逐行做数学/粗体/标签，避免「2.」和后面的公式被拆开
    var lines = String(text).split('\n');
    var html = lines.map(function (line) {
      var m = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/.exec(line);
      var mark = '', body = line;
      if (m) {
        mark = m[2];
        body = m[3];
      }
      var inner = '';
      tokenize(body).forEach(function (tk) {
        if (tk.t === 'math') inner += renderMath(tk.v, tk.display);
        else inner += inlinePart(tk.v);
      });
      if (!mark) return inner;
      return '<span class="md-li"><span class="md-li-mark">' + esc(mark) + '</span>' + inner + '</span>';
    });
    return html.join('<br>');
  }

  /** 纯文本预览：去掉标记，用于卡片摘要 */
  function plain(text, max) {
    var s = String(text || '')
      .replace(/\$\$([\s\S]+?)\$\$/g, ' $1 ')
      .replace(/\$([^$\n]+?)\$/g, ' $1 ')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    if (max && s.length > max) s = s.slice(0, max) + '…';
    return s;
  }

  /** 卡片摘要：把 LaTeX 命令换成可读的近似写法 */
  function prettyPlain(text, max) {
    var s = plain(text, 0)
      .replace(/\\dfrac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)')
      .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)')
      .replace(/\\[a-zA-Z]+/g, '')
      .replace(/[{}]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (max && s.length > max) s = s.slice(0, max) + '…';
    return s;
  }

  /** 渲染一个文字块：文字（含 markdown/公式）+ 行内图片 + 行内标签板块 */
  function rich(items) {
    if (!items || !items.length) return '';
    var html = '', buf = '';
    function flush() {
      if (buf) { html += inline(buf); buf = ''; }
    }
    items.forEach(function (it) {
      if (!it) return;
      if (it.t === 'text') { buf += it.v || ''; return; }
      if (it.t === 'tag') {
        flush();
        html += '<span class="inline-tag" data-tag="' + esc(it.v) + '">#' + esc(it.v) + '</span>';
        return;
      }
      if (it.t === 'img') {
        flush();
        var w = it.w || 130;
        var src = (global.Store && global.Store.getImage) ? global.Store.getImage(it.imageId) : '';
        html += '<span class="inline-img" data-iid="' + esc(it.imageId) + '" style="width:' + w + 'px">' +
          '<img src="' + esc(src) + '" draggable="false" alt=""></span>';
        return;
      }
    });
    flush();
    return html;
  }

  global.RUIBU = {
    esc: esc,
    inline: inline,
    rich: rich,
    plain: plain,
    prettyPlain: prettyPlain,
    hasKatex: hasKatex
  };
})(window);
