/* Alamza Notes — diff engine.
 * Block-level LCS + word-level LCS inside changed blocks, plus an automatic
 * change summary used when the user leaves the version message blank.
 *
 *   ADiff.blocks(oldBlocks, newBlocks) -> rows[]
 *   ADiff.words(a, b)                  -> {left:[], right:[]}
 *   ADiff.summary(oldBlocks, newBlocks)-> "Added 2 headings, rewrote intro"
 *   ADiff.stats(oldBlocks, newBlocks)  -> {added, removed, changed, none}
 *   ADiff.flatten(blocks)              -> the tree as one list, each with __depth
 *
 * ===========================================================================
 * WHAT COUNTS AS A CHANGE
 *
 * Everything about a block except three things: its `id`, which is identity
 * rather than content; `collapsed`, which is whether the reader happens to
 * have a toggle open; and `comments`, which are an annotation layer with their
 * own panel and no place in a text diff.
 *
 * It used to be the opposite — `type + level + text + checked` and nothing
 * else — so the diff was blind to indentation, colour, a code block's
 * language, a callout's icon, which table a database block embeds, which page
 * a sub-page points at, every cell of a plain table, and the entire contents
 * of toggles and columns. That is not merely a display problem: `stats()` is
 * what createVersion asks whether anything has changed, so an edit the diff
 * could not see was an edit that could not be SNAPSHOTTED — the dialog said
 * "Nothing has changed since v3" over a page the reader had just rewritten
 * inside a toggle.
 *
 * The signature is derived from the block rather than enumerated, so a field
 * added later is covered by default. Keys are sorted on the way in: the same
 * block arrives with a different key order depending on whether it came from
 * the editor or back from the database, and unsorted JSON would call that a
 * rewrite. Empty values are dropped for the same reason — `color: ''` and no
 * colour at all are the same block.
 *
 * THE TREE IS FLATTENED FIRST. A toggle's children are blocks in their own
 * right, so they are diffed in their own right: the row that changed is the
 * child, at its own depth, not the toggle wrapped around it. Every caller
 * reads this same answer — the viewer, the +/- counts and the snapshot guard —
 * which is the only way the three can agree.
 *
 * COST. Both LCS passes are O(n*m) in time and memory and nothing bounded
 * them: one edited code block of a few thousand words took ~50 seconds and
 * over a gigabyte, which in a browser is a hung tab or a dead one. Two things
 * fix that, in this order:
 *   1. Trim the matching head and tail before the DP runs. Two versions of a
 *      page are nearly always the same document with a few lines different, so
 *      this is exact — not an approximation — and it is what makes the
 *      ordinary case linear.
 *   2. A ceiling on whatever is left. Past it the middle is reported as a
 *      straight replacement rather than matched line by line: a worse diff,
 *      but an instant one.
 */
