/* Alamza Notes — Databases — props, views, filters, sorts, rows
 *
 * Methods of the app class, moved out verbatim. They run on the same
 * instance as everything in index.dc.html: `this.state`, `this.setState`,
 * `this.props` and every other method are all available here.
 * Registered onto Component.prototype by lib/parts.js.
 */
AlamzaParts.register(class {
  /* --------------------------------------------------------- databases */
  chipColor(label) {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const str = String(label == null ? '' : label);
    let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
    return dark
      ? { bg: 'hsla(' + h + ',60%,55%,.20)', fg: 'hsl(' + h + ',70%,74%)' }
      : { bg: 'hsla(' + h + ',72%,48%,.14)', fg: 'hsl(' + h + ',62%,32%)' };
  }
  cellText(pr, r) {
    const v = r.cells[pr.id];
    if (pr.type === 'createdTime') return r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '—';
    if (pr.type === 'editedTime') return r.updatedAt ? relTime(r.updatedAt) : '—';
    if (pr.type === 'createdBy' || pr.type === 'editedBy') return v || (this.state.user && this.state.user.name) || '—';
    if (pr.type === 'number' && v !== '' && v != null) return String(v);
    return v == null || v === '' ? '—' : String(v);
  }
  dbRowVals(db) {
    /* `rows === null` means the table's rows have not been fetched. Schema and
       row COUNT are already in the index, so the header renders truthfully and
       only the rows themselves wait. Same contract as a page body: never
       render [] for "not loaded", or an edit would save that emptiness. */
    const blank = (loading, d) => ({
      dbIsList: false, dbIsCard: false, dbIsTable: false, dbIsBoard: false,
      dbViews: [], dbRows: [], dbProps: [], dbGroups: [],
      filterColor: 'var(--muted)', filterBg: 'transparent', sortColor: 'var(--muted)', sortBg: 'transparent',
      dbOpenProps: () => {}, dbFilter: () => {}, dbSort: () => {}, dbAddRow: () => {},
      dbName: (d && d.name) || 'Database',
      dbCount: d && d.rowCount ? d.rowCount + (d.rowCount === 1 ? ' item' : ' items') : '',
      dbLoading: !!loading,
      dbSkeleton: loading
        ? Array.from({ length: Math.max(2, Math.min(6, (d && d.rowCount) || 3)) },
            (_, i) => ({ w: [88, 72, 84, 64, 80, 68][i % 6] + '%', delay: (i * 70) + 'ms' }))
        : [],
      dbPickIcon: () => {}, dbMenu: () => {}, dbIconEl: null
    });
    if (!db) return blank(false, null);
    if (!db.rows) { this.ensureRows(db.id); return blank(true, db); }
    const s = this.state;
    const vid = s.dbView[db.id] || db.defaultView || db.views[0].id;
    const view = db.views.find(v => v.id === vid) || db.views[0];
    let rows = db.rows.slice();
    (view.filters || []).forEach(f => {
      rows = rows.filter(r => { const v = r.cells[f.prop]; return Array.isArray(v) ? v.indexOf(f.value) >= 0 : String(v) === String(f.value); });
    });
    (view.sorts || []).forEach(so => {
      rows.sort((a, c) => { const x = a.cells[so.prop], y = c.cells[so.prop]; const n = x > y ? 1 : x < y ? -1 : 0; return so.dir === 'desc' ? -n : n; });
    });
    const nameProp = db.props[0];
    const props = db.props.filter(pr => (view.hidden || []).indexOf(pr.id) < 0);
    const chipsFor = (r, limit) => {
      const out = [];
      props.forEach(p => {
        if (out.length >= (limit || 3)) return;
        const v = r.cells[p.id];
        if ((p.type === 'select' || p.type === 'status') && v) out.push(Object.assign({ label: v }, this.optStyle(p, v)));
        if (p.type === 'multiSelect' && Array.isArray(v)) v.slice(0, 2).forEach(x => out.push(Object.assign({ label: x }, this.optStyle(p, x))));
      });
      return out;
    };
    const widths = props.map((p, i) => (i === 0 ? '240px' : p.type === 'checkbox' ? '80px' : '140px'));
    const mk = (r) => ({
      id: r.id, iconEl: this.iconEl(r, 16), coverIcon: r.icon || '',
      cover: r.cover || 'linear-gradient(135deg,#8E8E8E,#B9B9B9)',
      title: r.cells[nameProp.id] || 'Untitled',
      chips: chipsFor(r, 3), boardChips: chipsFor(r, 2),
      meta: r.cells.due || '',
      open: () => { if (!this._rowMoved) this.openRowPage(db, r); },
      context: (e) => { e.preventDefault(); e.stopPropagation(); this.setState({ menu: { kind: 'dbrow', dbId: db.id, rowId: r.id, x: e.clientX, y: e.clientY } }); },
      grab: (e) => this.rowGrab(db.id, r.id, e, vid),
      dragOp: this.state.rowDrag === r.id ? .4 : 1,
      cells: props.map((p, i) => {
        const v = r.cells[p.id];
        const isChips = !!OPTION_TYPES[p.type];
        const arr = p.type === 'multiSelect' ? (Array.isArray(v) ? v : []) : (v ? [v] : []);
        const txt = this.cellText(p, r);
        return {
          w: widths[i], isChips, isCheck: p.type === 'checkbox', isText: !isChips && p.type !== 'checkbox',
          chips: arr.map(x => Object.assign({ label: x }, this.optStyle(p, x))),
          tick: v ? '✓' : '', boxBg: v ? 'var(--accent)' : 'transparent', boxBorder: v ? 'var(--accent)' : 'var(--faint)',
          text: txt,
          color: txt === '—' ? 'var(--faint)' : 'var(--text)'
        };
      })
    });
    const mapped = rows.map(mk);
    let groups = [];
    if (view.type === 'board') {
      const gp = props.find(p => p.id === view.groupBy) || props.find(p => OPTION_TYPES[p.type]);
      const names = gp ? (gp.options || []).map(o => o.name) : [];
      groups = names.map(n => {
        const list = rows.filter(r => r.cells[gp.id] === n);
        const c = this.optStyle(gp, n);
        return { name: n, bg: c.bg, fg: c.fg, count: list.length, rows: list.map(mk) };
      });
      if (gp) {
        const none = rows.filter(r => !r.cells[gp.id]);
        if (none.length) {
          const c0 = PROP_COLOR_MAP.default;
          const dark = document.documentElement.getAttribute('data-theme') === 'dark';
          groups.push({ name: 'No ' + gp.name, bg: dark ? c0.dbg : c0.bg, fg: dark ? c0.dfg : c0.fg, count: none.length, rows: none.map(mk) });
        }
      }
    }
    const nF = (view.filters || []).length, nS = (view.sorts || []).length;
    return {
      dbName: db.name, dbCount: rows.length + (rows.length === 1 ? ' item' : ' items'),
      dbIsList: view.type === 'list', dbIsCard: view.type === 'card',
      dbIsTable: view.type === 'table', dbIsBoard: view.type === 'board',
      dbViews: db.views.map(v => ({
        name: v.name, glyph: VIEW_GLYPH[v.type] || '☰',
        isDefault: db.defaultView === v.id,
        bg: v.id === vid ? 'var(--soft)' : 'transparent',
        color: v.id === vid ? 'var(--text)' : 'var(--muted)',
        weight: v.id === vid ? '600' : '400',
        select: () => this.setState(st => ({ dbView: { ...st.dbView, [db.id]: v.id } })),
        menu: (e) => {
          e.stopPropagation(); e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          this.setState({ menu: { kind: 'viewedit', dbId: db.id, viewId: v.id, x: r.left, y: r.bottom + 6 } });
        }
      })),
      dbAddView: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); this.setState({ menu: { kind: 'newview', dbId: db.id, x: r.left, y: r.bottom + 6 } }); },
      dbIconEl: this.iconEl({ icon: db.icon }, 15),
      dbMenu: (e) => { e.stopPropagation(); e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); this.setState({ menu: { kind: 'dbedit', dbId: db.id, viewId: vid, x: r.left, y: r.bottom + 6 } }); },
      dbPickIcon: (e) => { e.stopPropagation(); this.setState({ modal: { kind: 'emoji', target: 'db', dbId: db.id } }); },
      dbRows: mapped, dbGroups: groups, dbLoading: false, dbSkeleton: [],
      dbProps: props.map((p, i) => ({
        name: p.name, w: widths[i], glyph: (PROP_TYPES.find(t => t.id === p.type) || {}).glyph || 'Aa',
        menu: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); this.setState({ menu: { kind: 'propedit', dbId: db.id, propId: p.id, viewId: vid, x: r.left, y: r.bottom + 4 } }); }
      })),
      dbCanSort: !(view.sorts || []).length,
      dbAddProp: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); this.setState({ menu: { kind: 'newprop', dbId: db.id, viewId: vid, x: Math.max(12, r.left - 150), y: r.bottom + 6 } }); },
      filterColor: nF ? 'var(--accent)' : 'var(--muted)', filterBg: nF ? 'var(--accent-soft)' : 'transparent',
      sortColor: nS ? 'var(--accent)' : 'var(--muted)', sortBg: nS ? 'var(--accent-soft)' : 'transparent',
      dbOpenProps: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); this.setState({ menu: { kind: 'dbprops', dbId: db.id, viewId: vid, x: Math.max(12, r.left - 60), y: r.bottom + 6 } }); },
      dbFilter: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); this.setState({ menu: { kind: 'dbfilter', dbId: db.id, viewId: vid, x: Math.max(12, r.left - 90), y: r.bottom + 6 } }); },
      dbSort: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); this.setState({ menu: { kind: 'dbsort', dbId: db.id, viewId: vid, x: Math.max(12, r.left - 90), y: r.bottom + 6 } }); },
      dbAddRow: (e) => {
        e.stopPropagation();
        const rid = uid('r');
        this.setState(st => {
          const dbs = { ...st.dbs }; const d = JSON.parse(JSON.stringify(dbs[db.id]));
          const cells = { [nameProp.id]: 'Untitled' };
          const cp = d.props.filter(x => x.id === 'created' || (x.type === 'date' && /created/i.test(x.name)))[0];
          if (cp) cells[cp.id] = new Date().toISOString().slice(0, 10);
          d.rows.push({ id: rid, icon: '', cover: '', cells });
          dbs[db.id] = d; return { dbs };
        }, () => { this.persist(); const d2 = this.state.dbs[db.id]; this.openRowPage(d2, d2.rows.find(x => x.id === rid)); });
      }
    };
  }
  /* A database row IS a page: it opens full-screen, takes blocks, nested pages. */
  openRowPage(db, row) {
    const existing = row.pageId && this.state.pages[row.pageId];
    if (existing) { this.openPage(row.pageId); return; }
    const pid = uid('p');
    const page = {
      id: pid, parentId: this.state.pageId, hidden: true,
      icon: row.icon || '', title: row.cells[db.props[0].id] || 'Untitled',
      order: Date.now(), favorite: false, trashed: false,
      createdAt: Date.now(), updatedAt: Date.now(),
      updatedBy: (this.state.user && this.state.user.name) || 'You', versions: [],
      share: { published: false, slug: pid, password: null, invites: [] },
      dbRef: { dbId: db.id, rowId: row.id },
      /* the database decides whether a new row page opens folded */
      propsCollapsed: db.collapseProps !== false,
      blocks: [{ id: uid('b'), type: 'p', text: '', indent: 0 }]
    };
    this.setState(s => {
      const pages = { ...s.pages, [pid]: page };
      const dbs = { ...s.dbs };
      const d = JSON.parse(JSON.stringify(dbs[db.id]));
      const rr = d.rows.find(x => x.id === row.id); if (rr) rr.pageId = pid;
      dbs[db.id] = d;
      return { pages, dbs };
    }, () => { this.persist(); this.openPage(pid); });
  }

  /* ============================ DELETING A TABLE ======================
     A database has exactly one block: creating one mints a block beside it,
     and every route that copies one — duplicate block, duplicate database,
     duplicate page — clones the table under a new id rather than sharing it.
     Nothing in the markdown importer can make a second reference. So "is this
     table still referenced?" is answerable, and when the answer is no the
     table is unreachable: no menu leads to it and no view can show it.

     Unreachable was not the same as gone. `state.dbs` kept it, so push() kept
     writing it, and dbmeta is a SUBSCRIBED node — every table a user had ever
     deleted the block of was downloaded again on every boot, for the life of
     the workspace. AStore.purgeDatabases() was written for exactly this and
     never called from anywhere. These three doors call it. */

  /* Door one: every block deletion, whatever route it took. `_mutate` hands us
     the ids that were on the page before the edit and are not on it after; the
     rest of the workspace is re-checked here before anything is dropped. */
  collectDatabases(ids) {
    const list = (ids || []).filter(Boolean);
    if (!list.length) return;
    /* after the mutation has settled, so `state` is the page as it now stands */
    setTimeout(() => {
      const dead = list.filter(id => this.state.dbs[id] && !this.dbReferenced(id));
      if (dead.length) this.dropDatabases(dead);
    }, 0);
  }
  /* Only bodies we actually HOLD can answer this, so it is deliberately asked
     about tables we just watched lose their block rather than swept over the
     whole workspace — see cleanUnusedTables() for the sweep that first fetches
     everything and is therefore allowed to be exhaustive. */
  dbReferenced(dbId, pages) {
    const src = pages || this.state.pages;
    return Object.values(src).some(p => p.blocks && this.dbIdsIn(p.blocks).indexOf(dbId) >= 0);
  }
  dropDatabases(ids) {
    if (!ids || !ids.length) return;
    this.setState(s => {
      const dbs = { ...s.dbs };
      ids.forEach(id => { delete dbs[id]; });
      return { dbs };
    }, () => {
      this.persist();
      /* push() can only null what `sent` remembers, and `sent` is empty after
         any reload — this is the one call that removes the whole subtree */
      if (AStore.purgeDatabases) AStore.purgeDatabases(ids);
    });
  }

  /* Door two: the menu. Deliberate, confirmed, and it takes the row pages with
     it — they are rows, and their table is going. */
  deleteDatabase(dbId) {
    const db = this.state.dbs[dbId];
    if (!db) return;
    const name = db.name || 'Database';
    const rowPages = (db.rows || []).map(r => r.pageId).filter(id => id && this.state.pages[id]);
    this.setState(s => {
      if (!rowPages.length) return null;
      const pages = { ...s.pages };
      rowPages.forEach(id => {
        /* Trashed rather than erased — the notes written inside a row are the
           reader's, not the table's. They come back as ordinary pages, because
           there is no longer a table for them to be rows of. */
        pages[id] = Object.assign({}, pages[id], {
          trashed: true, trashedAt: Date.now(), trashRoot: true,
          hidden: false, dbRef: null, dbRowBackup: null
        });
      });
      return { pages };
    }, () => {
      this.mutate(bs => {
        const strip = (list) => list.filter(b => {
          if (b.type === 'database' && b.dbId === dbId) return false;
          if (b.children) b.children = strip(b.children);
          if (b.cols) b.cols = b.cols.map(strip);
          return true;
        });
        return strip(bs);
      });
      this.dropDatabases([dbId]);
      this.setState({ menu: null, modal: null });
      this.toast(rowPages.length
        ? '“' + name + '” deleted — ' + rowPages.length + ' row page' +
          (rowPages.length === 1 ? '' : 's') + ' moved to trash'
        : '“' + name + '” deleted');
    });
  }

  /* Door three: the workspace sweep, for tables orphaned before any of this
     existed. Reachability needs every body, so — like the exports — it fetches
     the corpus explicitly and only when the reader asks for it. Trashed pages
     count as references: they can be restored, and a restored page whose table
     had been collected would show an empty block. */
  cleanUnusedTables() {
    const ids = Object.keys(this.state.dbs || {});
    if (!ids.length) { this.toast('There are no tables in this workspace'); return; }
    const all = Object.keys(this.state.pages || {});
    this.toast('Checking ' + all.length + ' page' + (all.length === 1 ? '' : 's') + '…');
    this.ensureBodies(all).then(() => {
      const missing = all.filter(id => !this.state.pages[id].blocks);
      if (missing.length) {
        /* a page we could not read might be the only thing referencing a table,
           so a partial answer is not an answer */
        this.toast('Could not read ' + missing.length + ' page' +
          (missing.length === 1 ? '' : 's') + ' — nothing was removed');
        return;
      }
      const dead = ids.filter(id => !this.dbReferenced(id));
      if (!dead.length) { this.toast('Every table is still in use'); return; }
      this.dropDatabases(dead);
      this.toast('Removed ' + dead.length + ' unused table' + (dead.length === 1 ? '' : 's'));
    });
  }

  /* Deleting a row is the same operation as trashing the page it opens as —
     they are two halves of one object (see trashPage). Everything that removes
     a row comes through here so neither half can be destroyed alone. */
  deleteRow(dbId, rowId) {
    if (!this.rowsReady(dbId)) {
      this.ensureRows(dbId).then(ok => {
        if (ok) this.deleteRow(dbId, rowId);
        else this.toast('Could not load that table — try again in a moment');
      });
      return;
    }
    const db = this.state.dbs[dbId];
    const row = (db.rows || []).find(r => r.id === rowId);
    if (!row) return;
    /* the page owns the round trip: it carries the row into the Trash and back */
    if (row.pageId && this.state.pages[row.pageId]) { this.trashPage(row.pageId); return; }
    this.patchDb(dbId, d => { d.rows = (d.rows || []).filter(x => x.id !== rowId); });
    this.toast('Row deleted');
  }

  /* Property editors shared by the row page and the quick-edit modal. */
  propFields(dbId, rowId, skipFirst) {
    const db = this.state.dbs[dbId];
    if (!db) return [];
    if (!db.rows) { this.ensureRows(dbId); return []; }
    const row = db.rows.find(r => r.id === rowId);
    if (!row) return [];
    const setCell = (pid, val) => this.patchDb(dbId, d => {
      const r = d.rows.find(x => x.id === rowId); if (r) r.cells[pid] = val;
      if (pid === db.props[0].id && r && r.pageId) this.patchPage(r.pageId, { title: val }, true);
    });
    const hid = db.pageHidden || [];
    return (skipFirst ? db.props.slice(1) : db.props)
      .filter(pr => this.state.showHiddenProps || hid.indexOf(pr.id) < 0)
      .map(pr => {
      this.normProp(pr);
      const v = row.cells[pr.id];
      const t = PROP_TYPES.find(x => x.id === pr.type) || PROP_TYPES[0];
      return {
        id: pr.id, name: pr.name, glyph: t.glyph,
        dimmed: hid.indexOf(pr.id) >= 0 ? .45 : 1,
        isText: pr.type === 'text' || pr.type === 'url' || pr.type === 'email' || pr.type === 'phone',
        inputType: pr.type === 'url' ? 'url' : pr.type === 'email' ? 'email' : pr.type === 'phone' ? 'tel' : 'text',
        isNumber: pr.type === 'number', isDate: pr.type === 'date',
        isCheck: pr.type === 'checkbox',
        isOptions: !!OPTION_TYPES[pr.type] || pr.type === 'person',
        isAuto: !!AUTO_TYPES[pr.type], autoText: this.cellText(pr, row),
        value: v == null ? '' : v,
        set: (e) => setCell(pr.id, pr.type === 'number' ? Number(e.target.value) : e.target.value),
        toggle: () => setCell(pr.id, !v),
        tick: v ? '✓' : '', boxBg: v ? 'var(--accent)' : 'transparent', boxBorder: v ? 'var(--accent)' : 'var(--faint)',
        edit: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); this.setState({ menu: { kind: 'propedit', dbId: dbId, propId: pr.id, x: Math.max(12, r.left - 40), y: r.bottom + 4 } }); },
        canAddOption: !!OPTION_TYPES[pr.type],
        options: (pr.options || []).map(o => {
          const on = pr.type === 'multiSelect' ? (Array.isArray(v) && v.indexOf(o.name) >= 0) : v === o.name;
          const c = this.optStyle(pr, o.name);
          return {
            label: o.name, bg: on ? c.bg : 'transparent', fg: on ? c.fg : 'var(--muted)',
            bd: on ? 'transparent' : 'var(--border)', weight: on ? '500' : '400',
            pick: () => {
              if (pr.type === 'multiSelect') { const arr = Array.isArray(v) ? v.slice() : []; const i2 = arr.indexOf(o.name); i2 >= 0 ? arr.splice(i2, 1) : arr.push(o.name); setCell(pr.id, arr); }
              else setCell(pr.id, on ? '' : o.name);
            }
          };
        })
      };
    });
  }

  /* ============================ PROPERTIES ============================
     Notion's model: a property has an id, a name, a type, and — for the
     option types — an ordered list of {id, name, color}. Options carry their
     own colour, are renamed/recoloured/reordered in place, and the same type
     may appear many times over. Visibility is per view AND per page. */

  /* Older databases stored options as plain strings; upgrade in place. */
  normProp(pr) {
    if (!pr.options) pr.options = [];
    pr.options = pr.options.map(o => (typeof o === 'string'
      ? { id: uid('o'), name: o, color: PROP_COLORS[Math.abs(hashStr(o)) % PROP_COLORS.length].id }
      : o));
    return pr;
  }
  normDb(d) { (d.props || []).forEach(pr => this.normProp(pr)); return d; }

  optOf(pr, name) {
    if (!pr || !name) return null;
    return (pr.options || []).find(o => o.name === name) || null;
  }
  optStyle(pr, name) {
    const o = this.optOf(pr, name);
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const c = PROP_COLOR_MAP[(o && o.color) || 'default'] || PROP_COLOR_MAP.default;
    return dark ? { bg: c.dbg, fg: c.dfg } : { bg: c.bg, fg: c.fg };
  }

  addProp(dbId, type, name) {
    const t = PROP_TYPES.find(x => x.id === type) || PROP_TYPES[0];
    const id = uid('pr');
    this.patchDb(dbId, d => {
      const base = { id, name: name || t.name, type: t.id, options: [] };
      if (t.id === 'select' || t.id === 'multiSelect' || t.id === 'status') {
        base.options = t.id === 'status'
          ? [{ id: uid('o'), name: 'Not started', color: 'gray' },
             { id: uid('o'), name: 'In progress', color: 'blue' },
             { id: uid('o'), name: 'Done', color: 'green' }]
          : [];
      }
      d.props.push(base);
    });
    return id;
  }
  renameProp(dbId, propId, name) {
    this.patchDb(dbId, d => { const pr = d.props.find(x => x.id === propId); if (pr) pr.name = name; });
  }
  retypeProp(dbId, propId, type) {
    this.patchDb(dbId, d => {
      const pr = d.props.find(x => x.id === propId); if (!pr) return;
      const was = pr.type;
      pr.type = type;
      if ((type === 'select' || type === 'multiSelect' || type === 'status') && !(pr.options || []).length) {
        /* seed the option list from whatever the rows already contain */
        const seen = {};
        d.rows.forEach(r => {
          const v = r.cells[pr.id];
          (Array.isArray(v) ? v : [v]).forEach(x => { if (x && !seen[x]) seen[x] = 1; });
        });
        pr.options = Object.keys(seen).slice(0, 24).map((n, i) => ({
          id: uid('o'), name: n, color: PROP_COLORS[i % PROP_COLORS.length].id
        }));
      }
      /* keep the data usable across the change */
      d.rows.forEach(r => {
        const v = r.cells[pr.id];
        if (v == null) return;
        if (type === 'multiSelect' && !Array.isArray(v)) r.cells[pr.id] = v ? [String(v)] : [];
        else if (type !== 'multiSelect' && Array.isArray(v)) r.cells[pr.id] = v[0] || '';
        else if (type === 'checkbox' && was !== 'checkbox') r.cells[pr.id] = !!v;
        else if (type === 'number') { const n = Number(v); r.cells[pr.id] = isNaN(n) ? '' : n; }
      });
    });
  }
  deleteProp(dbId, propId) {
    this.patchDb(dbId, d => {
      if (d.props.length <= 1) return;
      if (d.props[0].id === propId) return; // the title property is permanent
      d.props = d.props.filter(x => x.id !== propId);
      d.rows.forEach(r => { delete r.cells[propId]; });
      (d.views || []).forEach(v => {
        v.hidden = (v.hidden || []).filter(x => x !== propId);
        v.filters = (v.filters || []).filter(f => f.prop !== propId);
        v.sorts = (v.sorts || []).filter(sx => sx.prop !== propId);
        if (v.groupBy === propId) v.groupBy = null;
      });
    });
  }
  duplicateProp(dbId, propId) {
    this.patchDb(dbId, d => {
      const i = d.props.findIndex(x => x.id === propId);
      if (i < 0) return;
      const copy = JSON.parse(JSON.stringify(d.props[i]));
      copy.id = uid('pr');
      copy.name = copy.name + ' copy';
      (copy.options || []).forEach(o => { o.id = uid('o'); });
      d.props.splice(i + 1, 0, copy);
      d.rows.forEach(r => { r.cells[copy.id] = r.cells[propId]; });
    });
  }
  moveProp(dbId, propId, dir) {
    this.patchDb(dbId, d => {
      const i = d.props.findIndex(x => x.id === propId);
      const j = i + dir;
      if (i < 1 || j < 1 || j >= d.props.length) return; // title stays first
      const t = d.props[i]; d.props[i] = d.props[j]; d.props[j] = t;
    });
  }

  /* ---- select / multi-select / status options ---- */
  addOption(dbId, propId, name, color) {
    const oid = uid('o');
    this.patchDb(dbId, d => {
      const pr = this.normProp(d.props.find(x => x.id === propId) || {});
      if (!pr.options) return;
      if (pr.options.some(o => o.name === name)) return;
      pr.options.push({ id: oid, name, color: color || PROP_COLORS[pr.options.length % PROP_COLORS.length].id });
    });
    return oid;
  }
  renameOption(dbId, propId, optId, name) {
    this.patchDb(dbId, d => {
      const pr = d.props.find(x => x.id === propId); if (!pr) return;
      const o = (pr.options || []).find(x => x.id === optId); if (!o) return;
      const old = o.name; o.name = name;
      d.rows.forEach(r => {
        const v = r.cells[pr.id];
        if (Array.isArray(v)) r.cells[pr.id] = v.map(x => x === old ? name : x);
        else if (v === old) r.cells[pr.id] = name;
      });
    });
  }
  recolorOption(dbId, propId, optId, color) {
    this.patchDb(dbId, d => {
      const pr = d.props.find(x => x.id === propId); if (!pr) return;
      const o = (pr.options || []).find(x => x.id === optId); if (o) o.color = color;
    });
  }
  deleteOption(dbId, propId, optId) {
    this.patchDb(dbId, d => {
      const pr = d.props.find(x => x.id === propId); if (!pr) return;
      const o = (pr.options || []).find(x => x.id === optId); if (!o) return;
      pr.options = pr.options.filter(x => x.id !== optId);
      d.rows.forEach(r => {
        const v = r.cells[pr.id];
        if (Array.isArray(v)) r.cells[pr.id] = v.filter(x => x !== o.name);
        else if (v === o.name) r.cells[pr.id] = '';
      });
    });
  }
  moveOption(dbId, propId, optId, dir) {
    this.patchDb(dbId, d => {
      const pr = d.props.find(x => x.id === propId); if (!pr) return;
      const i = (pr.options || []).findIndex(x => x.id === optId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= pr.options.length) return;
      const t = pr.options[i]; pr.options[i] = pr.options[j]; pr.options[j] = t;
    });
  }

  /* ---- visibility ---- */
  isHiddenInView(view, propId) { return (view.hidden || []).indexOf(propId) >= 0; }
  toggleViewProp(dbId, viewId, propId) {
    this.patchDb(dbId, d => {
      const v = d.views.find(x => x.id === viewId); if (!v) return;
      v.hidden = v.hidden || [];
      const i = v.hidden.indexOf(propId);
      i >= 0 ? v.hidden.splice(i, 1) : v.hidden.push(propId);
    });
  }
  /* Page-level visibility lives on the database as `pageHidden`, so every row
     page of the same database agrees. (An earlier per-page `hiddenProps` was a
     second, unread mechanism — removed.) */
  togglePageProp(dbId, propId) {
    this.patchDb(dbId, d => {
      d.pageHidden = d.pageHidden || [];
      const i = d.pageHidden.indexOf(propId);
      i >= 0 ? d.pageHidden.splice(i, 1) : d.pageHidden.push(propId);
    });
  }
  /* One entry point for the Properties panel, which offers the same eye toggle
     for both scopes. Callers pass the scope rather than picking the method, so
     a row of toggles is one binding instead of a branch at every call site. */
  toggleProp(dbId, propId, scope, viewId) {
    if (scope === 'page') return this.togglePageProp(dbId, propId);
    if (viewId) return this.toggleViewProp(dbId, viewId, propId);
  }

  /* ---- manual row order ---- */
  moveRow(dbId, rowId, targetId, after) {
    if (!rowId || rowId === targetId) return;
    this.patchDb(dbId, d => {
      const i = d.rows.findIndex(r => r.id === rowId); if (i < 0) return;
      const moved = d.rows.splice(i, 1)[0];
      const j = d.rows.findIndex(r => r.id === targetId);
      d.rows.splice(j < 0 ? d.rows.length : j + (after ? 1 : 0), 0, moved);
    });
  }
  /* Notion has no six-dot handle inside a view — you grab the row itself and
     drag. A press that never moves stays a click. */
  /* Dropping a card in another board column SETS the group-by property —
     board groups are derived from that property, so reordering the flat row
     array alone would leave the card visually where it started. */
  /* One write for the whole drop: regroup AND reorder in a single patchDb, so
     there is no ordering ambiguity between two queued setState updaters. */
  /* FLIP: record where every row sits, run the mutation, then animate each row
     from its old box to its new one so the neighbours visibly make room. */
  flipRows(mutate) {
    const nodes = [...document.querySelectorAll('[data-dbrow]')];
    if (!nodes.length || nodes.length > 220) { mutate(); return; }
    const first = new Map();
    nodes.forEach(n => first.set(n.getAttribute('data-dbrow'), n.getBoundingClientRect()));
    mutate();
    /* two frames: one for React to commit the new order, one to measure it */
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.querySelectorAll('[data-dbrow]').forEach(n => {
        if (!n.animate) return;
        const id = n.getAttribute('data-dbrow');
        const a = first.get(id);
        /* a row that was not there a frame ago arrives rather than travels */
        if (!a) {
          n.animate([{ opacity: 0, transform: 'translateY(6px) scale(.99)' }, { opacity: 1, transform: 'none' }],
            { duration: 200, easing: 'cubic-bezier(.2,.9,.25,1)' });
          return;
        }
        const b = n.getBoundingClientRect();
        const dx = a.left - b.left, dy = a.top - b.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        n.animate(
          [{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }],
          { duration: 240, easing: 'cubic-bezier(.2,.9,.25,1)' }
        );
      });
    }));
  }

  /* How far an inline database may reach into the right margin. The page
     scroller clips horizontally (overflowX:hidden), so a fixed bleed pushes the
     block off-screen on a narrow window and makes its far columns undroppable.
     Only ever bleed into margin that actually exists. */
  dbBleed() {
    const s = this.state;
    if (s.isMobile || s.prefs.fullWidth) return 0;
    const sc = this._scroll;
    if (!sc) return 0;
    const avail = sc.clientWidth;          // what the scroller can show
    const wrapper = Math.min(780, avail);  // the text column's own width
    const margin = (avail - wrapper) / 2;  // free space on each side
    return -Math.max(0, Math.round(margin - 12));
  }

  applyRowDrop(dbId, viewId, rowId, groupName, target) {
    let moved = false, regrouped = false;
    this.patchDb(dbId, d => {
      const r = (d.rows || []).find(x => x.id === rowId);
      if (!r) return;
      if (groupName != null && viewId) {
        const v = (d.views || []).find(x => x.id === viewId);
        const gp = v && ((d.props || []).find(pp => pp.id === v.groupBy) ||
          (d.props || []).find(pp => OPTION_TYPES[pp.type]));
        if (gp) {
          const next = groupName.indexOf('No ') === 0 && groupName.slice(3) === gp.name ? '' : groupName;
          if (r.cells[gp.id] !== next) {
            r.cells[gp.id] = next;
            r.updatedAt = Date.now();
            regrouped = true;
          }
        }
      }
      if (target && target.id && target.id !== rowId) {
        const i = d.rows.indexOf(r);
        if (i >= 0) {
          d.rows.splice(i, 1);
          const j = d.rows.findIndex(x => x.id === target.id);
          d.rows.splice(j < 0 ? d.rows.length : j + (target.after ? 1 : 0), 0, r);
          moved = true;
        }
      }
    });
    return { moved, regrouped };
  }
  setRowGroup(dbId, viewId, rowId, groupName) {
    return this.applyRowDrop(dbId, viewId, rowId, groupName, null).regrouped;
  }
});
