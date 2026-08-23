/* Alamza Notes — markdown engine.
 * The editable DOM holds the EXACT markdown source; marker characters are
 * wrapped in spans that are hidden or dimmed. textContent therefore always
 * round-trips to lossless markdown.
 *
 *   AMD.inline(text, showMarks)   -> html string (textContent === text)
 *   AMD.markMap(text)             -> which characters are hidden delimiters
 *   AMD.backspaceAt(text, at)     -> Backspace that respects those delimiters
 *   AMD.deleteAt(text, at)        -> the same, forwards
 *   AMD.wordBackAt / wordForwardAt -> whole-word delete, counted as the
 *                                    READER sees the word
 *   AMD.snapOut(text, at)         -> a caret offset moved out of a delimiter run
 *   AMD.hiddenBetween(text, a, b) -> do two offsets sit at the same place?
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

  /* An underscore inside a word is not emphasis: `snake_case_name` is a name,
     and hiding its underscores turned it into `snakecasename` on screen —
     the reader's own text quietly rewritten. CommonMark says the same thing.
     Asterisks are deliberately left alone: `a*b*c` is emphasis by that spec
     and in every editor that implements it. */
  function intraword(s, a, b) {
    return /\w/.test(s.charAt(a - 1)) || /\w/.test(s.charAt(b));
  }

  /* One scan, two readers. `inline` below turns these segments into tags; the
     editor turns them into a map of which characters are delimiters, because
     the last character of `**bold**` is not the last character the reader
     sees. Segments cover the text end to end with no gaps and no overlap, so
     concatenating their slices gives the source back unchanged. */
  function scan(text) {
    var s = String(text == null ? '' : text);
    var segs = [];
    function put(k, a, b, href) { if (b > a) segs.push({ k: k, s: a, e: b, href: href }); }

    var base = 0;
    // 1. split out code spans so nothing inside them is parsed
    var parts = s.split(/(`[^`\n]+`)/g);
    for (var pi = 0; pi < parts.length; pi++) {
      var part = parts[pi];
      if (/^`[^`\n]+`$/.test(part)) {
        put('mk', base, base + 1);
        put('code', base + 1, base + part.length - 1);
        put('mk', base + part.length - 1, base + part.length);
        base += part.length;
        continue;
      }
      var last = 0, m;
      RE.lastIndex = 0;
      while ((m = RE.exec(part))) {
        put('txt', base + last, base + m.index);
        var at = base + m.index, end = at + m[0].length, extra = 0;
        if (m[1] || m[3]) {
          /* `***both***` is bold AND italic. The `**` alternative matches
             `***both**` and leaves the last `*` behind, so the reader saw
             `*both*` set in bold — the delimiters showing through. Take the
             third delimiter off each end instead and render both marks. */
          var d3 = (m[1] || m[3]).charAt(0), in3 = m[1] ? m[2] : m[4], tail3 = m.index + m[0].length;
          var three = in3.length > 1 && in3.charAt(0) === d3 && in3.charAt(1) !== d3 &&
            part.charAt(tail3) === d3 && part.charAt(tail3 + 1) !== d3;
          extra = three ? 1 : 0;
          if (d3 === '_' && intraword(s, at, end + extra)) put('txt', at, end + extra);
          else if (three) { put('mk', at, at + 3); put('strongem', at + 3, end - 2); put('mk', end - 2, end + 1); }
          else { put('mk', at, at + 2); put('strong', at + 2, end - 2); put('mk', end - 2, end); }
        }
        else if (m[5]) {
          if (m[5] === '_' && intraword(s, at, end)) put('txt', at, end);
          else { put('mk', at, at + 1); put('em', at + 1, end - 1); put('mk', end - 1, end); }
        }
        else if (m[7] != null) { put('mk', at, at + 2); put('del', at + 2, end - 2); put('mk', end - 2, end); }
        else if (m[8] != null) { put('mk', at, at + 2); put('mark', at + 2, end - 2); put('mk', end - 2, end); }
        else if (m[9] != null) {
          var label = at + 1 + m[9].length;
          put('mk', at, at + 1); put('link', at + 1, label, m[10] || ''); put('mk', label, end);
        }
        last = m.index + m[0].length + extra;
        RE.lastIndex = last;
      }
      put('txt', base + last, base + part.length);
      base += part.length;
    }
    return segs;
  }

  function inline(text, showMarks) {
    var s = String(text == null ? '' : text);
    var mkStyle = showMarks ? 'color:var(--mk);font-weight:400;' : 'display:none;';
    var out = '';
    scan(s).forEach(function (g) {
      var raw = esc(s.slice(g.s, g.e));
      if (g.k === 'mk') out += '<span data-mk="1" style="' + mkStyle + '">' + raw + '</span>';
      else if (g.k === 'code') out += '<code style="' + CODE_S + '">' + raw + '</code>';
      else if (g.k === 'strong') out += '<strong>' + raw + '</strong>';
      else if (g.k === 'strongem') out += '<strong><em>' + raw + '</em></strong>';
      else if (g.k === 'em') out += '<em>' + raw + '</em>';
      else if (g.k === 'del') out += '<s style="opacity:.6">' + raw + '</s>';
      else if (g.k === 'mark') out += '<mark style="' + MARK_S + '">' + raw + '</mark>';
      else if (g.k === 'link') {
        out += '<a data-link="' + esc(g.href) + '" href="' + esc(g.href) + '" style="' + LINK_S + '">' +
          raw + '</a>';
      } else out += raw;
    });
    return out;
  }

  /* true at every index the reader cannot see — the delimiters §5.1 keeps in
     the DOM but hides */
  function markMap(text) {
    var s = String(text == null ? '' : text);
    var map = new Array(s.length);
    scan(s).forEach(function (g) {
      if (g.k !== 'mk') return;
      for (var i = g.s; i < g.e; i++) map[i] = true;
    });
    return map;
  }

  /* Is everything between `a` and `b` a hidden delimiter? Two offsets with
     only markers between them sit at the SAME place on screen, which is what
     lets the editor tell "the browser moved my caret across an invisible
     span" from "the reader moved it somewhere else". */
  function hiddenBetween(text, a, b) {
    var s = String(text == null ? '' : text);
    var lo = Math.min(a, b), hi = Math.max(a, b);
    if (hi <= lo || hi > s.length) return false;
    var mk = markMap(s);
    for (var i = lo; i < hi; i++) if (!mk[i]) return false;
    return true;
  }

  /* Move an offset out of a delimiter run it is STRICTLY inside, forward to
     the end of that run. Typing `**bold**` leaves the caret between the two
     closing asterisks — a position no reader can see and no structural
     operation should ever act on: splitting there produced `**bold***` on one
     side and `*…**` on the other. Offsets merely NEXT to a run are left alone;
     they are honest positions. */
  function snapOut(text, at) {
    var s = String(text == null ? '' : text);
    var i = Math.max(0, Math.min(s.length, at == null ? s.length : at));
    if (i <= 0 || i >= s.length) return i;
    var mk = markMap(s);
    if (!(mk[i - 1] && mk[i])) return i;
    while (i < s.length && mk[i]) i++;
    return i;
  }

  /* Backspace, told where the invisible characters are.
     At the end of `**bold**` the caret sits behind two hidden asterisks, so a
     plain delete ate one of them and the whole run lost its formatting — the
     reader pressed ⌫ once and watched `bold` turn into `**bold*`. Delete the
     last character the reader can actually SEE instead, and when that empties
     the run, drop the delimiters with it rather than leave `****` behind.

     Returns {text, caret} to apply, {atStart:true} when only delimiters sit
     between the caret and column 0 (visually the caret IS at the start, so the
     block-level Backspace belongs there), or null when the block holds nothing
     invisible at all and the browser can be left to it. */
  var CLOSERS = ['```', '**', '__', '~~', '==', '`', '*', '_'];

  /* One rule for "the character was the last thing inside its run": drop the
     empty pair rather than leave `****` (or `[](url)`) behind. Shared, so ⌫,
     ⌦ and the word deletes can never disagree about it. */
  function collapsePair(head, rest) {
    for (var go = true; go;) {
      go = false;
      for (var p = 0; p < CLOSERS.length; p++) {
        var d = CLOSERS[p];
        if (head.slice(-d.length) === d && rest.slice(0, d.length) === d) {
          head = head.slice(0, head.length - d.length);
          rest = rest.slice(d.length);
          go = true;
          break;
        }
      }
      var link = /^\]\([^)\s]*\)/.exec(rest);
      if (link && head.slice(-1) === '[') {
        head = head.slice(0, -1); rest = rest.slice(link[0].length); go = true;
      }
    }
    return { head: head, rest: rest };
  }

  /* Whether the block holds anything invisible at all. If it does not, the
     browser cannot get a delete wrong and keeps the key. If it does, we take
     every press — Chromium removes a `display:none` span TOGETHER with the
     character next to it, so handing an "ordinary" character back was never
     safe next to a hidden delimiter. */
  function anyHidden(mk, len) {
    for (var q = 0; q < len; q++) if (mk[q]) return true;
    return false;
  }

  /* One visible character back / forward. null means there is none — every
     character on that side is a delimiter, so the caret is visually already
     at that end of the block. */
  function hiddenCount(s) {
    var mk = markMap(s), n = 0;
    for (var i = 0; i < s.length; i++) if (mk[i]) n++;
    return n;
  }

  /* Deleting the character at the edge of a run leaves whitespace against its
     delimiter — take `text` out of `**bold text**` and `**bold **` is left,
     which CommonMark does not read as emphasis, so the run breaks and its
     asterisks appear on screen. The whitespace belongs OUTSIDE the run:
     moving it across the delimiter leaves the reader's words in exactly the
     same order and makes the run whole again.

     Only the delimiter the deletion actually touched is considered, and the
     swap is kept only if it genuinely hides more — markMap says how much,
     so this cannot quietly turn someone's literal asterisks into emphasis. */
  function tidyEdge(head, rest, caret) {
    var before = hiddenCount(head + rest);
    for (var d = 0; d < CLOSERS.length; d++) {
      var k = CLOSERS[d];
      var wb = /\s+$/.exec(head);
      if (wb && rest.slice(0, k.length) === k) {           // …WS | D…  ->  …D WS…
        var c1 = head.slice(0, head.length - wb[0].length) + k + wb[0] + rest.slice(k.length);
        if (hiddenCount(c1) > before)
          return { text: c1, caret: caret > head.length - wb[0].length ? caret + k.length : caret };
      }
      var wa = /^\s+/.exec(rest);
      if (wa && head.slice(-k.length) === k) {             // …D | WS…  ->  …WS D…
        var c2 = head.slice(0, head.length - k.length) + wa[0] + k + rest.slice(wa[0].length);
        if (hiddenCount(c2) > before)
          return { text: c2, caret: caret > head.length - k.length ? caret + wa[0].length : caret };
      }
    }
    return { text: head + rest, caret: caret };
  }

  function back1(s, i) {
    var mk = markMap(s), del = i - 1;
    if (mk[del]) { while (del >= 0 && mk[del]) del--; if (del < 0) return null; }
    var g = collapsePair(s.slice(0, del), s.slice(del + 1));
    return tidyEdge(g.head, g.rest, g.head.length);
  }

  function fwd1(s, i) {
    var mk = markMap(s), del = i;
    while (del < s.length && mk[del]) del++;
    if (del >= s.length) return null;
    var g = collapsePair(s.slice(0, del), s.slice(del + 1));
    /* the caret stays where it was — unless closing an empty pair took
       characters out from behind it, in which case it lands where they were */
    return tidyEdge(g.head, g.rest, Math.min(i, g.head.length));
  }

  function backspaceAt(text, at) {
    var s = String(text == null ? '' : text);
    var i = Math.max(0, Math.min(s.length, at == null ? s.length : at));
    if (!i) return null;
    if (!anyHidden(markMap(s), s.length)) return null;
    return back1(s, i) || { atStart: true };
  }

  /* Everything backspaceAt does, forwards. Chromium eats a `display:none` span
     together with the character on EITHER side of it, so ⌦ over the `m` of
     `==mark==` took the opening `==` with it and left `ark==` showing as
     literal text — the same fault as ⌫, and the only reason it went unnoticed
     is that ⌦ is the rarer key.

     Returns {text, caret}, or {atEnd:true} when nothing but delimiters lies
     ahead (visually the caret IS at the end of the block, so the caller's
     merge-with-the-next-block rule belongs there), or null when the block
     holds nothing invisible and the browser can be left to it. */
  function deleteAt(text, at) {
    var s = String(text == null ? '' : text);
    var i = Math.max(0, Math.min(s.length, at == null ? 0 : at));
    if (i >= s.length) return null;
    if (!anyHidden(markMap(s), s.length)) return null;
    return fwd1(s, i) || { atEnd: true };
  }

  /* ---- whole-word delete (⌃/⌥ + ⌫ or ⌦) --------------------------------
     A word is what the READER sees, not what the source holds: `**bold**` is
     four characters to them and eight to the file, so counting in the source
     would have taken the delimiters for letters and stopped mid-run. The
     boundary is therefore measured on the visible projection — skip any
     whitespace, then take the run of word characters, or the run of
     punctuation if that is what is there — and the deletion is that many
     SINGLE steps. Reusing one step at a time is the whole point: emptying a
     run drops its delimiters by exactly the rule one keystroke already
     follows, so a word delete can never leave half a pair behind. */
  function wordSpan(vis, back) {
    var k = 0, n = vis.length;
    var ch = function (j) { return back ? vis[n - 1 - j] : vis[j]; };
    while (k < n && /\s/.test(ch(k))) k++;
    if (k < n) {
      var word = /\w/.test(ch(k));
      while (k < n && !/\s/.test(ch(k)) && /\w/.test(ch(k)) === word) k++;
    }
    return k;
  }

  function visibleSide(s, mk, from, to) {
    var vis = [];
    for (var q = from; q < to; q++) if (!mk[q]) vis.push(s.charAt(q));
    return vis;
  }

  function wordBackAt(text, at) {
    var s = String(text == null ? '' : text);
    var i = Math.max(0, Math.min(s.length, at == null ? s.length : at));
    if (!i) return null;
    var mk = markMap(s);
    var vis = visibleSide(s, mk, 0, i);
    if (!vis.length) return { atStart: true };
    var k = wordSpan(vis, true), cur = s, pos = i;
    for (var n = 0; n < k; n++) {
      var r = back1(cur, pos);
      if (!r) break;
      cur = r.text; pos = r.caret;
    }
    return { text: cur, caret: pos };
  }

  function wordForwardAt(text, at) {
    var s = String(text == null ? '' : text);
    var i = Math.max(0, Math.min(s.length, at == null ? 0 : at));
    if (i >= s.length) return null;
    var mk = markMap(s);
    var vis = visibleSide(s, mk, i, s.length);
    if (!vis.length) return { atEnd: true };
    var k = wordSpan(vis, false), cur = s, pos = i;
    for (var n = 0; n < k; n++) {
      var r = fwd1(cur, pos);
      if (!r) break;
      cur = r.text; pos = r.caret;
    }
    return { text: cur, caret: pos };
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
        case 'toggle': {
          /* A heading toggle keeps its level in the summary. `# ` would be
             read as plain text inside an HTML block, so the heading is written
             as the tag it is. */
          var sum = b.level ? '<h' + b.level + '>' + (b.text || '') + '</h' + b.level + '>' : (b.text || '');
          out.push('<details>\n<summary>' + sum + '</summary>\n\n' +
            toMarkdown(b.children || [], ctx).trim() + '\n\n</details>');
          break;
        }
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
        /* `_` and `__` never OPEN inside a word, or ⏎ in the middle of
           `snake_case_name` closed a run that was never open and handed back
           `snake_c_` above `_ase_name` — underscores the reader never typed */
        if (mk.charAt(0) === '_' && open[open.length - 1] !== mk && /\w/.test(s.charAt(i - 1))) continue;
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

  /* Where does an offset fall relative to a link? `[label](url)` is one word
     to the reader but four pieces of syntax to the parser, and only the label
     has caret positions in it at all. */
  function linkAt(text, at) {
    var segs = scan(text);
    for (var n = 0; n < segs.length; n++) {
      var g = segs[n];
      if (g.k !== 'link') continue;
      var cl = segs[n + 1];                       // the `](url)` that follows it
      var end = cl && cl.k === 'mk' ? cl.e : g.e;
      if (at > g.s - 1 && at < end)
        return { open: g.s - 1, ls: g.s, le: g.e, end: end, href: g.href || '' };
    }
    return null;
  }

  function splitMarked(text, at) {
    var s = String(text == null ? '' : text);
    var i = Math.max(0, Math.min(s.length, at == null ? s.length : at));

    /* ---- a cut inside a link -------------------------------------------
       Splitting the label used to leave `see [my ` above and
       `link](http://x.y) end` below — raw syntax in both blocks. Close the
       link on the head and reopen it on the tail, so both halves stay links,
       which is what Notion does. A cut on either EDGE of the label keeps the
       link whole rather than making an empty one, and a cut inside `](url)`
       — a place no reader can put a caret — moves past the link. */
    var lk = linkAt(s, i);
    if (lk) {
      if (i === lk.ls) i = lk.open;               // just after `[`: link moves down
      else if (i >= lk.le) i = lk.end;            // inside `](url)`: link stays up
      else {
        /* Inside a live label nothing ELSE is live — scan() does not parse
           emphasis inside a link — so any `*` or `==` in there is ordinary
           text and openRuns must not touch it. */
        return { head: s.slice(0, i) + '](' + lk.href + ')', tail: '[' + s.slice(i) };
      }
    }

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
    markMap: markMap, backspaceAt: backspaceAt, deleteAt: deleteAt,
    hiddenBetween: hiddenBetween, snapOut: snapOut,
    wordBackAt: wordBackAt, wordForwardAt: wordForwardAt,
    toMarkdown: toMarkdown, fromMarkdown: fromMarkdown,
    dbToMarkdown: dbToMarkdown, tableToMarkdown: tableToMarkdown
  };
})();
