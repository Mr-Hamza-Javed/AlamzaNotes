/* Alamza Notes — Data access — pages, bodies, rows, roles, mutate
 *
 * Methods of the app class, moved out verbatim. They run on the same
 * instance as everything in index.dc.html: `this.state`, `this.setState`,
 * `this.props` and every other method are all available here.
 * Registered onto Component.prototype by lib/parts.js.
 */
AlamzaParts.register(class {
  /* --------------------------------------------------------------- data */
  page() { return this.state.pages[this.state.pageId] || null; }

  /* `pageId` outlives the pages it names: it is persisted, it is seeded with a
     demo id, and with the split layout the real pages arrive asynchronously
     long after boot. Any path that receives pages must run the id back through
     here, or the document pane stays pointed at a page that does not exist and
     renders nothing — which, right after a storage migration, reads as data
     loss. Returns null only when the workspace is genuinely empty. */
  resolvePageId(pages, want, keepTrashed) {
    if (want && pages[want] && !pages[want].trashed) return want;
    /* A trashed page is read-only, so BOOT must never land on one — otherwise
       every reload after a trash drops the user on a page they cannot edit.
       Opening one deliberately from Trash still works: openPage() sets pageId
       directly, and remote deltas pass keepTrashed so they do not yank the
       user off a page they chose to look at. */
    if (keepTrashed && want && pages[want]) return want;
    /* A database row page is not somewhere to LAND. It is reached through its
       table, it is not in the sidebar, and it is very often the most recently
       updated page in the workspace — so the plain recency fallback would open
       the app on a row, one level below anything the tree can show. Opening
       one deliberately still works; `want` is honoured above. (It only became
       possible to land on one when `hidden` started surviving a reload.) */
    const live = Object.values(pages)
      .filter(x => !x.trashed)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const shown = live.filter(x => !x.hidden);
    return shown.length ? shown[0].id : (live.length ? live[0].id : null);
  }
  /* While previewing a version, read its databases rather than the live ones.
     From the PAYLOAD (`vsnap().d`), not from the version metadata: the tables
     used to be copied into the metadata too, and metadata is what every page
     open downloads — so a snapshot of a 400-row table was pulled down with the
     history list, every time. The payload is fetched only when a version is
     actually opened, which is exactly when this is asked. While it is still in
     flight `vsnap` is null and the page renders its loading skeleton, so the
     live-table fallback below is never what the reader sees. */
  dbFor(dbId) {
    if (this.state.roVersion) {
      const s = this.vsnap(this.state.roVersion);
      if (s && s.d && s.d[dbId]) return s.d[dbId];
    }
    return this.state.dbs[dbId];
  }
  activeBlocks() {
    const ro = this.state.roVersion;
    if (ro) { const v = this.versionById(ro); if (v) return this.vblocks(ro) || []; }
    const p = this.page(); return p ? (p.blocks || []) : [];
  }
  /* ---- bodies arrive on demand -----------------------------------------
     `blocks === null` means "not fetched yet", which is NOT the same as an
     empty note: rendering [] and letting an edit save would overwrite real
     text with nothing. Everything that writes checks bodyReady first. */
  bodyReady(id) {
    const p = this.state.pages[id || this.state.pageId];
    return !!(p && p.blocks);
  }
  ensureBody(id) {
    if (!id || this.bodyReady(id)) return Promise.resolve(true);
    if (!AStore.loadBody) return Promise.resolve(false);
    this._loadingBody = this._loadingBody || {};
    if (this._loadingBody[id]) return this._loadingBody[id];
    this._loadingBody[id] = AStore.loadBody(id).then(blocks => {
      delete this._loadingBody[id];
      /* null means the body is genuinely not there yet (a page created on
         another device, or one still migrating) — a brand-new page has [] */
      if (!blocks) {
        const pg = this.state.pages[id];
        if (pg && !pg.blockCount) {
          this.setState(s => s.pages[id] && !s.pages[id].blocks
            ? { pages: { ...s.pages, [id]: { ...s.pages[id], blocks: [] } } } : null);
          return true;
        }
        return false;
      }
      /* Resolve only once React has COMMITTED the body. needParent() re-runs
         the caller on this promise, and `setState` is async — resolving early
         meant the retry still saw `blocks: null`, bounced off the guard, and
         went round again for another fetch. */
      return new Promise(res => this.setState(s => {
        const pg = s.pages[id];
        if (!pg || pg.blocks) return null;
        return { pages: { ...s.pages, [id]: { ...pg, blocks } } };
      }, () => res(true)));
    });
    return this._loadingBody[id];
  }
  /* the pages whose text the sidebar/search/export need right now */
  ensureBodies(ids) { return Promise.all((ids || []).map(id => this.ensureBody(id))); }

  /* Any operation that INSERTS a sub-page link into a parent must hold that
     parent's real body first. Writing into a `null` body produces a page whose
     only block is the new link — the original content, never fetched, is gone
     on the next save. Returns false and re-runs `retry` once the body lands. */
  needParent(parentId, retry) {
    if (!parentId || this.bodyReady(parentId)) return true;
    this.ensureBody(parentId).then(ok => {
      if (ok) retry();
      /* never fail silently — the click would otherwise just do nothing */
      else this.toast('Could not load that page — try again in a moment');
    });
    return false;
  }

  /* ---- search digests ---------------------------------------------------
     Keywords used to ride along inside every index entry, so they were
     rebroadcast to the other device on every keystroke pause. They now live in
     their own node and arrive as ONE read, the first time someone actually
     searches — which in this app is rare. Until then, searching matches titles
     and snippets, which is already in memory. */
  digestMap() {
    /* local/demo mode has every body in memory, so there is nothing to fetch */
    if (AStore.mode !== 'firebase') return null;
    if (this._digests) return this._digests;
    const have = AStore.peekDigests && AStore.peekDigests();
    if (have) { this._digests = have; return have; }
    if (!this._digLoading && AStore.loadDigests) {
      this._digLoading = true;
      AStore.loadDigests().then(m => {
        this._digLoading = false;
        if (m) { this._digests = m; this.forceUpdate(); }
      });
    }
    return null;
  }
  digestFor(id) {
    if (this._digests) return this._digests[id] || '';
    const m = this.digestMap();
    return (m && m[id]) || '';
  }

  /* ---- database rows arrive on demand, exactly like page bodies ---------
     A table's schema, views and row count live in the index, so the header is
     honest from the first frame; the rows are one fetch, on first view. */
  rowsReady(dbId) {
    const d = this.state.dbs[dbId];
    return !!(d && d.rows);
  }
  ensureRows(dbId) {
    if (!dbId || this.rowsReady(dbId)) return Promise.resolve(true);
    if (!AStore.loadRows) return Promise.resolve(false);
    this._loadingRows = this._loadingRows || {};
    if (this._loadingRows[dbId]) return this._loadingRows[dbId];
    this._loadingRows[dbId] = AStore.loadRows(dbId).then(rows => {
      delete this._loadingRows[dbId];
      /* Symmetric to ensureBody(). An empty table is only believable when the
         index agrees it is empty; otherwise the rows are late, not absent, so
         we stay `null` — the skeleton holds, writes stay gated by rowsReady(),
         and dbmeta.o is never overwritten with an empty order. The absent case
         still has to resolve for a genuinely new table, or it loads forever. */
      const known = this.state.dbs[dbId];
      const empty = !known || !known.rowCount;
      if (!rows || rows.length === 0) {
        if (!empty) return false;
        this.setState(s => s.dbs[dbId] && !s.dbs[dbId].rows
          ? { dbs: { ...s.dbs, [dbId]: { ...s.dbs[dbId], rows: [] } } } : null);
        return true;
      }
      return new Promise(res => this.setState(s => {
        const d = s.dbs[dbId];
        if (!d || d.rows) return null;
        /* respect the stored order, which lives in the table's meta */
        return { dbs: { ...s.dbs, [dbId]: { ...d, rows } } };
      }, () => { this.repairRowPages(dbId); res(true); }));
    });
    return this._loadingRows[dbId];
  }
  /* ---- repairing row pages stripped by the old index format --------------
     `toIdx()` used to drop `dbRef` and `hidden`, so every row page in a
     workspace saved under that format came back as an ordinary page: no
     properties panel, no title mirroring, and — worst of it — visible to
     `reconcileChildren()`, which then wrote a sub-page link for it into the
     page holding the table.

     The link is only broken in one direction. The ROW still remembers its
     page in `row.pageId`, so the moment a table's rows arrive we can put back
     what the page forgot. It runs per table rather than once at boot because
     rows are fetched on demand — there is no earlier moment at which the
     answer is known. Pages already correct are left alone, so this is a no-op
     on every load after the first. */
  repairRowPages(dbId) {
    const db = this.state.dbs[dbId];
    if (!db || !db.rows) return;
    const fix = [];
    db.rows.forEach(r => {
      if (!r.pageId) return;
      const pg = this.state.pages[r.pageId];
      if (!pg) return;
      const wantRef = !pg.dbRef || pg.dbRef.dbId !== dbId || pg.dbRef.rowId !== r.id;
      if (wantRef || !pg.hidden) fix.push({ id: r.pageId, rowId: r.id });
    });
    if (!fix.length) return;
    /* On the FIRST boot of a workspace saved under the old format nothing yet
       knows these are rows, so resolvePageId's recency fallback can land on
       one — row pages are usually the most recently touched thing there is.
       Once the rows arrive and we find out, step back to the table. Only for a
       landing nobody chose: any deliberate navigation sets `_navigated`. */
    const land = !this._navigated && fix.some(f => f.id === this.state.pageId);
    const parent = land && this.state.pages[this.state.pageId].parentId;
    this.setState(s => {
      const pages = { ...s.pages };
      fix.forEach(f => {
        const pg = pages[f.id];
        if (!pg) return;
        pages[f.id] = { ...pg, dbRef: { dbId, rowId: f.rowId }, hidden: true };
      });
      const move = parent && pages[parent] && !pages[parent].trashed;
      return move ? { pages, pageId: parent } : { pages };
    }, () => this.persist());
  }
  /* every table this workspace already holds rows for — the demo adapter has
     them all in memory from the first frame, and a warm cache can too */
  repairAllRowPages() {
    Object.keys(this.state.dbs || {}).forEach(id => this.repairRowPages(id));
  }
  /* every database embedded in a set of blocks — needed before a snapshot or
     an export, both of which serialise tables in full */
  dbIdsIn(blocks) {
    const out = [];
    (function walk(list) {
      (list || []).forEach(b => {
        if (b.type === 'database' && b.dbId && out.indexOf(b.dbId) < 0) out.push(b.dbId);
        if (b.children) walk(b.children);
        if (b.cols) b.cols.forEach(walk);
      });
    })(blocks);
    return out;
  }
  ensureRowsFor(blocks) { return Promise.all(this.dbIdsIn(blocks).map(id => this.ensureRows(id))); }
  /* B15 — an accepted invite carries a role, and the role is enforced.
     owner/editor may write; commenter may only comment; viewer is read-only. */
  myRole(page) {
    const p = page || this.state.pages[this.state.pageId];
    if (!p) return 'owner';
    /* Only an invite addressed to ME can lower my role. One array holds both
       the invites this account sent and the ones it received, so without the
       recipient check an owner who invited a viewer and then accepted their
       own invitation became a viewer of their own page. */
    const acc = (this.state.invites || []).find(i =>
      i.pageId === p.id && i.status === 'accepted' && this.invitedMe(i));
    return acc ? acc.role : 'owner';
  }
  canEdit(page) { const r = this.myRole(page); return r === 'owner' || r === 'editor'; }
  canComment(page) { const r = this.myRole(page); return r !== 'viewer'; }

  isReadOnly() {
    const p = this.state.pages[this.state.pageId];
    return !!this.state.roVersion || this.state.route === 'public' ||
      !!(p && p.trashed) || !this.canEdit(p);
  }

  patchPage(id, patch, quiet) {
    this.setState(s => {
      const pages = { ...s.pages };
      pages[id] = Object.assign({}, pages[id], patch, quiet ? {} : { updatedAt: Date.now(), updatedBy: (s.user && s.user.name) || 'You' });
      return { pages };
    }, () => this.persist());
  }
  /* `allow` is the explicit intent to write while the page is read-only to
     this user — currently only a commenter adding a comment. */
  setBlocks(blocks, allow) {
    if (this.isReadOnly() && !allow) return; // never write through a version preview
    this.patchPage(this.state.pageId, { blocks });
  }

  /* Find a block in the (possibly nested) tree. `parent` comes back with it,
     because a block nested inside a toggle needs to know what it is nested in
     to be able to climb out of it. */
  locate(id, list, parent) {
    list = list || this.activeBlocks();
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) return { list, i, block: list[i], parent: parent || null };
      if (list[i].children) { const r = this.locate(id, list[i].children, list[i]); if (r) return r; }
      if (list[i].cols) {
        for (let c = 0; c < list[i].cols.length; c++) {
          const r2 = this.locate(id, list[i].cols[c], list[i]); if (r2) return r2;
        }
      }
    }
    return null;
  }

  /* compact row data for blocks living inside a column */
  miniRow(b, parentId, ci) {
    const t = b.type;
    const src = this.state.prefs.sourceView;
    return {
      id: b.id, ref: this.elRef(b.id),
      input: () => this.onInput(b.id), key: (e) => this.onKey(b.id, e),
      focus: () => this.onFocus(b.id), blur: () => this.onBlur(b.id),
      paste: (e) => this.onPaste(b.id, e),
      ph: this.state.focusId === b.id ? "Write, or press '/'" : ' ',
      size: t === 'h1' ? '24px' : t === 'h2' ? '19px' : t === 'h3' ? '16.5px' : '15.5px',
      weight: t && t.charAt(0) === 'h' ? '600' : '400',
      top: t === 'h1' ? '14px' : t === 'h2' ? '12px' : t === 'h3' ? '10px' : '0px',
      color: COLOR_HEX[b.color] || 'inherit',
      isDivider: t === 'divider',
      isTodo: t === 'todo',
      isBullet: t === 'ul' || t === 'ol',
      bullet: t === 'ol' ? '1.' : (src ? '-' : '•'),
      tick: b.checked ? '✓' : '',
      boxBg: b.checked ? 'var(--accent)' : 'transparent',
      boxBorder: b.checked ? 'var(--accent)' : 'var(--faint)',
      check: () => this.mutate(bs => { const g = this.locate(b.id, bs); if (g) g.block.checked = !g.block.checked; }),
      isQuote: t === 'quote',
      isText: t !== 'divider'
    };
  }
  /* Guard every structural write: a mutation against a body that has not
     arrived would serialise `null` over real text. */
  mutate(fn, opts) {
    if (!this.bodyReady()) { this.ensureBody(this.state.pageId); return; }
    return this._mutate(fn, opts);
  }
  _mutate(fn, opts) {
    const o = typeof opts === 'boolean' ? { noHist: opts } : (opts || {});
    const allow = !!o.allowInReadOnly;
    if (this.isReadOnly() && !allow) return;
    if (!o.noHist) this.syncTail();
    const blocks = JSON.parse(JSON.stringify(this.activeBlocks()));
    /* which tables this page held BEFORE the edit — every route that can
       remove a database block (the ⠿ menu, ⌘⇧⌫, a multi-block selection, a
       cut, typing over a selection) funnels through here, so this is the one
       place that sees them all */
    const hadDbs = this.dbIdsIn(blocks);
    const r = fn(blocks);
    const out = this.repair(r === undefined ? blocks : r);
    this.setBlocks(out, allow);
    if (hadDbs.length) {
      const now = this.dbIdsIn(out);
      this.collectDatabases(hadDbs.filter(id => now.indexOf(id) < 0));
    }
    if (!o.noHist) setTimeout(() => this.syncTail(), 0);
  }
}, 'part-data');
