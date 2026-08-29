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
    const v = this.cellRaw(pr, r);
    if (pr.type === 'createdTime') return v ? new Date(v).toLocaleDateString() : '—';
    if (pr.type === 'editedTime') return v ? relTime(v) : '—';
    if (pr.type === 'number' && v !== '' && v != null) return String(v);
    if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
    return v == null || v === '' ? '—' : String(v);
  }

  /* ======================= READING A CELL =============================
     The four automatic types are not stored in `cells` — they are facts about
     the ROW, kept beside it the way `createdAt` always was. Everything that
     reads a cell goes through here, so sorting, filtering and display all see
     the same value and an automatic column is no longer permanently blank.

     `createdBy`/`editedBy` used to fall back to the name of whoever was
     LOOKING, which meant every row claimed to be the current reader's. The
     fallback is gone: unknown is `''`, and reads as "—". */
  cellRaw(pr, r) {
    if (!pr || !r) return undefined;
    if (pr.type === 'createdTime') return r.createdAt || null;
    if (pr.type === 'editedTime') return r.updatedAt || null;
    /* `r.cells[pr.id]` is the pre-move home of these two — still read, so a
       workspace written before the move keeps whatever it had */
    if (pr.type === 'createdBy') return r.createdBy || r.cells[pr.id] || '';
    if (pr.type === 'editedBy') return r.editedBy || r.cells[pr.id] || '';
    return r.cells[pr.id];
  }
  isBlank(v) {
    return v == null || v === '' || (Array.isArray(v) && !v.length);
  }
  /* One day, as a number, from either a `YYYY-MM-DD` cell or a millisecond
     timestamp. The string is read field by field rather than through `new
     Date(...)`, which treats a bare date as UTC and can land on the day before
     in any timezone west of Greenwich. */
  dateNum(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'string') {
      const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
    }
    const d = new Date(v);
    if (isNaN(d.getTime())) return null;
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  }
  isDateType(t) { return t === 'date' || t === 'createdTime' || t === 'editedTime'; }

  /* ==================== WHO TOUCHED THIS ROW, AND WHEN ================
     The four Automatic property types rendered "—" on every row of every
     table, because nothing ever wrote what they read: `dbAddRow` created a row
     with no timestamps and `setCell` changed a cell without bumping one. The
     only writer in the whole codebase was a board drop.

     Asking each call site to remember is how it got into that state, so the
     stamping happens in `patchDb` — the single funnel every deliberate table
     edit goes through. A row is stamped only if this mutation actually changed
     it, so a reorder (which moves the array, not the rows) leaves the times
     alone, and a table nobody edited is not re-uploaded.

     Created-by is written once and never again; last-edited-by follows the
     edit. Neither is guessed from whoever happens to be reading. */
  stampRows(d, was, s) {
    const now = Date.now();
    const who = (s && s.user && s.user.name) || (this.state.user && this.state.user.name) || '';
    (d.rows || []).forEach(r => {
      const before = was[r.id];
      if (before === undefined) {
        if (!r.createdAt) r.createdAt = now;
        if (!r.createdBy && who) r.createdBy = who;
      }
      if (before !== JSON.stringify(r)) {
        r.updatedAt = now;
        if (who) r.editedBy = who;
      }
    });
    return d;
  }

  /* ============================= BOARD ================================
     Three faults lived in the eleven lines this replaces.

     The grouping property was looked up in the VISIBLE props, while the drop
     handler looked it up in all of them. Hide the group-by column and the
     board silently regrouped by whatever other option property came first,
     while dragging a card still wrote the original — the card sprang back and
     a column the reader could not see had quietly changed.

     A row whose value was not one of the options matched no column, and the
     catch-all only took rows whose value was EMPTY, so it was rendered
     nowhere: still in the table, absent from the board, with no count to say
     so. Now an off-list value gets a column of its own, which both shows the
     row and makes the stale value obvious.

     And a multi-select group compared an array to a name, so every card fell
     into "No …" — while a drop overwrote the array with a single string and
     took the row's other tags with it. */
  boardGroupProp(db, view) {
    const all = db.props || [];
    return all.find(p => p.id === view.groupBy) || all.find(p => OPTION_TYPES[p.type]) || null;
  }
  /* every value a row carries for the grouping property, as a list */
  groupVals(gp, r) {
    const v = r.cells[gp.id];
    if (Array.isArray(v)) return v.filter(x => x !== '' && x != null);
    return this.isBlank(v) ? [] : [v];
  }
  boardGroups(db, view, rows, mk) {
    const gp = this.boardGroupProp(db, view);
    if (!gp) return [];
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const c0 = PROP_COLOR_MAP.default;
    const known = (gp.options || []).map(o => o.name);
    const out = [];
    const placed = {};
    const column = (key, label, style) => {
      const list = rows.filter(r => this.groupVals(gp, r).indexOf(key) >= 0);
      list.forEach(r => { placed[r.id] = 1; });
      out.push({ key, name: label, bg: style.bg, fg: style.fg, count: list.length, rows: list.map(mk) });
    };
    known.forEach(n => column(n, n, this.optStyle(gp, n)));
    /* values that are set but are not options — an option deleted outside the
       editor, a retype, an import. A column each, so nothing disappears. */
    const strays = [];
    rows.forEach(r => {
      if (placed[r.id]) return;
      this.groupVals(gp, r).forEach(v => {
        const k = String(v);
        if (known.indexOf(k) < 0 && strays.indexOf(k) < 0) strays.push(k);
      });
    });
    strays.forEach(k => column(k, k, { bg: dark ? c0.dbg : c0.bg, fg: dark ? c0.dfg : c0.fg }));
    const none = rows.filter(r => !placed[r.id]);
    /* The empty column is always offered, even when nothing is in it — it is
       where a card is dropped to clear the property. */
    out.push({
      key: '', name: 'No ' + gp.name,
      bg: dark ? c0.dbg : c0.bg, fg: dark ? c0.dfg : c0.fg,
      count: none.length, rows: none.map(mk)
    });
    return out;
  }

  /* ============================ FILTERS ===============================
     Two rules, and the old code had neither.

     WITHIN one property the conditions are OR'd. They used to be AND'd like
     everything else, so ticking Status = Done and Status = In progress asked
     for rows that were both at once and the view went empty with nothing to
     explain it. ACROSS properties they are still AND'd, which is what the
     separate sections in the menu imply.

     And a value is compared BY TYPE. `String(v) === String(f.value)` made the
     checkbox filter almost useless: a row whose box was never touched has no
     cell at all, so "Unchecked" compared `"undefined"` against `"false"` and
     hid the very rows it was asked for. */
  filterOps(type) {
    if (type === 'checkbox') return [{ id: 'is', label: 'is' }];
    if (OPTION_TYPES[type]) return [
      { id: 'is', label: 'is' }, { id: 'isNot', label: 'is not' },
      { id: 'empty', label: 'is empty' }, { id: 'notEmpty', label: 'is not empty' }
    ];
    if (type === 'number') return [
      { id: 'is', label: '=' }, { id: 'gt', label: '>' }, { id: 'lt', label: '<' },
      { id: 'empty', label: 'is empty' }, { id: 'notEmpty', label: 'is not empty' }
    ];
    if (this.isDateType(type)) return [
      { id: 'is', label: 'is' }, { id: 'before', label: 'is before' }, { id: 'after', label: 'is after' },
      { id: 'empty', label: 'is empty' }, { id: 'notEmpty', label: 'is not empty' }
    ];
    return [
      { id: 'contains', label: 'contains' }, { id: 'is', label: 'is' }, { id: 'isNot', label: 'is not' },
      { id: 'empty', label: 'is empty' }, { id: 'notEmpty', label: 'is not empty' }
    ];
  }
  matchFilter(pr, f, r) {
    const v = this.cellRaw(pr, r);
    const op = f.op || 'is';                 // filters written before operators existed
    const blank = this.isBlank(v);
    if (op === 'empty') return blank;
    if (op === 'notEmpty') return !blank;
    if (pr.type === 'checkbox') return !!v === !!f.value;
    if (blank) return op === 'isNot';        // nothing else can match an empty cell
    if (Array.isArray(v)) {
      const has = v.indexOf(f.value) >= 0;
      return op === 'isNot' ? !has : has;
    }
    if (pr.type === 'number') {
      const a = Number(v), b = Number(f.value);
      if (isNaN(a) || isNaN(b)) return false;
      if (op === 'gt') return a > b;
      if (op === 'lt') return a < b;
      if (op === 'isNot') return a !== b;
      return a === b;
    }
    if (this.isDateType(pr.type)) {
      const a = this.dateNum(v), b = this.dateNum(f.value);
      if (a == null || b == null) return false;
      if (op === 'before') return a < b;
      if (op === 'after') return a > b;
      if (op === 'isNot') return a !== b;
      return a === b;
    }
    const sv = String(v).toLowerCase(), fv = String(f.value == null ? '' : f.value).toLowerCase();
    if (op === 'contains') return sv.indexOf(fv) >= 0;
    if (op === 'isNot') return sv !== fv;
    return sv === fv;
  }
  applyFilters(db, view, rows) {
    const list = (view.filters || []);
    if (!list.length) return rows;
    const byProp = {};
    list.forEach(f => { (byProp[f.prop] = byProp[f.prop] || []).push(f); });
    const ids = Object.keys(byProp);
    return rows.filter(r => ids.every(pid => {
      const pr = (db.props || []).find(p => p.id === pid);
      /* a filter on a property that no longer exists is inert, never fatal */
      if (!pr) return true;
      return byProp[pid].some(f => this.matchFilter(pr, f, r));
    }));
  }

  /* ============================ SORTING ===============================
     The old comparator was `x > y ? 1 : x < y ? -1 : 0` over raw cells. Two
     faults, and the first is the worse one.

     An empty cell compares false BOTH ways, so it was reported equal to every
     value. That is not a valid ordering, and V8 responds to an inconsistent
     comparator by leaving the array essentially untouched — so sorting a
     column with any blank in it looked like a key that did nothing.

     And `>` on strings compares code points, so every capitalised entry sorted
     above every lowercase one under a menu labelled "A → Z". */
  cmpCells(pr, ra, rb, desc) {
    const a = this.cellRaw(pr, ra), b = this.cellRaw(pr, rb);
    const ea = this.isBlank(a), eb = this.isBlank(b);
    /* Blanks sink in BOTH directions — decided before the flip, because
       "reverse the order" should not mean "lead with the empty rows". */
    if (ea && eb) return 0;
    if (ea) return 1;
    if (eb) return -1;
    let n = 0;
    if (pr.type === 'number') { const x = Number(a), y = Number(b); n = isNaN(x) || isNaN(y) ? 0 : x - y; }
    else if (this.isDateType(pr.type)) { n = (this.dateNum(a) || 0) - (this.dateNum(b) || 0); }
    else if (pr.type === 'checkbox') { n = (a ? 1 : 0) - (b ? 1 : 0); }
    else if (OPTION_TYPES[pr.type] && !Array.isArray(a) && !Array.isArray(b)) {
      /* a status sorts in the order its options are listed, not alphabetically
         — "Backlog, In progress, Done" is the sequence the reader arranged */
      const names = (pr.options || []).map(o => o.name);
      const ia = names.indexOf(String(a)), ib = names.indexOf(String(b));
      n = (ia < 0 ? names.length : ia) - (ib < 0 ? names.length : ib);
      if (!n) n = String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
    } else {
      const sa = Array.isArray(a) ? a.join(', ') : String(a);
      const sb = Array.isArray(b) ? b.join(', ') : String(b);
      n = sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' });
    }
    if (!n) return 0;
    return desc ? (n > 0 ? -1 : 1) : (n > 0 ? 1 : -1);
  }
  sortRows(db, view, rows) {
    const keys = (view.sorts || [])
      .map(so => ({ so, pr: (db.props || []).find(p => p.id === so.prop) }))
      .filter(k => k.pr);
    if (!keys.length) return rows;
    /* ONE comparator over every key in priority order. Running `Array.sort`
       once per key — which is what the old loop did — makes the LAST key the
       primary one, the exact reverse of what the list means. Sort is stable,
       so rows equal on every key keep their manual order. */
    return rows.slice().sort((ra, rb) => {
      for (let i = 0; i < keys.length; i++) {
        const n = this.cmpCells(keys[i].pr, ra, rb, keys[i].so.dir === 'desc');
        if (n) return n;
      }
      return 0;
    });
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
      dbPickIcon: () => {}, dbMenu: () => {}, dbIconEl: null,
      dbId: (d && d.id) || ''
    });
    if (!db) return blank(false, null);
    if (!db.rows) { this.ensureRows(db.id); return blank(true, db); }
    const s = this.state;
    /* A table with no views at all would throw here — `db.views[0].id` on an
       empty array — and take the whole page down with it, not just the block.
       Firebase drops empty arrays on write, so it is reachable. */
    const views = (db.views || []).length ? db.views : [DEFAULT_VIEW()];
    const vid = s.dbView[db.id] || db.defaultView || views[0].id;
    const view = views.find(v => v.id === vid) || views[0];
    const rows = this.sortRows(db, view, this.applyFilters(db, view, db.rows.slice()));
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
    /* the right-hand line on a list row: the first visible date, or nothing */
    const metaProp = props.find(p => p.type === 'date') || props.find(p => this.isDateType(p.type)) || null;
    const mk = (r) => ({
      id: r.id, iconEl: this.iconEl(r, 16), coverIcon: r.icon || '',
      cover: r.cover || 'linear-gradient(135deg,#8E8E8E,#B9B9B9)',
      title: r.cells[nameProp.id] || 'Untitled',
      chips: chipsFor(r, 3), boardChips: chipsFor(r, 2),
      /* was `r.cells.due` — a prop id that exists only in the demo seed, so in
         any table the reader made this column was unconditionally blank */
      meta: metaProp ? this.cellText(metaProp, r).replace('—', '') : '',
      open: () => { if (!this._rowMoved) this.openRowPage(db, r); },
      context: (e) => { e.preventDefault(); e.stopPropagation(); this.setState({ menu: { kind: 'dbrow', dbId: db.id, rowId: r.id, x: e.clientX, y: e.clientY } }); },
      grab: (e) => this.rowGrab(db.id, r.id, e, vid),
      dragOp: this.state.rowDrag === r.id ? .4 : 1,
      cells: props.map((p, i) => {
        const v = this.cellRaw(p, r);
        const isChips = !!OPTION_TYPES[p.type];
        const arr = MULTI_TYPES[p.type] ? (Array.isArray(v) ? v : []) : (this.isBlank(v) ? [] : [v]);
        const txt = this.cellText(p, r);
        const auto = !!AUTO_TYPES[p.type];
        /* ---- editing a cell in place ----------------------------------
           The table used to be read-only: the cell objects carried `tick` and
           `boxBg` — everything a checkbox needs except a handler — and every
           change, down to ticking one box, meant opening the row page and
           coming back. Notion's own table is the reference here.

           Three behaviours, by type. A checkbox toggles on click. An option
           type opens its picker over the cell. Everything else becomes an
           input. The automatic types stay read-only, because they are facts
           rather than fields. */
        const ed = s.cellEdit;
        const editing = !!(ed && ed.dbId === db.id && ed.rowId === r.id && ed.propId === p.id);
        const stop = (e) => { e.stopPropagation(); if (e.preventDefault) e.preventDefault(); };
        return {
          w: widths[i], isChips, isCheck: p.type === 'checkbox',
          isText: !isChips && p.type !== 'checkbox' && !editing,
          chips: arr.map(x => Object.assign({ label: x }, this.optStyle(p, x))),
          tick: v ? '✓' : '', boxBg: v ? 'var(--accent)' : 'transparent', boxBorder: v ? 'var(--accent)' : 'var(--faint)',
          text: txt,
          color: txt === '—' ? 'var(--faint)' : 'var(--text)',

          editable: !auto,
          editing,
          editType: p.type === 'number' ? 'number' : p.type === 'date' ? 'date'
            : p.type === 'url' ? 'url' : p.type === 'email' ? 'email' : p.type === 'phone' ? 'tel' : 'text',
          /* The field is CONTROLLED — the runtime hands `value` straight to
             React, and a controlled input with no onChange is read-only, so
             the first version of this silently refused every keystroke. The
             keystrokes live in `cellEdit.draft` until the field commits. */
          editValue: editing && ed.draft !== undefined ? ed.draft : (this.isBlank(v) ? '' : String(v)),
          change: (e) => {
            const draft = e.target.value;
            this.setState(st => (st.cellEdit ? { cellEdit: Object.assign({}, st.cellEdit, { draft }) } : null));
          },
          cellBg: editing ? 'var(--canvas)' : 'transparent',
          cellRing: editing ? 'inset 0 0 0 2px var(--accent)' : 'none',
          cursor: auto ? 'default' : 'text',
          /* One click, three destinations — and it is bound to CLICK only, not
             mousedown, so pressing on a cell still starts a row drag and only
             a press that never moved lands here. An automatic cell has nothing
             to edit, so its click is left to bubble and open the row like any
             other part of it. */
          tap: (e) => {
            if (auto) return;
            stop(e);
            if (p.type === 'checkbox') { this.setCell(db.id, r.id, p.id, !v); return; }
            if (isChips) {
              const box = e.currentTarget.getBoundingClientRect();
              this.setState({ menu: { kind: 'cellopt', dbId: db.id, rowId: r.id, propId: p.id, x: box.left, y: box.bottom + 4 } });
              return;
            }
            this.setState({ cellEdit: { dbId: db.id, rowId: r.id, propId: p.id, draft: this.isBlank(v) ? '' : String(v) } });
          },
          commit: (e) => {
            this.setCell(db.id, r.id, p.id, e.target.value);
            this.setState({ cellEdit: null });
          },
          key: (e) => {
            if (e.key === 'Escape') { e.preventDefault(); this.setState({ cellEdit: null }); return; }
            if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); return; }
            if (e.key === 'Tab') {
              e.preventDefault();
              this.setCell(db.id, r.id, p.id, e.target.value);
              this.stepCell(db.id, vid, r.id, p.id, e.shiftKey ? -1 : 1);
            }
          },
          editRef: editing ? (el => { if (el && this._cellEl !== el) { this._cellEl = el; setTimeout(() => { try { el.focus(); el.select && el.select(); } catch (x) {} }, 0); } }) : null
        };
      })
    });
    const mapped = rows.map(mk);
    const groupProp = view.type === 'board' ? this.boardGroupProp(db, view) : null;
    /* the cells a card dropped into this column would need to belong to it */
    const groupSeed = (key) => {
      if (!groupProp || key === '' || key == null) return {};
      return { [groupProp.id]: MULTI_TYPES[groupProp.type] ? [key] : key };
    };
    const groups = (view.type === 'board' ? this.boardGroups(db, view, rows, mk) : [])
      .map(g => Object.assign({}, g, { add: () => this.addRow(db.id, groupSeed(g.key), true) }));
    const nF = (view.filters || []).length, nS = (view.sorts || []).length;
    return {
      dbId: db.id,
      dbName: db.name, dbCount: rows.length + (rows.length === 1 ? ' item' : ' items'),
      dbIsList: view.type === 'list', dbIsCard: view.type === 'card',
      dbIsTable: view.type === 'table', dbIsBoard: view.type === 'board',
      dbViews: views.map(v => ({
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
      dbAddRow: (e) => { e.stopPropagation(); this.addRow(db.id, {}, true); }
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

  /* One way to make a row, so every route gets the timestamps and the
     authorship. `seed` pre-fills cells — a board column uses it to add a card
     that already belongs to that column. */
  addRow(dbId, seed, open) {
    if (!this.rowsReady(dbId)) {
      this.ensureRows(dbId).then(ok => {
        if (ok) this.addRow(dbId, seed, open);
        else this.toast('Could not load that table — try again in a moment');
      });
      return null;
    }
    const db = this.state.dbs[dbId];
    if (!db || !(db.props || []).length) return null;
    const rid = uid('r');
    this.patchDb(dbId, d => {
      const cells = Object.assign({ [d.props[0].id]: 'Untitled' }, seed || {});
      /* a date property the reader named "Created" is theirs to fill, and has
         been pre-filled since before the automatic types worked */
      const cp = d.props.filter(x => x.id === 'created' || (x.type === 'date' && /created/i.test(x.name)))[0];
      if (cp && cells[cp.id] === undefined) cells[cp.id] = new Date().toISOString().slice(0, 10);
      d.rows.push({ id: rid, icon: '', cover: '', cells });
    });
    if (open) {
      const d2 = this.state.dbs[dbId];
      const row = d2 && (d2.rows || []).find(x => x.id === rid);
      if (row) this.openRowPage(d2, row);
    }
    return rid;
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

  /* ===================== WRITING ONE CELL ==============================
     Every editor — the row page's property list, and now the table's own cells
     — writes through here, so the coercions and the title mirroring live in
     one place instead of at each call site.

     The title mirror used to run INSIDE the patchDb updater, calling
     patchPage() (another setState) from within one. Updaters must be pure and
     may be replayed; it belongs in the completion callback. */
  setCell(dbId, rowId, propId, val) {
    const db = this.state.dbs[dbId];
    if (!db) return;
    const pr = (db.props || []).find(p => p.id === propId);
    const v = this.coerceCell(pr, val);
    const isTitle = (db.props || [])[0] && db.props[0].id === propId;
    this.patchDb(dbId, d => {
      const r = (d.rows || []).find(x => x.id === rowId);
      if (r) r.cells[propId] = v;
    });
    if (isTitle) {
      const r = ((this.state.dbs[dbId] || {}).rows || []).find(x => x.id === rowId);
      if (r && r.pageId && this.state.pages[r.pageId]) this.patchPage(r.pageId, { title: String(v == null ? '' : v) }, true);
    }
  }
  /* what a property is willing to store */
  coerceCell(pr, val) {
    if (!pr) return val;
    if (pr.type === 'number') {
      /* `Number('')` is 0, so clearing a number field used to SAVE a zero —
         which then sorted, filtered and read as a real measurement. */
      if (val === '' || val == null) return '';
      const n = Number(val);
      return isNaN(n) ? '' : n;
    }
    if (pr.type === 'checkbox') return !!val;
    if (MULTI_TYPES[pr.type]) return Array.isArray(val) ? val : (this.isBlank(val) ? [] : [String(val)]);
    if (Array.isArray(val)) return val.length ? String(val[0]) : '';
    return val;
  }

  /* Property editors shared by the row page and the quick-edit modal. */
  propFields(dbId, rowId, skipFirst) {
    const db = this.state.dbs[dbId];
    if (!db) return [];
    if (!db.rows) { this.ensureRows(dbId); return []; }
    const row = db.rows.find(r => r.id === rowId);
    if (!row) return [];
    const setCell = (pid, val) => this.setCell(dbId, rowId, pid, val);
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
        isOptions: !!OPTION_TYPES[pr.type],
        isAuto: !!AUTO_TYPES[pr.type], autoText: this.cellText(pr, row),
        value: v == null ? '' : v,
        set: (e) => setCell(pr.id, e.target.value),
        toggle: () => setCell(pr.id, !v),
        tick: v ? '✓' : '', boxBg: v ? 'var(--accent)' : 'transparent', boxBorder: v ? 'var(--accent)' : 'var(--faint)',
        edit: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); this.setState({ menu: { kind: 'propedit', dbId: dbId, propId: pr.id, x: Math.max(12, r.left - 40), y: r.bottom + 4 } }); },
        canAddOption: !!OPTION_TYPES[pr.type],
        options: (pr.options || []).map(o => {
          const on = MULTI_TYPES[pr.type] ? (Array.isArray(v) && v.indexOf(o.name) >= 0) : v === o.name;
          const c = this.optStyle(pr, o.name);
          return {
            label: o.name, bg: on ? c.bg : 'transparent', fg: on ? c.fg : 'var(--muted)',
            bd: on ? 'transparent' : 'var(--border)', weight: on ? '500' : '400',
            pick: () => setCell(pr.id, this.toggleOption(pr, v, o.name))
          };
        })
      };
    });
  }
  /* Can this property be TYPED into? A picker and a checkbox are changed by
     clicking, and an automatic column is not changed at all, so Tab passes
     over all three — stopping on one would strand the reader mid-row with no
     way forward but the mouse, which is the opposite of what Tab is for. */
  typableProp(p) { return !!p && !AUTO_TYPES[p.type] && !OPTION_TYPES[p.type] && p.type !== 'checkbox'; }
  /* Tab out of a cell and into the next typable one, wrapping to the next row
     at the end of a row and to the previous row's last field going backwards.
     Past either end the editor simply closes. */
  stepCell(dbId, viewId, rowId, propId, dir) {
    const db = this.state.dbs[dbId];
    if (!db || !db.rows) return;
    const view = (db.views || []).find(v => v.id === viewId) || (db.views || [])[0];
    if (!view) return;
    const rows = this.sortRows(db, view, this.applyFilters(db, view, db.rows.slice()));
    const shown = (db.props || []).filter(p => (view.hidden || []).indexOf(p.id) < 0);
    const props = shown.filter(p => this.typableProp(p));
    if (!rows.length || !props.length) { this.setState({ cellEdit: null }); return; }
    let ri = rows.findIndex(r => r.id === rowId);
    if (ri < 0) { this.setState({ cellEdit: null }); return; }
    let pi = props.findIndex(p => p.id === propId);
    if (pi < 0) {
      /* tabbed out of a cell that is not itself typable — find where it sat
         among the visible columns and carry on from there */
      const at = shown.findIndex(p => p.id === propId);
      pi = dir > 0
        ? props.findIndex(p => shown.indexOf(p) > at) - dir
        : props.length - 1 - dir;
      if (pi === undefined || isNaN(pi)) pi = dir > 0 ? -1 : props.length;
    }
    pi += dir;
    if (pi >= props.length) { pi = 0; ri += 1; }
    else if (pi < 0) { pi = props.length - 1; ri -= 1; }
    if (ri < 0 || ri >= rows.length) { this.setState({ cellEdit: null }); return; }
    this.setState({ cellEdit: { dbId, rowId: rows[ri].id, propId: props[pi].id } });
  }

  /* picking an option: a multi-select adds or removes it, everything else
     replaces the value — and picking the current one clears it */
  toggleOption(pr, v, name) {
    if (MULTI_TYPES[pr.type]) {
      const arr = Array.isArray(v) ? v.slice() : (this.isBlank(v) ? [] : [String(v)]);
      const i = arr.indexOf(name);
      if (i >= 0) arr.splice(i, 1); else arr.push(name);
      return arr;
    }
    return v === name ? '' : name;
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
  normDb(d) {
    (d.props || []).forEach(pr => this.normProp(pr));
    /* heal a table that lost its views rather than letting every reader of
       `views[0]` find out the hard way */
    if (!(d.views || []).length) { d.views = [DEFAULT_VIEW()]; d.defaultView = d.views[0].id; }
    return d;
  }

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
      if (t.id === 'status') {
        base.options = [{ id: uid('o'), name: 'Not started', color: 'gray' },
                        { id: uid('o'), name: 'In progress', color: 'blue' },
                        { id: uid('o'), name: 'Done', color: 'green' }];
      } else if (t.id === 'person') {
        /* A new Person property used to arrive with no options and no way to
           gain any, so it could never be filled in. Seed it with the people
           this workspace already knows — the signed-in user, and anyone named
           on an existing person property — and the option editor takes it from
           there like any other option list. */
        base.options = this.knownPeople(d).map((n, i) => ({
          id: uid('o'), name: n, color: PROP_COLORS[i % PROP_COLORS.length].id
        }));
      }
      d.props.push(base);
    });
    return id;
  }
  /* every person this workspace can name, most useful first */
  knownPeople(d) {
    const out = [];
    const add = (n) => { const t = String(n || '').trim(); if (t && out.indexOf(t) < 0) out.push(t); };
    add(this.state.user && this.state.user.name);
    (d.props || []).forEach(p => {
      if (p.type !== 'person') return;
      (p.options || []).forEach(o => add(typeof o === 'string' ? o : o.name));
      (d.rows || []).forEach(r => {
        const v = r.cells[p.id];
        (Array.isArray(v) ? v : [v]).forEach(add);
      });
    });
    (this.state.invites || []).forEach(i => add(i.email));
    return out.slice(0, 24);
  }
  renameProp(dbId, propId, name) {
    this.patchDb(dbId, d => { const pr = d.props.find(x => x.id === propId); if (pr) pr.name = name; });
  }
  retypeProp(dbId, propId, type) {
    this.patchDb(dbId, d => {
      const pr = d.props.find(x => x.id === propId); if (!pr) return;
      const was = pr.type;
      pr.type = type;
      if (OPTION_TYPES[type] && !(pr.options || []).length) {
        /* seed the option list from whatever the rows already contain */
        const seen = {};
        d.rows.forEach(r => {
          const v = r.cells[pr.id];
          (Array.isArray(v) ? v : [v]).forEach(x => { if (x && !seen[x]) seen[x] = 1; });
        });
        let names = Object.keys(seen);
        if (!names.length && type === 'person') names = this.knownPeople(d);
        pr.options = names.slice(0, 24).map((n, i) => ({
          id: uid('o'), name: n, color: PROP_COLORS[i % PROP_COLORS.length].id
        }));
      }
      /* Keep the data usable across the change — SHAPE first, then type. The
         two used to share one if/else chain, so an array value took the
         "collapse to v[0]" branch and never reached the number branch below
         it: multi-select → number left every cell a string, which then sorted
         lexicographically ("10" before "9"). */
      d.rows.forEach(r => {
        let v = r.cells[pr.id];
        if (v === undefined) return;
        if (MULTI_TYPES[type] && !Array.isArray(v)) v = this.isBlank(v) ? [] : [String(v)];
        else if (!MULTI_TYPES[type] && Array.isArray(v)) v = v.length ? v[0] : '';
        if (!Array.isArray(v)) {
          if (type === 'checkbox' && was !== 'checkbox') v = !!v;
          else if (type === 'number') { const n = Number(v); v = (v === '' || v == null || isNaN(n)) ? '' : n; }
          else if (was === 'checkbox' && type !== 'checkbox') v = v ? 'Yes' : '';
          else if (v != null && typeof v !== 'string') v = String(v);
        }
        r.cells[pr.id] = v;
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
      /* The guard used to run AFTER normProp(), which assigns `options = []`
         to whatever it is handed — so `!pr.options` could never be true and a
         bad propId silently pushed onto a throwaway object, dirtying the table
         and re-uploading it for nothing. Look the property up first. */
      const pr = d.props.find(x => x.id === propId);
      if (!pr || !OPTION_TYPES[pr.type]) return;
      this.normProp(pr);
      if (pr.options.some(o => o.name === name)) return;
      pr.options.push({ id: oid, name, color: color || PROP_COLORS[pr.options.length % PROP_COLORS.length].id });
    });
    return oid;
  }
  /* Options are referenced by NAME in three places: the row cells, a view's
     filters, and a board view's grouping. Renaming used to rewrite only the
     cells, so a view filtered on "In review" went permanently empty the moment
     someone renamed that option — with the Filter button still lit and a chip
     the menu no longer offered. deleteProp() has always cleaned filters; the
     option-level operations were simply never given the same treatment. */
  renameOption(dbId, propId, optId, name) {
    this.patchDb(dbId, d => {
      const pr = d.props.find(x => x.id === propId); if (!pr) return;
      const o = (pr.options || []).find(x => x.id === optId); if (!o) return;
      const old = o.name; o.name = name;
      if (old === name) return;
      d.rows.forEach(r => {
        const v = r.cells[pr.id];
        if (Array.isArray(v)) r.cells[pr.id] = v.map(x => x === old ? name : x);
        else if (v === old) r.cells[pr.id] = name;
      });
      (d.views || []).forEach(vw => {
        (vw.filters || []).forEach(f => { if (f.prop === propId && f.value === old) f.value = name; });
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
      /* a filter naming an option that no longer exists can only ever match
         nothing — drop it rather than leave the view mysteriously empty */
      (d.views || []).forEach(vw => {
        vw.filters = (vw.filters || []).filter(f => !(f.prop === propId && f.value === o.name));
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
  flipRows(mutate, dbId) {
    /* Scoped to the table being written. This used to select `[data-dbrow]`
       document-wide, so editing one cell measured and animated the rows of
       every table on the page — and the 220-row bail-out counted rows the
       mutation could not touch. */
    const scope = () => {
      const root = dbId ? document.querySelector('[data-db="' + dbId + '"]') : null;
      return [...(root || document).querySelectorAll('[data-dbrow]')];
    };
    const nodes = scope();
    if (!nodes.length || nodes.length > 220) { mutate(); return; }
    const first = new Map();
    nodes.forEach(n => first.set(n.getAttribute('data-dbrow'), n.getBoundingClientRect()));
    mutate();
    /* two frames: one for React to commit the new order, one to measure it */
    requestAnimationFrame(() => requestAnimationFrame(() => {
      scope().forEach(n => {
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

  /* `groupKey` is the column's VALUE, not its label — the empty column used to
     be recognised by parsing its caption back out ("No " + prop name), which a
     property genuinely named "No Status" would have broken. `fromKey` is the
     column the card was picked up from, which is what a multi-select needs:
     the drop removes that tag and adds the new one, leaving the row's other
     tags alone rather than replacing the whole array with one string. */
  applyRowDrop(dbId, viewId, rowId, groupKey, target, fromKey) {
    let moved = false, regrouped = false;
    this.patchDb(dbId, d => {
      const r = (d.rows || []).find(x => x.id === rowId);
      if (!r) return;
      if (groupKey != null && viewId) {
        const v = (d.views || []).find(x => x.id === viewId);
        const gp = v && this.boardGroupProp(d, v);
        if (gp) {
          const was = JSON.stringify(r.cells[gp.id] === undefined ? null : r.cells[gp.id]);
          if (MULTI_TYPES[gp.type]) {
            const arr = Array.isArray(r.cells[gp.id]) ? r.cells[gp.id].slice()
              : (this.isBlank(r.cells[gp.id]) ? [] : [String(r.cells[gp.id])]);
            const i = fromKey ? arr.indexOf(fromKey) : -1;
            if (i >= 0) arr.splice(i, 1);
            if (groupKey !== '' && arr.indexOf(groupKey) < 0) arr.push(groupKey);
            r.cells[gp.id] = arr;
          } else {
            r.cells[gp.id] = groupKey;
          }
          if (JSON.stringify(r.cells[gp.id] === undefined ? null : r.cells[gp.id]) !== was) regrouped = true;
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
  setRowGroup(dbId, viewId, rowId, groupKey, fromKey) {
    return this.applyRowDrop(dbId, viewId, rowId, groupKey, null, fromKey).regrouped;
  }
});
