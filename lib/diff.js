/* Alamza Notes — diff engine.
 * Block-level LCS + word-level LCS inside changed blocks, plus an automatic
 * change summary used when the user leaves the version message blank.
 *
 *   ADiff.blocks(oldBlocks, newBlocks) -> rows[]
 *   ADiff.words(a, b)                  -> {left:[], right:[]}
 *   ADiff.summary(oldBlocks, newBlocks)-> "Added 2 headings, rewrote intro"
 */
(function () {
  function lcs(a, b, eq) {
    var n = a.length, m = b.length;
    var dp = [];
    for (var i = 0; i <= n; i++) dp.push(new Array(m + 1).fill(0));
    for (i = n - 1; i >= 0; i--)
      for (var j = m - 1; j >= 0; j--)
        dp[i][j] = eq(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    var out = [], x = 0, y = 0;
    while (x < n && y < m) {
      if (eq(a[x], b[y])) { out.push({ t: '=', a: a[x], b: b[y], ai: x, bi: y }); x++; y++; }
      else if (dp[x + 1][y] >= dp[x][y + 1]) { out.push({ t: '-', a: a[x], ai: x }); x++; }
      else { out.push({ t: '+', b: b[y], bi: y }); y++; }
    }
    while (x < n) { out.push({ t: '-', a: a[x], ai: x }); x++; }
    while (y < m) { out.push({ t: '+', b: b[y], bi: y }); y++; }
    return out;
  }

  /* `level` is part of what a toggle IS, so promoting one to a heading toggle
     reads as an edit rather than as no change at all */
  function sig(b) { return (b.type || 'p') + (b.level || '') + '\u0000' + (b.text || '') + '\u0000' + (b.checked ? 1 : 0); }
  function key(b) { return (b.type || 'p') + '\u0000' + (b.text || '').slice(0, 24); }

  function tokens(s) { return String(s || '').split(/(\s+)/).filter(function (t) { return t !== ''; }); }

  function words(a, b) {
    var ta = tokens(a), tb = tokens(b);
    var ops = lcs(ta, tb, function (x, y) { return x === y; });
    var left = [], right = [];
    ops.forEach(function (o) {
      if (o.t === '=') { left.push({ t: '=', s: o.a }); right.push({ t: '=', s: o.b }); }
      else if (o.t === '-') left.push({ t: '-', s: o.a });
      else right.push({ t: '+', s: o.b });
    });
    return { left: left, right: right };
  }

  /* Pair up -/+ runs into "changed" rows so we can show word-level diffs. */
  function blocks(oldB, newB) {
    var ops = lcs(oldB || [], newB || [], function (x, y) { return sig(x) === sig(y); });
    // second pass: match near-identical removed/added pairs
    var rows = [], i = 0;
    while (i < ops.length) {
      var o = ops[i];
      if (o.t === '-') {
        var dels = [], adds = [];
        while (i < ops.length && ops[i].t === '-') { dels.push(ops[i].a); i++; }
        while (i < ops.length && ops[i].t === '+') { adds.push(ops[i].b); i++; }
        var n = Math.max(dels.length, adds.length);
        for (var k = 0; k < n; k++) {
          var d = dels[k], a2 = adds[k];
          if (d && a2 && key(d) === key(a2)) rows.push({ t: '~', old: d, now: a2 });
          else if (d && a2) rows.push({ t: '~', old: d, now: a2 });
          else if (d) rows.push({ t: '-', old: d });
          else rows.push({ t: '+', now: a2 });
        }
        continue;
      }
      if (o.t === '+') { rows.push({ t: '+', now: o.b }); i++; continue; }
      rows.push({ t: '=', old: o.a, now: o.b }); i++;
    }
    return rows;
  }

  var LABEL = {
    h1: 'heading', h2: 'heading', h3: 'heading', p: 'paragraph', ul: 'list item',
    ol: 'list item', todo: 'to-do', quote: 'quote', callout: 'callout',
    divider: 'divider', code: 'code block', math: 'equation', toggle: 'toggle',
    subpage: 'sub-page', database: 'database'
  };

  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

  function summary(oldB, newB) {
    var rows = blocks(oldB, newB);
    var added = {}, removed = {}, changed = 0, nAdd = 0, nDel = 0;
    rows.forEach(function (r) {
      if (r.t === '+') { nAdd++; var l = LABEL[r.now.type] || 'block'; added[l] = (added[l] || 0) + 1; }
      else if (r.t === '-') { nDel++; var l2 = LABEL[r.old.type] || 'block'; removed[l2] = (removed[l2] || 0) + 1; }
      else if (r.t === '~') changed++;
    });
    if (!nAdd && !nDel && !changed) return 'No content changes';
    var parts = [];
    var addParts = Object.keys(added).map(function (k) { return plural(added[k], k); });
    if (addParts.length) parts.push('Added ' + addParts.slice(0, 2).join(' and '));
    if (changed) parts.push('revised ' + plural(changed, 'block'));
    var delParts = Object.keys(removed).map(function (k) { return plural(removed[k], k); });
    if (delParts.length) parts.push('removed ' + delParts.slice(0, 2).join(' and '));
    var s = parts.join(', ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function stats(oldB, newB) {
    var rows = blocks(oldB, newB), a = 0, d = 0, c = 0;
    rows.forEach(function (r) { if (r.t === '+') a++; else if (r.t === '-') d++; else if (r.t === '~') c++; });
    return { added: a, removed: d, changed: c, none: !a && !d && !c };
  }

  window.ADiff = { blocks: blocks, words: words, summary: summary, stats: stats };
})();
