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
    /* snapshotIds, not subtreeIds: a database row page holds a real note and
       belongs in the capture — see lib/part-pages.js */
    const ids = this.snapshotIds(rootId);
    const snap = { b: clone((root && root.blocks) || []), d: {}, p: {} };
    const rootStat = ADiff.stats(prevSnap ? prevSnap.b : [], (root && root.blocks) || []);
    const deep = { pages: ids.length, added: rootStat.added, removed: rootStat.removed,
                   changed: rootStat.changed, touched: 0, gone: 0 };
    /* a body that never arrived is the one thing that makes a capture a lie;
       the callers prefetch, and this reports it if one slipped through */
    let partial = !(root && root.blocks);
    ids.forEach(id => {
      const pg = this.state.pages[id];
      if (!pg) return;
      Object.assign(snap.d, this.dbsUsedBy(pg.blocks));
      if (id === rootId) return;
      /* an unloaded body must never be captured as an empty page */
      if (!pg.blocks) { partial = true; return; }
      /* Everything that makes this page what it IS, not merely where it sits.
         Restoring used to rebuild a deleted child with no cover, no icon type
         and no favourite — and a rebuilt ROW page with no `dbRef`, which is an
         orphan nothing in the app can open. Old payloads simply lack these
         keys and fall back on read. */
      snap.p[id] = { t: pg.title || '', i: pg.icon || '', pa: pg.parentId || null,
                     o: pg.order || 0, b: clone(pg.blocks) };
      if (pg.iconType) snap.p[id].it = pg.iconType;
      if (pg.cover) snap.p[id].c = pg.cover;
      if (pg.favorite) snap.p[id].f = 1;
      if (pg.hidden) snap.p[id].h = 1;
      if (pg.dbRef && pg.dbRef.dbId) snap.p[id].dr = [pg.dbRef.dbId, pg.dbRef.rowId];
      const was = prevSnap && prevSnap.p[id] ? prevSnap.p[id].b : [];
      const st = ADiff.stats(was, pg.blocks);
      if (!st.none) deep.touched++;
      deep.added += st.added; deep.removed += st.removed; deep.changed += st.changed;
    });
    /* A child that existed in the previous snapshot and is gone is a deletion —
       but "absent from this capture" is not the same as "deleted". A page whose
       body had not been fetched is also absent, and counting it as removed
       recorded "removed 3 nested pages" for three intact pages, permanently:
       a stat cannot be recomputed later. Only a page that has really left the
       workspace, or gone to the Trash, is gone. */
    if (prevSnap) Object.keys(prevSnap.p).forEach(id => {
      if (snap.p[id]) return;
      const pg = this.state.pages[id];
      if (pg && pg.blocks) return;                 // still here, just unchanged shape
      if (pg && !pg.trashed) return;               // here but unfetched — not a deletion
      deep.gone++; deep.removed += (prevSnap.p[id].b || []).length;
    });
    const scope = ids.map(id => {
      const pg = this.state.pages[id] || {};
      return { id, t: pg.title || 'Untitled', i: pg.icon || '', pa: pg.parentId || null };
    });
    return { snap, rootStat, deep, ids, scope, partial };
  }

  /* ---- everything a capture needs, in hand -----------------------------
     A body or a table still loading would be captured as empty, which is how
     a snapshot ends up "not storing the changes". Both authors — createVersion
     and restore's safety snapshot — wait on this; the safety snapshot did not,
     so it quietly protected less than the thing it was protecting.

     Bounded on purpose. This used to be a re-entrant call that re-ran itself
     until everything was ready, and a body the server does not hold (a
     migration gap, a write that never landed) never becomes ready — so it sat
     in a fetch loop, billing a read and raising a toast on every pass, for as
     long as the tab stayed open. Three passes is enough for bodies, then the
     tables inside them, then a verify; after that the honest answer is no. */
  ensureSnapshotReady(rootId, pass) {
    const n = pass || 0;
    if (n > 3) return Promise.resolve(false);
    const ids = this.snapshotIds(rootId);
    const needBodies = ids.filter(id => !this.bodyReady(id));
    if (needBodies.length) {
      if (!n) this.toast('Capturing ' + needBodies.length + (needBodies.length === 1 ? ' page…' : ' pages…'));
      return Promise.all(needBodies.map(id => this.ensureBody(id)))
        .then(() => this.ensureSnapshotReady(rootId, n + 1), () => false);
    }
    let needRows = [];
    ids.forEach(id => {
      const pg = this.state.pages[id];
      if (pg && pg.blocks) needRows = needRows.concat(this.dbIdsIn(pg.blocks).filter(d => !this.rowsReady(d)));
    });
    if (needRows.length) {
      return Promise.all(needRows.map(d => this.ensureRows(d)))
        .then(() => this.ensureSnapshotReady(rootId, n + 1), () => false);
    }
    return Promise.resolve(true);
  }
  /* The previous snapshot is the baseline for the summary and the +/− stat.
     Diffing against a snapshot that has not loaded reports the whole page as
     newly added — the wrong history, and it cannot be recomputed later. */
  ensureBaseline(pageId) {
    const p = this.state.pages[pageId];
    const vs = (p && p.versions) || [];
    const last = vs.length ? vs[vs.length - 1] : null;
    if (!last || this.vsnap(last.id)) return Promise.resolve(true);
    return this.ensureVersion(last.id).then(() => !!this.vsnap(last.id), () => false);
  }

  /* Version numbers are identity, not position. `versions.length + 1` handed a
     new snapshot a number an existing one already had as soon as any snapshot
     had been deleted — delete v2 of three and the next capture is a second v3,
     making every "restore v3" and "since v3" ambiguous. */
  nextVersionN(versions) {
    return (versions || []).reduce((m, v) => Math.max(m, v.n || 0), 0) + 1;
  }

  /* A snapshot of a page is a snapshot of everything UNDER it: its child
     pages, their children, the database row pages hanging off its tables, and
     every database any of them embeds. Capturing only the open page meant
     restoring a version silently left the nested pages at their newest state —
     a version that never existed.

     The four things that must be true before a single byte is authored are
     each asked once, in order, and any of them saying no ends the attempt with
     a message. This used to be four re-entrant calls to createVersion itself,
     which is both hard to follow and unbounded when one of them can never
     succeed. */
  createVersion(msg) {
    const p = this.page();
    if (!p) return;
    /* a deep capture can take several fetches; a second click during that
       window would author two snapshots of the same state. Held across the
       whole author, not just the prefetch: two calls in the same tick both
       read the pre-commit `p.versions` and each push onto it, so the second
       silently discards the first. */
    if (this._verLock) return;
    this._verLock = true;
    const pid = p.id;
    const done = () => { this._verLock = false; };
    const fail = (m) => { done(); this.toast(m); };

    /* 1 — the stored history. Version metadata is its own node, so a page
       whose list has not been fetched presents as `versions: []`; authoring
       against that gives the snapshot the number 1 and a list of one, which
       push() then writes over every real snapshot on the server. */
    const meta = this.versionMetaKnown(pid)
      ? Promise.resolve(true)
      : this.ensureVersionMeta(pid).then(() => this.versionMetaKnown(pid), () => false);

    meta.then(okMeta => {
      if (!okMeta) return fail('Could not load this page\u2019s history \u2014 try again in a moment');
      /* 2 — every body and every table in the subtree */
      return this.ensureSnapshotReady(pid).then(okAll => {
        if (!okAll) return fail('Could not load everything on this page \u2014 try again in a moment');
        /* 3 — the baseline the stat and the summary are measured against */
        return this.ensureBaseline(pid).then(okBase => {
          if (!okBase) return fail('Could not load the previous snapshot \u2014 try again in a moment');
          /* 4 — and the reader is still on the page they asked to snapshot */
          if (this.state.pageId !== pid) return fail('You left that page \u2014 nothing was captured');
          this.authorVersion(pid, msg);
        });
      });
    }, () => fail('Could not take a snapshot \u2014 try again in a moment'));
  }

  /* The author itself: everything it needs is already in hand, so it is
     synchronous and there is no window in which the list can move under it. */
  authorVersion(pageId, msg) {
    const p = this.state.pages[pageId];
    const done = () => { this._verLock = false; };
    if (!p) return done();
    const versions = (p.versions || []).slice();
    const last = versions.length ? versions[versions.length - 1] : null;
    const prevSnap = last ? this.vsnap(last.id) : null;
    const prevRoot = prevSnap ? prevSnap.b : [];

    const built = this.buildSnapshot(pageId, prevSnap);
    const snap = built.snap, rootStat = built.rootStat, deep = built.deep;
    const touched = deep.touched, gone = deep.gone;

    /* A snapshot of content identical to the last one is noise: it clutters
       the history and makes every diff against it read "identical". The first
       snapshot is the exception — that one establishes the baseline. */
    if (versions.length && !gone && rootStat.none && !deep.added && !deep.removed && !deep.changed) {
      done();
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
    this.cacheVersion(pageId, vid, snap);
    const entry = {
      id: vid, n: this.nextVersionN(versions), message: text, auto,
      createdAt: Date.now(), author: (this.state.user && this.state.user.name) || 'You',
      /* precomputed so the history panel never has to fetch a snapshot */
      stat: rootStat, deepStat: deep,
      /* the manifest lets the diff list nested pages without a fetch */
      scope: built.scope,
      title: p.title, icon: p.icon
    };
    /* Merged INSIDE the updater against whatever the list holds by then: a
       delta from another device can land between the read above and this
       write, and assigning the array read earlier would drop its snapshot. */
    this.setState(st => {
      const pg = st.pages[pageId];
      if (!pg) return null;
      return {
        pages: { ...st.pages, [pageId]: { ...pg, versions: this.mergeVersions(pg.versions, [entry]) } },
        modal: null, sheet: null
      };
    }, () => { done(); this.persist(); });
    const extra = touched ? ' · ' + touched + ' nested' : '';
    this.toast('Snapshot saved as v' + entry.n + extra);
  }

  /* ---- a snapshot payload, renamed onto a copy of the subtree -----------
     A payload names pages, tables, rows, views and blocks by id. Duplicating a
     page copied its version list with fresh version ids but left the payloads
     naming the ORIGINAL's pages and tables — so restoring one of them on the
     copy wrote the snapshot's child blocks into the original's children and
     replaced the original's tables. `maps` carries the old→new id mapping the
     duplicate already built for the live tree; anything the copy did not take
     is dropped rather than left pointing across. */
  remapSnapshot(raw, maps) {
    const snap = this.normSnap(raw);
    if (!snap) return null;
    const m = maps || {};
    const pg = (id) => (m.pages && m.pages[id]) || null;
    const dbid = (id) => (m.dbs && m.dbs[id]) || null;
    /* a block the copy also holds keeps that copy's id, so the snapshot and
       the working copy line up the way they do on the original page */
    const blk = (id) => (m.blocks && m.blocks[id]) || uid('b');
    const walk = (list) => (list || []).map(b => {
      const c = Object.assign({}, b, { id: blk(b.id) });
      if (c.type === 'subpage' && c.pageId) c.pageId = pg(c.pageId) || c.pageId;
      if (c.type === 'database' && c.dbId) c.dbId = dbid(c.dbId) || c.dbId;
      if (c.children) c.children = walk(c.children);
      if (c.cols) c.cols = c.cols.map(walk);
      return c;
    });
    const out = { b: walk(snap.b), d: {}, p: {} };
    Object.keys(snap.p || {}).forEach(id => {
      const nid = pg(id);
      if (!nid) return;
      const sub = Object.assign({}, snap.p[id], { b: walk(snap.p[id].b) });
      sub.pa = sub.pa ? (pg(sub.pa) || null) : null;
      if (sub.dr) {
        const nd = dbid(sub.dr[0]), nr = m.rows && m.rows[sub.dr[1]];
        if (nd && nr) sub.dr = [nd, nr]; else delete sub.dr;
      }
      out.p[nid] = sub;
    });
    Object.keys(snap.d || {}).forEach(id => {
      const nid = dbid(id);
      if (!nid) return;
      const d = JSON.parse(JSON.stringify(snap.d[id]));
      d.id = nid;
      (d.views || []).forEach(v => {
        const nv = m.views && m.views[v.id];
        if (!nv) return;
        if (d.defaultView === v.id) d.defaultView = nv;
        v.id = nv;
      });
      d.rows = (d.rows || []).map(r => {
        const nr = Object.assign({}, r);
        const rid = m.rows && m.rows[r.id];
        if (rid) nr.id = rid;
        if (nr.pageId) { const np = pg(nr.pageId); if (np) nr.pageId = np; else delete nr.pageId; }
        return nr;
      });
      out.d[nid] = d;
    });
    return out;
  }
  /* the metadata beside it: the manifest the diff reads without a fetch */
  remapVersionMeta(v, maps) {
    const m = maps || {};
    const pg = (id) => (m.pages && m.pages[id]) || null;
    const nv = Object.assign({}, JSON.parse(JSON.stringify(v)), { id: uid('v') });
    delete nv.blocks; delete nv.dbs;              // payload, and it lives apart
    nv.scope = (v.scope || []).map(x => ({
      id: pg(x.id), t: x.t, i: x.i, pa: x.pa ? pg(x.pa) : null
    })).filter(x => x.id);
    return nv;
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

  /* What a restore is actually going to touch — the nested pages it rewrites,
     the pages it has to recreate, and the tables it replaces. The tables are
     the sharp edge: a database is shared between every page that embeds it, so
     restoring a snapshot of THIS page can silently revert a table that another
     page also shows. That reaches outside the thing the reader asked to
     restore, so it is named before the click rather than discovered after.
     Returns null while the payload is still loading. */
  restoreScope(vid) {
    const snap = this.vsnap(vid);
    if (!snap) return null;
    const rootId = this.state.pageId;
    const inSubtree = {};
    this.snapshotIds(rootId).forEach(id => { inSubtree[id] = 1; });
    const nested = Object.keys(snap.p).map(id => {
      const cur = this.state.pages[id];
      return {
        id, title: snap.p[id].t || (cur && cur.title) || 'Untitled',
        missing: !cur, row: !!(snap.p[id].dr || (cur && cur.dbRef))
      };
    });
    const dbs = Object.keys(snap.d || {}).map(id => {
      const live = this.state.dbs[id];
      /* every page outside this subtree that embeds the same table */
      const where = Object.keys(this.state.pages).filter(pid => {
        if (inSubtree[pid] || snap.p[pid] || pid === rootId) return false;
        const pg = this.state.pages[pid];
        return pg && pg.blocks && !pg.trashed && this.dbIdsIn(pg.blocks).indexOf(id) >= 0;
      });
      return { id, name: (live && live.name) || (snap.d[id] && snap.d[id].name) || 'Table', where };
    });
    return { nested, dbs, sharedDbs: dbs.filter(d => d.where.length) };
  }

  restore(vid, mode) {
    const p = this.page(), v = this.versionById(vid);
    if (!v) return;
    /* the snapshot may not be local yet — fetch, then run the same path again.
       One attempt: a payload the server does not hold never arrives, and a
       re-entrant retry would fetch it forever. */
    if (!this.vsnap(vid)) {
      if (mode === 'ro') this.setState({ roVersion: vid, modal: null, sheet: null, panel: null });
      else this.setState({ restoring: true });
      this.ensureVersion(vid).then(() => {
        if (this.vsnap(vid)) { this.setState({ restoring: false }); this.restore(vid, mode); }
        else {
          /* leave a preview the reader has since moved on from alone */
          this.setState(st => ({ restoring: false, roVersion: st.roVersion === vid ? null : st.roVersion }));
          this.toast('Could not load that snapshot \u2014 try again in a moment');
        }
      }, () => {
        this.setState(st => ({ restoring: false, roVersion: st.roVersion === vid ? null : st.roVersion }));
        this.toast('Could not load that snapshot \u2014 try again in a moment');
      });
      return;
    }
    if (mode === 'ro') { this.setState({ roVersion: vid, modal: null, sheet: null, panel: null }); return; }
    /* Writing modes only: a second click during the safety snapshot's fetches
       would author two of them, and two restores would race each other. */
    if (this._verLock) return;
    this._verLock = true;
    const pid = p.id;
    const done = () => { this._verLock = false; };
    const fail = (m) => { done(); this.setState({ restoring: false }); this.toast(m); };

    if (mode !== 'new') { this.applyRestore(pid, vid, null); return; }

    /* The safety snapshot is a real snapshot and has to be as deep as the
       thing it protects: it waits for the same subtree and the same baseline
       createVersion waits for. Without that it captured only the pages that
       happened to be loaded, counted the rest as deleted, and left the reader
       with a way back that did not lead all the way back. */
    this.setState({ restoring: true });
    this.ensureSnapshotReady(pid).then(okAll => {
      if (!okAll) return fail('Could not load everything on this page \u2014 nothing was restored');
      return this.ensureBaseline(pid).then(okBase => {
        if (!okBase) return fail('Could not load the previous snapshot \u2014 nothing was restored');
        if (this.state.pageId !== pid) return fail('You left that page \u2014 nothing was restored');
        const cur = this.state.pages[pid];
        const vs = (cur.versions || []);
        const last = vs.length ? vs[vs.length - 1] : null;
        const built = this.buildSnapshot(pid, last ? this.vsnap(last.id) : null);
        const nvid = uid('v');
        this.cacheVersion(pid, nvid, built.snap);
        this.applyRestore(pid, vid, {
          id: nvid, n: this.nextVersionN(vs),
          message: 'Snapshot taken before restoring v' + v.n, auto: true,
          createdAt: Date.now(), author: (this.state.user && this.state.user.name) || 'You',
          stat: built.rootStat, deepStat: built.deep, scope: built.scope,
          title: cur.title, icon: cur.icon
        });
      });
    }, () => fail('Could not take the safety snapshot \u2014 nothing was restored'));
  }

  /* The write. One state update for the root, every captured child, every
     child deleted since (which is recreated, or the restored parent links to
     nothing) and every table the snapshot holds. Pages created AFTER the
     snapshot are left alone — deleting them would make restore destructive in
     a way nothing warned about. */
  applyRestore(pageId, vid, safety) {
    const snap = this.vsnap(vid);
    const host = this.state.pages[pageId];
    const v = host && (host.versions || []).find(x => x.id === vid);
    const clone = (x) => JSON.parse(JSON.stringify(x));
    const done = () => { this._verLock = false; };
    if (!snap || !v || !host) return done();

    /* ---- history ------------------------------------------------------
       A restore rewrites a whole subtree, so the step it files has to carry
       the subtree. It used to write straight to state: ⌘Z then filed the
       post-restore state as a fresh step and walked back to the ROOT page's
       old blocks only, leaving every nested page and every table at the
       restored state — a document that never existed. */
    const touched = [pageId].concat(Object.keys(snap.p));
    this.histFlush();
    this.syncTailDeep(pageId, touched);

    this._els = {}; this._refs = {}; this._mathEls = {}; this._mathRefs = {};

    let revived = 0, untrashed = 0;
    this.setState(st => {
      const pages = { ...st.pages };
      const dbs = (snap.d && Object.keys(snap.d).length)
        ? Object.assign({}, st.dbs, clone(snap.d)) : st.dbs;
      const cur = pages[pageId];
      const versions = safety ? this.mergeVersions(cur.versions, [safety]) : (cur.versions || []);
      pages[pageId] = { ...cur, versions, blocks: clone(snap.b),
                        title: v.title || cur.title, icon: v.icon || cur.icon,
                        updatedAt: Date.now(),
                        updatedBy: (st.user && st.user.name) || 'You' };
      Object.keys(snap.p).forEach(id => {
        const sub = snap.p[id];
        const was = pages[id];
        /* Fields the payload did not carry are the page's own business and
           are kept; a payload written before they were captured simply has
           none of them, which is why every one of these falls back. */
        const ref = sub.dr ? { dbId: sub.dr[0], rowId: sub.dr[1] } : (was && was.dbRef) || null;
        const shape = {
          blocks: clone(sub.b), title: sub.t || (was && was.title) || 'Untitled',
          icon: sub.i || (was && was.icon) || '',
          iconType: sub.it || (was && was.iconType) || '',
          cover: sub.c || (was && was.cover) || '',
          favorite: sub.f ? true : !!(was && was.favorite),
          hidden: sub.h ? true : !!(was && was.hidden),
          dbRef: ref,
          parentId: sub.pa, order: sub.o, updatedAt: Date.now()
        };
        if (was) {
          /* the restored parent links to this page, so it has to be reachable */
          if (was.trashed) untrashed++;
          pages[id] = { ...was, ...shape, trashed: false, trashRoot: false };
        } else {
          revived++;
          pages[id] = Object.assign({
            id, createdAt: Date.now(), trashed: false, trashRoot: false,
            propsCollapsed: false, versions: [],
            share: { published: false, slug: id, password: null, invites: [] }
          }, shape);
        }
      });
      return { pages, dbs, modal: null, sheet: null, roVersion: null, restoring: false };
    }, () => {
      /* the "after" side of the step, so ⌘Y walks forward into the restore */
      setTimeout(() => this.syncTailDeep(pageId, touched), 0);
      /* a restored table knows which pages are its rows — let it say so */
      Object.keys(snap.d || {}).forEach(id => this.repairRowPages(id));
      this.persist();
      done();
      const n = Object.keys(snap.p).length;
      const bits = [];
      if (n) bits.push(n + (n === 1 ? ' nested page' : ' nested pages'));
      if (revived) bits.push(revived + ' recreated');
      if (untrashed) bits.push(untrashed + ' brought back from the trash');
      this.toast((safety ? 'Restored v' + v.n + ' as a new version' : 'Restored v' + v.n)
        + (bits.length ? ' · ' + bits.join(' · ') : ''));
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
}, 'part-versions');
