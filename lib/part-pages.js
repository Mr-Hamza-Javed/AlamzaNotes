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
    this._els = {}; this._refs = {};
    /* The body is fetched here and nowhere else — this is the one moment the
       app is allowed to pull note text. Everything before this point renders
       from the index. */
    this.ensureBody(id).then(() => {
      /* tables embedded in this page load right behind it */
      const p = this.state.pages[id];
      if (p && p.blocks) this.ensureRowsFor(p.blocks);
      /* a database ROW page needs its parent table for the property editors */
      if (p && p.dbRef && p.dbRef.dbId) this.ensureRows(p.dbRef.dbId);
      this.reconcileChildren(id);
    });
    /* history metadata lives in its own node — without this the page renders
       with no snapshots, and the next save would push that emptiness */
    this.ensureVersionMeta(id).then(() => this.primeLatestVersion());
    setTimeout(() => this.primeLatestVersion(), 0);
    this.setState(s => ({
      pageId: id, main: 'page', roVersion: null, sheet: null, menu: null, slash: null,
      blockSel: [], focusId: null, selBar: null, linkCard: null,
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
    }, () => { this.persist(); setTimeout(() => { if (this._titleEl) this._titleEl.focus(); }, 50); });
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
  trashPage(id, purge) {
    const ids = this.descendants(id);
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
    this.setState(s => {
      const pages = {};
      Object.keys(s.pages).forEach(k => {
        if (purge && ids.indexOf(k) >= 0) return;
        const pg = JSON.parse(JSON.stringify(s.pages[k]));
        if (ids.indexOf(k) < 0) pg.blocks = strip(pg.blocks);
        if (ids.indexOf(k) >= 0 && !purge) { pg.trashed = true; pg.trashedAt = Date.now(); pg.trashRoot = k === id; }
        pages[k] = pg;
      });
      const nx = Object.values(pages).find(x => !x.trashed && !x.hidden);
      return {
        pages, blockSel: [],
        pageId: ids.indexOf(s.pageId) >= 0 ? (purge ? (nx ? nx.id : s.pageId) : s.pageId) : s.pageId
      };
    }, () => this.persist());
    const n = ids.length;
    this.toast(purge
      ? 'Deleted permanently'
      : (n > 1 ? 'Moved to trash with ' + (n - 1) + ' sub-page' + (n > 2 ? 's' : '') : 'Moved to trash'));
  }
  restorePage(id) {
    const ids = this.descendants(id);
    this.setState(s => {
      const pages = { ...s.pages };
      ids.forEach(k => {
        if (!pages[k]) return;
        pages[k] = Object.assign({}, pages[k], { trashed: false, trashRoot: false });
      });
      /* if its old parent is gone or still trashed, bring it back to the root */
      const root = pages[id];
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
      return { pages };
    }, () => this.persist());
    this.toast('Restored');
  }
});
