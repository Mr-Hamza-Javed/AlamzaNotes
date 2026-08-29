/* Alamza Notes — Tools — undo, caret, marks, share, icons, lasso, stats
 *
 * Methods of the app class, moved out verbatim. They run on the same
 * instance as everything in index.dc.html: `this.state`, `this.setState`,
 * `this.props` and every other method are all available here.
 * Registered onto Component.prototype by lib/parts.js.
 */
/* How much history is kept: steps for one page, pages held at once, and a
   ceiling on all of it together. Twelve pages is enough to cover moving
   between a note, a sub-page and a database row and back without losing the
   ability to undo on any of them. */
var HIST_STEPS = 350, HIST_PAGES = 12, HIST_BYTES = 24e6;
/* How long a pause separates one undo step from the next. Everything that
   writes through the DOM files on this timer, so it is what decides how much a
   single ⌘Z takes back. Longer means fewer, larger steps. */
var HIST_PAUSE = 1800;
/* A run also ends after this many keystrokes, however fast they arrive. The
   pause alone is not enough: type a whole paragraph without stopping for two
   seconds and the lot would be one undo step, so one ⌘Z would take the whole
   paragraph. Roughly a line of prose is a reasonable thing to lose at once. */
var HIST_RUN_KEYS = 80;

AlamzaParts.register(class {
  /* ---------------------------------------------------------- readonly */
  readHtml(blocks) {
    const ctx = { pages: this.state.pages, dbs: this.state.dbs };
    const out = [];
    (blocks || []).forEach(b => {
      const t = b.type, txt = AMD.inline(b.text || '', false);
      const ind = 'margin-left:' + ((b.indent || 0) * 24) + 'px;';
      if (t === 'h1') out.push('<h2 style="font-size:28px;font-weight:700;letter-spacing:-.018em;margin:34px 0 8px;line-height:1.25">' + txt + '</h2>');
      else if (t === 'h2') out.push('<h3 style="font-size:21px;font-weight:700;margin:28px 0 6px;line-height:1.3">' + txt + '</h3>');
      else if (t === 'h3') out.push('<h4 style="font-size:17px;font-weight:700;margin:22px 0 4px">' + txt + '</h4>');
      else if (t === 'ul') out.push('<div style="display:flex;gap:8px;margin:3px 0;' + ind + '"><span>•</span><span>' + txt + '</span></div>');
      else if (t === 'ol') out.push('<div style="display:flex;gap:8px;margin:3px 0;' + ind + '"><span style="color:var(--muted)">–</span><span>' + txt + '</span></div>');
      else if (t === 'todo') out.push('<div style="display:flex;gap:9px;margin:3px 0;' + ind + '"><span>' + (b.checked ? '☑' : '☐') + '</span><span style="opacity:' + (b.checked ? .55 : 1) + '">' + txt + '</span></div>');
      else if (t === 'quote') out.push('<blockquote style="margin:14px 0;padding-left:16px;border-left:3px solid var(--text);font-family:var(--serif);font-size:18px">' + txt + '</blockquote>');
      else if (t === 'callout') out.push('<div style="display:flex;gap:10px;margin:14px 0;padding:14px;border-radius:5px;background:var(--soft);border:1px solid var(--border)"><span>' + (b.icon || '💡') + '</span><span>' + txt + '</span></div>');
      else if (t === 'divider') out.push('<div style="height:1px;background:var(--border);margin:26px 0"></div>');
      else if (t === 'code') {
        let code = AMD.esc(b.text || '');
        try { if (window.hljs) code = window.hljs.highlight(b.text || '', { language: b.lang || 'plaintext', ignoreIllegals: true }).value; } catch (e) {}
        out.push('<pre style="margin:16px 0;padding:14px;border-radius:5px;background:var(--code-bg);border:1px solid var(--border);overflow-x:auto"><code style="font-family:var(--mono);font-size:13px;line-height:1.6">' + code + '</code></pre>');
      } else if (t === 'math') {
        let m = AMD.esc(b.text || '');
        try { if (window.katex) m = window.katex.renderToString(b.text || '', { displayMode: true, throwOnError: false }); } catch (e) {}
        out.push('<div style="margin:18px 0;text-align:center">' + m + '</div>');
      } else if (t === 'toggle') {
        /* the reader gets the heading toggle's size too, or a collapsed
           section that titles a chapter reads as body text */
        const ts = b.level ? 'font-size:' + ['28px', '21px', '17px'][b.level - 1] + ';font-weight:700;' : 'font-weight:500;';
        out.push('<details style="margin:' + (b.level ? '24px 0 8px' : '10px 0') + '"><summary style="cursor:pointer;' + ts + '">' + txt + '</summary><div style="padding:8px 0 0 20px">' + this.readHtml(b.children || []) + '</div></details>');
      } else if (t === 'table') {
        const rows = b.rows || [];
        if (rows.length) {
          const head = '<tr>' + rows[0].map(c => '<th style="text-align:left;padding:8px 12px;font-size:12.5px;font-weight:600;background:var(--soft);border-bottom:1px solid var(--border)">' + AMD.esc(c) + '</th>').join('') + '</tr>';
          const body = rows.slice(1).map(r => '<tr>' + r.map(c => '<td style="padding:8px 12px;font-size:14px;border-bottom:1px solid var(--border)">' + AMD.esc(c) + '</td>').join('') + '</tr>').join('');
          out.push('<div style="margin:18px 0;border:1px solid var(--border);border-radius:5px;overflow:auto"><table style="width:100%;border-collapse:collapse">' + head + body + '</table></div>');
        }
      } else if (t === 'columns') {
        const cols = (b.cols || []).map(col =>
          '<div style="flex:1;min-width:0;border-left:1px solid var(--border);padding-left:14px">' + this.readHtml(col) + '</div>').join('');
        out.push('<div style="display:flex;gap:20px;margin:16px 0;align-items:flex-start;flex-wrap:wrap">' + cols + '</div>');
      } else if (t === 'subpage') {
        const p = this.state.pages[b.pageId];
        out.push('<a data-link="#/page/' + AMD.esc(b.pageId) + '" href="#/page/' + AMD.esc(b.pageId) +
          '" style="display:flex;align-items:center;gap:10px;margin:6px 0;padding:9px 11px;border-radius:5px;border:1px solid var(--border);text-decoration:none;color:inherit">' +
          '<span style="flex:none">' + ((p && p.icon) || PAGE_SVG) + '</span>' +
          '<span style="font-weight:500;text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--border)">' +
          AMD.esc((p && p.title) || 'Untitled') + '</span></a>');
      } else if (t === 'database') {
        const d = this.state.dbs[b.dbId];
        if (d) {
          const head = '<tr>' + d.props.map(p => '<th style="text-align:left;padding:8px 12px;font-size:12px;color:var(--muted);border-bottom:1px solid var(--border)">' + AMD.esc(p.name) + '</th>').join('') + '</tr>';
          /* rows may not be fetched yet — emit the header rather than throw */
          const body = (d.rows || []).map(r => '<tr>' + d.props.map(p => {
            let v = r.cells[p.id]; if (Array.isArray(v)) v = v.join(', ');
            if (p.type === 'checkbox') v = v ? '☑' : '☐';
            return '<td style="padding:8px 12px;font-size:13.5px;border-bottom:1px solid var(--border)">' + AMD.esc(v == null ? '' : v) + '</td>';
          }).join('') + '</tr>').join('');
          out.push('<div style="margin:18px 0;border:1px solid var(--border);border-radius:6px;overflow:auto"><table style="width:100%;border-collapse:collapse">' + head + body + '</table></div>');
        }
      } else out.push('<p style="margin:9px 0;line-height:1.75">' + txt + '</p>');
    });
    return out.join('');
  }

  /* ------------------------------------------------------- undo / redo
     History belongs to the page the work was done on, and it has to survive
     leaving that page. There used to be one history object keyed by page id,
     so opening anything else threw the previous page's away — and since
     opening a sub-page or a database row NAVIGATES, the very act of making one
     destroyed the history of the page you made it on.

     Each page keeps its own record now, the twelve most recently visited are
     held, and the least recently visited is dropped first. */
  histFor(only) {
    const p = this.page(), id = only || (p && p.id);
    if (!this._hists) { this._hists = {}; this._histLru = []; }
    if (!id) return (this._hist = { stack: [], idx: -1 });   // nowhere to file: a scratch record
    if (!this._hists[id]) this._hists[id] = { stack: [], idx: -1 };
    const k = this._histLru.indexOf(id);
    if (k >= 0) this._histLru.splice(k, 1);
    this._histLru.push(id);
    while (this._histLru.length > HIST_PAGES) delete this._hists[this._histLru.shift()];
    /* the page in hand, also reachable as `_hist` because that is what nearly
       every caller means */
    return (this._hist = this._hists[id]);
  }
  /* History covers the databases embedded in the page as well as its blocks,
     so ⌘Z undoes a row reorder, a cell edit or a property change too.

     Blocks and databases are kept as SEPARATE strings. A database is by far
     the heavier of the two — on a 400-row table it is the entire snapshot,
     with the blocks a rounding error — and it usually does not move at all
     while someone types, so an entry whose databases match the one before it
     keeps that same string rather than a second copy of the same characters. */
  histJson(only) {
    const p = only ? this.state.pages[only] : this.page();
    /* a body that has not arrived is not an empty page, and must never be
       filed as one */
    if (!p || !p.blocks) return null;
    return { b: JSON.stringify({ b: p.blocks, t: p.title, i: p.icon || '' }),
             d: JSON.stringify(this.dbsUsedBy(p.blocks) || null) };
  }
  /* `own` says the caller is filing a change THIS page just made.

     A database is shared: the same one is edited from the page it sits on and
     from inside every row opened as its own page. A passive snapshot — the one
     taken when typing pauses, or on the way into ⌘Z — that differs only in its
     databases is therefore recording someone else's work, and filing it would
     put a step in this page's history that this page never took. The next ⌘Z
     would undo a stranger's edit.

     Deliberate database edits all arrive through `patchDb`, which says so, and
     anything that adds or removes a database block changes the blocks too. So
     a db-only difference with no `own` is always foreign, and is left out of
     the history — which also keeps rows arriving from storage out of it. */
  syncTail(own, only) {
    const h = this.histFor(only), j = this.histJson(only); if (!j) return;
    const top = h.idx >= 0 ? h.stack[h.idx] : null;
    if (top && top.b === j.b && top.d === j.d) return;
    if (top && top.b === j.b && !own) return;
    if (top && top.d === j.d) j.d = top.d;               // share, do not copy
    h.stack = h.stack.slice(0, h.idx + 1);
    h.stack.push(j);
    h.idx = h.stack.length - 1;
    this.histTrim();
  }
  /* Steps per page, pages kept, and a ceiling on the lot. The byte count adds
     up each entry's own two strings, so a database shared between entries is
     counted more than once — the budget is deliberately conservative rather
     than exact, and trims a little sooner than it strictly must. */
  histTrim() {
    const size = (h) => h.stack.reduce((n, e) => n + e.b.length + e.d.length, 0);
    let bytes = this._histLru.reduce((n, id) => n + (this._hists[id] ? size(this._hists[id]) : 0), 0);
    /* whole pages go first, least recently visited first */
    while (bytes > HIST_BYTES && this._histLru.length > 1) {
      const id = this._histLru.shift(), old = this._hists[id];
      if (old) bytes -= size(old);
      delete this._hists[id];
    }
    const cur = this._hists[this._histLru[this._histLru.length - 1]];
    if (!cur) return;
    while (cur.stack.length > HIST_STEPS || (cur.stack.length > 2 && bytes > HIST_BYTES)) {
      const e = cur.stack.shift();
      bytes -= e.b.length + e.d.length;
      cur.idx = Math.max(0, cur.idx - 1);
    }
  }
  /* Nothing here may write in a view the reader is not allowed to edit — a
     version preview, a page sitting in the Trash, a published page someone is
     only reading. `_mutate` has always checked; `applyHist` never did, so ⌘Z
     and ⌘Y went straight past it into `setState` and edited the document
     anyway. The check belongs on the function that WRITES, so no future caller
     can slip past it, and again on the two keys so that nothing is filed on
     the way in and no toast claims an edit that never happened. */
  /* ---- the two halves of a debounced history entry ----------------------
     `mutate` files on BOTH sides of a structural change, so every such edit
     has a state behind it to step back to. The writers that go through the DOM
     instead — typing, ⌫/⌦, the code block — cannot do that: filing per
     keystroke would pack the stack with single characters, so they file once
     the reader pauses. That left the run itself with no "before". On a freshly
     opened page the stack was empty, so the first thing anyone typed could not
     be undone at all: `undo()` needs a step behind the current one, and there
     was none.

     `histMark()` files that "before" exactly once per run — the pending timer
     is what says a run is already under way — and `histLater()` files the
     result on the pause. The timer carries the page it belongs to, so a run
     still pending when the reader navigates away cannot file itself into
     whatever page is open by the time it fires. */
  histMark() {
    if (!this._histT) { this.syncTail(); this._runN = 0; return; }
    /* the run is long enough to be more than one edit: close it here and let
       the keystrokes that follow begin the next one */
    if (++this._runN >= HIST_RUN_KEYS) { this.syncTail(); this._runN = 0; }
  }
  /* A page property the reader changes deliberately — the icon — filed on both
     sides, the way a structural edit is. `patchPage` itself has to stay out of
     the history: every mutation writes blocks through it, and the title files
     its own runs on a pause, so filing there would double up on both. */
  patchPageHist(id, patch) {
    this.syncTail(false, id);
    this.patchPage(id, patch, true);
    setTimeout(() => this.syncTail(false, id), 0);
  }
  /* Anything still on a debounce belongs to the page it was typed on. Leaving
     that page used to be the moment it was lost; now that the history is kept,
     it is filed on the way out instead. */
  histFlush() {
    if (!this._histT && !this._titleT) return;
    clearTimeout(this._histT); this._histT = null;
    clearTimeout(this._titleT); this._titleT = null;
    this.syncTail();
  }
  histLater() {
    clearTimeout(this._histT);
    const pid = this.state.pageId;
    this._histT = setTimeout(() => {
      this._histT = null;
      if (this.state.pageId === pid) this.syncTail();
    }, HIST_PAUSE);
  }
  /* ---- restoring a database ---------------------------------------------
     Undo means "go back one step", not "make everything look the way it did
     then". For blocks the two are the same thing: a page's blocks are edited
     only from that page, so putting the snapshot back is exactly right.

     A database is not like that. The same database is edited from the page it
     sits on AND from inside every row opened as its own page, so replacing it
     with the snapshot's copy silently threw away work done in the other place
     — set a property from inside a row page, go back to the host, press ⌘Z on
     something unrelated, and the property was gone with no way to tell.

     So only what this STEP changed is applied. `from` is the database as it
     stood at the step being left, `to` as it stood at the step being entered:
     any field where those two agree was not touched by this step and keeps
     whatever it holds now. Fields are compared one level at a time — the
     database's own fields, then the row list, then each row's cells — because
     a whole-object comparison would call the entire database "changed" the
     moment one cell moved. */
  dbDelta(live, from, to) {
    if (!from && !to) return live;
    const out = Object.assign({}, live), seen = {};
    Object.keys(from || {}).concat(Object.keys(to || {})).forEach(k => { seen[k] = 1; });
    Object.keys(seen).forEach(id => {
      const f = (from || {})[id], t = (to || {})[id];
      if (JSON.stringify(f) === JSON.stringify(t)) return;   // this step left it alone
      if (!t) return;                                        // the target never held it
      out[id] = out[id] ? this.dbMerge(out[id], f, t) : JSON.parse(JSON.stringify(t));
    });
    return out;
  }
  dbMerge(live, from, to) {
    const d = Object.assign({}, live), f = from || {};
    Object.keys(to).forEach(k => {
      if (k === 'rows') return;
      if (JSON.stringify(f[k]) !== JSON.stringify(to[k])) d[k] = JSON.parse(JSON.stringify(to[k]));
    });
    const fRows = f.rows || [], tRows = to.rows || [], cRows = live.rows || [];
    const index = (list) => { const m = {}; (list || []).forEach(r => { m[r.id] = r; }); return m; };
    const fm = index(fRows), tm = index(tRows), cm = index(cRows);
    const order = (list) => list.map(r => r.id).join('\u0000');
    /* Which rows exist, and in what order, is one fact about the whole list —
       so it moves only if this step moved it. When it did, the target's list
       wins its shape while each surviving row still merges cell by cell. */
    d.rows = order(fRows) !== order(tRows)
      ? tRows.map(r => (cm[r.id] ? this.rowMerge(cm[r.id], fm[r.id], tm[r.id]) : JSON.parse(JSON.stringify(r))))
      : cRows.map(r => (tm[r.id] ? this.rowMerge(r, fm[r.id], tm[r.id]) : r));
    return d;
  }
  rowMerge(live, from, to) {
    if (!to) return live;
    const r = Object.assign({}, live), f = from || {};
    Object.keys(to).forEach(k => {
      if (k === 'cells') return;
      if (JSON.stringify(f[k]) !== JSON.stringify(to[k])) r[k] = to[k];
    });
    const fc = f.cells || {}, tc = to.cells || {}, cells = Object.assign({}, live.cells), seen = {};
    Object.keys(fc).concat(Object.keys(tc)).forEach(k => { seen[k] = 1; });
    Object.keys(seen).forEach(k => {
      if (JSON.stringify(fc[k]) === JSON.stringify(tc[k])) return;  // untouched by this step
      if (tc[k] === undefined) delete cells[k]; else cells[k] = tc[k];
    });
    r.cells = cells;
    return r;
  }

  /* A sub-page lives in two places at once: a block on the host page, and a
     page in the workspace. A snapshot carries only the blocks, so undo put the
     block back and left its page in the Trash — a block pointing at a trashed
     page — and, the other way, took the block away and left the page behind,
     sitting in the sidebar with nothing pointing at it.

     Only the sub-pages this STEP moves are reconciled, never the whole set: a
     page the reader trashed from the sidebar still has its block on the host,
     and must not be resurrected by an unrelated undo. */
  subPages(blocks) {
    const out = [];
    const walk = (list) => (list || []).forEach(b => {
      if (b.type === 'subpage' && b.pageId) out.push(b.pageId);
      if (b.children) walk(b.children);
      if (b.cols) b.cols.forEach(walk);
    });
    walk(blocks);
    return out;
  }

  /* Every block in the tree, flattened, each with a signature of ITSELF —
     children are visited in their own right, so a change inside a toggle
     points at the child that changed rather than at the toggle around it. */
  histFlat(blocks, out) {
    out = out || [];
    (blocks || []).forEach(b => {
      out.push({ id: b.id, sig: JSON.stringify(Object.assign({}, b, { children: undefined, cols: undefined })) });
      if (b.children) this.histFlat(b.children, out);
      if (b.cols) b.cols.forEach(c => this.histFlat(c, out));
    });
    return out;
  }
  /* Which block the reader should be looking at once this step is applied.
     An undo whose effect is off screen looks like a key that did nothing, so
     the changed block is brought into view and flashed.

     A block the step changes or brings back exists afterwards and is the
     obvious target. A step that only REMOVES leaves nothing to point at, so
     the nearest block that survives on either side of the gap is used. */
  histFocusId(fromBlocks, toBlocks) {
    const a = this.histFlat(fromBlocks), b = this.histFlat(toBlocks);
    const am = {}, bm = {};
    a.forEach(x => { am[x.id] = x.sig; });
    b.forEach(x => { bm[x.id] = x.sig; });
    for (let i = 0; i < b.length; i++) if (am[b[i].id] !== b[i].sig) return b[i].id;
    let gap = -1;
    for (let i = 0; i < a.length; i++) if (bm[a[i].id] === undefined) { gap = i; break; }
    if (gap < 0) return null;
    for (let i = gap - 1; i >= 0; i--) if (bm[a[i].id] !== undefined) return a[i].id;
    for (let i = gap + 1; i < a.length; i++) if (bm[a[i].id] !== undefined) return a[i].id;
    return null;
  }

  applyHist(i) {
    const h = this.histFor(), p = this.page();
    if (!p || this.isReadOnly() || i < 0 || i >= h.stack.length) return;
    /* the step being LEFT, needed to tell what this move actually changes */
    const from = h.idx >= 0 && h.stack[h.idx] ? JSON.parse(h.stack[h.idx].d) : null;
    h.idx = i;
    const snap = JSON.parse(h.stack[i].b), snapD = JSON.parse(h.stack[i].d);
    const focus = this.histFocusId(p.blocks, snap.b);
    const had = this.subPages(p.blocks), has = this.subPages(snap.b);
    const back = has.filter(x => had.indexOf(x) < 0);   // this step brings them back
    const away = had.filter(x => has.indexOf(x) < 0);   // this step takes them away
    this._els = {}; this._refs = {}; this._mathEls = {}; this._mathRefs = {};
    this.setState(s => {
      const pages = { ...s.pages };
      pages[p.id] = Object.assign({}, pages[p.id], { blocks: snap.b, title: snap.t, icon: snap.i || '', updatedAt: Date.now() });
      back.forEach(x => { const g = pages[x]; if (g && g.trashed) pages[x] = Object.assign({}, g, { trashed: false }); });
      away.forEach(x => { const g = pages[x]; if (g && !g.trashed) pages[x] = Object.assign({}, g, { trashed: Date.now() }); });
      return { pages, dbs: this.dbDelta(s.dbs, from, snapD), blockSel: [] };
    }, () => {
      this.persist();
      /* `nearest` so a block already on screen does not jump; the flash is
         what tells the reader which one moved */
      if (focus) this.flashBlock(focus, { block: 'nearest', ms: 900, climb: true });
    });
  }
  /* Both keys begin by filing whatever is still pending. Typing files its
     history on a pause, so a character struck a moment ago is not in
     the stack yet — and `applyHist` overwrites the page wholesale, so anything
     unfiled at that moment is simply gone. `undo()` has always guarded against
     this; `redo()` never did, and it destroyed that typing outright: undo a
     step, type, press ⌘Y, and what you typed had never existed.

     `syncTail()` is a no-op when nothing has changed, so a redo with nothing
     pending still walks forward exactly as before. When something HAS changed
     it is filed, which takes the forward stack with it — the same rule any new
     edit has always followed, and the reason a new edit kills redo. */
  /* Whether either key would do anything — the menus read this to dim
     themselves, and the keys read it to explain when nothing happens.

     Pending work counts for undo: a run still on its timer is filed by the key
     itself before it steps, so undo IS available at the bottom of the stack
     when something is waiting to be recorded. It does not count for redo,
     because filing pending work is exactly what discards the forward stack —
     and in that case the key says so rather than doing nothing in silence. */
  canUndo() {
    if (this.isReadOnly()) return false;
    const h = this.histFor();
    return h.idx > 0 || (h.idx === 0 && !!(this._histT || this._titleT));
  }
  canRedo() {
    if (this.isReadOnly()) return false;
    const h = this.histFor();
    return h.idx >= 0 && h.idx < h.stack.length - 1;
  }
  undo() {
    if (this.isReadOnly()) return;
    this.syncTail();
    const h = this.histFor();
    if (h.idx > 0) { this.applyHist(h.idx - 1); this.toast('Undo'); }
    else this.toast('Nothing to undo');
  }
  redo() {
    if (this.isReadOnly()) return;
    this.syncTail();
    const h = this.histFor();
    if (h.idx < h.stack.length - 1) { this.applyHist(h.idx + 1); this.toast('Redo'); }
    else this.toast('Nothing to redo');
  }

  /* --------------------------------------------------- structural fixes */
  isAncestor(aid, bid) {
    const f = this.locate(aid); if (!f) return false;
    let found = false;
    const walk = (list) => (list || []).forEach(x => {
      if (x.id === bid) found = true;
      if (x.children) walk(x.children);
      if (x.cols) x.cols.forEach(walk);
    });
    walk(f.block.children || []);
    (f.block.cols || []).forEach(walk);
    return found;
  }
  repair(bs) {
    const list = bs || [];
    /* indexed, not forEach: the orphan rule below inserts into the very list
       being walked, and the inserted blocks must be repaired in their turn */
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.type === 'toggle' && (!b.children || !b.children.length)) b.children = [{ id: uid('b'), type: 'p', text: '', indent: 0 }];
      if (b.type === 'columns') b.cols = (b.cols || []).map(c => (c && c.length) ? c : [{ id: uid('b'), type: 'p', text: '', indent: 0 }]);
      /* Only a toggle has an inside. Nothing walks `children` for any other
         type, so a toggle that stopped being one — from the ⠿ menu's Turn
         into, from a markdown shortcut typed in its title, or from ⌫ at its
         start — took its contents off the page AND out of the markdown export
         while they sat on in the file, whole and unreachable. The three doors
         are one rule, so it belongs here rather than at each of them: what was
         inside the toggle becomes what follows it. The blank child repair()
         itself guarantees above is dropped rather than lifted, so emptying a
         toggle and turning it into text leaves no litter behind. */
      if (b.type !== 'toggle' && b.children) {
        const kept = b.children.filter(c => c && !(
          (!c.type || c.type === 'p') && !(c.text || '').trim() && !c.children && !c.cols));
        delete b.children;
        if (kept.length) list.splice(i + 1, 0, ...kept);
      }
      if (b.children) this.repair(b.children);
      if (b.cols) b.cols.forEach(c => this.repair(c));
    }
    return list;
  }
  mergePrev(id) {
    const f = this.locate(id); if (!f || f.i === 0) return false;
    const prev = f.list[f.i - 1];
    /* R1 — a sub-page or database is a real object; Backspace must never delete
       it. Select it instead, so the ⠿ menu (or Delete) is the only way out. */
    if (prev.type === 'subpage' || prev.type === 'database') {
      this.setState({ blockSel: [prev.id] });
      const el = this._els[id]; if (el) el.blur();
      return true;
    }
    const solid = ['divider', 'table', 'math', 'code'];
    if (solid.indexOf(prev.type) >= 0) { this.setState({ blockSel: [prev.id] }); return true; }
    const at = (prev.text || '').length;
    this.mutate(bs => {
      const g = this.locate(id, bs); if (!g || g.i === 0) return;
      const pv = g.list[g.i - 1];
      pv.text = (pv.text || '') + (g.block.text || '');
      g.list.splice(g.i, 1);
    });
    setTimeout(() => { const el = this._els[prev.id]; if (el) { el.focus(); setCaret(el, at); } }, 20);
    return true;
  }
  removeAt(id) { this.mutate(bs => { const f = this.locate(id, bs); if (f) f.list.splice(f.i, 1); }); }

  /* ------------------------------------------------------- caret column */
  caretX() {
    const s = window.getSelection();
    if (!s || !s.rangeCount) return null;
    const r = s.getRangeAt(0).cloneRange(); r.collapse(true);
    const rects = r.getClientRects();
    if (rects.length) return rects[0].left;
    const el = s.anchorNode && s.anchorNode.parentElement;
    return el ? el.getBoundingClientRect().left : null;
  }
  caretToX(el, x, atEnd) {
    el.focus();
    if (x == null || !document.caretRangeFromPoint) { setCaret(el, atEnd ? (el.textContent || '').length : 0); return; }
    const rect = el.getBoundingClientRect();
    const y = atEnd ? rect.bottom - 6 : rect.top + 6;
    const r = document.caretRangeFromPoint(Math.max(rect.left + 1, Math.min(x, rect.right - 1)), y);
    if (r && el.contains(r.startContainer)) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
    else setCaret(el, atEnd ? (el.textContent || '').length : 0);
  }

  /* ------------------------------------------------- inline mark helpers */
  applyMark(mk) {
    const id = this.state.focusId; if (!id) return;
    this.wrapSel(id, mk);
  }
  setBlockColor(id, key, val) {
    this.mutate(bs => { const f = this.locate(id, bs); if (f) f.block[key] = val || undefined; });
    this.setState({ menu: null });
  }

  /* Search is opened from three places — ⌘K, the sidebar button and the
     workspace menu — so it is a method, not a closure built inside renderVals.
     It used to exist only as a renderVals key, which left both JS call sites
     throwing "not a function" and the keyboard shortcut dead. */
  openSearch() { this.setState({ modal: { kind: 'search' }, search: '' }); }

  /* ------------------------------------------------------- block anchors */  copyBlockLink(id) {
    const url = location.origin + location.pathname + '#/page/' + this.state.pageId + '/' + id;
    navigator.clipboard.writeText(url).then(() => this.toast('Link to block copied'));
    this.setState({ menu: null });
  }
  /* The element a block is drawn in, or — with `climb` — the nearest ancestor
     that IS drawn. A block inside a collapsed toggle renders nothing at all,
     and taking the reader to the toggle is better than taking them nowhere;
     expanding it would be an edit they did not ask for. */
  blockHost(id, climb) {
    let at = id, hops = 0;
    while (at && hops++ < 12) {
      const el = this._els[at] || document.querySelector('[data-bid="' + at + '"]');
      const host = el && (el.closest ? el.closest('[data-block]') : el);
      if (host) return host;
      if (!climb) return null;
      const f = this.locate(at);
      at = f && f.parent ? f.parent.id : null;
    }
    return null;
  }
  flashBlock(id, how) {
    setTimeout(() => {
      const host = this.blockHost(id, how && how.climb);
      if (!host) return;
      if (host.scrollIntoView) host.scrollIntoView({ block: (how && how.block) || 'center' });
      if (host.animate) host.animate(
        [{ background: 'var(--accent-soft)' }, { background: 'var(--accent-soft)', offset: .7 }, { background: 'transparent' }],
        { duration: (how && how.ms) || 1200, easing: 'ease-out' });
    }, 80);
  }

  /* ------------------------------------------- changed-since-last-version */
  changedIds() {
    const p = this.page();
    if (!p || !this.state.prefs.showChanges) return {};
    const vs = p.versions || []; if (!vs.length) return {};
    const key = p.id + ':' + vs.length + ':' + (p.updatedAt || 0);
    if (this._chKey === key) return this._chIds;
    const rows = ADiff.blocks(vs[vs.length - 1].blocks, p.blocks);
    const map = {};
    rows.forEach(r => { if (r.t === '+' && r.now) map[r.now.id] = 'new'; else if (r.t === '~' && r.now) map[r.now.id] = 'edit'; });
    this._chKey = key; this._chIds = map;
    return map;
  }

  /* ---------------------------------------------------------- table block */
  tableEdit(id, ri, ci, val) {
    this.mutate(bs => { const f = this.locate(id, bs); if (f && f.block.rows[ri]) f.block.rows[ri][ci] = val; });
  }
  tableAdd(id, what) {
    this.mutate(bs => {
      const f = this.locate(id, bs); if (!f) return;
      const rows = f.block.rows;
      if (what === 'row') rows.push(rows[0].map(() => ''));
      else rows.forEach((r, i) => r.push(i === 0 ? 'Column ' + (r.length + 1) : ''));
    });
  }
  tableDel(id, what, at) {
    this.mutate(bs => {
      const f = this.locate(id, bs); if (!f) return;
      const rows = f.block.rows;
      if (what === 'row' && rows.length > 2) rows.splice(at, 1);
      if (what === 'col' && rows[0].length > 1) rows.forEach(r => r.splice(at, 1));
    });
    this.setState({ menu: null });
  }

  commentCount() {
    let n = 0;
    const walk = (list) => (list || []).forEach(b => {
      n += (b.comments || []).length;
      if (b.children) walk(b.children);
      if (b.cols) b.cols.forEach(walk);
    });
    walk(this.activeBlocks());
    return n;
  }
  addComment(blockId, text) {
    if (!text || !text.trim()) return;
    if (!this.canComment()) { this.toast('You only have view access to this page'); return; }
    /* A commenter may add comments even though the page body is read-only to
       them — but not while previewing an old version or a trashed page. */
    const p = this.page();
    const allow = this.myRole() === 'commenter' && !this.state.roVersion && !(p && p.trashed);
    this.mutate(bs => {
      const f = this.locate(blockId, bs); if (!f) return;
      f.block.comments = (f.block.comments || []).concat([{
        id: uid('c'), author: (this.state.user && this.state.user.name) || 'You',
        text: text.trim(), at: Date.now(), resolved: false
      }]);
    }, { allowInReadOnly: allow });
    this.setState({ draft: '' });
  }
  resolveComment(blockId, cid) {
    const p = this.page();
    const allow = this.myRole() === 'commenter' && !this.state.roVersion && !(p && p.trashed);
    this.mutate(bs => {
      const f = this.locate(blockId, bs); if (!f) return;
      f.block.comments = (f.block.comments || []).filter(c => c.id !== cid);
    }, { allowInReadOnly: allow });
  }

  /* ----------------------------------------------------- R5 share links */
  /* Links are built from wherever the app is actually served, so the same
     database works on alamza-notes.web.app, notes.alamza.com, localhost… */
  origin() { return location.origin + location.pathname.replace(/[^/]*$/, ''); }
  pageUrl(id) { return this.origin() + '#/page/' + id; }
  shareUrl(page) {
    const sh = (page && page.share) || {};
    return this.origin() + 's/' + (sh.slug || (page && page.id) || '');
  }
  inviteUrl(page, email) {
    return this.origin() + 'invite/' + ((page && page.share && page.share.slug) || (page && page.id)) +
      '?to=' + encodeURIComponent(email || '');
  }

  /* An invite creates a pending notification for the invited account. The
     other user accepts it in-app and then acts within their role. */
  sendInvite(pageId, email, role) {
    const page = this.state.pages[pageId];
    if (!page || !email) return;
    const inv = {
      id: uid('inv'), pageId, email, role,
      from: (this.state.user && this.state.user.name) || 'A teammate',
      title: page.title || 'Untitled', icon: page.icon || '',
      at: Date.now(), status: 'pending'
    };
    this.setState(s => ({ invites: (s.invites || []).concat([inv]) }), () => this.persist());
    return inv;
  }
  answerInvite(id, accept) {
    this.setState(s => ({
      invites: (s.invites || []).map(i => i.id === id ? Object.assign({}, i, { status: accept ? 'accepted' : 'declined' }) : i)
    }), () => this.persist());
    this.toast(accept ? 'Invitation accepted' : 'Invitation declined');
  }

  /* ---------------------------------------------------------- R19 icons */
  /* The default page icon is a drawn glyph, not an emoji: it inherits
     currentColor so it reads correctly in both themes, and it marks "no icon
     chosen yet" so the page body can hide it entirely (R2). */
  iconEl(page, size) {
    const s = size || 16;
    if (page && page.icon) return React.createElement('span', { style: { fontSize: (s - 1) + 'px', lineHeight: 1 } }, page.icon);
    return React.createElement('svg', {
      width: s, height: s, viewBox: '0 0 20 20', fill: 'none',
      style: { color: 'var(--faint)', flex: 'none' }
    },
      React.createElement('path', {
        d: 'M4.5 2.75h6.19c.33 0 .65.13.88.37l3.06 3.06c.24.23.37.55.37.88v10.19c0 .69-.56 1.25-1.25 1.25h-9.25c-.69 0-1.25-.56-1.25-1.25V4c0-.69.56-1.25 1.25-1.25z',
        stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round'
      }),
      React.createElement('path', { d: 'M10.75 3v3.25c0 .41.34.75.75.75h3.25', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' }),
      React.createElement('path', { d: 'M6.9 10.5h6.2M6.9 13.4h4.3', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' })
    );
  }

  /* ------------------------------------------------- R3 page order model */
  /* One order, two views. A page's children are ordered by the sub-page
     blocks inside the parent; pages with no block fall back to `order`. */
  childrenOf(pid) {
    const all = Object.values(this.state.pages).filter(p => !p.trashed && !p.hidden);
    const kids = all.filter(p => (p.parentId || null) === (pid || null));
    if (!pid) return kids.sort((a, b) => (a.order || 0) - (b.order || 0));
    const parent = this.state.pages[pid];
    if (!parent) return kids;
    const seen = {}, out = [];
    const scan = (list) => (list || []).forEach(b => {
      if (b.type === 'subpage') {
        const k = kids.find(x => x.id === b.pageId);
        if (k && !seen[k.id]) { seen[k.id] = 1; out.push(k); }
      }
      if (b.children) scan(b.children);
      if (b.cols) b.cols.forEach(scan);
    });
    scan(parent.blocks);
    kids.filter(k => !seen[k.id]).sort((a, b) => (a.order || 0) - (b.order || 0)).forEach(k => out.push(k));
    return out;
  }

  /* ---- keep the sidebar and the page body telling the same story --------
     The sidebar lists children by `parentId`; a page body shows them as
     `subpage` blocks. Those are two records of one fact, so any code path that
     writes one and not the other produces a page that exists in the tree but
     is invisible in its parent — and no fix to the creating code repairs the
     pages already in that state. This runs when a body is in hand and appends
     a link for any child that lost one. It is deliberately one-directional: a
     block whose page is gone is left alone (removeBlock/trash own that), so
     this can only ever add back a missing link, never delete content. */
  reconcileChildren(pid) {
    const s = this.state;
    if (this.state.roVersion) return;
    const p = s.pages[pid];
    if (!p || !p.blocks || p.trashed) return;
    const have = {};
    const scan = (list) => (list || []).forEach(b => {
      if (b.type === 'subpage' && b.pageId) have[b.pageId] = 1;
      if (b.children) scan(b.children);
      if (b.cols) b.cols.forEach(scan);
    });
    scan(p.blocks);
    const orphans = Object.values(s.pages)
      .filter(x => !x.trashed && !x.hidden && (x.parentId || null) === pid && !have[x.id])
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!orphans.length) return;
    this.setState(st => {
      const pg = st.pages[pid];
      if (!pg || !pg.blocks) return null;
      const blocks = pg.blocks.concat(orphans.map(o => ({
        id: uid('b'), type: 'subpage', text: '', indent: 0, pageId: o.id
      })));
      return { pages: { ...st.pages, [pid]: { ...pg, blocks, updatedAt: Date.now() } } };
    }, () => this.persist());
  }

  /* remove the sub-page block that points at `pid`, wherever it lives */
  stripSubpage(blocks, pid) {
    /* preserves `null` — see the note in trashPage(): a never-fetched body must
       not be rewritten as [], or the next save blanks it in the database */
    if (blocks == null) return null;
    return blocks.filter(b => {
      if (b.type === 'subpage' && b.pageId === pid) return false;
      if (b.children) b.children = this.stripSubpage(b.children, pid) || [];
      if (b.cols) b.cols = b.cols.map(c => this.stripSubpage(c, pid) || []);
      return true;
    });
  }

  movePage(dragId, targetId, where) {
    if (!dragId || dragId === targetId) return;
    {
      const t = targetId ? this.state.pages[targetId] : null;
      const np = where === 'inside' ? targetId : (t ? (t.parentId || null) : null);
      if (!this.needParent(np, () => this.movePage(dragId, targetId, where))) return;
    }
    const drag = this.state.pages[dragId];
    if (!drag) return;
    /* never drop a page inside its own subtree */
    let probe = targetId;
    while (probe) {
      if (probe === dragId) { this.toast('A page cannot be moved inside itself'); return; }
      probe = this.state.pages[probe] ? this.state.pages[probe].parentId : null;
    }
    const target = targetId ? this.state.pages[targetId] : null;
    const newParent = where === 'inside' ? targetId : (target ? (target.parentId || null) : null);

    this.setState(s => {
      const pages = {};
      Object.keys(s.pages).forEach(k => { pages[k] = JSON.parse(JSON.stringify(s.pages[k])); });
      /* 1. detach from the old parent */
      Object.keys(pages).forEach(k => { pages[k].blocks = this.stripSubpage(pages[k].blocks, dragId); });
      pages[dragId].parentId = newParent;

      /* 2. attach under the new parent.
         `newParent` set but its body missing is NOT the same as a root move —
         conflating them set `parentId` without inserting the link, which is
         precisely how a page ends up visible in the sidebar (which reads
         `parentId`) and absent from its parent's body (which renders blocks).
         needParent() above makes this unreachable; the branch is explicit so a
         future caller cannot resurrect the bug silently. */
      if (newParent && (!pages[newParent] || !pages[newParent].blocks)) {
        return null;
      }
      if (newParent) {
        const par = pages[newParent];
        const nb = { id: uid('b'), type: 'subpage', text: '', indent: 0, pageId: dragId };
        const list = par.blocks;
        if (where === 'inside') list.push(nb);
        else {
          const at = list.findIndex(b => b.type === 'subpage' && b.pageId === targetId);
          list.splice(at < 0 ? list.length : at + (where === 'after' ? 1 : 0), 0, nb);
        }
      } else {
        /* root level — renumber so the dragged page lands beside the target */
        const roots = Object.values(pages)
          .filter(p => !p.trashed && !p.hidden && !p.parentId && p.id !== dragId)
          .sort((a, b) => (a.order || 0) - (b.order || 0));
        const at = targetId ? roots.findIndex(p => p.id === targetId) : roots.length - 1;
        roots.splice(at < 0 ? roots.length : at + (where === 'after' ? 1 : 0), 0, pages[dragId]);
        roots.forEach((p, i) => { pages[p.id].order = i; });
      }
      return { pages, expanded: where === 'inside' ? { ...s.expanded, [newParent]: true } : s.expanded };
    }, () => this.persist());
  }

  /* drag a sidebar row: threshold, live indicator, drop */
  navGrab(id, e) {
    if (e.button !== 0) return;
    const startX = e.clientX, startY = e.clientY;
    let dragging = false, target = null;
    const line = document.createElement('div');
    line.style.cssText = 'position:fixed;height:2px;border-radius:2px;background:var(--accent);z-index:999;pointer-events:none;opacity:0;transition:opacity .1s';
    const move = (ev) => {
      if (!dragging) {
        if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 5) return;
        dragging = true;
        document.body.appendChild(line);
        document.body.classList.add('noSel');
        document.body.style.cursor = 'grabbing';
        this.setState({ navDrag: id });
      }
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const row = el && el.closest ? el.closest('[data-navrow]') : null;
      if (!row || row.getAttribute('data-navrow') === id) { line.style.opacity = '0'; target = null; return; }
      const rid = row.getAttribute('data-navrow');
      const r = row.getBoundingClientRect();
      const rel = (ev.clientY - r.top) / r.height;
      const where = rel < 0.3 ? 'before' : rel > 0.7 ? 'after' : 'inside';
      target = { id: rid, where };
      line.style.opacity = '1';
      if (where === 'inside') {
        /* translucent tint + ring — an opaque fill used to hide the row's
           own text, which read as the row going blank mid-drag */
        line.style.height = r.height + 'px';
        line.style.background = 'var(--accent-tint)';
        line.style.boxShadow = 'inset 0 0 0 1.5px var(--accent)';
        line.style.borderRadius = '4px';
        line.style.left = r.left + 'px'; line.style.width = r.width + 'px'; line.style.top = r.top + 'px';
      } else {
        line.style.boxShadow = 'none';
        line.style.borderRadius = '2px';
        line.style.height = '2px';
        line.style.background = 'var(--accent)';
        line.style.left = (r.left + 12) + 'px'; line.style.width = (r.width - 16) + 'px';
        line.style.top = (where === 'before' ? r.top : r.bottom) - 1 + 'px';
      }
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (dragging) {
        line.remove();
        document.body.classList.remove('noSel');
        document.body.style.cursor = '';
        this.setState({ navDrag: null });
        if (target) this.movePage(id, target.id, target.where);
        this._navMoved = true;
        setTimeout(() => { this._navMoved = false; }, 40);
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  /* ------------------------------------------------ R9 sidebar resizing */
  startResize(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = this.state.prefs.sidebarW || 264;
    document.body.classList.add('noSel');
    document.body.style.cursor = 'col-resize';
    this.setState({ resizing: true });
    const move = (ev) => {
      const w = Math.max(180, Math.min(460, startW + (ev.clientX - startX)));
      this.setState(s => ({ prefs: { ...s.prefs, sidebarW: w } }));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.classList.remove('noSel');
      document.body.style.cursor = '';
      this.setState({ resizing: false }, () => this.persist());
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  /* ------------------------------------------------ R18 deep duplicate */
  deepDuplicatePage(id, intoParent) {
    const src = this.state.pages[id];
    if (!src) return null;
    /* Every page in the subtree must have its body in hand before it can be
       cloned. A `blocks: null` copy would be skipped by push() — not even its
       index entry written — so the duplicate would exist only on this device. */
    const need = this.descendants(id).concat(src.parentId ? [src.parentId] : [])
      .filter(pid => !this.bodyReady(pid));
    if (need.length) {
      this.toast('Preparing ' + need.length + (need.length === 1 ? ' page…' : ' pages…'));
      Promise.all(need.map(pid => this.ensureBody(pid)))
        .then(() => this.deepDuplicatePage(id, intoParent));
      return null;
    }
    const map = {}, made = {}, madeDbs = {};
    const cloneTree = (pid, parentId) => {
      const orig = this.state.pages[pid];
      if (!orig) return null;
      const copy = JSON.parse(JSON.stringify(orig));
      const nid = uid('p');
      map[pid] = nid;
      copy.id = nid;
      copy.parentId = parentId;
      copy.createdAt = copy.updatedAt = Date.now();
      copy.share = { published: false, slug: nid, password: null, invites: [] };
      /* versions come along, each with a fresh identity */
      copy.versions = (orig.versions || []).map(v => {
        const nv = Object.assign({}, JSON.parse(JSON.stringify(v)), { id: uid('v') });
        /* the body travels with the copy under its new identity */
        const body = this.vsnap(v.id) || v.blocks;
        if (body && AStore.putVersionBlocks) AStore.putVersionBlocks(nid, nv.id, JSON.parse(JSON.stringify(body)));
        return nv;
      });
      made[nid] = copy;
      /* recurse into children, rewriting the sub-page blocks as we go */
      const rewrite = (list) => (list || []).forEach(b => {
        b.id = uid('b');
        if (b.type === 'subpage' && this.state.pages[b.pageId]) {
          const child = cloneTree(b.pageId, nid);
          if (child) b.pageId = child;
        }
        /* an embedded database is copied whole: fresh db, fresh row ids, and
           every row page that had been opened is cloned too */
        if (b.type === 'database' && this.state.dbs[b.dbId] && this.state.dbs[b.dbId].rows) {
          const nd = JSON.parse(JSON.stringify(this.state.dbs[b.dbId]));
          const ndid = uid('db');
          nd.id = ndid;
          const oldDefault = nd.defaultView;
          nd.views.forEach(v => { const ov = v.id; v.id = uid('v'); if (oldDefault === ov) nd.defaultView = v.id; });
          nd.rows.forEach(r => {
            r.id = uid('r');
            if (r.pageId && this.state.pages[r.pageId]) {
              const rp = cloneTree(r.pageId, nid);
              if (rp) { r.pageId = rp; made[rp].dbRef = { dbId: ndid, rowId: r.id }; made[rp].hidden = true; }
              else delete r.pageId;
            } else delete r.pageId;
          });
          madeDbs[ndid] = nd;
          b.dbId = ndid;
        }
        if (b.children) rewrite(b.children);
        if (b.cols) b.cols.forEach(rewrite);
      });
      rewrite(copy.blocks);
      /* children that had no block still need copying */
      Object.values(this.state.pages)
        .filter(p => !p.trashed && p.parentId === pid && !map[p.id])
        .forEach(p => cloneTree(p.id, nid));
      return nid;
    };
    const rootId = cloneTree(id, intoParent === undefined ? src.parentId : intoParent);
    if (!rootId) return null;
    made[rootId].title = (src.title || 'Untitled') + ' copy';
    made[rootId].order = (src.order || 0) + 0.5;

    this.setState(s => {
      const pages = { ...s.pages, ...made };
      const dbs = Object.keys(madeDbs).length ? { ...s.dbs, ...madeDbs } : s.dbs;
      /* mirror the new page beside the original in its parent */
      const par = made[rootId].parentId;
      if (par && pages[par] && pages[par].blocks) {
        const p2 = JSON.parse(JSON.stringify(pages[par]));
        const list = p2.blocks;
        const at = list.findIndex(b => b.type === 'subpage' && b.pageId === id);
        list.splice(at < 0 ? list.length : at + 1, 0, { id: uid('b'), type: 'subpage', text: '', indent: 0, pageId: rootId });
        p2.blocks = list;
        pages[par] = p2;
      }
      return { pages, dbs, menu: null };
    }, () => this.persist());
    const n = Object.keys(made).length;
    const nd2 = Object.keys(madeDbs).length;
    const bits = [];
    if (n > 1) bits.push((n - 1) + ' sub-page' + (n > 2 ? 's' : ''));
    if (nd2) bits.push(nd2 + ' database' + (nd2 > 1 ? 's' : ''));
    this.toast(bits.length ? 'Duplicated with ' + bits.join(' and ') : 'Page duplicated');
    return rootId;
  }

  /* ------------------------------------------------- R11 marginal lasso */
  /* Notion: press in the empty gutter beside the text and drag — you select
     BLOCKS, not a browser text range. */
  lassoStart(e) {
    /* selecting is read-only itself, so it stays available on a version
       preview or a trashed page — you still want to copy out of those */
    if (e.button !== 0) return;
    /* A press inside a database (row, board column, table cell, header) belongs
       to that database's own drag — never start the block lasso from it. */
    if (e.target.closest && (e.target.closest('[contenteditable="true"]') || e.target.closest('button') ||
      e.target.closest('input') || e.target.closest('select') || e.target.closest('textarea') ||
      e.target.closest('a') || e.target.closest('[data-menu]') ||
      e.target.closest('[data-dbrow]') || e.target.closest('[data-dbgroup]') ||
      e.target.closest('[data-db]'))) return;
    const sc = this._scroll;
    /* Anchor the origin in DOCUMENT space. If it stayed viewport-relative the
       rectangle would slide with the page and silently drop everything you had
       already selected while scrolling through a long note. */
    const scrollAt = () => (sc ? sc.scrollTop : 0);
    const startScroll = scrollAt();
    const startX = e.clientX, startDocY = e.clientY + startScroll;
    let dragging = false, lastX = e.clientX, lastY = e.clientY, raf = null;

    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;z-index:40;pointer-events:none;background:var(--sel);border:1px solid var(--accent);border-radius:2px;opacity:.5';

    const paint = () => {
      const docY = lastY + scrollAt();
      const topDoc = Math.min(startDocY, docY), botDoc = Math.max(startDocY, docY);
      /* back to viewport coordinates for drawing and hit-testing */
      const t = topDoc - scrollAt(), b = botDoc - scrollAt();
      const l = Math.min(startX, lastX), w = Math.abs(lastX - startX);
      box.style.left = l + 'px'; box.style.width = w + 'px';
      box.style.top = t + 'px'; box.style.height = (b - t) + 'px';
      const hit = [];
      document.querySelectorAll('[data-block]').forEach(node => {
        const r = node.getBoundingClientRect();
        if (r.bottom > t && r.top < b) hit.push(node.getAttribute('data-bid'));
      });
      const cur = this.state.blockSel || [];
      if (hit.length !== cur.length || hit[0] !== cur[0] || hit[hit.length - 1] !== cur[cur.length - 1]) {
        this.setState({ blockSel: hit });
      }
    };

    const move = (ev) => {
      lastX = ev.clientX; lastY = ev.clientY;
      if (!dragging) {
        if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY + scrollAt() - startDocY) < 6) return;
        dragging = true;
        document.body.appendChild(box);
        document.body.classList.add('noSel');
        const g = window.getSelection(); if (g) g.removeAllRanges();
        /* auto-scroll while the pointer is held near an edge, so a selection
           can run past the fold */
        const tick = () => {
          raf = requestAnimationFrame(tick);
          if (sc) {
            const vr = sc.getBoundingClientRect();
            const PAD = 64, SPEED = 14;
            const top = Math.max(vr.top, 0), bot = Math.min(vr.bottom, window.innerHeight);
            if (lastY < top + PAD) sc.scrollTop -= Math.max(4, (top + PAD - lastY) / PAD * SPEED);
            else if (lastY > bot - PAD) sc.scrollTop += Math.max(4, (lastY - (bot - PAD)) / PAD * SPEED);
          }
          paint();
        };
        tick();
      }
      paint();
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      if (dragging) { box.remove(); document.body.classList.remove('noSel'); }
      else if (!(this.state.blockSel || []).length) this.setState({ blockSel: [] });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  /* -------------------------------------------- R4 menus follow the page */
  /* A popup is anchored to its block. While the document scrolls the popup
     travels with it, and once the anchor leaves the viewport it closes. */
  trackAnchor() {
    const reposition = () => {
      const mu = this.state.menu, sl = this.state.slash;
      const scRect = this._scroll ? this._scroll.getBoundingClientRect() : null;
      const follow = (obj, key) => {
        if (!obj || !obj.anchor) return;
        const node = document.querySelector('[data-bid="' + obj.anchor + '"]') || this._els[obj.anchor];
        if (!node || !node.isConnected) { this.setState({ [key]: null }); return; }
        const r = node.getBoundingClientRect();
        if (scRect && (r.bottom < scRect.top + 4 || r.top > scRect.bottom - 4)) { this.setState({ [key]: null }); return; }
        const dy = r.top - obj.anchorTop;
        if (Math.abs(dy) > 0.5) this.setState(s => (s[key] ? { [key]: Object.assign({}, s[key], { y: obj.y0 + dy }) } : null));
      };
      follow(mu, 'menu');
      follow(sl, 'slash');
      if (this.state.selBar) this.setState({ selBar: null });
    };
    return reposition;
  }

  /* ---- backlog 3: word count and reading time ---- */
  pageStats() {
    let words = 0, chars = 0, blocks = 0;
    const walk = (list) => (list || []).forEach(b => {
      blocks++;
      const t = AMD.stripMarks(b.text || '').trim();
      if (t) { words += t.split(/\s+/).length; chars += t.length; }
      if (b.children) walk(b.children);
      if (b.cols) b.cols.forEach(walk);
      if (b.rows) b.rows.forEach(r => r.forEach(c => {
        const s2 = String(c || '').trim();
        if (s2) { words += s2.split(/\s+/).length; chars += s2.length; }
      }));
    });
    walk(this.activeBlocks());
    const p = this.page();
    if (p && p.title) words += p.title.trim().split(/\s+/).length;
    return { words, chars, blocks, minutes: Math.max(1, Math.round(words / 220)) };
  }

  /* ---- backlog 5: headings are searchable, not just pages ---- */
  headingHits(q) {
    if (!q) return [];
    const t = q.toLowerCase();
    const out = [];
    Object.values(this.state.pages).forEach(pg => {
      if (pg.trashed || !pg.blocks) return;   // headings need a real body
      pg.blocks.forEach(b => {
        if (b.type !== 'h1' && b.type !== 'h2' && b.type !== 'h3') return;
        const txt = AMD.stripMarks(b.text || '');
        if (!txt.toLowerCase().includes(t)) return;
        out.push({ page: pg, block: b, text: txt });
      });
    });
    return out.slice(0, 8);
  }

  /* ---- backlog 7: Tab / arrows move between table cells ---- */
  tableNav(blockId, ri, ci, e) {
    const f = this.locate(blockId);
    if (!f || !f.block.rows) return;
    const rows = f.block.rows;
    let r2 = ri, c2 = ci;
    if (e.key === 'Tab') {
      e.preventDefault();
      c2 = ci + (e.shiftKey ? -1 : 1);
      if (c2 >= rows[0].length) { c2 = 0; r2 = ri + 1; }
      if (c2 < 0) { c2 = rows[0].length - 1; r2 = ri - 1; }
      if (r2 >= rows.length) { this.tableAdd(blockId, 'row'); r2 = rows.length; c2 = 0; }
    } else if (e.key === 'ArrowDown') { r2 = ri + 1; }
    else if (e.key === 'ArrowUp') { r2 = ri - 1; }
    else if (e.key === 'Enter') { e.preventDefault(); r2 = ri + 1; if (r2 >= rows.length) { this.tableAdd(blockId, 'row'); } }
    else return;
    if (r2 < 0) return;
    setTimeout(() => {
      const host = document.querySelector('[data-bid="' + blockId + '"]');
      if (!host) return;
      const cell = host.querySelector('[data-cell="' + r2 + '-' + c2 + '"]');
      if (cell) { cell.focus(); if (cell.select) cell.select(); }
    }, 20);
  }

  upModal(patch) { this.setState(s => ({ modal: Object.assign({}, s.modal, patch) })); }
});
