/* Alamza Notes — markdown engine.
 * The editable DOM holds the EXACT markdown source; marker characters are
 * wrapped in spans that are hidden or dimmed. textContent therefore always
 * round-trips to lossless markdown.
 *
 *   AMD.inline(text, showMarks)   -> html string (textContent === text)
 *   AMD.toMarkdown(blocks, ctx)   -> full markdown document
 *   AMD.fromMarkdown(md)          -> blocks[]
 */
(function () {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  var CODE_S = 'font-family:var(--mono);font-size:.88em;background:var(--code-bg);' +
    'border:1px solid var(--border);border-radius:4px;padding:.1em .32em;';
  var MARK_S = 'background:var(--hl);border-radius:3px;padding:.05em .15em;color:inherit;';
  var LINK_S = 'color:var(--accent);text-decoration:underline;text-underline-offset:2px;' +
    'text-decoration-color:color-mix(in srgb,var(--accent) 40%,transparent);cursor:pointer;';

  /* Emphasis, strike, highlight and links — code spans are handled before this
     runs, so `a*b*c` can never turn into italics. */
  var RE = /(\*\*)(?=\S)([\s\S]*?\S)\1|(__)(?=\S)([\s\S]*?\S)\3|(\*|_)(?=\S)([^*_\n]*?\S)\5|~~([\s\S]*?)~~|==([\s\S]*?)==|\[([^\]\n]*)\]\(([^)\s]*)\)/g;

  function inline(text, showMarks) {
    var s = String(text == null ? '' : text);
    var mkStyle = showMarks ? 'color:var(--mk);font-weight:400;' : 'display:none;';
    function mk(t) { return '<span data-mk="1" style="' + mkStyle + '">' + esc(t) + '</span>'; }

    var out = '';
    // 1. split out code spans so nothing inside them is parsed
    var parts = s.split(/(`[^`\n]+`)/g);
    for (var pi = 0; pi < parts.length; pi++) {
      var part = parts[pi];
      if (/^`[^`\n]+`$/.test(part)) {
        out += mk('`') + '<code style="' + CODE_S + '">' + esc(part.slice(1, -1)) + '</code>' + mk('`');
        continue;
      }
      var last = 0, m;
      RE.lastIndex = 0;
      while ((m = RE.exec(part))) {
        out += esc(part.slice(last, m.index));
        if (m[1]) out += mk('**') + '<strong>' + esc(m[2]) + '</strong>' + mk('**');
        else if (m[3]) out += mk('__') + '<strong>' + esc(m[4]) + '</strong>' + mk('__');
        else if (m[5]) out += mk(m[5]) + '<em>' + esc(m[6]) + '</em>' + mk(m[5]);
        else if (m[7] != null) out += mk('~~') + '<s style="opacity:.6">' + esc(m[7]) + '</s>' + mk('~~');
        else if (m[8] != null) out += mk('==') + '<mark style="' + MARK_S + '">' + esc(m[8]) + '</mark>' + mk('==');
        else if (m[9] != null) {
          var href = m[10] || '';
          out += mk('[') +
            '<a data-link="' + esc(href) + '" href="' + esc(href) + '" style="' + LINK_S + '">' +
            esc(m[9]) + '</a>' + mk('](' + href + ')');
        }
        last = m.index + m[0].length;
      }
      out += esc(part.slice(last));
    }
    return out;
  }

  function stripMarks(text) {
    return String(text || '')
      .replace(/\*\*([\s\S]*?)\*\*/g, '$1')
      .replace(/__([\s\S]*?)__/g, '$1')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/~~([\s\S]*?)~~/g, '$1')
      .replace(/==([\s\S]*?)==/g, '$1')
      .replace(/\[([^\]\n]*)\]\(([^)\s]*)\)/g, '$1');
  }

  /* --------------------------------------------------------- serialisation */
  function pad(n) { return new Array((n || 0) + 1).join('  '); }
  function softPad(n) { return new Array(Math.min(n || 0, 1) + 1).join('  '); }

  function tableToMarkdown(b) {
    var rows = b.rows || [];
    if (!rows.length) return '';
    var esc2 = function (c) { return String(c == null ? '' : c).replace(/\|/g, '\\|'); };
    var head = '| ' + rows[0].map(esc2).join(' | ') + ' |';
    var sep = '| ' + rows[0].map(function () { return '---'; }).join(' | ') + ' |';
    var body = rows.slice(1).map(function (r) { return '| ' + r.map(esc2).join(' | ') + ' |'; });
    return [head, sep].concat(body).join('\n');
  }

  function dbToMarkdown(db) {
    if (!db) return '';
    var props = db.props || [];
    var head = '| ' + props.map(function (p) { return p.name; }).join(' | ') + ' |';
    var sep = '| ' + props.map(function () { return '---'; }).join(' | ') + ' |';
    var rows = (db.rows || []).map(function (r) {
      return '| ' + props.map(function (p) {
        var v = r.cells ? r.cells[p.id] : '';
        if (Array.isArray(v)) v = v.join(', ');
        if (p.type === 'checkbox') v = v ? 'x' : '';
        return String(v == null ? '' : v).replace(/\|/g, '\\|');
      }).join(' | ') + ' |';
    });
    return ['**' + (db.name || 'Database') + '**', '', head, sep].concat(rows).join('\n');
  }

  var TIGHT = { ul: 1, ol: 1, todo: 1 };

  function toMarkdown(blocks, ctx) {
    ctx = ctx || {};
    var out = [];
    var tight = [];
    var counters = {};
    (blocks || []).forEach(function (b) {
      var ind = pad(b.indent);
      var soft = softPad(b.indent);
      tight.push(!!TIGHT[b.type]);
      if (b.type !== 'ol') counters = {};
      switch (b.type) {
        case 'h1': out.push(soft + '# ' + b.text); break;
        case 'h2': out.push(soft + '## ' + b.text); break;
        case 'h3': out.push(soft + '### ' + b.text); break;
        case 'ul': out.push(ind + '- ' + b.text); break;
        case 'ol':
          counters[b.indent || 0] = (counters[b.indent || 0] || 0) + 1;
          out.push(ind + counters[b.indent || 0] + '. ' + b.text); break;
        case 'todo': out.push(ind + '- [' + (b.checked ? 'x' : ' ') + '] ' + b.text); break;
        case 'quote': out.push(soft + '> ' + b.text); break;
        case 'callout': out.push(soft + '> ' + (b.icon || '💡') + ' ' + b.text); break;
        case 'divider': out.push('---'); break;
        case 'code': out.push('```' + (b.lang || '') + '\n' + (b.text || '') + '\n```'); break;
        case 'math': out.push('$$\n' + (b.text || '') + '\n$$'); break;
        case 'table': out.push(tableToMarkdown(b)); break;
        case 'columns':
          out.push((b.cols || []).map(function (col) { return toMarkdown(col, ctx).trim(); })
            .filter(Boolean).join('\n\n'));
          break;
        case 'toggle':
          out.push('<details>\n<summary>' + (b.text || '') + '</summary>\n\n' +
            toMarkdown(b.children || [], ctx).trim() + '\n\n</details>');
          break;
        case 'subpage': {
          var p = ctx.pages && ctx.pages[b.pageId];
          out.push(soft + '- [' + ((p && p.icon) || '📄') + ' ' + ((p && p.title) || 'Untitled') +
            '](#/page/' + b.pageId + ')');
          break;
        }
        case 'database': out.push(dbToMarkdown(ctx.dbs && ctx.dbs[b.dbId])); break;
        default: out.push(soft + (b.text || ''));
      }
    });
    var doc = '';
    out.forEach(function (line, i) {
      if (i) doc += (tight[i] && tight[i - 1]) ? '\n' : '\n\n';
      doc += line;
    });
    return doc.replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
  }

  /* ------------------------------------------------------------- parsing */
  var uid = function () { return 'b' + Math.random().toString(36).slice(2, 9); };

  function splitRow(line) {
    return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '')
      .split(/(?<!\\)\|/).map(function (c) { return c.trim().replace(/\\\|/g, '|'); });
  }

  function fromMarkdown(md) {
    var lines = String(md || '').replace(/\r/g, '').split('\n');
    var blocks = [], i = 0;
    function push(type, text, extra) {
      blocks.push(Object.assign({ id: uid(), type: type, text: text || '', indent: 0 }, extra || {}));
    }
    while (i < lines.length) {
      var l = lines[i];
      var fence = l.match(/^```(\w*)\s*$/);
      if (fence) {
        var buf = []; i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++; push('code', buf.join('\n'), { lang: fence[1] || 'plaintext' }); continue;
      }
      if (/^\$\$\s*$/.test(l)) {
        var mb = []; i++;
        while (i < lines.length && !/^\$\$\s*$/.test(lines[i])) { mb.push(lines[i]); i++; }
        i++; push('math', mb.join('\n')); continue;
      }
      /* markdown table -> table block */
      if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        var trows = [splitRow(l)];
        i += 2;
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { trows.push(splitRow(lines[i])); i++; }
        push('table', '', { rows: trows });
        continue;
      }
      if (!l.trim()) { i++; continue; }
      var m;
      if ((m = l.match(/^\s{0,3}(#{1,3})\s+(.*)$/))) push('h' + m[1].length, m[2]);
      else if (/^(-{3,}|\*{3,})\s*$/.test(l)) push('divider', '');
      else if ((m = l.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/)))
        push('todo', m[3], { indent: Math.floor(m[1].length / 2), checked: /[xX]/.test(m[2]) });
      else if ((m = l.match(/^(\s*)[-*+]\s+(.*)$/)))
        push('ul', m[2], { indent: Math.floor(m[1].length / 2) });
      else if ((m = l.match(/^(\s*)\d+[.)]\s+(.*)$/)))
        push('ol', m[2], { indent: Math.floor(m[1].length / 2) });
      else if ((m = l.match(/^\s{0,3}>\s*(.*)$/))) {
        var em = m[1].match(/^(\p{Extended_Pictographic}|\[!\w+\])\s+(.*)$/u);
        if (em) push('callout', em[2], { icon: em[1].indexOf('[') === 0 ? '💡' : em[1] });
        else push('quote', m[1]);
      }
      else push('p', l.trim());
      i++;
    }
    if (!blocks.length) push('p', '');
    return blocks;
  }

  /* Split `text` at `at`, keeping every inline run well-formed: any delimiter
     pair the cut falls inside is closed on the head and reopened on the tail.
     Returns {head, tail}. */
  var PAIRS = ['```', '**', '__', '~~', '==', '`', '*', '_'];

  function openRuns(s) {
    var open = [], i = 0;
    while (i < s.length) {
      if (s[i] === '\\') { i += 2; continue; }
      var hit = null;
      for (var p = 0; p < PAIRS.length; p++) {
        var mk = PAIRS[p];
        if (s.substr(i, mk.length) !== mk) continue;
        /* a single * or _ must sit against non-space to open emphasis */
        if ((mk === '*' || mk === '_') && open[open.length - 1] !== mk) {
          var nx = s[i + mk.length];
          if (!nx || /\s/.test(nx)) continue;
        }
        hit = mk; break;
      }
      if (!hit) { i++; continue; }
      if (open[open.length - 1] === hit) open.pop();
      else open.push(hit);
      i += hit.length;
    }
    return open;
  }

  function splitMarked(text, at) {
    var s = String(text == null ? '' : text);
    var i = Math.max(0, Math.min(s.length, at == null ? s.length : at));
    var head = s.slice(0, i), tail = s.slice(i);
    var open = openRuns(head);
    if (!open.length) return { head: head, tail: tail };

    /* ---- HEAD: close every open run, innermost first ----
       A closing `*`/`**` may not sit after whitespace or CommonMark leaves it
       as literal text, so trailing space is peeled off, the closers are added
       against the last real character, and the space is put back after. */
    var hm = head.match(/\s+$/);
    var hTrail = hm ? hm[0] : '';
    var hCore = hTrail ? head.slice(0, head.length - hTrail.length) : head;
    for (var k = open.length - 1; k >= 0; k--) {
      var mk = open[k];
      /* the opener is the very last thing: the run is empty, so drop the
         opener instead of emitting `****` */
      if (hCore.slice(-mk.length) === mk) hCore = hCore.slice(0, hCore.length - mk.length);
      else hCore += mk;
    }
    head = hCore + hTrail;

    /* ---- TAIL: reopen the same runs ----
       Any closer the tail already begins with belonged to a run we just closed
       on the head, so it is consumed rather than reopened. */
    var tCore = tail, keep = [];
    for (var j = open.length - 1; j >= 0; j--) {
      var mk2 = open[j];
      if (tCore.slice(0, mk2.length) === mk2) tCore = tCore.slice(mk2.length);
      else keep.unshift(mk2); // unshift keeps outermost-first order
    }
    /* an opener may not be followed by whitespace either */
    var tm = tCore.match(/^\s+/);
    var tLead = tm ? tm[0] : '';
    if (tLead) tCore = tCore.slice(tLead.length);
    tail = tLead + (tCore ? keep.join('') + tCore : '');

    return { head: head, tail: tail };
  }

  window.AMD = {
    inline: inline, esc: esc, stripMarks: stripMarks, splitMarked: splitMarked,
    toMarkdown: toMarkdown, fromMarkdown: fromMarkdown,
    dbToMarkdown: dbToMarkdown, tableToMarkdown: tableToMarkdown
  };
})();
