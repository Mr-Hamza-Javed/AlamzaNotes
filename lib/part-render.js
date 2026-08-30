/* Alamza Notes — renderVals() — the template inputs
 *
 * Methods of the app class, moved out verbatim. They run on the same
 * instance as everything in index.dc.html: `this.state`, `this.setState`,
 * `this.props` and every other method are all available here.
 * Registered onto Component.prototype by lib/parts.js.
 */
AlamzaParts.register(class {
  /* -------------------------------------------------------- render vals */
  renderVals() {
    const s = this.state, p = this.page();
    const ro = this.isReadOnly();
    const src = s.prefs.sourceView;
    const showApp = s.ready && s.route === 'app';

    /* sidebar tree */
    const all = Object.values(s.pages).filter(x => !x.trashed && !x.hidden);
    const tree = [];
    const walk = (pid, depth) => this.childrenOf(pid).forEach(pg => {
      const active = pg.id === s.pageId;
      tree.push({
        id: pg.id, title: pg.title || 'Untitled', iconEl: this.iconEl(pg, 16), pad: (4 + depth * 15) + 'px',
        rot: s.expanded[pg.id] ? '90deg' : '0deg',
        bg: active ? 'var(--row)' : 'transparent',
        color: active ? 'var(--text)' : 'var(--muted)',
        weight: active ? '600' : '500',
        selected: active, dragOp: s.navDrag === pg.id ? .4 : 1,
        dropShadow: 'none',
        /* the action buttons only claim width while the row is hovered, so a
           resting title runs the full width of the sidebar */
        hoverOp: s.hoverId === 'nav:' + pg.id ? 1 : 0,
        actW: s.hoverId === 'nav:' + pg.id ? '46px' : '0px',
        enter: () => { if (s.hoverId !== 'nav:' + pg.id) this.setState({ hoverId: 'nav:' + pg.id }); },
        leave: () => { if (this.state.hoverId === 'nav:' + pg.id) this.setState({ hoverId: null }); },
        grab: (e) => this.navGrab(pg.id, e),
        toggle: (e) => { e.stopPropagation(); if (this._navMoved) return; this.setState(st => ({ expanded: { ...st.expanded, [pg.id]: !st.expanded[pg.id] } })); },
        open: () => { if (!this._navMoved) this.openPage(pg.id); },
        menu: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); this.setState({ menu: { kind: 'navpage', id: pg.id, x: r.left - 10, y: r.bottom + 6 } }); },
        context: (e) => { e.preventDefault(); e.stopPropagation(); this.setState({ menu: { kind: 'navpage', id: pg.id, x: e.clientX, y: e.clientY } }); },
        addChild: (e) => { e.stopPropagation(); this.newPage(pg.id); }
      });
      if (s.expanded[pg.id]) walk(pg.id, depth + 1);
    });
    walk(null, 0);

    /* breadcrumbs */
    const chain = []; let cur = p;
    while (cur) { chain.unshift(cur); cur = cur.parentId ? s.pages[cur.parentId] : null; }
    const crumbs = chain.map((c, i) => ({
      title: c.title || 'Untitled', iconEl: this.iconEl(c, 14),
      color: i === chain.length - 1 ? 'var(--text)' : 'var(--muted)',
      sep: i < chain.length - 1, open: () => this.openPage(c.id),
      context: (e) => { e.preventDefault(); e.stopPropagation(); this.setState({ menu: { kind: 'crumb', id: c.id, x: e.clientX, y: e.clientY } }); }
    }));

    /* blocks */
    const changed = this.changedIds();
    const lastVerId = p && (p.versions || []).length ? p.versions[p.versions.length - 1].id : null;
    let olCount = {};
    const rows = this.flat().map((f, idx, arr) => {
      const b = f.block, t = b.type;
      if (t === 'ol') {
        const lvl = (b.indent || 0) + f.depth * 10;
        olCount[lvl] = (olCount[lvl] || 0) + 1;
        Object.keys(olCount).forEach(k => { if (+k > lvl) delete olCount[k]; });
      } else olCount = {};
      const hovered = s.hoverId === b.id;
      const db = b.dbId ? this.dbFor(b.dbId) : null;
      const sub = b.pageId ? s.pages[b.pageId] : null;
      const focused = s.focusId === b.id;
      /* a heading toggle is a toggle with a level, so its typography is data
         rather than three more branches in the template */
      const tg = toggleStyle(b);
      return {
        id: b.id, isP: t === 'p', isH1: t === 'h1', isH2: t === 'h2', isH3: t === 'h3',
        isUL: t === 'ul', isOL: t === 'ol', isTodo: t === 'todo', isQuote: t === 'quote',
        isCallout: t === 'callout', isDivider: t === 'divider', isToggle: t === 'toggle',
        isCode: t === 'code', isMath: t === 'math', isSubpage: t === 'subpage', isDB: t === 'database',
        indent: ((b.indent || 0) * 26 + f.depth * 26) + 'px',
        num: (olCount[(b.indent || 0) + f.depth * 10] || 1) + '.',
        ph: (focused || (idx === 0 && arr.length === 1)) ? "Write, or press '/' for commands" : ' ',
        isTable: t === 'table', isColumns: t === 'columns',
        aria: blockLabel(b) + (b.text ? ': ' + AMD.stripMarks(b.text).slice(0, 60) : ''),
        txtColor: COLOR_HEX[b.color] || 'inherit',
        blockBg: b.bg ? COLOR_BG[b.bg] : 'transparent',
        chMark: changed[b.id] === 'new' ? '+' : changed[b.id] === 'edit' ? '~' : '',
        chColor: changed[b.id] === 'new' ? 'var(--add-fg)' : 'var(--del-fg)',
        hasChange: !!changed[b.id],
        nComments: (b.comments || []).length,
        hasComments: !!(b.comments && b.comments.length),
        openComments: (e) => {
          e.stopPropagation();
          if (s.isMobile) this.setState({ sheet: 'comments', commentOn: b.id });
          else this.setState({ panel: 'comments', commentOn: b.id });
        },
        openChange: (e) => { e.stopPropagation(); this.openDiff(lastVerId, 'current'); },
        selectSelf: (e) => { e.stopPropagation(); this.setState({ blockSel: [b.id] }); },
        /* Long press is the phone's right-click. It selects the word under the
           finger the way the OS would, then opens the one editor menu — and
           only that menu; the floating colour bar is suppressed on touch. */
        touchStart: (e) => {
          if (!this.state.isMobile) return;
          /* a native control owns its own press — never cover it with a menu */
          if (e.target.closest && e.target.closest('input,select,textarea,button,a')) return;
          const t = e.touches && e.touches[0]; if (!t) return;
          const host = e.currentTarget.closest ? e.currentTarget.closest('[data-block]') : null;
          this._lp = { x: t.clientX, y: t.clientY, top: host ? host.getBoundingClientRect().top : t.clientY };
          clearTimeout(this._lpT);
          this._lpT = setTimeout(() => {
            const lp = this._lp; if (!lp) return;
            this._lp = null;
            if (navigator.vibrate) { try { navigator.vibrate(8); } catch (err) {} }
            let picked = false;
            const rg = document.caretRangeFromPoint ? document.caretRangeFromPoint(lp.x, lp.y) : null;
            if (rg && rg.startContainer.nodeType === 3) {
              const tn = rg.startContainer, str = tn.nodeValue || '';
              let a = rg.startOffset, z = rg.startOffset;
              while (a > 0 && /\S/.test(str[a - 1])) a--;
              while (z < str.length && /\S/.test(str[z])) z++;
              if (z > a) {
                const rr = document.createRange(); rr.setStart(tn, a); rr.setEnd(tn, z);
                const g2 = window.getSelection(); g2.removeAllRanges(); g2.addRange(rr);
                picked = true;
              }
            }
            this.setState({
              selBar: null, slash: null,
              menu: {
                kind: 'editor', id: b.id, x: lp.x, y: lp.y, y0: lp.y,
                anchor: b.id, anchorTop: lp.top, hasSel: picked
              }
            });
          }, 470);
        },
        touchMove: (e) => {
          const t = e.touches && e.touches[0];
          if (!t || !this._lp) return;
          if (Math.abs(t.clientX - this._lp.x) + Math.abs(t.clientY - this._lp.y) > 10) {
            clearTimeout(this._lpT); this._lp = null;
          }
        },
        touchEnd: () => { clearTimeout(this._lpT); this._lp = null; },
        /* R14 — our own editor context menu, anchored like every other popup */
        context: (e) => {
          if (e.target.closest && e.target.closest('a')) return;
          e.preventDefault(); e.stopPropagation();
          const g = window.getSelection();
          const host = e.currentTarget.closest ? e.currentTarget.closest('[data-block]') : null;
          this.setState({
            menu: {
              kind: 'editor', id: b.id, x: e.clientX, y: e.clientY, y0: e.clientY,
              anchor: b.id, anchorTop: host ? host.getBoundingClientRect().top : e.clientY,
              hasSel: !!(g && !g.isCollapsed && g.toString())
            }
          });
        },
        menu: (e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          const host = e.currentTarget.closest ? e.currentTarget.closest('[data-block]') : null;
          this.setState({
            menu: {
              kind: 'block', id: b.id, x: r.left, y: r.bottom + 6, y0: r.bottom + 6,
              anchor: b.id, anchorTop: host ? host.getBoundingClientRect().top : r.top
            }
          });
        },
        gutRef: t === 'code' ? this.gutRef(b.id) : null,
        tRows: t === 'table' ? (b.rows || []).map((row, ri) => ({
          head: ri === 0 ? 'var(--soft)' : 'transparent',
          weight: ri === 0 ? '600' : '400',
          ph: ri === 0 ? 'Column' : '',
          cells: row.map((cell, ci) => ({
            v: cell, at: ri + '-' + ci,
            set: (ev) => this.tableEdit(b.id, ri, ci, ev.target.value),
            nav: (ev) => this.tableNav(b.id, ri, ci, ev)
          })),
          del: () => this.tableDel(b.id, 'row', ri)
        })) : [],
        tAddRow: () => this.tableAdd(b.id, 'row'),
        tAddCol: () => this.tableAdd(b.id, 'col'),
        cols: t === 'columns' ? (b.cols || []).map((col, ci) => ({
          width: (100 / (b.cols.length || 1)) + '%',
          blocks: col.map(cb => this.miniRow(cb, b.id, ci))
        })) : [],
        /* a toggle heading sits on the same line as the matching heading, so
           the gutter takes the heading's offset with it */
        gutterTop: (t === 'toggle' && b.level ? GUTTER['h' + b.level] : GUTTER[t]) || '3px',
        bullet: src ? '-' : '•',
        bulletSize: src ? '13px' : '16px',
        bulletColor: src ? 'var(--mk)' : 'var(--text)',
        bulletFont: src ? 'var(--mono)' : 'inherit',
        todoMark: b.checked ? '- [x]' : '- [ ]',
        selBg: (s.blockSel || []).indexOf(b.id) >= 0 ? 'var(--sel)' : 'transparent',
        down: (e) => {
          /* A pointer press puts the caret somewhere of its own choosing, so
             the column an earlier run of ↑/↓ was aiming for no longer means
             anything — held on, it would yank the next ↓ back to wherever the
             caret happened to be travelling before the click. */
          this._col = null;
          /* ...and the caret this press is about to place is the reader's
             choice, not the one typing parked (see onInput's `_want`) */
          this._want = null;
          /* A press on the row's own background (the gutter beside the text, or
             the empty space to its right) is a lasso, not a caret drag. */
          const onText = e.target.closest && (e.target.closest('[contenteditable="true"]') ||
            e.target.closest('button') || e.target.closest('input') ||
            e.target.closest('select') || e.target.closest('textarea') || e.target.closest('a'));
          if (!onText) { this.lassoStart(e); return; }
          this._anchor = b.id;
          if ((s.blockSel || []).length) this.setState({ blockSel: [] });
        },
        over: (e) => {
          if (e.buttons !== 1 || !this._anchor || this._anchor === b.id) return;
          const ids = this.flat().map(x => x.id);
          const a1 = ids.indexOf(this._anchor), c1 = ids.indexOf(b.id);
          if (a1 < 0 || c1 < 0) return;
          const range = ids.slice(Math.min(a1, c1), Math.max(a1, c1) + 1);
          const cur = s.blockSel || [];
          if (cur.length !== range.length || cur[0] !== range[0]) {
            const g = window.getSelection(); if (g) g.removeAllRanges();
            this.setState({ blockSel: range });
          }
        },
        rowBg: s.dropId === b.id ? 'var(--accent-soft)' : 'transparent',
        dropTop: s.dropId === b.id ? '2px solid var(--accent)' : '2px solid transparent',
        ref: this.elRef(b.id), mathRef: this.mathRef(b.id),
        input: () => this.onInput(b.id), key: (e) => this.onKey(b.id, e),
        focus: () => this.onFocus(b.id), blur: () => this.onBlur(b.id),
        paste: (e) => this.onPaste(b.id, e),
        focusSelf: () => {
          this.setState({ focusId: b.id });
          setTimeout(() => { const el = this._els[b.id]; if (el) { el.focus(); setCaret(el, (b.text || '').length); } }, 20);
        },
        insertAfter: () => this.insertAfter(b.id, 'p'),
        grab: (e) => this.startDrag(b.id, e),
        check: () => this.mutate(bs => { const g = this.locate(b.id, bs); if (g) g.block.checked = !g.block.checked; }),
        tick: b.checked ? '✓' : '',
        boxBg: b.checked ? 'var(--accent)' : 'transparent',
        boxBorder: b.checked ? 'var(--accent)' : 'var(--faint)',
        doneOp: b.checked ? .5 : 1, doneLine: b.checked ? 'line-through' : 'none',
        collapse: () => this.mutate(bs => { const g = this.locate(b.id, bs); if (g) g.block.collapsed = !g.block.collapsed; }),
        rot: b.collapsed ? '0deg' : '90deg',
        tgSize: tg.size, tgWeight: tg.weight, tgLine: tg.line, tgSpace: tg.space,
        tgMinH: tg.minH, tgTop: tg.top, tgScale: tg.scale, tgPh: tg.ph,
        tgMarks: tg.mk, tgSource: src && !!tg.mk,
        icon: b.icon || '💡',
        pickIcon: () => this.setState({ modal: { kind: 'emoji', target: 'block', id: b.id } }),
        lang: b.lang || 'plaintext',
        setLang: (e) => { const v = e.target.value; this.mutate(bs => { const g = this.locate(b.id, bs); if (g) g.block.lang = v; }); },
        copyCode: () => navigator.clipboard.writeText(b.text || '').then(() => this.toast('Code copied')),
        mathShown: true, mathEditDisplay: (focused || src) ? 'block' : 'none',
        openPage: () => sub && this.openPage(sub.id),
        subIconEl: this.iconEl(sub, 18), subTitle: (sub && sub.title) || 'Untitled',
        subMeta: sub ? (((sub.blocks || []).length || sub.blockCount || 0) + ' blocks · ' + relTime(sub.updatedAt)) : 'Missing page',
        dbName: (db && db.name) || 'Database',
        /* the count comes from the index, so it is right before rows arrive */
        dbCount: db ? ((db.rows ? db.rows.length : (db.rowCount || 0)) + ' items') : '',
        ...this.dbRowVals(db)
      };
    });

    const favs = all.filter(x => x.favorite).map(x => ({
      id: x.id, title: x.title || 'Untitled', iconEl: this.iconEl(x, 16),
      open: () => this.openPage(x.id),
      context: (e) => { e.preventDefault(); e.stopPropagation(); this.setState({ menu: { kind: 'navpage', id: x.id, x: e.clientX, y: e.clientY } }); }
    }));
    const tq = (s.trashQ || '').toLowerCase().trim();
    const trashAll = Object.values(s.pages).filter(x => x.trashed);
    const trashList = trashAll
      .filter(x => !tq || (x.title || 'Untitled').toLowerCase().includes(tq))
      .sort((a, b) => (b.trashedAt || 0) - (a.trashedAt || 0)).map(x => ({
      iconEl: this.iconEl(x, 17), title: x.title || 'Untitled',
      pad: x.trashRoot === false ? '22px' : '0px',
      meta: (x.trashRoot === false ? 'Sub-page · ' : '') + 'Deleted ' + relTime(x.trashedAt || x.updatedAt),
      open: () => this.openPage(x.id),
      sub: !x.trashRoot,
      restore: (e) => { e.stopPropagation(); this.restorePage(x.id); },
      purge: (e) => { e.stopPropagation(); this.trashPage(x.id, true); }
    }));

    /* ---- the phone home screen -------------------------------------------
       Two modes, because they answer different questions. BROWSING wants the
       same shape as the desktop sidebar: the page tree, indented, expandable,
       so a note's place in the workspace is visible. SEARCHING wants matches
       wherever they live, so hierarchy would only hide them — that stays a
       flat list, and each hit names the page it sits inside instead.

       It used to be one flat `Object.values(pages)` sorted by date, which threw
       the nesting away entirely and mixed in hidden database-row pages. */
    const hq = (s.homeQ || '').toLowerCase().trim();
    const homeOn = !!(s.isMobile && s.main === 'home');

    /* first line of real text, for the search results' snippet */
    const bodyOf = (x) => {
      let body = x.snippet || '';
      if (x.blocks) {
        for (const b of x.blocks) {
          if (b.type === 'divider' || !b.text) continue;
          const t = AMD.stripMarks(b.text).trim();
          if (t) { body = t; break; }
        }
      }
      return body;
    };

    const homeTree = [];
    if (homeOn && !hq) {
      const walkHome = (pid, depth) => this.childrenOf(pid).forEach(pg => {
        const kids = this.childrenOf(pg.id);
        const open = !!s.expanded[pg.id];
        homeTree.push({
          id: pg.id, title: pg.title || 'Untitled',
          iconEl: this.iconEl(pg, 20),
          /* indentation carries the hierarchy; the chevron column is fixed so
             every row's text starts on the same line at a given depth */
          pad: (6 + depth * 18) + 'px',
          hasKids: kids.length > 0,
          /* a leaf still needs the chevron column, or its title would sit
             further left than its siblings' and the indentation would lie */
          noKids: kids.length === 0,
          rot: open ? '90deg' : '0deg',
          meta: relTime(pg.updatedAt)
            + (kids.length ? ' · ' + kids.length + (kids.length === 1 ? ' page inside' : ' pages inside') : ''),
          /* separate hit targets: expanding must not force the page open, and
             both stay at 44px so neither is a coin-flip on a phone */
          toggle: (e) => { e.stopPropagation();
            this.setState(st => ({ expanded: { ...st.expanded, [pg.id]: !st.expanded[pg.id] } })); },
          open: () => this.openPage(pg.id)
        });
        if (open) walkHome(pg.id, depth + 1);
      });
      walkHome(null, 0);
    }

    const homeHits = !(homeOn && hq) ? [] : Object.values(s.pages)
      .filter(x => !x.trashed && !x.hidden)
      .map(x => {
        /* Index-only search: the digest stands in for a body we have not
           downloaded, so an unopened note is still findable. */
        let hay = '';
        if (x.blocks) {
          const parts = [x.title || ''];
          (function walk(list) {
            (list || []).forEach(b => {
              if (b.text) parts.push(b.text);
              if (b.children) walk(b.children);
              if (b.cols) b.cols.forEach(walk);
              if (b.rows) b.rows.forEach(r => parts.push(r.join(' ')));
            });
          })(x.blocks);
          hay = parts.join('\n').toLowerCase();
        } else hay = ((x.title || '') + ' ' + (x.snippet || '') + ' ' + this.digestFor(x.id)).toLowerCase();
        return { pg: x, hay };
      })
      .filter(({ hay }) => hay.includes(hq))
      .sort((a, b) => (b.pg.updatedAt || 0) - (a.pg.updatedAt || 0))
      .map(({ pg }) => {
        const par = pg.parentId && s.pages[pg.parentId];
        return {
          id: pg.id, title: pg.title || 'Untitled',
          snippet: bodyOf(pg) || 'Empty note',
          when: relTime(pg.updatedAt),
          /* a flat hit list hides where a note lives, so say it */
          inLabel: par ? 'in ' + (par.title || 'Untitled') : 'Top level',
          iconEl: this.iconEl(pg, 20),
          open: () => this.openPage(pg.id)
        };
      });

    /* local/demo has no separate index, so it is known from the first frame */
    const indexKnown = AStore.mode !== 'firebase' || !!AStore.indexReady;
    const versions = p ? (p.versions || []) : [];
    const wantList = s.panel === 'versions' || s.sheet === 'versions';
    /* the moment the list is actually consumed — guarded, so it is one read */
    if (wantList && p) this.ensureVersionMeta(p.id);
    /* An unread history is NOT an empty one — the same null-vs-empty contract
       bodies and rows follow. Rendering "No snapshots yet · Take the first
       snapshot" over a page with five stored snapshots invites exactly the
       click that used to destroy them. */
    const versionsLoading = !!(wantList && p && !this.versionMetaKnown(p.id));
    /* a reader who may not write the history is not offered the buttons that
       write it — the guard refuses them anyway, and a button that does nothing
       is worse than one that is not there */
    const canWriteHist = this.canWriteHistory(p);
    /* A click on a row opens that version read-only — but a DRAG across the
       message is someone selecting text, and it used to navigate on the way
       up. */
    const plainClick = () => {
      const sel = window.getSelection && window.getSelection();
      return !(sel && String(sel).length);
    };
    /* The highlight marks what is on screen. It used to key off `diffB ===
       'current'`, which is the initial state, so the CURRENT row was lit from
       boot and stayed lit whatever the reader was looking at. */
    const vlist = !wantList ? [] : [{
      tag: 'CURRENT', when: relTime(p && p.updatedAt), message: 'Working copy — auto-saved',
      author: (p && p.updatedBy) || 'You', auto: false, actions: versions.length > 0,
      bg: s.roVersion ? 'transparent' : 'var(--accent-soft)',
      bd: 'transparent', dot: 'var(--accent)', line: 'var(--border)', tagColor: 'var(--accent)',
      stat: false, deep: false, deepLabel: '', add: 0, del: 0, chg: 0,
      canRestore: false, hasMenu: false,
      select: () => { if (s.roVersion) this.setState({ roVersion: null }); },
      context: () => {}, more: () => {},
      diff: (e) => { e.stopPropagation(); this.openDiff(versions.length ? versions[versions.length - 1].id : null, 'current'); },
      restore: () => {}
    }].concat(versions.slice().reverse().map((v, i) => {
      const prev = versions[versions.length - 2 - i];
      /* Stored at snapshot time. The fallback is only for snapshots written
         before `stat` existed, and it must not run against cold payloads: two
         unloaded sides diff to "+0 −0", one loaded side to "the whole page was
         added". Show no counts until both are really in hand. */
      const haveBoth = !!this.vsnap(v.id) && (!prev || !!this.vsnap(prev.id));
      const st = v.stat || (haveBoth
        ? ADiff.stats(prev ? this.vblocks(prev.id) : [], this.vblocks(v.id))
        : null);
      return {
        tag: 'v' + v.n, when: relTime(v.createdAt), message: v.message, author: v.author || 'Alamza', auto: !!v.auto,
        actions: true, canRestore: canWriteHist, hasMenu: true,
        bg: v.id === s.roVersion ? 'var(--accent-soft)' : 'transparent',
        bd: v.id === s.roVersion ? 'var(--accent)' : 'transparent',
        dot: v.id === s.roVersion ? 'var(--accent)' : 'var(--faint)', line: 'var(--border)',
        tagColor: 'var(--muted)', stat: !!st, add: st ? st.added : 0, del: st ? st.removed : 0, chg: st ? st.changed : 0,
        /* a snapshot that reaches past this page says so — and says how many of
           those nested pages actually moved, not merely how many exist */
        deep: !!(v.deepStat && v.deepStat.pages > 1),
        deepLabel: !(v.deepStat && v.deepStat.pages > 1) ? ''
          : (v.deepStat.touched ? v.deepStat.touched + ' nested changed'
             : (v.deepStat.pages - 1) + ' nested'),
        /* tapping a snapshot opens it — read-only. The diff is its own button */
        select: (e) => { if (e && e.stopPropagation) e.stopPropagation(); if (plainClick()) this.restore(v.id, 'ro'); },
        context: (e) => { e.preventDefault(); e.stopPropagation(); this.setState({ menu: { kind: 'version', id: v.id, x: e.clientX, y: e.clientY } }); },
        /* the same menu, reachable without a right-click — which is to say
           reachable on a phone, and by anyone using a keyboard */
        more: (e) => {
          if (e && e.preventDefault) e.preventDefault();
          if (e && e.stopPropagation) e.stopPropagation();
          const r = e && e.currentTarget && e.currentTarget.getBoundingClientRect
            ? e.currentTarget.getBoundingClientRect() : { right: 240, bottom: 120 };
          this.setState({ menu: { kind: 'version', id: v.id, x: Math.max(12, r.right - 224), y: r.bottom + 6 } });
        },
        diff: (e) => { e.stopPropagation(); this.openDiff(v.id, 'current'); },
        restore: (e) => { e.stopPropagation(); this.setState({ modal: { kind: 'restore', vid: v.id } }); }
      };
    }));

    return {
      showApp, showSidebar: showApp && !s.isMobile && !s.focusMode,
      focusMode: !!s.focusMode,
      exitFocus: () => this.setState({ focusMode: false }),
      sidebarShell: s.sidebarOpen ? (s.prefs.sidebarW || 264) + 'px' : '0px',
      sidebarOp: s.sidebarOpen ? 1 : 0,
      sidebarShift: s.sidebarOpen ? '0px' : '-14px',
      showDesktopBar: showApp && !s.isMobile && !s.focusMode,
      showMobileHeader: showApp && s.isMobile && s.main !== 'home',
      showHome: showApp && s.isMobile && s.main === 'home',
      homeQ: s.homeQ || '', homeHasQ: !!(s.homeQ || '').trim(),
      setHomeQ: (e) => this.setState({ homeQ: e.target.value }),
      clearHomeQ: () => this.setState({ homeQ: '' }),
      homeNew: () => this.newPage(null),
      /* browsing counts the whole workspace, not the rows currently expanded —
         collapsing a branch does not mean those notes stopped existing */
      homeCount: (() => {
        if (!homeOn) return '';
        if (hq) return homeHits.length + (homeHits.length === 1 ? ' match' : ' matches');
        const n = Object.values(s.pages).filter(x => !x.trashed && !x.hidden).length;
        return n + (n === 1 ? ' note' : ' notes');
      })(),
      homeSearching: !!hq,
      homeBrowsing: homeOn && !hq,
      homeTree, homeHits,
      homeEmpty: homeOn && (hq ? homeHits.length === 0 : homeTree.length === 0),
      homeEmptyMsg: (s.homeQ || '').trim() ? 'No note matches “' + s.homeQ.trim() + '”.' : 'No notes yet. Tap ＋ New to start one.',
      goHome: () => this.goHome(),
      sidebarClosed: !s.sidebarOpen, isPageRoute: s.main === 'page' && !!p, isTrashRoute: s.main === 'trash',
      /* A toolbar with no document under it is the worst thing to show: it
         says a page is open when none is. Say plainly which case this is. */
      /* Never claim a workspace is empty until the index has actually arrived.
         `ready` only means the SDK booted, so it cannot distinguish "no pages"
         from "not fetched yet" — and getting that wrong offers a New page
         button that writes a stray page into a workspace full of real notes. */
      noPageOpen: s.main === 'page' && !p && s.ready && indexKnown,
      awaitingIndex: s.main === 'page' && !p && s.ready && !indexKnown,
      indexSkeleton: Array.from({ length: 6 }, (_, i) => ({
        w: [88, 74, 92, 66, 80, 70][i] + '%', delay: (i * 80) + 'ms'
      })),
      noPageTitle: Object.keys(s.pages).length ? 'This page is no longer here' : 'Your workspace is empty',
      noPageBody: Object.keys(s.pages).length
        ? 'The page that was open has been deleted or moved. Pick another from the sidebar, or start a new one.'
        : 'Nothing has been created yet. Start your first page whenever you are ready.',
      noPageAction: () => this.newPage(null),
      wsName: s.workspace.name, wsIcon: s.workspace.icon,
      wsGlyph: s.workspace.icon || (s.workspace.name || 'A').slice(0, 1).toUpperCase(),
      userName: (s.user && s.user.name) || 'Guest',
      userInitial: ((s.user && s.user.name) || 'G').slice(0, 1).toUpperCase(),
      storeLabel: AStore.mode === 'firebase' ? 'Firebase · synced' : AStore.demo ? 'Demo · this browser' : 'Local storage',
      themeGlyph: s.prefs.theme === 'dark' ? '☾' : '☼',
      tree, favorites: favs, hasFavorites: favs.length > 0,
      treeEmpty: tree.length === 0 && indexKnown,
      treeLoading: tree.length === 0 && !indexKnown,
      sidebarW: (s.prefs.sidebarW || 264) + 'px',
      resizeBg: s.resizing ? 'var(--accent)' : 'transparent',
      startResize: (e) => this.startResize(e),
      resetSidebar: () => this.setState(st => ({ prefs: { ...st.prefs, sidebarW: 264 } }), () => this.persist()),
      trashBg: s.main === 'trash' ? 'var(--row)' : 'transparent',
      sidebarContext: (e) => {
        if (e.target.closest && e.target.closest('[data-navrow]')) return;
        e.preventDefault();
        this.setState({ menu: { kind: 'navroot', x: e.clientX, y: e.clientY } });
      },
      trashCount: trashAll.length || '', trashList, trashEmpty: trashList.length === 0,
      trashHasItems: trashAll.length > 0,
      trashQ: s.trashQ || '',
      setTrashQ: (e) => this.setState({ trashQ: e.target.value }),
      emptyTrash: () => {
        const ids = trashAll.map(x => x.id);
        this.setState(st => {
          const pages = {};
          Object.keys(st.pages).forEach(k => { if (ids.indexOf(k) < 0) pages[k] = st.pages[k]; });
          return { pages, trashQ: '' };
        }, () => this.persist());
        this.toast('Trash emptied — ' + ids.length + ' page' + (ids.length === 1 ? '' : 's') + ' deleted');
      },
      crumbs, crumbLabel: crumbs.slice(0, -1).map(c => c.title).join(' / ') || 'Workspace',
      pageIcon: (p && p.icon) || '', pageTitle: (p && p.title) || 'Untitled',
      hasIcon: !!(p && p.icon), pageIconEl: this.iconEl(p || {}, 18),
      showAddIcon: !!p && !p.icon && !ro,
      pageKey: s.pageId + (s.roVersion || ''),
      pageAnim: 'aPage .22s cubic-bezier(.22,.8,.3,1)',
      lassoStart: (e) => this.lassoStart(e),
      isTrashed: !!(p && p.trashed),
      /* role banner */
      showRoleBar: !!p && !p.trashed && this.myRole(p) !== 'owner',
      roleLabel: this.myRole(p) === 'viewer'
        ? 'You have view access to this page. Editing is disabled.'
        : 'You have comment access to this page. You can comment, but not edit.',
      roleName: this.myRole(p),
      roleCanComment: this.canComment(p),
      openRoleComments: () => this.setState(st => (st.isMobile ? { sheet: 'comments' } : { panel: 'comments' })),
      pageTint: p && p.trashed ? 'linear-gradient(var(--del-bg),var(--del-bg)) padding-box' : 'transparent',
      restoreThis: () => this.restorePage(s.pageId),
      purgeThis: () => this.trashPage(s.pageId, true),
      editedLabel: p ? 'Edited by ' + (p.updatedBy || 'you') + ' · ' + relTime(p.updatedAt) : '',
      isPublished: !!(p && p.share && p.share.published),
      viewers: (p && p.viewers || []).map(v => ({ title: v.name + ' is viewing', initial: v.name.slice(0, 1), color: v.color })),
      hasViewers: !!(p && p.viewers && p.viewers.length) && !s.narrow,
      showEdited: !s.narrow,
      saveLabel: s.saveState === 'saving' ? 'Saving…' : s.saveState === 'error' ? 'Not saved' : s.saveState === 'saved' ? 'Saved' : '',
      saveColor: s.saveState === 'error' ? 'var(--del-fg)' : 'var(--faint)',
      showSave: !!s.saveState && s.saveState !== 'idle',
      sourceOn: src, srcColor: src ? '#fff' : 'var(--muted)', srcBg: src ? 'var(--accent)' : 'transparent',
      verColor: s.panel === 'versions' ? 'var(--accent)' : 'var(--muted)',
      verBg: s.panel === 'versions' ? 'var(--accent-soft)' : 'transparent',
      versionCount: versions.length || '',
      favGlyph: p && p.favorite ? '★' : '☆', favColor: p && p.favorite ? '#E8A33D' : 'var(--muted)',
      docWidth: s.prefs.fullWidth ? '100%' : '780px',
      /* A phone has no room for a desktop's margins. The 46px hover gutter is
         also dead weight on touch — the handles only appear on hover, which a
         finger cannot do; long-press gives the same actions. Dropping both
         gives the text about 80px back on a 390px screen. */
      docPad: s.isMobile ? '10px 12px 0' : '54px 40px 0',
      headPad: s.isMobile ? '0px' : '48px',
      titleSize: s.isMobile ? '29px' : '40px',
      titleMinH: s.isMobile ? '36px' : '48px',
      /* A page whose body has not arrived shows its own shape — title, icon
         and block count are already in the index — rather than an empty
         document that looks like data loss. */
      migrating: s.migrating != null,
      migratingLabel: 'Upgrading workspace — ' + (s.migrating || 0) + ' pages moved',
      layoutFailed: !!s.layoutError,
      /* Demo mode replaces the whole workspace with seeded pages. Unannounced
         that is indistinguishable from having lost every note, so it says so —
         and offers the way back, rather than leaving it buried in settings. */
      inDemo: !!AStore.demo && s.route === 'app',
      /* On a phone the message and a 44px button cannot share one 41px row, and
         this button is the ONLY way back from a state the banner exists because
         users would otherwise read as data loss — so it stacks rather than
         shrinking below the 44px floor. */
      demoDir: s.isMobile ? 'column' : 'row',
      demoPad: s.isMobile ? '9px 12px 11px' : '7px 14px',
      demoGap: s.isMobile ? '8px' : '10px',
      demoBtnH: s.isMobile ? '44px' : '26px',
      demoBtnW: s.isMobile ? '100%' : 'auto',
      demoMsg: s.isMobile
        ? 'Demo workspace — your own notes are untouched.'
        : 'Demo workspace — sample notes in this browser. Your own notes are untouched.',
      layoutErrorMsg: 'Your notes could not be upgraded to the new storage layout. They are safe and untouched in the database — nothing has been deleted. Retry below, and send this if it keeps failing: ' + (s.layoutError || ''),
      retryMigration: () => { this.setState({ layoutError: null }); AStore.retryMigration(); },
      /* A read-only snapshot that has not arrived is LOADING, not empty. The
         blocks it renders come from `vblocks()`, which returns `[]` while the
         payload is in flight — so without this the page reads as "this version
         was blank", with a Restore button beside it. */
      bodyLoading: !!(p && !p.blocks && AStore.mode === 'firebase')
        || !!(s.roVersion && !this.vsnap(s.roVersion)),
      skeletonRows: (p && !p.blocks) || (s.roVersion && !this.vsnap(s.roVersion))
        ? Array.from({ length: Math.max(3, Math.min(9, (p && p.blockCount) || 5)) }, (_, i) => ({
            w: [92, 76, 88, 60, 84, 70, 90, 64, 80][i % 9] + '%',
            delay: (i * 70) + 'ms'
          }))
        : [],
      showGutter: !ro && !s.isMobile,
      deadGutter: ro && !s.isMobile,
      editable: !ro, notEditable: ro, rows, langs: LANGS,
      /* let an inline database use the space beside the text column, like
         Notion does, so a board shows more than two columns at a time */
      dbBleed: this.dbBleed() + 'px',
      readOnlyBanner: !!s.roVersion,
      /* A version message is free text and can be a paragraph. Unclamped it
         pushed the four buttons beside it off the banner. */
      readOnlyLabel: (() => {
        const v = s.roVersion && this.versionById(s.roVersion);
        if (!s.roVersion) return '';
        if (!v) return 'Read-only preview of an old version';
        const msg = (v.message || '').trim();
        const cut = msg.length > 78 ? msg.slice(0, 77).trimEnd() + '…' : msg;
        return 'Read-only preview of v' + v.n + (cut ? ' — ' + cut : '');
      })(),
      readOnlyTitle: (() => {
        const v = s.roVersion && this.versionById(s.roVersion);
        return v ? 'v' + v.n + ' — ' + (v.message || '') : '';
      })(),
      backColor: s.stack.length ? 'var(--text)' : 'var(--faint)',
      showVersionPanel: showApp && !s.isMobile && s.panel === 'versions',
      showCommentPanel: showApp && !s.isMobile && s.panel === 'comments',
      commentTarget: s.commentOn && this.locate(s.commentOn)
        ? (AMD.stripMarks(this.locate(s.commentOn).block.text) || 'this block').slice(0, 64) : 'Pick a block',
      commentDraft: s.draft || '',
      commentTotal: this.commentCount(),
      setCommentDraft: (e) => this.setState({ draft: e.target.value }),
      submitComment: () => this.addComment(s.commentOn, s.draft),
      canComment: !!s.commentOn,
      commentThreads: (() => {
        const list = [];
        const walk = (arr) => (arr || []).forEach(b => {
          if (b.comments && b.comments.length) list.push({
            id: b.id,
            label: (AMD.stripMarks(b.text) || b.type).slice(0, 52) || 'Untitled block',
            active: b.id === s.commentOn,
            bg: b.id === s.commentOn ? 'var(--accent-soft)' : 'transparent',
            pick: () => { this.setState({ commentOn: b.id }); this.flashBlock(b.id); },
            items: b.comments.map(c => ({
              author: c.author, initial: (c.author || '?').slice(0, 1).toUpperCase(),
              color: this.chipColor(c.author).fg, when: relTime(c.at), text: c.text,
              resolve: () => this.resolveComment(b.id, c.id)
            }))
          });
          if (b.children) walk(b.children);
          if (b.cols) b.cols.forEach(walk);
        });
        walk(this.activeBlocks());
        return list;
      })(),
      /* the thread list walks children and columns, so the empty state has to
         as well — a comment inside a toggle showed BOTH */
      noComments: !ADiff.flatten(this.activeBlocks()).some(b => b.comments && b.comments.length),
      closePanel2: () => this.setState({ panel: null }),
      versionList: versionsLoading ? [] : vlist,
      noVersions: !versionsLoading && versions.length === 0,
      versionsLoading,
      /* nothing may be authored against a history that has not arrived, or by
         a reader who may not write this page */
      newVersionOff: versionsLoading || !canWriteHist,
      newVersionBg: (versionsLoading || !canWriteHist) ? 'var(--soft)' : 'var(--accent)',
      newVersionColor: (versionsLoading || !canWriteHist) ? 'var(--faint)' : '#fff',
      newVersionLabel: versionsLoading ? 'Loading history…' : !canWriteHist ? 'View only' : 'New version',
      canWriteHistory: canWriteHist,
      scrollRef: (el) => {
        const first = !this._scroll;
        this._scroll = el;
        /* measure once the scroller exists, so the database bleed is real */
        if (el && (first || this.state.scW !== el.clientWidth)) {
          setTimeout(() => {
            if (this._scroll && this.state.scW !== this._scroll.clientWidth) {
              this.setState({ scW: this._scroll.clientWidth });
            }
          }, 0);
        }
      },
      titleRef: (el) => { if (el) { this._titleEl = el; } },
      hasProps: !!(p && p.dbRef && s.dbs[p.dbRef.dbId]),
      isDbRow: !!(p && p.dbRef && s.dbs[p.dbRef.dbId]),
      dbRowSource: p && p.dbRef && s.dbs[p.dbRef.dbId] ? (s.dbs[p.dbRef.dbId].name || 'Database') : '',
      backToDb: () => { if (p && p.parentId) this.openPage(p.parentId); },
      pageProps: p && p.dbRef ? this.propFields(p.dbRef.dbId, p.dbRef.rowId, true) : [],
      propPanelOpen: !(p && p.propsCollapsed),
      propPanelRot: (p && p.propsCollapsed) ? '0deg' : '90deg',
      propPanelLabel: (p && p.propsCollapsed)
        ? 'Properties (' + (p.dbRef && s.dbs[p.dbRef.dbId] ? s.dbs[p.dbRef.dbId].props.length - 1 : 0) + ')'
        : 'Properties',
      togglePropPanel: () => this.patchPage(s.pageId, { propsCollapsed: !(p && p.propsCollapsed) }, true),
      addPageProp: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        this.setState({ menu: { kind: 'newprop', dbId: p.dbRef.dbId, x: r.left, y: r.bottom + 6 } });
      },
      openPageProps: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        this.setState({ menu: { kind: 'pageprops', dbId: p.dbRef.dbId, x: r.left, y: r.bottom + 6 } });
      },
      hasHiddenProps: !!(p && p.dbRef && s.dbs[p.dbRef.dbId] && (s.dbs[p.dbRef.dbId].pageHidden || []).length),
      hiddenPropsLabel: s.showHiddenProps ? 'Hide hidden properties'
        : (p && p.dbRef && s.dbs[p.dbRef.dbId] ? 'Show ' + (s.dbs[p.dbRef.dbId].pageHidden || []).length + ' hidden' : ''),
      toggleHiddenProps: () => this.setState(st => ({ showHiddenProps: !st.showHiddenProps })),
      onTitleInput: () => {
        const t = this._titleEl.textContent;
        /* The title sits in every snapshot, but nothing ever filed one FOR it.
           Two faults followed: ⌘Z could not take a title back, and — worse —
           undoing anything ELSE landed on a snapshot carrying the old title
           and wiped what had been typed since.

           Filed the way a block edit is: the state as it stood BEFORE this run
           of keystrokes goes in once, then the result goes in on a pause, so a
           whole title is one undo step rather than one per character. The pause
           is what separates runs, so stopping and typing again gives two steps.

           On a database row page the title also mirrors into the row's first
           cell, and `patchDb` files history on every call — that alone put one
           entry per KEYSTROKE in the stack, so that write is told not to and
           the debounce below owns the filing for both kinds of page. */
        if (!this._titleT) this.syncTail();
        this.patchPage(s.pageId, { title: t });
        if (p && p.dbRef) this.patchDb(p.dbRef.dbId, d => {
          const r = d.rows.find(x => x.id === p.dbRef.rowId); if (r) r.cells[d.props[0].id] = t;
        }, true);
        clearTimeout(this._titleT);
        const pid = s.pageId;
        this._titleT = setTimeout(() => {
          this._titleT = null;
          /* the reader may have left while this was pending; history belongs
             to the page the typing happened on, not to whatever is open now */
          if (this.state.pageId === pid) this.syncTail();
        }, HIST_PAUSE);
      },
      onTitleKey: (e) => { if (e.key === 'Enter') { e.preventDefault(); const first = this.activeBlocks()[0]; if (first) { const el = this._els[first.id]; if (el) el.focus(); } } },
      toggleSidebar: () => this.setState(st => ({ sidebarOpen: !st.sidebarOpen })),
      openWorkspaceMenu: (e) => { const r = e.currentTarget.getBoundingClientRect(); this.setState({ menu: { kind: 'ws', x: r.left, y: r.bottom + 4 } }); },
      openSearch: () => this.openSearch(),
      goSettings: () => this.setState({ route: 'settings', panel: null, sheet: null }),
      openTrash: () => this.setState({ main: 'trash', panel: null }),
      newRootPage: () => this.newPage(null),
      toggleTheme: () => this.toggleTheme(), toggleSource: () => this.toggleSource(),
      openVersions: () => this.setState(st => ({ panel: st.panel === 'versions' ? null : 'versions' })),
      closePanel: () => this.setState({ panel: null }),
      openShare: () => this.setState({ modal: { kind: 'share' } }),
      toggleFavorite: () => this.patchPage(s.pageId, { favorite: !(p && p.favorite) }, true),
      openPageMenu: (e) => { const r = e.currentTarget.getBoundingClientRect(); this.setState({ menu: { kind: 'page', x: Math.max(12, r.right - 210), y: r.bottom + 6 } }); },
      openIconPicker: () => !ro && this.setState({ modal: { kind: 'emoji', target: 'page' } }),
      openNewVersion: () => this.setState({ modal: { kind: 'newVersion', msg: '' } }),
      appendBlock: () => { const bs = this.activeBlocks(); const last = bs[bs.length - 1]; if (last && last.type === 'p' && !last.text) { const el = this._els[last.id]; if (el) el.focus(); } else if (last) this.insertAfter(last.id, 'p'); },
      exitReadOnly: () => this.setState({ roVersion: null }),
      /* four buttons plus a sentence do not fit a phone on one line, so the
         label takes a full row of its own and the buttons wrap beneath it */
      roLabelFlex: s.isMobile ? '1 1 100%' : '1 1 auto',
      roCopyLabel: s.isMobile ? 'Copy MD' : 'Copy as Markdown',
      roBackLabel: s.isMobile ? 'Back' : 'Back to current',
      copyRoMarkdown: () => this.copyMarkdown(),
      diffRoVersion: () => this.openDiff(s.roVersion, 'current'),
      openRestoreFromRO: () => this.setState({ modal: { kind: 'restore', vid: s.roVersion } }),
      mobileBack: () => this.mobileBack(),
      openStackSheet: () => this.setState({ sheet: 'pages' }),
      ...this.extraVals()
    };
  }
}, 'part-render');
