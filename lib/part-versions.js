/* Alamza Notes — Versions — snapshots, diff, restore (+ small app actions)
 *
 * Methods of the app class, moved out verbatim. They run on the same
 * instance as everything in index.dc.html: `this.state`, `this.setState`,
 * `this.props` and every other method are all available here.
 * Registered onto Component.prototype by lib/parts.js.
 */
AlamzaParts.register(class {
  /* ------------------------------------------------------------ actions */
  toggleTheme() {
    const order = ['light', 'dark'];
    const next = order[(order.indexOf(this.state.prefs.theme) + 1) % order.length];
    this.setState(s => ({ prefs: { ...s.prefs, theme: next } }), () => { this.applyTheme(); this.persist(); });
  }
  toggleSource() { this.setState(s => ({ prefs: { ...s.prefs, sourceView: !s.prefs.sourceView } }), () => { Object.values(this._els).forEach(e => { e.__h = undefined; }); this.syncDom(); this.persist(); }); }
  toast(msg) { this.setState({ toast: msg }); clearTimeout(this._toastT); this._toastT = setTimeout(() => this.setState({ toast: null }), 2200); }

  copyMarkdown() {
    const p = this.page();
    /* activeBlocks() already returns the previewed version's blocks, so the
       title has to follow it too or the copy is labelled with the wrong one */
    const v = this.state.roVersion && this.versionById(this.state.roVersion);
    const md = '# ' + ((v && v.title) || p.title || 'Untitled') + '\n\n' + AMD.toMarkdown(this.activeBlocks(), { pages: this.state.pages, dbs: this.state.dbs });
    navigator.clipboard.writeText(md).then(() => this.toast('Page copied as Markdown'));
  }

  /* ---------------------------------------------------------- versions */
  /* ONE place that builds a snapshot payload and its honest statistics.
     This existed twice — createVersion computed nested and deleted counts,
     restore's safety snapshot hardcoded zeros — and the copies drifted, so a
     safety snapshot claimed "+0 nested" for a subtree that had really moved.
     Both callers now share this, which is the only way the two stay equal. */
  buildSnapshot(rootId, prevSnap) {
    const clone = (x) => JSON.parse(JSON.stringify(x));
    const root = this.state.pages[rootId];
    const ids = this.subtreeIds(rootId);
    const snap = { b: clone((root && root.blocks) || []), d: {}, p: {} };
    const rootStat = ADiff.stats(prevSnap ? prevSnap.b : [], (root && root.blocks) || []);
    const deep = { pages: ids.length, added: rootStat.added, removed: rootStat.removed,
                   changed: rootStat.changed, touched: 0, gone: 0 };
    ids.forEach(id => {
      const pg = this.state.pages[id];
      if (!pg) return;
      Object.assign(snap.d, this.dbsUsedBy(pg.blocks));
      if (id === rootId) return;
      /* an unloaded body must never be captured as an empty page */
      if (!pg.blocks) return;
      snap.p[id] = { t: pg.title || '', i: pg.icon || '', pa: pg.parentId || null,
                     o: pg.order || 0, b: clone(pg.blocks) };
      const was = prevSnap && prevSnap.p[id] ? prevSnap.p[id].b : [];
      const st = ADiff.stats(was, pg.blocks);
      if (!st.none) deep.touched++;
      deep.added += st.added; deep.removed += st.removed; deep.changed += st.changed;
    });
    /* a child that existed in the previous snapshot and is gone is a deletion */
    if (prevSnap) Object.keys(prevSnap.p).forEach(id => {
      if (!snap.p[id]) { deep.gone++; deep.removed += (prevSnap.p[id].b || []).length; }
    });
    const scope = ids.map(id => {
      const pg = this.state.pages[id] || {};
      return { id, t: pg.title || 'Untitled', i: pg.icon || '', pa: pg.parentId || null };
    });
    return { snap, rootStat, deep, ids, scope };
  }

  /* Version numbers are identity, not position. `versions.length + 1` handed a
     new snapshot a number an existing one already had as soon as any snapshot
     had been deleted — delete v2 of three and the next capture is a second v3,
     making every "restore v3" and "since v3" ambiguous. */
  nextVersionN(versions) {
    return (versions || []).reduce((m, v) => Math.max(m, v.n || 0), 0) + 1;
  }

  /* A snapshot of a page is a snapshot of everything UNDER it: its child
     pages, their children, and every database any of them embeds. Capturing
     only the open page meant restoring a version silently left the nested
     pages at their newest state — a version that never existed. */
  createVersion(msg) {
    const p = this.page();
    if (!p) return;
    /* a deep capture can take several fetches; a second click during that
       window would author two snapshots of the same state */
    if (this._verLock) return;
    /* Held across the whole author, not just the async prefetch: two calls in
       the same tick both read the pre-commit `p.versions` and each push onto
       it, so the second silently discards the first. */
    this._verLock = true;
    const ids = this.subtreeIds(p.id);

    /* Everything the snapshot needs must be in hand FIRST. A body or a table
       that is still loading would be captured as empty, which is how a
       snapshot ends up "not storing the changes". */
    const done = () => { this._verLock = false; };
    const needBodies = ids.filter(id => !this.bodyReady(id));
    if (needBodies.length) {
      this.toast('Capturing ' + needBodies.length + (needBodies.length === 1 ? ' page…' : ' pages…'));
      Promise.all(needBodies.map(id => this.ensureBody(id)))
        .then(() => { done(); this.createVersion(msg); }, done);
      return;
    }
    let needRows = [];
    ids.forEach(id => {
      const pg = this.state.pages[id];
      needRows = needRows.concat(this.dbIdsIn(pg.blocks).filter(d => !this.rowsReady(d)));
    });
    if (needRows.length) {
      Promise.all(needRows.map(d => this.ensureRows(d)))
        .then(() => { done(); this.createVersion(msg); }, done);
      return;
    }
    const versions = (p.versions || []).slice();
    const last = versions.length ? versions[versions.length - 1] : null;
    /* The previous snapshot is the baseline for the summary and the +/− stat.
       Diffing against a snapshot that has not loaded reports the whole page as
       newly added, which is the wrong history and cannot be recomputed later. */
    if (last && !this.vsnap(last.id)) {
      this.ensureVersion(last.id).then(() => { done(); this.createVersion(msg); }, done);
      return;
    }

    const prevSnap = last ? this.vsnap(last.id) : null;
    const prevRoot = prevSnap ? prevSnap.b : [];

    /* ---- build the deep payload ---- */
    const built = this.buildSnapshot(p.id, prevSnap);
    const snap = built.snap, rootStat = built.rootStat, deep = built.deep;
    const touched = deep.touched, gone = deep.gone;

    /* A snapshot of content identical to the last one is noise: it clutters
       the history and makes every diff against it read "identical". The first
       snapshot is the exception — that one establishes the baseline. */
    if (versions.length && !gone && rootStat.none && !deep.added && !deep.removed && !deep.changed) {
      this._verLock = false;
      this.setState({ modal: null, sheet: null });
      this.toast('Nothing has changed since v' + last.n);
      return;
    }

    /* Describe what actually moved. The root summary alone would read "No
       content changes" for a snapshot whose whole point was a nested edit. */
    const auto = !msg || !msg.trim();
    let text = auto ? ADiff.summary(prevRoot, p.blocks) : msg.trim();
    if (auto) {
      const parts = [];
      if (touched) parts.push('changes in ' + touched + (touched === 1 ? ' nested page' : ' nested pages'));
      /* a page that left the subtree is a deletion, not a "change" */
      if (gone) parts.push('removed ' + gone + (gone === 1 ? ' nested page' : ' nested pages'));
      if (parts.length) {
        if (rootStat.none) {
          const s0 = parts.join(' · ');
          text = s0.charAt(0).toUpperCase() + s0.slice(1);
        } else text = text + ' · ' + parts.join(' · ');
      }
    }
    const vid = uid('v');
    this.cacheVersion(p.id, vid, snap);

    versions.push({
      id: vid, n: this.nextVersionN(versions), message: text, auto,
      createdAt: Date.now(), author: (this.state.user && this.state.user.name) || 'You',
      /* precomputed so the history panel never has to fetch a snapshot */
      stat: rootStat, deepStat: deep,
      /* the manifest lets the diff list nested pages without a fetch */
      scope: built.scope,
      title: p.title, icon: p.icon, blocks: snap,
      dbs: snap.d
    });
    this.patchPage(p.id, { versions });
    this.setState({ modal: null, sheet: null }, () => { this._verLock = false; });
    const extra = touched ? ' · ' + touched + ' nested' : '';
    this.toast('Snapshot saved as v' + versions[versions.length - 1].n + extra);
  }

  /* every database embedded anywhere in these blocks, deep-copied */
  dbsUsedBy(blocks) {
    const out = {};
    const walk = (list) => (list || []).forEach(b => {
      /* only a table whose rows are loaded can be snapshotted honestly */
      if (b.type === 'database' && this.state.dbs[b.dbId] && this.state.dbs[b.dbId].rows) out[b.dbId] = JSON.parse(JSON.stringify(this.state.dbs[b.dbId]));
      if (b.children) walk(b.children);
      if (b.cols) b.cols.forEach(walk);
    });
    walk(blocks);
    return Object.keys(out).length ? out : undefined;
  }

  restore(vid, mode) {
    const p = this.page(), v = this.versionById(vid);
    if (!v) return;
    /* the snapshot may not be local yet — fetch, then run the same path again */
    if (!this.vsnap(vid)) {
      this.ensureVersion(vid).then(() => { if (this.vsnap(vid)) this.restore(vid, mode); });
      if (mode === 'ro') this.setState({ roVersion: vid, modal: null, sheet: null, panel: null });
      return;
    }
    if (mode === 'ro') { this.setState({ roVersion: vid, modal: null, sheet: null, panel: null }); return; }

    const snap = this.vsnap(vid);
    const clone = (x) => JSON.parse(JSON.stringify(x));
    const versions = (p.versions || []).slice();
    const last = versions.length ? versions[versions.length - 1] : null;

    if (mode === 'new') {
      /* The safety snapshot is a real snapshot and needs a real baseline. With
         the previous one still in flight its stat was computed against `[]`,
         so a page that had not changed since v3 was recorded as "+8 added" —
         permanently, since a stat cannot be recomputed later. Wait for it. */
      if (last && !this.vsnap(last.id)) {
        this.ensureVersion(last.id).then(() => this.restore(vid, mode));
        return;
      }
      /* the safety snapshot has to be as deep as the thing it protects, and
         built by the same code so its numbers mean the same thing */
      const prevSnap = last ? this.vsnap(last.id) : null;
      const built = this.buildSnapshot(p.id, prevSnap);
      const nvid = uid('v');
      this.cacheVersion(p.id, nvid, built.snap);
      versions.push({
        id: nvid, n: this.nextVersionN(versions),
        message: 'Snapshot taken before restoring v' + v.n, auto: true,
        createdAt: Date.now(), author: (this.state.user && this.state.user.name) || 'You',
        stat: built.rootStat, deepStat: built.deep, scope: built.scope,
        title: p.title, icon: p.icon, blocks: built.snap, dbs: built.snap.d
      });
    }

    this._els = {}; this._refs = {}; this._mathEls = {};

    /* Restore the whole subtree in ONE state write: root blocks, every child
       the snapshot captured, and any child that has since been deleted (which
       is recreated, or the restored parent would link to nothing). Pages
       created after the snapshot are left alone — deleting them would make
       restore destructive in a way nothing warned about. */
    this.setState(st => {
      const pages = { ...st.pages };
      const dbs = (snap && snap.d && Object.keys(snap.d).length)
        ? Object.assign({}, st.dbs, clone(snap.d)) : st.dbs;
      pages[p.id] = { ...pages[p.id], versions, blocks: clone(snap ? snap.b : []),
                      title: v.title || p.title, icon: v.icon || p.icon, updatedAt: Date.now() };
      let revived = 0;
      Object.keys((snap && snap.p) || {}).forEach(id => {
        const sub = snap.p[id];
        const cur = pages[id];
        if (cur) {
          pages[id] = { ...cur, blocks: clone(sub.b), title: sub.t || cur.title,
                        icon: sub.i || cur.icon, parentId: sub.pa, order: sub.o,
                        trashed: false, updatedAt: Date.now() };
        } else {
          revived++;
          pages[id] = { id, parentId: sub.pa, title: sub.t || 'Untitled', icon: sub.i || '',
                        iconType: '', cover: '', order: sub.o || 0, favorite: false,
                        trashed: false, createdAt: Date.now(), updatedAt: Date.now(),
                        blocks: clone(sub.b), versions: [] };
        }
      });
      this._revived = revived;
      return { pages, dbs, modal: null, sheet: null, roVersion: null };
    }, () => {
      this.persist();
      const n = Object.keys((snap && snap.p) || {}).length;
      const extra = n ? ' · ' + n + (n === 1 ? ' nested page' : ' nested pages') : '';
      this.toast((mode === 'new' ? 'Restored v' + v.n + ' as a new version'
                                 : 'Restored v' + v.n) + extra);
    });
  }

  openDiff(a, b) {
    this.setState({ modal: { kind: 'diff' }, diffA: a || 'current', diffB: b || 'current', diffPage: null });
    /* Both sides may be cold. The snapshots are one fetch each; the CURRENT
       side is a body per page, and without them a nested page reads as `[]`
       and the diff invents a deletion of everything in it — under a Restore
       button. Prefetch the whole scope, then let each arrival re-render. */
    Promise.all([this.ensureVersion(a), this.ensureVersion(b)]).then(() => {
      const ids = this.diffScope(a || 'current', b || 'current').map(x => x.id);
      this.ensureBodies(ids);
    });
  }
  /* the current side of the diff is unreadable until that page's body lands.
     An index blockCount of 0 is the one case where empty is the truth. */
  diffPending(side, pageId) {
    if (side !== 'current') return !this.vsnap(side);
    const pg = this.state.pages[pageId];
    if (!pg) return false;
    if (pg.blocks) return false;
    return (pg.blockCount || 0) > 0;
  }
  /* blocks for one side of the diff, for one page in the subtree */
  blocksOf(id, pageId) {
    const rootId = this.state.pageId;
    const pid = pageId || rootId;
    if (id === 'current') {
      const pg = this.state.pages[pid];
      return (pg && pg.blocks) || [];
    }
    const s = this.vsnap(id);
    if (!s) return [];
    if (pid === rootId) return s.b || [];
    return s.p[pid] ? (s.p[pid].b || []) : [];
  }
  /* every page either side of the diff knows about, with its own stat */
  diffScope(a, b) {
    const rootId = this.state.pageId;
    const root = this.state.pages[rootId];
    const seen = {}, order = [];
    const add = (id, title, icon) => {
      if (seen[id]) return;
      seen[id] = { id, title: title || 'Untitled', icon: icon || '' };
      order.push(id);
    };
    add(rootId, root && root.title, root && root.icon);
    [a, b].forEach(side => {
      if (side === 'current') {
        this.subtreeIds(rootId).forEach(id => {
          const pg = this.state.pages[id];
          add(id, pg.title, pg.icon);
        });
        return;
      }
      const v = this.versionById(side);
      if (v && v.scope) v.scope.forEach(x => add(x.id, x.t, x.i));
      const s2 = this.vsnap(side);
      if (s2) Object.keys(s2.p).forEach(id => add(id, s2.p[id].t, s2.p[id].i));
    });
    return order.map(id => {
      /* A page still loading is NOT an empty page — diffing it against a real
         snapshot would report every block as deleted. Report it as pending and
         let it resolve; the counts appear when the body arrives. */
      const pending = this.diffPending(a, id) || this.diffPending(b, id);
      if (pending) {
        this.ensureBody(id);
        return Object.assign({}, seen[id], {
          isRoot: id === rootId, pending: true,
          added: 0, removed: 0, changed: 0, touched: false
        });
      }
      const st = ADiff.stats(this.blocksOf(a, id), this.blocksOf(b, id));
      return Object.assign({}, seen[id], {
        isRoot: id === rootId, pending: false,
        added: st.added, removed: st.removed, changed: st.changed,
        touched: !st.none
      });
    });
  }
  labelOf(id) { if (id === 'current') return 'Current'; const v = this.versionById(id); return v ? 'v' + v.n : '—'; }

  diffText(b) {
    if (!b) return '';
    if (b.type === 'divider') return '———';
    if (b.type === 'subpage') { const p = this.state.pages[b.pageId]; return '📄 ' + ((p && p.title) || 'Sub-page'); }
    if (b.type === 'database') { const d = this.state.dbs[b.dbId]; return '🗃️ ' + ((d && d.name) || 'Database'); }
    if (b.type === 'todo') return (b.checked ? '☑ ' : '☐ ') + b.text;
    if (b.type === 'ul') return '• ' + b.text;
    if (b.type === 'ol') return '1. ' + b.text;
    return b.text || '';
  }
  diffStyle(b) {
    const t = b ? b.type : 'p';
    return {
      size: t === 'h1' ? '19px' : t === 'h2' ? '16.5px' : t === 'h3' ? '15px' : t === 'code' || t === 'math' ? '12.5px' : '14px',
      weight: t && t.startsWith('h') ? '700' : '400',
      font: t === 'code' || t === 'math' ? 'var(--mono)' : 'var(--ui)'
    };
  }
  tokens(list, kind) {
    return (list || []).map((t, i) => ({
      key: i, s: t.s,
      bg: t.t === '=' ? 'transparent' : t.t === '-' ? 'var(--del-strong)' : 'var(--add-strong)',
      fg: t.t === '=' ? 'inherit' : t.t === '-' ? 'var(--del-fg)' : 'var(--add-fg)',
      deco: t.t === '-' ? 'line-through' : 'none'
    }));
  }
  plain(text) { return [{ key: 0, s: text, bg: 'transparent', fg: 'inherit', deco: 'none' }]; }
});
