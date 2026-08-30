/* Alamza Notes — Pages — navigation, create, trash, restore, version accessors
 *
 * Methods of the app class, moved out verbatim. They run on the same
 * instance as everything in index.dc.html: `this.state`, `this.setState`,
 * `this.props` and every other method are all available here.
 * Registered onto Component.prototype by lib/parts.js.
 */
AlamzaParts.register(class {
  /* --------------------------------------------------------- flat render */
  flat() {
    const out = [];
    let n = 0;
    const walk = (list, depth) => {
      list.forEach(b => {
        if (b.type === 'ol') n++; else if (b.type !== 'ol') n = b.type === 'ol' ? n : 0;
        out.push({ id: b.id, block: b, depth });
        if (b.type === 'toggle' && !b.collapsed && b.children) walk(b.children, depth + 1);
      });
    };
    walk(this.activeBlocks(), 0);
    return out;
  }

  /* ------------------------------------------------------------ nav ops */
  openPage(id, anchor) {
    /* Undo history is kept PER PAGE and survives leaving one — this used to
       throw the outgoing page's away, which meant that making a sub-page or
       opening a database row, both of which navigate, destroyed the history of
       the page you did it from. What is still on a debounce is filed here, for
       the page being left, rather than lost. */
    this.histFlush();
    /* the reader has chosen a page — repairRowPages() must not move them */
    this._navigated = true;
    this._els = {}; this._refs = {};
    /* The body is fetched here and nowhere else — this is the one moment the
       app is allowed to pull note text. Everything before this point renders
       from the index. */
    this.ensureBody(id).then(() => {
      /* tables embedded in this page load right behind it */
      const p = this.state.pages[id];
      /* a database ROW page needs its parent table for the property editors */
      if (p && p.dbRef && p.dbRef.dbId) this.ensureRows(p.dbRef.dbId);
      /* reconcileChildren AFTER the tables, never beside them. A row page is a
         child of the page its table sits on, and the only thing that marks it
         as one is `hidden` — which repairRowPages() restores as each table's
         rows arrive. Reconciling first meant racing that repair, and losing the
         race appends a sub-page link for every row to the host page's body. */
      return (p && p.blocks ? this.ensureRowsFor(p.blocks) : Promise.resolve())
        .then(() => this.reconcileChildren(id));
    });
    /* history metadata lives in its own node — without this the page renders
       with no snapshots, and the next save would push that emptiness */
    this.ensureVersionMeta(id).then(() => this.primeLatestVersion());
    setTimeout(() => this.primeLatestVersion(), 0);
    this.setState(s => ({
      pageId: id, main: 'page', roVersion: null, sheet: null, menu: null, slash: null,
      blockSel: [], focusId: null, selBar: null, linkCard: null, cellEdit: null,
      panel: s.isMobile ? null : s.panel,
      stack: s.isMobile ? [...s.stack, s.pageId] : s.stack
    }));
    if (this._scroll) this._scroll.scrollTop = 0;
    if (anchor) this.flashBlock(anchor);
  }
  mobileBack() {
    const st = [...this.state.stack];
    const prev = st.pop();
    if (prev) this.setState({ pageId: prev, stack: st, roVersion: null });
    else this.goHome();
  }
  /* the phone's root screen: every note, searchable */
  goHome() {
    this.setState({ main: 'home', sheet: null, menu: null, roVersion: null, blockSel: [], focusId: null });
    if (this._scroll) this._scroll.scrollTop = 0;
  }
  newPage(parentId, afterId) {
    if (!this.needParent(parentId, () => this.newPage(parentId, afterId))) return null;
    const id = uid('p');
    const page = {
      id, parentId: parentId || null, icon: '', title: '', order: Date.now(),
      favorite: false, trashed: false, createdAt: Date.now(), updatedAt: Date.now(),
      updatedBy: (this.state.user && this.state.user.name) || 'You', versions: [],
      share: { published: false, slug: id, password: null, invites: [] },
      blocks: [{ id: uid('b'), type: 'p', text: '', indent: 0 }]
    };
    /* The sub-page block lands on the PARENT's page, so it belongs in the
       parent's history — and this call navigates to the child, so the state
       after the insert has to be filed against the parent by name rather than
       against whatever page is open by then. Without this, making a sub-page
       left no step at all and ⌘Z on the host did nothing. */
    if (parentId) this.syncTail(false, parentId);
    this.setState(s => {
      const pages = { ...s.pages, [id]: page };
      if (parentId && pages[parentId] && pages[parentId].blocks) {
        const par = { ...pages[parentId] };
        const list = par.blocks.slice();
        const nb = { id: uid('b'), type: 'subpage', text: '', indent: 0, pageId: id };
        let at = list.length;
        if (afterId) { const j = list.findIndex(x => x.id === afterId); if (j >= 0) at = j + 1; }
        list.splice(at, 0, nb);
        if (afterId) { const j2 = list.findIndex(x => x.id === afterId); if (j2 >= 0 && list[j2].type === 'p' && !list[j2].text) list.splice(j2, 1); }
        par.blocks = list;
        pages[parentId] = par;
      }
      const expanded = parentId ? { ...s.expanded, [parentId]: true } : s.expanded;
      return { pages, pageId: id, main: 'page', expanded, sheet: null };
    }, () => {
      this.persist();
      if (parentId) this.syncTail(false, parentId);
      setTimeout(() => { if (this._titleEl) this._titleEl.focus(); }, 50);
    });
    return id;
  }

  versionById(vid) { const p = this.page(); return p && (p.versions || []).find(v => v.id === vid); }

  /* ---- version bodies are cold data ----------------------------------
     A snapshot's blocks are the heaviest thing in the workspace and the least
     read: history is append-only, so a body written once is never rewritten
     and usually never looked at again. They are stored outside the page and
     fetched on demand; `stat` is computed at snapshot time so the history
     panel can show +/- counts without touching a single body. */
  /* A snapshot payload is `{ b, d, p }` — the root page's blocks, the
     databases it uses, and every descendant page keyed by id. Snapshots
     written before deep capture existed are a bare block array, so they are
     normalised here rather than at twenty call sites. */
  normSnap(raw) {
    if (!raw) return null;
    if (Array.isArray(raw)) return { b: raw, d: {}, p: {} };
    return { b: raw.b || [], d: raw.d || {}, p: raw.p || {} };
  }
  vsnap(vid) {
    if (!vid || vid === 'current') return null;
    if (this._vb && this._vb[vid]) return this._vb[vid];
    const v = this.versionById(vid);
    return v && v.blocks ? this.normSnap(v.blocks) : null;
  }
  vblocks(vid, pageId) {
    const s = this.vsnap(vid);
    if (!s) return null;
    if (!pageId || pageId === (this.state.pageId)) return s.b;
    const sub = s.p[pageId];
    return sub ? (sub.b || []) : null;
  }
  ensureVersion(vid) {
    if (!vid || vid === 'current') return Promise.resolve(null);
    const have = this.vsnap(vid);
    if (have) return Promise.resolve(have);
    const p = this.page();
    if (!p || !AStore.getVersionBlocks) return Promise.resolve(null);
    this._vb = this._vb || {};
    this._vbP = this._vbP || {};
    if (this._vbP[vid]) return this._vbP[vid];
    this._vbP[vid] = AStore.getVersionBlocks(p.id, vid).then((raw) => {
      delete this._vbP[vid];
      const snap = this.normSnap(raw);
      if (snap) { this._vb[vid] = snap; this.forceUpdate(); }
      return snap;
    });
    return this._vbP[vid];
  }
  /* Whenever `pageId` becomes current, its history must be fetched — and
     `openPage` is NOT the only way that happens. Boot resolves the first page
     directly, a remote delta can re-point it, and the versions panel can be
     opened on a page that arrived either way. Missing those left the most
     travelled path of all — the page the app opens on — showing whatever
     stale list the local mirror happened to hold. `vmetaSeen` makes this
     idempotent, so the cost is one small read per page per session. */
  syncVersionMeta() {
    const id = this.state.pageId;
    if (!id) return;
    /* The baseline snapshot is needed for the pending-changes readout, and it
       has the same "openPage is not the only path" problem as the metadata:
       prime it wherever the page becomes current, or the page the app opens on
       computes its readout against nothing. */
    this.ensureVersionMeta(id).then(() => this.primeLatestVersion());
    this.primeLatestVersion();
  }
  /* Version METADATA is its own node and was never read back — that is what
     made history vanish on a second device. Fetch it whenever a page opens. */
  ensureVersionMeta(pageId) {
    if (!pageId || !AStore.loadVersionMeta) return Promise.resolve(null);
    if (AStore.vmetaKnown && AStore.vmetaKnown(pageId)) return Promise.resolve(null);
    this._vmP = this._vmP || {};
    if (this._vmP[pageId]) return this._vmP[pageId];
    this._vmP[pageId] = AStore.loadVersionMeta(pageId).then(list => {
      delete this._vmP[pageId];
      if (!list) return null;
      this.setState(s => {
        const pg = s.pages[pageId];
        if (!pg) return null;
        /* a snapshot authored in this session outranks the fetched list */
        if ((pg.versions || []).length >= list.length) return null;
        return { pages: { ...s.pages, [pageId]: { ...pg, versions: list } } };
      });
      return list;
    });
    return this._vmP[pageId];
  }
  /* the newest snapshot is what "pending changes" compares against, so it is
     worth having before the user asks — and createVersion waits on it */
  primeLatestVersion() {
    const p = this.page();
    const vs = p && p.versions;
    if (vs && vs.length) this.ensureVersion(vs[vs.length - 1].id);
  }
  cacheVersion(pageId, vid, snap) {
    this._vb = this._vb || {};
    this._vb[vid] = snap;
    if (AStore.putVersionBlocks) AStore.putVersionBlocks(pageId, vid, snap);
    if (AStore.markVersionMeta) AStore.markVersionMeta(pageId);
  }
  /* every page in this page's subtree, root first, row pages excluded */
  subtreeIds(rootId) {
    return this.descendants(rootId).filter(id => {
      const pg = this.state.pages[id];
      return pg && !pg.hidden && !pg.trashed;
    });
  }

  /* Trashing (or purging) a page also removes the sub-page blocks that point
     at it, so no note is ever left showing "Missing page". */
  /* R8 — trashing a page trashes its whole subtree. The sub-page block that
     pointed at it is removed from the parent, but the pages themselves stay
     openable from Trash (tinted red) until they are purged. */
  descendants(id, pages) {
    const src = pages || this.state.pages;
    const out = [id];
    for (let i = 0; i < out.length; i++) {
      Object.values(src).forEach(p => {
        if (p.parentId === out[i] && out.indexOf(p.id) < 0) out.push(p.id);
      });
    }
    return out;
  }
  /* ---- a row and its page are one thing ---------------------------------
     A database row and the page it opens as are two halves of one object, and
     for a long time each half could be destroyed on its own: "Delete row" left
     the page behind as an orphan nobody could reach, and trashing the page
     from its own ⋯ menu left the row in the table pointing at something the
     reader could only open read-only.

     So both doors lead here. Trashing a row page takes its row out of the
     table and keeps a copy on the page; restoring the page puts the row back
     where it was. The copy is what makes Trash mean the same thing for a row
     as it does for a note — recoverable, not merely hidden.

     Only the page being trashed DIRECTLY is treated this way. Row pages that
     are merely swept up as descendants of a trashed host keep their rows: the
     whole table is going to the Trash with the host and has to come back
     whole. */
  trashPage(id, purge) {
    const ids = this.descendants(id);
    const target = this.state.pages[id];
    const ref = !purge && target && target.dbRef;
    const db = ref && this.state.dbs[ref.dbId];
    /* the row cannot be taken out of a table whose rows never arrived — fetch
       them and come back, rather than writing a row set we do not hold */
    if (ref && db && !db.rows) {
      this.ensureRows(ref.dbId).then(okRows => {
        if (okRows) this.trashPage(id, purge);
        else this.toast('Could not load that table — try again in a moment');
      });
      return;
    }
    const at = db && db.rows ? db.rows.findIndex(r => r.id === ref.rowId) : -1;
    const backup = at >= 0
      ? { dbId: ref.dbId, at, row: JSON.parse(JSON.stringify(db.rows[at])) }
      : null;
    /* Purging takes the pages themselves away, so any table embedded in one of
       them loses its only reference here rather than through mutate(). */
    const purgedDbs = purge
      ? ids.reduce((acc, k) => {
          const pg = this.state.pages[k];
          return pg && pg.blocks ? acc.concat(this.dbIdsIn(pg.blocks)) : acc;
        }, [])
      : [];
    /* `null` means the body was never fetched — it is NOT an empty page. Turning
       it into [] here would mark the page loaded-and-dirty, and the next push
       would write that emptiness over the real body in the database. A body we
       do not hold cannot contain a live subpage block anyway, and any stale
       reference is cleaned the next time that page is opened and saved. */
    const strip = (blocks) => blocks == null ? null : blocks.filter(b => {
      if (b.type === 'subpage' && b.pageId === id) return false;
      if (b.children) b.children = strip(b.children) || [];
      if (b.cols) b.cols = b.cols.map(c => strip(c) || []);
      return true;
    });
    /* One write for the page set AND the table, so no ordering ambiguity can
       open up between two queued updaters — the same rule applyRowDrop follows. */
    this.setState(s => {
      const pages = {};
      Object.keys(s.pages).forEach(k => {
        if (purge && ids.indexOf(k) >= 0) return;
        const pg = JSON.parse(JSON.stringify(s.pages[k]));
        if (ids.indexOf(k) < 0) pg.blocks = strip(pg.blocks);
        if (ids.indexOf(k) >= 0 && !purge) { pg.trashed = true; pg.trashedAt = Date.now(); pg.trashRoot = k === id; }
        if (k === id && backup) pg.dbRowBackup = backup;
        pages[k] = pg;
      });
      let dbs = s.dbs;
      if (backup) {
        dbs = { ...s.dbs };
        const d = JSON.parse(JSON.stringify(dbs[backup.dbId]));
        d.rows = (d.rows || []).filter(r => r.id !== ref.rowId);
        dbs[backup.dbId] = d;
      }
      /* Leaving the reader on a trashed row page is a dead end — it is not in
         the sidebar, so there is nothing to click. Step back to the table. */
      const leaving = ids.indexOf(s.pageId) >= 0;
      const home = (backup && target.parentId && pages[target.parentId] && !pages[target.parentId].trashed)
        ? target.parentId : null;
      const nx = Object.values(pages).find(x => !x.trashed && !x.hidden);
      return {
        pages, dbs, blockSel: [],
        pageId: leaving
          ? (home || (purge ? (nx ? nx.id : s.pageId) : s.pageId))
          : s.pageId
      };
    }, () => { this.persist(); this.collectDatabases(purgedDbs); });
    const n = ids.length;
    this.toast(purge
      ? 'Deleted permanently'
      : backup
        ? 'Row moved to trash — restore it to put it back in the table'
        : (n > 1 ? 'Moved to trash with ' + (n - 1) + ' sub-page' + (n > 2 ? 's' : '') : 'Moved to trash'));
  }
  restorePage(id) {
    const ids = this.descendants(id);
    const was = this.state.pages[id];
    const backup = was && was.dbRowBackup;
    /* the table has to be in hand before its row can go back into it */
    if (backup && this.state.dbs[backup.dbId] && !this.state.dbs[backup.dbId].rows) {
      this.ensureRows(backup.dbId).then(okRows => {
        if (okRows) this.restorePage(id);
        else this.toast('Could not load that table — try again in a moment');
      });
      return;
    }
    /* A row page restored while its table is gone would come back invisible:
       hidden, out of the tree, and with nothing left to open it from. Let it
       return as an ordinary page instead — the note is what the reader wanted
       back, and it is better visible than correct-but-unreachable. */
    const table = backup && this.state.dbs[backup.dbId];
    const orphaned = !!backup && !table;
    this.setState(s => {
      const pages = { ...s.pages };
      ids.forEach(k => {
        if (!pages[k]) return;
        pages[k] = Object.assign({}, pages[k], { trashed: false, trashRoot: false });
      });
      let dbs = s.dbs;
      if (backup && table) {
        dbs = { ...s.dbs };
        const d = JSON.parse(JSON.stringify(dbs[backup.dbId]));
        d.rows = d.rows || [];
        if (!d.rows.some(r => r.id === backup.row.id)) {
          d.rows.splice(Math.min(backup.at, d.rows.length), 0, JSON.parse(JSON.stringify(backup.row)));
        }
        dbs[backup.dbId] = d;
      }
      if (backup) {
        pages[id] = Object.assign({}, pages[id], { dbRowBackup: null });
        if (orphaned) pages[id] = Object.assign({}, pages[id], { dbRef: null, hidden: false });
      }
      /* A row page that went back into its table belongs to the table, not to
         the page tree — it needs neither a sub-page link nor a reparent. */
      const root = pages[id];
      if (backup && !orphaned) return { pages, dbs };
      /* if its old parent is gone or still trashed, bring it back to the root */
      if (root && root.parentId && (!pages[root.parentId] || pages[root.parentId].trashed)) {
        pages[id] = Object.assign({}, root, { parentId: null, order: Date.now() });
      } else if (root && root.parentId) {
        const par = JSON.parse(JSON.stringify(pages[root.parentId]));
        const has = (list) => (list || []).some(b =>
          (b.type === 'subpage' && b.pageId === id) ||
          (b.children && has(b.children)) || (b.cols && b.cols.some(has)));
        /* only touch a parent whose real body we hold — see needParent() */
        if (par.blocks && !has(par.blocks)) {
          par.blocks = par.blocks.concat([{ id: uid('b'), type: 'subpage', text: '', indent: 0, pageId: id }]);
          pages[root.parentId] = par;
        }
      }
      return { pages, dbs };
    }, () => this.persist());
    this.toast(orphaned
      ? 'Restored as a page — its table is gone'
      : backup ? 'Row restored to its table' : 'Restored');
  }
}, 'part-pages');