(function () {
  /* the most DP cells either pass will allocate before giving up on matching */
  var MAX_CELLS = 1200000;

  /* JSON with the keys in a fixed order, so two blocks holding the same fields
     compare equal however they were built. */
  function stable(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    return '{' + Object.keys(v).sort().map(function (k) {
      return JSON.stringify(k) + ':' + stable(v[k]);
    }).join(',') + '}';
  }

  /* identity, view state and the annotation layer — see the note above */
  var SKIP = { id: 1, collapsed: 1, comments: 1, __depth: 1, children: 1, cols: 1 };
  function sig(b) {
    if (!b) return '';
    var o = {};
    Object.keys(b).forEach(function (k) {
      if (SKIP[k]) return;
      var v = b[k];
      /* an absent field and an empty one are the same block */
      if (v === undefined || v === null || v === '' || v === false || v === 0) return;
      o[k] = v;
    });
    o.type = b.type || 'p';                       // the one field with a default
    return stable(o);
  }
  /* how a removed and an added row are paired up into one "changed" row */
  function key(b) { return (b.type || 'p') + ' ' + String((b && b.text) || '').slice(0, 24); }

  /* The tree as one list. Each entry is a SHALLOW copy carrying its depth, so
     nothing downstream can mutate the caller's blocks and every row knows how
     far to indent. */
  function flatten(list, depth, out) {
    out = out || [];
    (list || []).forEach(function (b) {
      if (!b || typeof b !== 'object') return;
      var own = {};
      Object.keys(b).forEach(function (k) { if (k !== 'children' && k !== 'cols') own[k] = b[k]; });
      own.__depth = depth || 0;
      out.push(own);
      if (b.children) flatten(b.children, (depth || 0) + 1, out);
      if (b.cols) b.cols.forEach(function (c) { flatten(c, (depth || 0) + 1, out); });
    });
    return out;
  }

  /* the O(n*m) core, over runs whose matching ends have already been trimmed */
  function core(a, b, eq) {
    var n = a.length, m = b.length, out = [], i, j;
    if (!n && !m) return out;
    if (!n || !m || n * m > MAX_CELLS) {
      for (i = 0; i < n; i++) out.push({ t: '-', a: a[i] });
      for (j = 0; j < m; j++) out.push({ t: '+', b: b[j] });
      return out;
    }
    var dp = [];
    for (i = 0; i <= n; i++) dp.push(new Array(m + 1).fill(0));
    for (i = n - 1; i >= 0; i--)
      for (j = m - 1; j >= 0; j--)
        dp[i][j] = eq(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    var x = 0, y = 0;
    while (x < n && y < m) {
      if (eq(a[x], b[y])) { out.push({ t: '=', a: a[x], b: b[y] }); x++; y++; }
      else if (dp[x + 1][y] >= dp[x][y + 1]) { out.push({ t: '-', a: a[x] }); x++; }
      else { out.push({ t: '+', b: b[y] }); y++; }
    }
    while (x < n) { out.push({ t: '-', a: a[x] }); x++; }
    while (y < m) { out.push({ t: '+', b: b[y] }); y++; }
    return out;
  }

  function lcs(a, b, eq) {
    var n = a.length, m = b.length, out = [], i;
    var head = 0;
    while (head < n && head < m && eq(a[head], b[head])) head++;
    var tail = 0;
    while (tail < n - head && tail < m - head && eq(a[n - 1 - tail], b[m - 1 - tail])) tail++;
    for (i = 0; i < head; i++) out.push({ t: '=', a: a[i], b: b[i] });
    out = out.concat(core(a.slice(head, n - tail), b.slice(head, m - tail), eq));
    for (i = n - tail; i < n; i++) out.push({ t: '=', a: a[i], b: b[m - n + i] });
    return out;
  }

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
    /* the signature is precomputed ONCE per block: it is the comparison the DP
       makes in every cell, and deriving it from the block each time would put
       a deep serialisation inside an O(n*m) loop */
    var pre = function (list) {
      return flatten(list).map(function (b) { return { b: b, s: sig(b), k: key(b) }; });
    };
    var A = pre(oldB), B = pre(newB);
    var ops = lcs(A, B, function (x, y) { return x.s === y.s; });
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
          if (d && a2) rows.push({ t: '~', old: d.b, now: a2.b });
          else if (d) rows.push({ t: '-', old: d.b });
          else rows.push({ t: '+', now: a2.b });
        }
        continue;
      }
      if (o.t === '+') { rows.push({ t: '+', now: o.b.b }); i++; continue; }
      rows.push({ t: '=', old: o.a.b, now: o.b.b }); i++;
    }
    return rows;
  }

  var LABEL = {
    h1: 'heading', h2: 'heading', h3: 'heading', p: 'paragraph', ul: 'list item',
    ol: 'list item', todo: 'to-do', quote: 'quote', callout: 'callout',
    divider: 'divider', code: 'code block', math: 'equation', toggle: 'toggle',
    subpage: 'sub-page', database: 'database', table: 'table', columns: 'columns'
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

  window.ADiff = { blocks: blocks, words: words, summary: summary, stats: stats, flatten: flatten };
})();
