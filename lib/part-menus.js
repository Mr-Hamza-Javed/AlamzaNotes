/* Alamza Notes — Menus, modals and sheets — extraVals()
 *
 * Methods of the app class, moved out verbatim. They run on the same
 * instance as everything in index.dc.html: `this.state`, `this.setState`,
 * `this.props` and every other method are all available here.
 * Registered onto Component.prototype by lib/parts.js.
 */
AlamzaParts.register(class {
  extraVals() {
    const s = this.state, p = this.page();
    const m = s.modal || {}, mu = s.menu || {};
    const dark = s.prefs.theme === 'dark';
    const setTab = s.setTab || 'account';
    const versions = p ? (p.versions || []) : [];
    const lastV = versions.length ? versions[versions.length - 1] : null;
    const wantVer = m.kind === 'newVersion' || (s.route === 'settings' && setTab === 'versions');
    /* Pending changes across the whole subtree, not just the open page.
       The same null-vs-empty contract applies: a baseline snapshot that has
       not been fetched is UNKNOWN, not empty. Treating it as `[]` reported the
       page's entire content as newly added and let Save be offered — the user
       clicked it, createVersion fetched the real snapshot, found nothing
       changed, and refused. The dialog promised six changes and the click said
       "nothing has changed". An unloaded nested page is pending too, rather
       than being skipped, which was the same error in the other direction. */
    const lastSnap = lastV ? this.vsnap(lastV.id) : null;
    let pendUnknown = false;
    if (wantVer && lastV && !lastSnap) { pendUnknown = true; this.ensureVersion(lastV.id); }
    const pend = (wantVer && !pendUnknown)
      ? ADiff.stats(lastSnap ? lastSnap.b : [], p ? p.blocks : [])
      : { added: 0, removed: 0, changed: 0, none: true };
    let pendNested = 0;
    if (wantVer && p && !pendUnknown) {
      this.subtreeIds(p.id).forEach(id => {
        if (id === p.id) return;
        const pg = this.state.pages[id];
        if (!pg) return;
        if (!pg.blocks) {                       // body still loading
          if ((pg.blockCount || 0) > 0) { pendUnknown = true; this.ensureBody(id); }
          return;
        }
        const was = lastSnap && lastSnap.p[id] ? lastSnap.p[id].b : [];
        if (!ADiff.stats(was, pg.blocks).none) pendNested++;
      });
    }
    /* A child that was in the last snapshot and has left the subtree is a
       DELETION, and the automatic message names it. Same rule buildSnapshot
       uses, so the preview and the saved text agree: gone from the workspace
       or in the Trash, never merely unfetched. */
    let pendGone = 0;
    if (wantVer && p && lastSnap && !pendUnknown) {
      const live = {};
      this.snapshotIds(p.id).forEach(id => { live[id] = 1; });
      Object.keys(lastSnap.p).forEach(id => {
        if (live[id]) return;
        const pg = this.state.pages[id];
        if (pg && pg.blocks) return;
        if (pg && !pg.trashed) return;
        pendGone++;
      });
    }
    /* only a fully known comparison may conclude "nothing to snapshot" */
    const pendNone = wantVer && !!lastV && !pendUnknown && pend.added === 0
      && pend.removed === 0 && pend.changed === 0 && pendNested === 0 && pendGone === 0;

    /* ---- slash ---- */
    const sl = s.slash;
    const isMention = !!sl && sl.kind === 'mention';
    /* Clamp against the CURRENT result count. Typing narrows the list under a
       selection index that was valid for the old one, and an out-of-range index
       highlighted nothing while ⏎ still inserted the clamped last item — the
       menu disagreed with itself about what was selected. slashKey() clamps the
       same way, so both read the same row. */
    const slashRaw = !sl ? [] : (isMention ? this.mentionCatalog(sl.q) : this.slashCatalog(sl.q));
    const slashSel = Math.max(0, Math.min(slashRaw.length - 1, (sl && sl.i) || 0));
    const slashItems = !sl ? [] : (isMention
      ? slashRaw.map((pg, i) => ({
        idx: i,
        name: pg.title || 'Untitled', desc: ((pg.blocks || []).length || pg.blockCount || 0) + ' blocks · ' + relTime(pg.updatedAt), glyph: this.iconEl(pg, 16),
        bg: i === slashSel ? 'var(--hover)' : 'transparent',
        hover: () => this.setState(st => ({ slash: { ...st.slash, i } })),
        run: (e) => { e.preventDefault(); this.insertMention(sl.id, pg); }
      }))
      : slashRaw.map((c, i) => ({
        idx: i,
        name: c.name, desc: c.desc, glyph: c.glyph,
        bg: i === slashSel ? 'var(--hover)' : 'transparent',
        hover: () => this.setState(st => ({ slash: { ...st.slash, i } })),
        run: (e) => { e.preventDefault(); this.clearTrigger(sl.id); this.insertOfType(sl.id, c.type); }
      })));

    /* ---- menus ---- */
    const base = { isItem: false, isHeader: false, isRule: false, isProp: false, isOption: false, isSearch: false, isName: false, isAddOption: false, isChip: false, isCond: false, off: false };
    const item = (label, glyph, run, extra) => Object.assign({}, base, { isItem: true, label, glyph, run, color: 'var(--text)', hint: '' }, extra || {});
    const head = (label) => Object.assign({}, base, { isHeader: true, label });
    const rule = () => Object.assign({}, base, { isRule: true });
    let menuItems = [], menuW = '212px';
    if (mu.kind === 'block') {
      menuW = '232px';
      menuItems = [head('Turn into')].concat(
        CATALOG.filter(c => ['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'todo', 'toggle', 'toggle1', 'toggle2', 'toggle3', 'quote', 'callout', 'code', 'math'].indexOf(c.type) >= 0)
          .map(c => item(c.name, c.glyph, () => this.turnInto(mu.id, c.type)))
      ).concat([rule(), head('Colour')])
        .concat(COLORS.map(c => item(c.name, '●', () => this.setBlockColor(mu.id, 'color', c.id), { color: c.id ? COLOR_HEX[c.id] : 'var(--text)' })))
        .concat([head('Background')])
        .concat(COLORS.map(c => item(c.name, '▬', () => this.setBlockColor(mu.id, 'bg', c.id), { color: c.id ? COLOR_HEX[c.id] : 'var(--muted)' })))
        .concat([
          rule(),
          item('Duplicate', '⧉', () => this.duplicateBlock(mu.id), { hint: '⌘D' }),
          item('Comment', '💬', () => this.setState({ panel: 'comments', commentOn: mu.id, menu: null, sheet: null })),
          item('Copy link to block', '🔗', () => this.copyBlockLink(mu.id)),
          item('Copy as Markdown', '↧', () => { const f = this.locate(mu.id); if (f) navigator.clipboard.writeText(AMD.toMarkdown([f.block], { pages: s.pages, dbs: s.dbs })).then(() => this.toast('Block copied')); this.setState({ menu: null }); }),
          item('Move up', '↑', () => { const r2 = this.flat().map(x => x.id); const i2 = r2.indexOf(mu.id); if (i2 > 0) this.moveBlock(mu.id, r2[i2 - 1], false); this.setState({ menu: null }); }),
          item('Move down', '↓', () => { const r2 = this.flat().map(x => x.id); const i2 = r2.indexOf(mu.id); if (i2 < r2.length - 1) this.moveBlock(mu.id, r2[i2 + 1], true); this.setState({ menu: null }); }),
          item('Delete', '✕', () => {
            /* B13 — deleting a commented block must not silently bin the thread */
            const f2 = this.locate(mu.id);
            const n2 = f2 && f2.block.comments ? f2.block.comments.length : 0;
            if (n2 && !window.confirm('This block has ' + n2 + ' comment' + (n2 === 1 ? '' : 's') + '. Delete it anyway?')) {
              this.setState({ menu: null });
              return;
            }
            this.removeBlock(mu.id);
            this.setState({ menu: null });
            if (n2) this.toast('Block deleted with ' + n2 + ' comment' + (n2 === 1 ? '' : 's') + ' — ⌘Z to undo');
          }, { color: 'var(--del-fg)', hint: '⌘⇧⌫' })
        ]);
    } else if (mu.kind === 'page') {
      menuItems = [
        item('Copy page as Markdown', '↧', () => { this.copyMarkdown(); this.setState({ menu: null }); }),
        item(s.prefs.sourceView ? 'Hide markdown source' : 'Show markdown source', '</>', () => { this.toggleSource(); this.setState({ menu: null }); }),
        item(s.prefs.fullWidth ? 'Narrow width' : 'Full width', '⇔', () => { this.setState(st => ({ prefs: { ...st.prefs, fullWidth: !st.prefs.fullWidth }, menu: null }), () => this.persist()); }),
        item(s.focusMode ? 'Leave focus mode' : 'Focus mode', '◎', () => this.setState(st => ({ focusMode: !st.focusMode, menu: null, panel: null })), { hint: 'Esc' }),
        item('Word count', '∑', () => {
          const st2 = this.pageStats();
          this.toast(st2.words + ' words · ' + st2.blocks + ' blocks · about ' + st2.minutes + ' min read');
          this.setState({ menu: null });
        }),
        rule(),
        item(s.prefs.showChanges ? 'Hide changes since last version' : 'Show changes since last version', '◈',
          () => this.setState(st => ({ prefs: { ...st.prefs, showChanges: !st.prefs.showChanges }, menu: null }), () => this.persist())),
        item('Undo', '↺', () => { this.undo(); this.setState({ menu: null }); },
          { hint: '⌘Z', off: !this.canUndo(), color: this.canUndo() ? 'var(--text)' : 'var(--faint)' }),
        item('Redo', '↻', () => { this.redo(); this.setState({ menu: null }); },
          { hint: '⌘⇧Z', off: !this.canRedo(), color: this.canRedo() ? 'var(--text)' : 'var(--faint)' }),
        rule(),
        item('Version history', '⑂', () => this.setState({ panel: 'versions', menu: null, sheet: null }),
          { off: !!(p && p.shared), color: (p && p.shared) ? 'var(--faint)' : 'var(--text)' }),
        item('New version…', '＋', () => this.setState({ modal: { kind: 'newVersion', msg: '' }, menu: null, sheet: null }),
          { off: !this.canWriteHistory(p), color: this.canWriteHistory(p) ? 'var(--text)' : 'var(--faint)' }),
        item('Share', '🌐', () => this.setState({ modal: { kind: 'share' }, menu: null, sheet: null }),
          { off: !!(p && p.shared), color: (p && p.shared) ? 'var(--faint)' : 'var(--text)' }),
        rule(),
        /* Someone else's page is not this account's to throw away — leaving it
           takes it off this sidebar and nothing more. A row page IS a row, so
           say so, and nobody expects the table to keep it. */
        (p && p.shared)
          ? item('Remove from my sidebar', '✕',
              () => { this.setState({ menu: null }); this.leaveShared(s.pageId); }, { color: 'var(--del-fg)' })
          : item(p && p.dbRef ? 'Move row to trash' : 'Move to trash', '🗑',
              () => { this.setState({ menu: null }); this.trashPage(s.pageId); }, { color: 'var(--del-fg)' })
      ];
    } else if (mu.kind === 'navpage') {
      const pg = s.pages[mu.id];
      menuW = '218px';
      menuItems = pg ? [
        item('Open', '↗', () => { this.openPage(mu.id); this.setState({ menu: null }); }),
        item(pg.favorite ? 'Remove from favorites' : 'Add to favorites', pg.favorite ? '★' : '☆',
          () => { this.patchPage(mu.id, { favorite: !pg.favorite }, true); this.setState({ menu: null }); }),
        rule(),
        item('Rename', '✎', () => { this.openPage(mu.id); this.setState({ menu: null }); setTimeout(() => { if (this._titleEl) { this._titleEl.focus(); document.execCommand('selectAll'); } }, 220); }),
        item('Duplicate', '⧉', () => this.deepDuplicatePage(mu.id), { hint: 'deep' }),
        item('Move to…', '⇄', () => this.setState({ menu: { kind: 'moveto', id: mu.id, x: mu.x, y: mu.y } })),
        item('Add a page inside', '＋', () => { this.newPage(mu.id); this.setState({ menu: null }); }),
        rule(),
        item('Copy link', '🔗', () => { navigator.clipboard.writeText(this.pageUrl(mu.id)); this.toast('Link copied'); this.setState({ menu: null }); }),
        item('Copy as Markdown', '↧', () => {
          this.setState({ menu: null });
          /* this page may never have been opened, so fetch its body and any
             tables in it before serialising — otherwise the clipboard gets a
             heading and nothing else */
          this.ensureBody(mu.id).then(() => {
            const p2 = this.state.pages[mu.id];
            return p2 && p2.blocks ? this.ensureRowsFor(p2.blocks) : null;
          }).then(() => {
            const st = this.state, p2 = st.pages[mu.id];
            const md = '# ' + ((p2 && p2.title) || 'Untitled') + '\n\n' +
              AMD.toMarkdown((p2 && p2.blocks) || [], { pages: st.pages, dbs: st.dbs });
            navigator.clipboard.writeText(md);
            this.toast('Copied as Markdown');
          });
        }),
        rule(),
        item('Move to trash', '🗑', () => { this.trashPage(mu.id); this.setState({ menu: null }); }, { color: 'var(--del-fg)' })
      ] : [];
    } else if (mu.kind === 'navroot') {
      menuItems = [
        item('New page', '＋', () => { this.newPage(null); this.setState({ menu: null }); }),
        item('Search', '⌕', () => { this.openSearch(); }),
        rule(),
        item('Expand all', '⌄', () => { const e2 = {}; Object.keys(s.pages).forEach(k => { e2[k] = true; }); this.setState({ expanded: e2, menu: null }); }),
        item('Collapse all', '⌃', () => this.setState({ expanded: {}, menu: null })),
        rule(),
        item('Open trash', '🗑', () => this.setState({ main: 'trash', menu: null, panel: null })),
        item('Settings', '⚙', () => this.setState({ route: 'settings', menu: null }))
      ];
    } else if (mu.kind === 'moveto') {
      /* A4 — re-parent a page from a picker instead of only by dragging */
      menuW = '260px';
      const moving = mu.id;
      const banned = this.descendants(moving);
      const opts = [];
      const walkOpts = (pid, depth) => this.childrenOf(pid).forEach(pg => {
        if (banned.indexOf(pg.id) < 0) opts.push({ pg, depth });
        walkOpts(pg.id, depth + 1);
      });
      walkOpts(null, 0);
      menuItems = [head('Move to')]
        .concat([item('Top level', '◇', () => { this.movePage(moving, null, 'after'); this.setState({ menu: null }); })])
        .concat(opts.slice(0, 40).map(o => item(
          new Array(o.depth + 1).join('   ') + (o.pg.title || 'Untitled'),
          o.pg.icon || '▸',
          () => { this.movePage(moving, o.pg.id, 'inside'); this.setState({ menu: null }); }
        )));
    } else if (mu.kind === 'crumb') {
      const cp = s.pages[mu.id];
      menuItems = cp ? [
        item('Copy link', '🔗', () => { navigator.clipboard.writeText(this.pageUrl(mu.id)); this.toast('Link copied'); this.setState({ menu: null }); }),
        item('Duplicate', '⧉', () => this.deepDuplicatePage(mu.id)),
        item('Move to…', '⇄', () => this.setState({ menu: { kind: 'moveto', id: mu.id, x: mu.x, y: mu.y } })),
        rule(),
        item('Move to trash', '🗑', () => { this.trashPage(mu.id); this.setState({ menu: null }); }, { color: 'var(--del-fg)' })
      ] : [];
    } else if (mu.kind === 'dbrow') {
      const rdb2 = s.dbs[mu.dbId];
      const rr = rdb2 && rdb2.rows && rdb2.rows.find(x => x.id === mu.rowId);
      menuItems = rdb2 && rr ? [
        item('Open', '↗', () => { this.openRowPage(rdb2, rr); this.setState({ menu: null }); }),
        item('Duplicate row', '⧉', () => {
          this.patchDb(mu.dbId, d => {
            const src2 = d.rows.find(x => x.id === mu.rowId);
            const copy = JSON.parse(JSON.stringify(src2));
            copy.id = uid('r'); delete copy.pageId;
            d.rows.splice(d.rows.indexOf(src2) + 1, 0, copy);
          });
          this.setState({ menu: null });
        }),
        item('Copy as Markdown', '↧', () => {
          const line = rdb2.props.map(pr => { let v = rr.cells[pr.id]; if (Array.isArray(v)) v = v.join(', '); return pr.name + ': ' + (v == null ? '' : v); }).join('\n');
          navigator.clipboard.writeText(line); this.toast('Row copied'); this.setState({ menu: null });
        }),
        rule(),
        item('Delete row', '✕', () => {
          this.deleteRow(mu.dbId, mu.rowId);
          this.setState({ menu: null });
        }, { color: 'var(--del-fg)' })
      ] : [];
    } else if (mu.kind === 'version') {
      const vv = this.versionById(mu.id);
      /* reading a version is always on offer; the two that WRITE are not, for
         a viewer or on a page in the Trash */
      const mayWrite = this.canWriteHistory(p);
      menuItems = vv ? [
        item('Compare with current', '⇄', () => this.openDiff(mu.id, 'current')),
        item('Open read-only', '👁', () => this.restore(mu.id, 'ro'))
      ].concat(mayWrite ? [
        item('Restore…', '⟲', () => this.setState({ modal: { kind: 'restore', vid: mu.id }, menu: null }))
      ] : []).concat([
        rule(),
        item('Copy this version as Markdown', '↧', () => {
          /* `vv.blocks` is the deep snapshot object `{b,d,p}`, not a block
             array — handing it straight to toMarkdown threw. vblocks() takes
             the root blocks out of it, and a cold snapshot is fetched first. */
          this.setState({ menu: null });
          const write = () => {
            const bs = this.vblocks(vv.id);
            if (!bs) return this.toast('Could not load that snapshot');
            navigator.clipboard.writeText('# ' + (vv.title || 'Untitled') + '\n\n'
              + AMD.toMarkdown(bs, { pages: this.state.pages, dbs: this.state.dbs }));
            this.toast('Version copied as Markdown');
          };
          this.vsnap(vv.id) ? write() : this.ensureVersion(vv.id).then(write);
        })
      ]).concat(mayWrite ? [
        item('Delete this snapshot', '✕', () => {
          /* deleteVersion() drops the payload node too — the metadata alone
             left it stored and re-downloaded forever with nothing referencing
             it — and records the tombstone that stops the next delta from
             putting the row back */
          this.setState({
            menu: null,
            modal: {
              kind: 'confirm', act: 'deleteVersion', vid: vv.id, tone: 'danger',
              title: 'Delete v' + vv.n + '?',
              body: 'This snapshot and everything it captured — this page, its sub-pages and the tables they embed — are removed for good. It cannot be undone, and the other snapshots are untouched.',
              confirmLabel: 'Delete snapshot'
            }
          });
        }, { color: 'var(--del-fg)' })
      ] : []) : [];
    } else if (mu.kind === 'editor') {
      const hasSel = mu.hasSel;
      menuW = '224px';
      menuItems = [
        item('Select all', '⌗', () => {
          const el = this._els[mu.id];
          if (el) {
            el.focus();
            const r2 = document.createRange(); r2.selectNodeContents(el);
            const g2 = window.getSelection(); g2.removeAllRanges(); g2.addRange(r2);
          }
          this.setState({ menu: null });
        }, { hint: '⌘A' }),
        item('Select this block', '▣', () => this.setState({ blockSel: [mu.id], menu: null, focusId: null })),
        rule(),
        item('Cut', '✂', () => { document.execCommand('cut'); this.setState({ menu: null }); }, { hint: '⌘X', color: hasSel ? 'var(--text)' : 'var(--faint)' }),
        item('Copy', '⧉', () => { document.execCommand('copy'); this.setState({ menu: null }); }, { hint: '⌘C', color: hasSel ? 'var(--text)' : 'var(--faint)' }),
        item('Paste', '📋', () => {
          this.setState({ menu: null });
          navigator.clipboard.readText().then(t => {
            if (!t) return;
            if (/\n/.test(t) && mu.id) {
              const parsed = AMD.fromMarkdown(t);
              this.mutate(bs => { const f = this.locate(mu.id, bs); if (f) f.list.splice(f.i + 1, 0, ...parsed); });
            } else document.execCommand('insertText', false, t);
          }).catch(() => this.toast('Clipboard access was blocked'));
        }, { hint: '⌘V' }),
        item('Paste as plain text', '¶', () => {
          this.setState({ menu: null });
          navigator.clipboard.readText().then(t => t && document.execCommand('insertText', false, AMD.stripMarks(t)))
            .catch(() => this.toast('Clipboard access was blocked'));
        })
      ];
      if (hasSel) menuItems = menuItems.concat([
        rule(), head('Format'),
        item('Bold', 'B', () => { this.wrapSel(mu.id, '**'); this.setState({ menu: null }); }, { hint: '⌘B' }),
        item('Italic', 'i', () => { this.wrapSel(mu.id, '*'); this.setState({ menu: null }); }, { hint: '⌘I' }),
        item('Code', '</>', () => { this.wrapSel(mu.id, '`'); this.setState({ menu: null }); }, { hint: '⌘E' }),
        item('Highlight', '◼', () => { this.wrapSel(mu.id, '=='); this.setState({ menu: null }); }, { hint: '⌘H' })
      ]);
      if (mu.id) menuItems = menuItems.concat([
        rule(),
        item('Block options…', '⠿', () => this.setState({ menu: { kind: 'block', id: mu.id, x: mu.x, y: mu.y, y0: mu.y, anchor: mu.id, anchorTop: mu.anchorTop } })),
        item('Copy as Markdown', '↧', () => {
          const f2 = this.locate(mu.id);
          if (f2) navigator.clipboard.writeText(AMD.toMarkdown([f2.block], { pages: s.pages, dbs: s.dbs })).then(() => this.toast('Block copied as Markdown'));
          this.setState({ menu: null });
        }),
        item('Duplicate block', '⧉', () => this.duplicateBlock(mu.id), { hint: '⌘D' }),
        item('Delete block', '✕', () => { this.removeBlock(mu.id); this.setState({ menu: null }); }, { color: 'var(--del-fg)' })
      ]);
    } else if (mu.kind === 'ws') {
      menuItems = [
        item('Settings', '⚙', () => this.setState({ route: 'settings', menu: null })),
        item(dark ? 'Light theme' : 'Dark theme', dark ? '☼' : '☾', () => { this.toggleTheme(); this.setState({ menu: null }); }),
        item('Rename workspace', '✎', () => this.setState({ route: 'settings', setTab: 'account', menu: null })),
        rule(),
        item('Sign out', '⏻', () => { this.forgetVersions(); AStore.signOut(); this.setState({ user: null, route: 'auth', menu: null }); })
      ];
    } else if (mu.kind === 'dbprops' || mu.kind === 'pageprops') {
      /* Notion's "Properties" panel: one row per property with an eye toggle,
         reorder arrows and a click-through to that property's editor. */
      const onPage = mu.kind === 'pageprops';
      const db2 = s.dbs[mu.dbId];
      if (db2) {
        const view2 = (db2.views || []).find(v => v.id === mu.viewId);
        const hiddenList = onPage ? (db2.pageHidden || []) : ((view2 && view2.hidden) || []);
        menuW = '272px';
        menuItems = [head(onPage ? 'Shown on this page' : 'Shown in this view')];
        db2.props.forEach((pr, i) => {
          const off = hiddenList.indexOf(pr.id) >= 0;
          const isTitle = i === 0 && !onPage;
          const t2 = PROP_TYPES.find(x => x.id === pr.type) || PROP_TYPES[0];
          menuItems.push({ isItem:false,isHeader:false,isRule:false,isProp:false,isOption:false,isSearch:false,isName:false,isAddOption:false,isChip:false,isCond:false, isProp: true,
            label: pr.name, glyph: t2.glyph, off,
            color: off ? 'var(--faint)' : 'var(--text)',
            eye: off ? '🚫' : '👁', eyeOp: isTitle ? .3 : 1,
            canToggle: !isTitle,
            hint: isTitle ? 'Title' : t2.name,
            toggle: (e) => { e.stopPropagation(); if (!isTitle) this.toggleProp(db2.id, pr.id, onPage ? 'page' : 'view', mu.viewId); },
            up: (e) => { e.stopPropagation(); this.moveProp(db2.id, pr.id, -1); },
            down: (e) => { e.stopPropagation(); this.moveProp(db2.id, pr.id, 1); },
            run: () => this.setState({ menu: { kind: 'propedit', dbId: db2.id, propId: pr.id, viewId: mu.viewId, x: mu.x, y: mu.y } })
          });
        });
        menuItems.push(rule());
        menuItems.push(item('Hide all', '🚫', () => {
          this.patchDb(db2.id, d => {
            const ids = d.props.slice(onPage ? 0 : 1).map(x => x.id);
            if (onPage) d.pageHidden = ids;
            else { const v2 = d.views.find(x => x.id === mu.viewId); if (v2) v2.hidden = ids; }
          });
        }, { color: 'var(--muted)' }));
        menuItems.push(item('Show all', '👁', () => {
          this.patchDb(db2.id, d => {
            if (onPage) d.pageHidden = [];
            else { const v2 = d.views.find(x => x.id === mu.viewId); if (v2) v2.hidden = []; }
          });
        }, { color: 'var(--muted)' }));
        menuItems.push(rule());
        menuItems.push(item('New property', '＋', () => this.setState({ menu: { kind: 'newprop', dbId: db2.id, viewId: mu.viewId, x: mu.x, y: mu.y } }), { color: 'var(--accent)' }));
      }
    } else if (mu.kind === 'newprop') {
      /* type picker, grouped like Notion's */
      menuW = '250px';
      const db3 = s.dbs[mu.dbId];
      const q3 = (mu.q || '').toLowerCase();
      menuItems = [{ isItem:false,isHeader:false,isRule:false,isProp:false,isOption:false,isSearch:false,isName:false,isAddOption:false,isChip:false,isCond:false, isSearch: true,
        value: mu.q || '', placeholder: 'Search for a property type',
        set: (e) => this.setState(st => ({ menu: Object.assign({}, st.menu, { q: e.target.value }) }))
      }];
      let lastGroup = null;
      PROP_TYPES.filter(t => !q3 || t.name.toLowerCase().includes(q3)).forEach(t => {
        if (t.group !== lastGroup) { menuItems.push(head(t.group)); lastGroup = t.group; }
        menuItems.push(item(t.name, t.glyph, () => {
          const pid = this.addProp(mu.dbId, t.id);
          this.setState({ menu: { kind: 'propedit', dbId: mu.dbId, propId: pid, viewId: mu.viewId, x: mu.x, y: mu.y, fresh: true } });
        }));
      });
      if (!db3) menuItems = [];
    } else if (mu.kind === 'propedit') {
      /* one property: rename, retype, options with colours, visibility */
      const db4 = s.dbs[mu.dbId];
      const pr4 = db4 && db4.props.find(x => x.id === mu.propId);
      menuW = '268px';
      if (pr4) {
        this.normProp(pr4);
        const t4 = PROP_TYPES.find(x => x.id === pr4.type) || PROP_TYPES[0];
        const isTitle = db4.props[0].id === pr4.id;
        menuItems = [{ isItem:false,isHeader:false,isRule:false,isProp:false,isOption:false,isSearch:false,isName:false,isAddOption:false,isChip:false,isCond:false, isName: true,
          value: pr4.name, placeholder: 'Property name',
          set: (e) => this.renameProp(mu.dbId, mu.propId, e.target.value)
        }];
        if (!isTitle) menuItems.push(item('Type', t4.glyph, () => this.setState({ menu: Object.assign({}, mu, { kind: 'proptype' }) }), { hint: t4.name + '  ›' }));
        if (OPTION_TYPES[pr4.type]) {
          menuItems.push(rule(), head('Options'));
          (pr4.options || []).forEach((o, oi) => {
            const c = this.optStyle(pr4, o.name);
            menuItems.push({ isItem:false,isHeader:false,isRule:false,isProp:false,isOption:false,isSearch:false,isName:false,isAddOption:false,isChip:false,isCond:false, isOption: true,
              label: o.name, bg: c.bg, fg: c.fg,
              swatch: (PROP_COLOR_MAP[o.color] || PROP_COLOR_MAP.default).sw,
              rename: (e) => this.renameOption(mu.dbId, mu.propId, o.id, e.target.value),
              recolor: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); this.setState({ menu: Object.assign({}, mu, { kind: 'optcolor', optId: o.id, x: r.left - 30, y: r.bottom + 4 }) }); },
              up: (e) => { e.stopPropagation(); this.moveOption(mu.dbId, mu.propId, o.id, -1); },
              down: (e) => { e.stopPropagation(); this.moveOption(mu.dbId, mu.propId, o.id, 1); },
              del: (e) => { e.stopPropagation(); this.deleteOption(mu.dbId, mu.propId, o.id); }
            });
          });
          menuItems.push({ isItem:false,isHeader:false,isRule:false,isProp:false,isOption:false,isSearch:false,isName:false,isAddOption:false,isChip:false,isCond:false, isAddOption: true,
            value: mu.newOpt || '', placeholder: 'Type a name, press Enter',
            set: (e) => this.setState(st => ({ menu: Object.assign({}, st.menu, { newOpt: e.target.value }) })),
            key: (e) => {
              if (e.key !== 'Enter') return;
              const n = (this.state.menu.newOpt || '').trim();
              if (!n) return;
              this.addOption(mu.dbId, mu.propId, n);
              this.setState(st => ({ menu: Object.assign({}, st.menu, { newOpt: '' }) }));
            }
          });
        }
        /* The column header opens this menu, so this is where "sort by this
           column" belongs — it used to be reachable only from the toolbar's
           Sort button, several clicks away from the column it acts on. The
           other sort keys are left in place. */
        if (mu.viewId) {
          const vw4 = (db4.views || []).find(x => x.id === mu.viewId);
          const cur4 = vw4 && (vw4.sorts || []).find(x => x.prop === mu.propId);
          const lbl4 = this.isDateType(pr4.type) ? ['Oldest → newest', 'Newest → oldest']
            : pr4.type === 'number' ? ['1 → 9', '9 → 1'] : ['A → Z', 'Z → A'];
          menuItems.push(rule(), head('Sort'));
          [['asc', lbl4[0], '↑'], ['desc', lbl4[1], '↓']].forEach(([dir4, label4, gl4]) => {
            const on4 = !!cur4 && cur4.dir === dir4;
            menuItems.push(item(label4, gl4, () => {
              this.sortByProp(mu.dbId, mu.viewId, mu.propId, on4 ? null : dir4);
              this.setState({ menu: null });
            }, { color: on4 ? 'var(--accent)' : 'var(--text)', hint: on4 ? '✓' : '' }));
          });
        }
        menuItems.push(rule());
        if (!isTitle) {
          menuItems.push(item('Hide in this view', '🚫', () => { if (mu.viewId) this.toggleViewProp(mu.dbId, mu.viewId, mu.propId); this.setState({ menu: null }); }));
          menuItems.push(item('Hide on the page', '👁', () => { this.toggleProp(mu.dbId, mu.propId, 'page'); this.setState({ menu: null }); }));
          menuItems.push(item('Duplicate property', '⧉', () => { this.duplicateProp(mu.dbId, mu.propId); this.setState({ menu: null }); }));
          menuItems.push(item('Delete property', '✕', () => { this.deleteProp(mu.dbId, mu.propId); this.setState({ menu: null }); }, { color: 'var(--del-fg)' }));
        } else {
          menuItems.push(item('The title property cannot be removed', '🔒', () => {}, { color: 'var(--faint)' }));
        }
      }
    } else if (mu.kind === 'proptype') {
      menuW = '236px';
      const db5 = s.dbs[mu.dbId];
      const pr5 = db5 && db5.props.find(x => x.id === mu.propId);
      let lg = null;
      menuItems = [item('‹ Back', '', () => this.setState({ menu: Object.assign({}, mu, { kind: 'propedit' }) }), { color: 'var(--muted)' })];
      PROP_TYPES.forEach(t => {
        if (t.group !== lg) { menuItems.push(head(t.group)); lg = t.group; }
        menuItems.push(item(t.name, t.glyph, () => {
          this.retypeProp(mu.dbId, mu.propId, t.id);
          this.setState({ menu: Object.assign({}, mu, { kind: 'propedit' }) });
        }, { color: pr5 && pr5.type === t.id ? 'var(--accent)' : 'var(--text)', hint: pr5 && pr5.type === t.id ? '✓' : '' }));
      });
    } else if (mu.kind === 'optcolor') {
      menuW = '190px';
      menuItems = [head('Colour')].concat(PROP_COLORS.map(c => item(c.name, '●', () => {
        this.recolorOption(mu.dbId, mu.propId, mu.optId, c.id);
        this.setState({ menu: Object.assign({}, mu, { kind: 'propedit' }) });
      }, { color: PROP_COLOR_MAP[c.id].sw })));
    } else if (mu.kind === 'dbedit') {
      const dbe = s.dbs[mu.dbId];
      menuW = '256px';
      if (dbe) {
        menuItems = [{
          isItem: false, isHeader: false, isRule: false, isProp: false, isOption: false,
          isSearch: false, isName: true, isAddOption: false, isChip: false, isCond: false,
          value: dbe.name || '', placeholder: 'Database name',
          set: (e) => this.patchDb(mu.dbId, d => { d.name = e.target.value; })
        }];
        menuItems.push(item('Change icon', dbe.icon || '🗃️', () => this.setState({ modal: { kind: 'emoji', target: 'db', dbId: mu.dbId } })));
        menuItems.push(rule(), head('Default view'));
        (dbe.views || []).forEach(v => menuItems.push(item(v.name, VIEW_GLYPH[v.type] || '☰', () => {
          this.patchDb(mu.dbId, d => { d.defaultView = v.id; });
          this.toast('“' + v.name + '” is now the default view');
        }, { color: dbe.defaultView === v.id ? 'var(--accent)' : 'var(--text)', hint: dbe.defaultView === v.id ? '✓' : '' })));
        menuItems.push(rule(), head('New pages'));
        menuItems.push(item('Start with properties collapsed', dbe.collapseProps === false ? '○' : '●', () => {
          this.patchDb(mu.dbId, d => { d.collapseProps = d.collapseProps === false; });
        }, { color: dbe.collapseProps === false ? 'var(--faint)' : 'var(--accent)' }));
        menuItems.push(rule());
        menuItems.push(item('Properties…', '≡', () => this.setState({ menu: { kind: 'dbprops', dbId: mu.dbId, viewId: mu.viewId, x: mu.x, y: mu.y } })));
        menuItems.push(item('Duplicate database', '⧉', () => {
          /* a copy made before the rows arrive would be an empty table */
          if (!dbe.rows) {
            this.setState({ menu: null });
            this.ensureRows(mu.dbId).then(ok =>
              this.toast(ok ? 'Table ready — try duplicating again' : 'Could not load that table'));
            return;
          }
          const nid = uid('db');
          const copy = JSON.parse(JSON.stringify(dbe));
          copy.id = nid; copy.name = (dbe.name || 'Database') + ' copy';
          copy.rows.forEach(r => { r.id = uid('r'); delete r.pageId; });
          this.setState(st => ({ dbs: { ...st.dbs, [nid]: copy }, menu: null }), () => {
            this.mutate(bs => {
              const f = (function find(list) {
                for (const b of list) {
                  if (b.type === 'database' && b.dbId === mu.dbId) return b;
                  if (b.children) { const r = find(b.children); if (r) return r; }
                  if (b.cols) { for (const c of b.cols) { const r = find(c); if (r) return r; } }
                }
                return null;
              })(bs);
              if (f) bs.splice(bs.indexOf(f) + 1, 0, { id: uid('b'), type: 'database', text: '', indent: 0, dbId: nid });
              else bs.push({ id: uid('b'), type: 'database', text: '', indent: 0, dbId: nid });
            });
            this.toast('Database duplicated');
          });
        }));
        menuItems.push(item('Delete database', '✕', () => {
          const rn = dbe.rows ? dbe.rows.length : (dbe.rowCount || 0);
          const pn = (dbe.rows || []).filter(r => r.pageId && s.pages[r.pageId]).length;
          this.setState({
            menu: null,
            modal: {
              kind: 'confirm', tone: 'danger',
              title: 'Delete “' + (dbe.name || 'Database') + '”?',
              body: 'The table and its ' + rn + ' row' + (rn === 1 ? '' : 's') + ' are removed from this page'
                + (pn ? ', and ' + pn + ' row page' + (pn === 1 ? '' : 's') + ' move to the trash where you can still read '
                     + (pn === 1 ? 'it' : 'them') : '')
                + '. ⌘Z undoes this while the page is open.',
              confirmLabel: 'Delete database', dbId: mu.dbId, act: 'deleteDatabase'
            }
          });
        }, { color: 'var(--del-fg)' }));
      }
    } else if (mu.kind === 'viewedit') {
      const dbv = s.dbs[mu.dbId];
      const vw = dbv && dbv.views.find(x => x.id === mu.viewId);
      menuW = '250px';
      if (vw) {
        menuItems = [{
          isItem: false, isHeader: false, isRule: false, isProp: false, isOption: false,
          isSearch: false, isName: true, isAddOption: false, isChip: false, isCond: false,
          value: vw.name || '', placeholder: 'View name',
          set: (e) => this.patchDb(mu.dbId, d => { const q = d.views.find(x => x.id === mu.viewId); if (q) q.name = e.target.value; })
        }];
        menuItems.push(head('Layout'));
        [['list', 'List'], ['table', 'Table'], ['board', 'Board'], ['card', 'Gallery']].forEach(([t, n]) => {
          menuItems.push(item(n, VIEW_GLYPH[t], () => this.patchDb(mu.dbId, d => {
            const q = d.views.find(x => x.id === mu.viewId); if (!q) return;
            q.type = t;
            if (t === 'board' && !q.groupBy) { const gp = d.props.find(pp => OPTION_TYPES[pp.type]); if (gp) q.groupBy = gp.id; }
          }), { color: vw.type === t ? 'var(--accent)' : 'var(--text)', hint: vw.type === t ? '✓' : '' }));
        });
        if (vw.type === 'board') {
          menuItems.push(rule(), head('Group by'));
          dbv.props.filter(pp => OPTION_TYPES[pp.type]).forEach(pp => menuItems.push(item(pp.name, '◑', () => this.patchDb(mu.dbId, d => {
            const q = d.views.find(x => x.id === mu.viewId); if (q) q.groupBy = pp.id;
          }), { color: vw.groupBy === pp.id ? 'var(--accent)' : 'var(--text)', hint: vw.groupBy === pp.id ? '✓' : '' })));
        }
        menuItems.push(rule());
        menuItems.push(item('Set as default view', '★', () => {
          this.patchDb(mu.dbId, d => { d.defaultView = mu.viewId; });
          this.setState({ menu: null });
          this.toast('Default view set');
        }, { color: dbv.defaultView === mu.viewId ? 'var(--accent)' : 'var(--text)', hint: dbv.defaultView === mu.viewId ? '✓' : '' }));
        menuItems.push(item('Properties…', '≡', () => this.setState({ menu: { kind: 'dbprops', dbId: mu.dbId, viewId: mu.viewId, x: mu.x, y: mu.y } })));
        menuItems.push(item('Duplicate view', '⧉', () => {
          const nv = JSON.parse(JSON.stringify(vw));
          nv.id = uid('v'); nv.name = vw.name + ' copy';
          this.patchDb(mu.dbId, d => { d.views.splice(d.views.findIndex(x => x.id === mu.viewId) + 1, 0, nv); });
          this.setState({ menu: null });
        }));
        if ((dbv.views || []).length > 1) {
          menuItems.push(item('Delete view', '✕', () => {
            this.patchDb(mu.dbId, d => {
              d.views = d.views.filter(x => x.id !== mu.viewId);
              if (d.defaultView === mu.viewId) d.defaultView = d.views[0] && d.views[0].id;
            });
            this.setState(st => { const dv = { ...st.dbView }; delete dv[mu.dbId]; return { dbView: dv, menu: null }; });
          }, { color: 'var(--del-fg)' }));
        }
      }
    } else if (mu.kind === 'newview') {
      menuW = '220px';
      menuItems = [head('New view')].concat(
        [['list', 'List'], ['table', 'Table'], ['board', 'Board'], ['card', 'Gallery']].map(([t, n]) =>
          item(n, VIEW_GLYPH[t], () => {
            const nvid = uid('v');
            this.patchDb(mu.dbId, d => {
              const v2 = { id: nvid, name: n, type: t, filters: [], sorts: [], hidden: [] };
              if (t === 'board') { const gp = d.props.find(pp => OPTION_TYPES[pp.type]); if (gp) v2.groupBy = gp.id; }
              d.views.push(v2);
            });
            this.setState(st => ({ dbView: { ...st.dbView, [mu.dbId]: nvid }, menu: null }));
          })));
    } else if (mu.kind === 'cellopt') {
      /* the picker a table cell opens over itself — the same option list the
         row page shows, without the trip to the row page */
      const cdb = s.dbs[mu.dbId];
      const cpr = cdb && (cdb.props || []).find(x => x.id === mu.propId);
      const crow = cdb && (cdb.rows || []).find(x => x.id === mu.rowId);
      menuW = '230px';
      if (cpr && crow) {
        this.normProp(cpr);
        const cv = crow.cells[cpr.id];
        const multi = !!MULTI_TYPES[cpr.type];
        menuItems = [head(cpr.name)];
        (cpr.options || []).forEach(o => {
          const on = multi ? (Array.isArray(cv) && cv.indexOf(o.name) >= 0) : cv === o.name;
          const c = this.optStyle(cpr, o.name);
          menuItems.push({
            isItem: false, isHeader: false, isRule: false, isProp: false, isOption: false,
            isSearch: false, isName: false, isAddOption: false, isCond: false, isChip: true,
            label: o.name, bg: c.bg, fg: c.fg, on, mark: on ? '✓' : '',
            run: () => {
              this.setCell(mu.dbId, mu.rowId, mu.propId, this.toggleOption(cpr, crow.cells[cpr.id], o.name));
              /* a multi-select stays open so several can be picked at once */
              if (!multi) this.setState({ menu: null });
            }
          });
        });
        if (!(cpr.options || []).length) menuItems.push(item('No options yet', '', () => {}, { color: 'var(--faint)' }));
        menuItems.push({
          isItem: false, isHeader: false, isRule: false, isProp: false, isOption: false,
          isSearch: false, isName: false, isCond: false, isChip: false, isAddOption: true,
          value: mu.newOpt || '', placeholder: 'Type a name, press Enter',
          set: (e) => this.setState(st => ({ menu: Object.assign({}, st.menu, { newOpt: e.target.value }) })),
          key: (e) => {
            if (e.key !== 'Enter') return;
            const n = ((this.state.menu || {}).newOpt || '').trim();
            if (!n) return;
            this.addOption(mu.dbId, mu.propId, n);
            this.setCell(mu.dbId, mu.rowId, mu.propId, this.toggleOption(cpr, crow.cells[cpr.id], n));
            this.setState(st => ({ menu: Object.assign({}, st.menu, { newOpt: '' }) }));
          }
        });
        menuItems.push(rule(), item('Clear', '⟲', () => {
          this.setCell(mu.dbId, mu.rowId, mu.propId, multi ? [] : '');
          this.setState({ menu: null });
        }, { color: 'var(--muted)' }));
      }
    } else if (mu.kind === 'dbfilter' || mu.kind === 'dbsort') {
      const db = s.dbs[mu.dbId];
      const view = db && db.views.find(v => v.id === mu.viewId);
      if (db && view) {
        if (mu.kind === 'dbfilter') {
          /* Options are {id,name,color} now — the old code printed the object. */
          menuW = '272px';
          const nf = (view.filters || []).length;
          const setFilters = (fn) => this.patchDb(db.id, d => {
            const v = d.views.find(x => x.id === view.id);
            if (v) v.filters = fn(v.filters || []);
          });
          const toggle = (f) => {
            const same = (a, b) => a.prop === b.prop && (a.op || 'is') === (b.op || 'is') && a.value === b.value;
            setFilters(list => list.some(x => same(x, f))
              ? list.filter(x => !same(x, f))
              : list.concat([f]));
          };
          const isOn = (f) => (view.filters || []).some(x =>
            x.prop === f.prop && (x.op || 'is') === (f.op || 'is') && x.value === f.value);

          menuItems = [head(nf ? nf + ' filter' + (nf === 1 ? '' : 's') + ' active' : 'Filter')];
          db.props.forEach(pr => {
            this.normProp(pr);
            if (OPTION_TYPES[pr.type]) {
              if (!(pr.options || []).length) return;
              menuItems.push(head(pr.name));
              /* Ticking two of these used to ask for a row that was both at
                 once — they are OR'd within the property now, so a pair of
                 chips reads the way the pair of chips looks. */
              pr.options.forEach(o => {
                const f = { prop: pr.id, op: 'is', value: o.name };
                const on = isOn(f);
                const c = this.optStyle(pr, o.name);
                menuItems.push({
                  isItem: false, isHeader: false, isRule: false, isProp: false, isOption: false,
                  isSearch: false, isName: false, isAddOption: false, isCond: false, isChip: true,
                  label: o.name, bg: c.bg, fg: c.fg, on,
                  mark: on ? '✓' : '',
                  run: () => toggle(f)
                });
              });
              const fe = { prop: pr.id, op: 'empty', value: '' };
              menuItems.push(item('Empty', isOn(fe) ? '✓' : '', () => toggle(fe),
                { color: isOn(fe) ? 'var(--accent)' : 'var(--muted)' }));
            } else if (pr.type === 'checkbox') {
              menuItems.push(head(pr.name));
              [{ v: true, l: 'Checked' }, { v: false, l: 'Unchecked' }].forEach(x => {
                const f = { prop: pr.id, op: 'is', value: x.v };
                const on = isOn(f);
                menuItems.push(item(x.l, on ? '✓' : '', () => {
                  /* checked and unchecked are the whole universe: picking one
                     replaces the other rather than OR-ing to "everything" */
                  const other = { prop: pr.id, op: 'is', value: !x.v };
                  setFilters(list => {
                    const rest = list.filter(q => !(q.prop === pr.id && (q.op || 'is') === 'is'));
                    return on ? rest : rest.concat([f]);
                  });
                  void other;
                }, { color: on ? 'var(--accent)' : 'var(--text)' }));
              });
            } else {
              /* Text, number, date and the automatic types could not be
                 filtered at all — the menu simply skipped them, and on a table
                 of nothing else it said "No filterable properties yet". */
              menuItems.push(head(pr.name));
              const q = (mu.q || {})[pr.id] || '';
              const ops = this.filterOps(pr.type);
              const cur = (view.filters || []).find(f => f.prop === pr.id) || null;
              const curOp = (cur && cur.op) || ops[0].id;
              menuItems.push({
                isItem: false, isHeader: false, isRule: false, isProp: false, isOption: false,
                isSearch: false, isName: false, isAddOption: false, isChip: false, isCond: true,
                ops: ops.map(o => ({ id: o.id, label: o.label, on: o.id === curOp })),
                opValue: curOp,
                setOp: (e) => {
                  const op = e.target.value;
                  setFilters(list => {
                    const rest = list.filter(f => f.prop !== pr.id);
                    if (op === 'empty' || op === 'notEmpty') return rest.concat([{ prop: pr.id, op, value: '' }]);
                    const val = cur ? cur.value : '';
                    return val === '' ? rest : rest.concat([{ prop: pr.id, op, value: val }]);
                  });
                },
                needsValue: curOp !== 'empty' && curOp !== 'notEmpty',
                inputType: pr.type === 'number' ? 'number' : this.isDateType(pr.type) ? 'date' : 'text',
                value: cur && cur.value != null ? String(cur.value) : q,
                placeholder: 'Value',
                set: (e) => {
                  const val = e.target.value;
                  setFilters(list => {
                    const rest = list.filter(f => f.prop !== pr.id);
                    return val === '' ? rest : rest.concat([{ prop: pr.id, op: curOp, value: val }]);
                  });
                },
                clear: () => setFilters(list => list.filter(f => f.prop !== pr.id)),
                hasFilter: !!cur
              });
            }
          });
          if (menuItems.length === 1) menuItems.push(item('This table has no properties to filter', '', () => {}, { color: 'var(--faint)' }));
          menuItems.push(rule(), item('Clear filters', '⟲', () => { setFilters(() => []); this.setState({ menu: null }); }, { color: 'var(--muted)' }));
        } else {
          menuW = '268px';
          const sorts = view.sorts || [];
          menuItems = [head(sorts.length > 1 ? sorts.length + ' sort keys' : 'Sort')];
          menuItems.push(item('Manual (drag rows)', sorts.length ? '' : '✓', () => {
            this.patchDb(db.id, d => { const v = d.views.find(x => x.id === view.id); if (v) v.sorts = []; });
          }, { color: sorts.length ? 'var(--text)' : 'var(--accent)' }));
          menuItems.push(rule(), head('By property'));
          /* `sorts` was always an array and dbRowVals looped over it, but the
             menu only ever wrote a single-element one — so a second key was
             unreachable, and had it been reachable the old loop would have run
             them in reverse precedence. One comparator handles them in order
             now, so clicking a second property genuinely adds a tie-breaker. */
          db.props.forEach(pr => {
            const at = sorts.findIndex(x => x.prop === pr.id);
            const cur = at >= 0 ? sorts[at] : null;
            const t6 = PROP_TYPES.find(x => x.id === pr.type) || PROP_TYPES[0];
            const dirLabel = this.isDateType(pr.type) ? ['Oldest → newest  ↑', 'Newest → oldest  ↓']
              : pr.type === 'number' ? ['1 → 9  ↑', '9 → 1  ↓']
              : ['A → Z  ↑', 'Z → A  ↓'];
            const rank = sorts.length > 1 && at >= 0 ? String(at + 1) + '. ' : '';
            menuItems.push(item(rank + pr.name, t6.glyph, () => this.patchDb(db.id, d => {
              const v = d.views.find(x => x.id === view.id); if (!v) return;
              const list = (v.sorts || []).slice();
              const i = list.findIndex(x => x.prop === pr.id);
              /* asc → desc → off, keeping the other keys and their order */
              if (i < 0) list.push({ prop: pr.id, dir: 'asc' });
              else if (list[i].dir === 'asc') list[i] = { prop: pr.id, dir: 'desc' };
              else list.splice(i, 1);
              v.sorts = list;
            }), {
              color: cur ? 'var(--accent)' : 'var(--text)',
              hint: cur ? (cur.dir === 'asc' ? dirLabel[0] : dirLabel[1]) : ''
            }));
          });
          if (sorts.length) menuItems.push(rule(), item('Sorted views cannot be dragged', '🔒', () => {}, { color: 'var(--faint)' }));
        }
      }
    }

    /* ---- search ---- */
    const q = (s.search || '').toLowerCase().trim();
    const wantSearch = m.kind === 'search' || s.sheet === 'search';
    /* Search runs over the INDEX, not the corpus. Every entry carries a short
       keyword digest, so a note whose body was never downloaded is still
       findable; a note already in memory is matched in full. */
    if (wantSearch && q) this.digestMap();
    const results = !wantSearch ? [] : Object.values(s.pages).filter(x => !x.trashed).filter(x => {
      if (!q) return true;
      if ((x.title || '').toLowerCase().includes(q)) return true;
      if (x.blocks) return x.blocks.some(b => (b.text || '').toLowerCase().includes(q));
      if ((x.snippet || '').toLowerCase().includes(q)) return true;
      return this.digestFor(x.id).includes(q);
    }).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 12).map(x => {
      const hit = x.blocks
        ? (q ? x.blocks.find(b => (b.text || '').toLowerCase().includes(q)) : x.blocks[0])
        : { text: x.snippet || '' };
      return {
        iconEl: this.iconEl(x, 17), title: x.title || 'Untitled', when: relTime(x.updatedAt),
        snippet: AMD.stripMarks(hit ? hit.text : '').slice(0, 90) || 'Empty page',
        open: () => { this.openPage(x.id); this.setState({ modal: null, sheet: null }); }
      };
    });

    /* ---- restore ----
       the payload is what knows the reach, so a cold one is fetched here and
       the dialog says "working it out" until it lands rather than promising
       something smaller than the truth */
    const rScope = m.kind === 'restore' && m.vid ? this.restoreScope(m.vid) : undefined;
    if (m.kind === 'restore' && m.vid && rScope === null) this.ensureVersion(m.vid);
    const rNested = rScope ? rScope.nested.length : 0;
    const rDbs = rScope ? rScope.dbs.length : 0;
    const rBits = [];
    if (rNested) rBits.push(rNested + (rNested === 1 ? ' sub-page' : ' sub-pages'));
    if (rDbs) rBits.push(rDbs + (rDbs === 1 ? ' table' : ' tables'));
    const rReachTail = rBits.length ? ', along with ' + rBits.join(' and ') : '';
    const rReach = !rScope ? '' : rBits.length
      ? 'This snapshot covers this page plus ' + rBits.join(' and ') + '.'
      : 'This snapshot covers this page only.';

    /* ---- diff ---- */
    const dA = s.diffA || (versions.length ? versions[versions.length - 1].id : 'current');
    const dB = s.diffB || 'current';
    /* the diff is scoped to ONE page of the snapshot at a time; the rail lists
       the whole subtree so nested changes are reachable */
    const dScope = m.kind === 'diff' ? this.diffScope(dA, dB) : [];
    const dPage = (s.diffPage && dScope.some(x => x.id === s.diffPage))
      ? s.diffPage : (dScope.find(x => x.touched) || dScope[0] || {}).id;
    const dEntry = dScope.find(x => x.id === dPage) || {};
    /* never run the diff against a body that has not arrived */
    const rowsD = (m.kind === 'diff' && !dEntry.pending)
      ? ADiff.blocks(this.blocksOf(dA, dPage), this.blocksOf(dB, dPage)) : [];
    /* The header used to print the SELECTED page's counts, which reads as the
       total for the comparison and changes the moment you click a different
       page in the rail. The total is the total; the selected page gets a line
       of its own. */
    const dTotal = dScope.reduce((t, x) => ({
      add: t.add + (x.added || 0), del: t.del + (x.removed || 0), chg: t.chg + (x.changed || 0)
    }), { add: 0, del: 0, chg: 0 });
    const dStats = { add: 0, del: 0, chg: 0 };
    const diffRows = rowsD.map((r, i) => {
      const st = this.diffStyle(r.now || r.old);
      const base = { key: i, size: st.size, weight: st.weight, font: st.font, pad: st.pad };
      if (r.t === '=') return Object.assign(base, {
        left: this.plain(this.diffText(r.old)), right: this.plain(this.diffText(r.now)),
        leftBg: 'transparent', rightBg: 'transparent', leftBar: 'transparent', rightBar: 'transparent',
        leftMark: '', rightMark: '', leftMarkColor: 'var(--faint)', rightMarkColor: 'var(--faint)'
      });
      if (r.t === '+') { dStats.add++; return Object.assign(base, {
        left: [], right: this.tokens([{ t: '+', s: this.diffText(r.now) }]),
        leftBg: 'transparent', rightBg: 'var(--add-bg)', leftBar: 'transparent', rightBar: 'var(--add-fg)',
        leftMark: '', rightMark: '+', leftMarkColor: 'var(--faint)', rightMarkColor: 'var(--add-fg)'
      }); }
      if (r.t === '-') { dStats.del++; return Object.assign(base, {
        left: this.tokens([{ t: '-', s: this.diffText(r.old) }]), right: [],
        leftBg: 'var(--del-bg)', rightBg: 'transparent', leftBar: 'var(--del-fg)', rightBar: 'transparent',
        leftMark: '−', rightMark: '', leftMarkColor: 'var(--del-fg)', rightMarkColor: 'var(--faint)'
      }); }
      dStats.chg++;
      const w = ADiff.words(this.diffText(r.old), this.diffText(r.now));
      return Object.assign(base, {
        left: this.tokens(w.left), right: this.tokens(w.right),
        leftBg: 'var(--del-bg)', rightBg: 'var(--add-bg)', leftBar: 'var(--del-fg)', rightBar: 'var(--add-fg)',
        leftMark: '~', rightMark: '~', leftMarkColor: 'var(--del-fg)', rightMarkColor: 'var(--add-fg)'
      });
    });
    const diffInline = [];
    rowsD.forEach((r, i) => {
      const st = this.diffStyle(r.now || r.old);
      const base = { size: st.size, weight: st.weight, font: st.font, pad: st.pad };
      if (r.t === '=') diffInline.push(Object.assign({ key: 'e' + i, tokens: this.plain(this.diffText(r.old)), bg: 'transparent', bar: 'transparent', mark: '', markColor: 'var(--faint)' }, base));
      else if (r.t === '+') diffInline.push(Object.assign({ key: 'a' + i, tokens: this.tokens([{ t: '+', s: this.diffText(r.now) }]), bg: 'var(--add-bg)', bar: 'var(--add-fg)', mark: '+', markColor: 'var(--add-fg)' }, base));
      else if (r.t === '-') diffInline.push(Object.assign({ key: 'd' + i, tokens: this.tokens([{ t: '-', s: this.diffText(r.old) }]), bg: 'var(--del-bg)', bar: 'var(--del-fg)', mark: '−', markColor: 'var(--del-fg)' }, base));
      else {
        const w = ADiff.words(this.diffText(r.old), this.diffText(r.now));
        diffInline.push(Object.assign({ key: 'x' + i, tokens: this.tokens(w.left), bg: 'var(--del-bg)', bar: 'var(--del-fg)', mark: '−', markColor: 'var(--del-fg)' }, base));
        diffInline.push(Object.assign({ key: 'y' + i, tokens: this.tokens(w.right), bg: 'var(--add-bg)', bar: 'var(--add-fg)', mark: '+', markColor: 'var(--add-fg)' }, base));
      }
    });
    const diffOpts = versions.map(v => ({ id: v.id, label: 'v' + v.n + ' — ' + (v.message || '').slice(0, 34) })).concat([{ id: 'current', label: 'Current (working copy)' }]);
    /* the older side first, so "Restore v3" beats "Restore the working copy" */
    const dRestoreSide = dA !== 'current' ? dA : (dB !== 'current' ? dB : null);

    /* ---- emoji ---- */
    const eq = (m.q || '').toLowerCase();
    const emojiList = m.kind !== 'emoji' ? [] : EMOJI.filter(e => !eq || e.name.includes(eq)).map(e => ({
      ch: e.ch, name: e.name,
      pick: () => {
        if (m.target === 'db') this.patchDb(m.dbId, d => { d.icon = e.ch; });
        else if (m.target === 'block') this.mutate(bs => { const f = this.locate(m.id, bs); if (f) f.block.icon = e.ch; });
        else if (m.target === 'ws') this.setState(st => ({ workspace: { ...st.workspace, icon: e.ch } }), () => this.persist());
        else this.patchPageHist(s.pageId, { icon: e.ch });
        this.setState({ modal: null });
      }
    }));

    /* ---- row modal ---- */
    const rdb = m.kind === 'row' ? s.dbs[m.dbId] : null;
    const rrow = rdb && rdb.rows ? rdb.rows.find(r => r.id === m.rowId) : null;
    /* one implementation only — propFields already speaks the option model */
    const rowFields = rdb && rrow ? this.propFields(rdb.id, rrow.id, true) : [];

    /* ---- share ---- */
    const sh = (p && p.share) || { published: false, slug: '', password: null, invites: [] };
    const patchShare = (patch) => this.patchPage(s.pageId, { share: Object.assign({}, sh, patch) }, true);

    /* ---- settings ---- */
    const tabs = [
      { id: 'account', name: 'Account', glyph: '👤' }, { id: 'appearance', name: 'Appearance', glyph: '🎨' },
      { id: 'versions', name: 'Versions', glyph: '⑂' }, { id: 'data', name: 'Data & sync', glyph: '🔌' },
      { id: 'shortcuts', name: 'Shortcuts', glyph: '⌨️' }
    ];
    const tabMeta = {
      account: ['Account', 'Your identity and workspace name.'],
      appearance: ['Appearance', 'Theme and reading comfort.'],
      versions: ['Versions', 'How snapshots behave on this workspace.'],
      data: ['Data & sync', 'Where your pages are stored.'],
      shortcuts: ['Shortcuts', 'Everything you can do without the mouse.']
    };
    const togglesArr = [
      { key: 'fullWidth', name: 'Full-width pages', desc: 'Let content use the whole window instead of a fixed column.' },
      { key: 'sourceView', name: 'Markdown source by default', desc: 'Show every markdown marker as soon as a page opens.' },
      { key: 'smallText', name: 'Small text', desc: 'Tighter body size for dense documents.' },
      { key: 'showChanges', name: 'Mark changes since the last version', desc: 'Show + and ~ in the gutter beside every block edited since your last snapshot.' },
      { key: 'spellcheck', name: 'Spellcheck', desc: 'Let the browser underline misspelled words while you write.' }
    ].map(t => {
      const on = !!s.prefs[t.key];
      return Object.assign({}, t, {
        trackBg: on ? 'var(--accent)' : 'var(--border)', knobLeft: on ? '21px' : '3px',
        toggle: () => this.setState(st => ({ prefs: { ...st.prefs, [t.key]: !st.prefs[t.key] } }), () => { if (t.key === 'sourceView') { Object.values(this._els).forEach(e => { e.__h = undefined; }); this.syncDom(); } this._chKey = null; this.persist(); })
      });
    });

    /* "is there a server?" — see the note on AStore.mode in lib/store.js */
    const isFB = AStore.cloud;
    /* The sign-in screen must describe the PROJECT, not the current adapter —
       otherwise a demo user who signs out is told no project exists and has no
       way back to real Google auth. */
    const canFB = !!AStore.hasConfig;

    /* ---- mobile ---- */
    const bar = [
      { id: 'home', name: 'Home', glyph: '☰' }, { id: 'search', name: 'Search', glyph: '⌕' },
      { id: 'insert', name: 'Insert', glyph: '＋' }, { id: 'versions', name: 'Versions', glyph: '⑂' },
      { id: 'more', name: 'More', glyph: '···' }
    ].map(b => {
      const home = b.id === 'home';
      const on = home ? s.main === 'home' : s.sheet === b.id;
      return {
        name: b.name, glyph: b.glyph, flex: b.id === 'insert' ? '1.25' : '1',
        isPages: home, isSearch: b.id === 'search', isInsert: b.id === 'insert',
        isVersions: b.id === 'versions', isMore: b.id === 'more',
        glyphSize: b.id === 'insert' ? '21px' : '17px',
        bg: on ? 'var(--accent-soft)' : (b.id === 'insert' ? 'var(--accent)' : 'transparent'),
        color: b.id === 'insert' ? '#fff' : (on ? 'var(--accent)' : 'var(--muted)'),
        run: home ? () => this.goHome() : () => this.setState(st => ({ sheet: st.sheet === b.id ? null : b.id, search: '' }))
      };
    });
    const fmt = [
      { label: 'B', mk: '**', weight: '700', size: '15px' }, { label: 'I', mk: '*', weight: '400', size: '15px', font: 'var(--serif)' },
      { label: '<>', mk: '`', weight: '500', size: '13px', font: 'var(--mono)' },
      { label: 'H1', turn: 'h1' }, { label: 'H2', turn: 'h2' }, { label: 'H3', turn: 'h3' },
      { label: '•', turn: 'ul', size: '17px' }, { label: '1.', turn: 'ol' }, { label: '☑', turn: 'todo', size: '16px' },
      { label: '❝', turn: 'quote', size: '15px' }, { label: '⇥', indent: 1 }, { label: '⇤', indent: -1 }
    ].map(t => ({
      label: t.label, size: t.size || '13.5px', weight: t.weight || '600', font: t.font || 'var(--ui)',
      run: (e) => {
        e.preventDefault();
        const id = s.focusId; if (!id) return;
        if (t.mk) this.wrapSel(id, t.mk);
        else if (t.turn) this.turnInto(id, t.turn);
        else if (t.indent) this.mutate(bs => { const g = this.locate(id, bs); if (g) g.block.indent = Math.max(0, Math.min(5, (g.block.indent || 0) + t.indent)); });
      }
    }));
    const sheetTitles = { pages: 'Pages', search: 'Search', insert: 'Insert a block', versions: 'Version history', more: 'Page actions', comments: 'Comments' };

    return {
      /* auth */
      showAuth: s.ready && s.route === 'auth',
      authArtDisplay: s.isMobile ? 'none' : 'flex',
      authModeLabel: canFB ? 'or' : 'Local mode',
      authSub: canFB
        ? 'Sign in with Google to sync your pages, versions and shared links across every device. Not ready to sign in? Open the demo instead.'
        : 'Everything stays on this device until a Firebase project is configured.',
      /* Name the store this account will actually sync to, not a vendor. The
         sign-in screen must describe the CONFIGURED backend even while the app
         is running on the local one, or a demo user is told there is nothing to
         come back to. */
      authHint: canFB
        ? (AStore.demo
          ? 'You are in demo mode, so this browser is not talking to the server. Sign in to leave the demo and sync to ' + this.backendLabel() + (AStore.projectId ? ' (' + AStore.projectId + ')' : '') + ' — your demo pages stay in this browser.'
          : 'Signing in syncs this workspace to ' + this.backendLabel() + (AStore.projectId ? ' (' + AStore.projectId + ')' : '') + '. The demo runs entirely in this browser on a seeded workspace — nothing is written to the server and nothing is shared.')
        : 'No database is configured, so signing in creates a local identity and your pages stay on this device. Fill in a block in lib/config.js to sync.',
      showDemoButton: canFB && !AStore.demo,
      signIn: () => {
        /* In demo mode the Google button must leave the demo first, otherwise it
           would just mint another fake local identity. */
        if (canFB && AStore.demo) { AStore.leaveDemo(); return; }
        this.setState({ signingIn: true, authError: null });
        AStore.signInWithGoogle()
          .then(u => { if (u) this.setState({ user: u, route: 'app', signingIn: false }); else this.setState({ signingIn: false }); })
          .catch(err => {
            console.warn('[auth]', err);
            this.setState({ signingIn: false, authError: (err && err.code) || 'auth/unknown' });
          });
      },
      signingIn: !!s.signingIn,
      signInLabel: s.signingIn ? 'Opening Google…' : 'Continue with Google',
      hasAuthError: !!s.authError,
      authErrTitle: (() => {
        const c = s.authError;
        if (c === 'auth/unauthorized-domain') return 'This domain is not authorised';
        if (c === 'auth/popup-blocked' || c === 'auth/operation-not-supported-in-this-environment') return 'The sign-in popup was blocked';
        if (c === 'auth/network-request-failed') return 'No connection to Firebase';
        if (c === 'auth/configuration-not-found') return 'Google sign-in is not enabled';
        if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return 'Sign-in was closed';
        return 'Google sign-in failed';
      })(),
      authErrBody: (() => {
        const c = s.authError;
        const host = location.hostname || 'this domain';
        if (c === 'auth/unauthorized-domain')
          return 'Add ' + host + ' to Firebase Console → Authentication → Settings → Authorised domains, then try again.';
        if (c === 'auth/popup-blocked' || c === 'auth/operation-not-supported-in-this-environment')
          return 'This page is running inside a sandboxed frame, so the Google popup cannot open. Open index.html in its own browser tab, or use the demo.';
        if (c === 'auth/configuration-not-found')
          return 'Turn on the Google provider in Firebase Console → Authentication → Sign-in method.';
        if (c === 'auth/network-request-failed')
          return 'Check the connection and that ' + this.backendLabel() + (AStore.projectId ? ' (' + AStore.projectId + ')' : '') + ' is still reachable.';
        if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request')
          return 'The Google window was closed before finishing. Try again, or use the demo.';
        return 'Firebase returned ' + (c || 'an unknown error') + '. The demo works without any of this.';
      })(),
      authErrCode: s.authError || '',
      authHost: location.hostname,
      showAuthHost: s.authError === 'auth/unauthorized-domain',
      copyAuthHost: () => { navigator.clipboard.writeText(location.hostname); this.toast('Domain copied — paste it into Firebase'); },
      dismissAuthError: () => this.setState({ authError: null }),
      enterDemo: () => AStore.enterDemo().then(u => {
        const seed = window.ASEED ? window.ASEED() : { pages: {}, dbs: {}, prefs: {} };
        const loaded = (() => { try { const raw = localStorage.getItem('alamza.notes.v1'); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } })();
        const data = loaded && loaded.pages ? loaded : seed;
        this._els = {}; this._refs = {};
        this.setState({
          user: u, route: 'app', pages: data.pages, dbs: data.dbs || {},
          workspace: data.workspace || { name: 'Alamza', icon: '🛰️' },
          pageId: data.pages.p_spec ? 'p_spec' : Object.keys(data.pages)[0]
        }, () => { this.persist(); this.toast('Demo workspace — stored in this browser only'); });
      }),
      leaveDemo: () => { this.forgetVersions(); AStore.leaveDemo(); },
      isDemo: AStore.demo,
      signOut: () => {
        /* the snapshot memo holds whole subtrees of the workspace being left */
        this.forgetVersions();
        if (canFB && AStore.demo) { AStore.leaveDemo(); return; }
        AStore.signOut(); this.setState({ user: null, route: 'auth' });
      },
      signOutLabel: canFB && AStore.demo ? 'Leave the demo' : 'Sign out',
      userEmail: (s.user && s.user.email) || '—',

      /* settings */
      showSettings: s.ready && s.route === 'settings',
      setNavW: s.isMobile ? '150px' : '220px',
      exitSettings: () => this.setState({ route: 'app' }),
      setTabs: tabs.map(t => ({
        name: t.name, glyph: t.glyph,
        bg: setTab === t.id ? 'var(--hover)' : 'transparent',
        color: setTab === t.id ? 'var(--text)' : 'var(--muted)',
        weight: setTab === t.id ? '600' : '400',
        select: () => this.setState({ setTab: t.id })
      })),
      setTitle: tabMeta[setTab][0], setSub: tabMeta[setTab][1],
      setIsAccount: setTab === 'account', setIsAppearance: setTab === 'appearance',
      setIsData: setTab === 'data', setIsVersions: setTab === 'versions', setIsShortcuts: setTab === 'shortcuts',
      pickWsIcon: () => this.setState({ modal: { kind: 'emoji', target: 'ws' } }),
      setWsName: (e) => { const v = e.target.value; this.setState(st => ({ workspace: { ...st.workspace, name: v } }), () => this.persist()); },
      themeOpts: [
        { id: 'light', name: 'Light', glyph: '☼' }, { id: 'dark', name: 'Dark', glyph: '☾' }, { id: 'system', name: 'System', glyph: '◐' }
      ].map(t => ({
        name: t.name, glyph: t.glyph,
        bd: s.prefs.theme === t.id ? 'var(--accent)' : 'var(--border)',
        bg: s.prefs.theme === t.id ? 'var(--accent-soft)' : 'var(--canvas)',
        weight: s.prefs.theme === t.id ? '600' : '400',
        select: () => this.setState(st => ({ prefs: { ...st.prefs, theme: t.id } }), () => { this.applyTheme(); this.persist(); })
      })),
      toggles: togglesArr,
      sidebarWVal: s.prefs.sidebarW || 264,
      sidebarWLabel: (s.prefs.sidebarW || 264) + 'px',
      setSidebarW: (e) => { const v = Number(e.target.value); this.setState(st => ({ prefs: { ...st.prefs, sidebarW: v } }), () => this.persist()); },
      syncDot: isFB ? 'var(--add-fg)' : '#E8A33D',
      /* Downloads are the billed number, so the app now shows them. The old
         counter only measured explicit reads, which is why a listener leak
         could pull hundreds of megabytes while this readout said almost
         nothing — every listener callback is metered too. */
      dataDown: fmtBytes(AStore.stats.down || 0),
      dataUp: fmtBytes(AStore.stats.up || 0),
      syncTitle: isFB ? 'Connected to ' + this.backendLabel()
        : AStore.demo ? 'Demo mode — this browser only' : 'Running on local storage',
      syncBody: isFB
        ? 'Startup loads one small index — titles, icons, hierarchy, row counts — and nothing else. Page text, database rows, search keywords and snapshot bodies are separate nodes, each fetched the first time you actually need it and then cached. Only the index and two tiny change-pings are subscribed, so neither your own saves nor a large workspace cost you a download. Which database is behind all of that is one line in lib/config.js — the app itself does not name one.'
        : AStore.demo
          ? 'You chose the demo on the sign-in screen. The workspace is seeded and kept in this browser — nothing reaches the network, and sharing links are simulated. Leave the demo to sign in and sync for real.'
          : 'No database is configured in lib/config.js, so Alamza keeps everything in this browser. Fill in one of the blocks there and reload — the app switches on its own, with no code changes.',
      /* What is on screen has to be what is actually happening, or it is worse
         than nothing: the backend that was chosen, the sentence saying why it
         was chosen, and what it can and cannot do. A user who edits
         lib/config.js and reloads reads this to find out whether it took. */
      syncCode: isFB || AStore.hasConfig
        ? 'backend:  ' + (AStore.backendName || '?') + '   (' + (AStore.why || '') + ')'
          + '\nsign-in:  ' + (AStore.authName || '?')
          + (AStore.caps
              ? '\nlive:     ' + (AStore.caps.realtime ? 'yes — other devices appear as they type'
                                                        : 'no — other devices appear on reload')
                + '\nsaves:    ' + (AStore.caps.atomicCommit ? 'all-or-nothing' : 'applied one at a time')
              : '')
          + (AStore.projectId ? '\nproject:  ' + AStore.projectId : '')
          + '\n\nworkspaces/<uid>/\n  meta                    prefs · workspace · invites\n  idx/<pageId>            ~110 B  title, parent, flags   ← subscribed\n  dbmeta/<dbId>           props, views, row order  ← subscribed\n  dbrev/<dbId>            ~60 B row-change ping    ← subscribed\n  body/<pageId>           blocks        · on open\n  dbrow/<dbId>/<rowId>    one row       · on first view\n  dig/<pageId>            search words  · on first search\n  vmeta/<pageId>          snapshot metadata\n  vdata/<pageId>/<vId>    snapshot bodies · write-once'
          + '\n\nthis session\n  down  ' + fmtBytes(AStore.stats.down || 0)
          + '\n  up    ' + fmtBytes(AStore.stats.up || 0) + '   (uploads are not billed)'
          + '\n  reads ' + (AStore.stats.reads || 0) + '  ·  writes ' + (AStore.stats.writes || 0)
        : 'lib/config.js\n\n  backend: "rtdb",          ← or "firestore", "rest", "local"\n  backends: {\n    rtdb: { apiKey: "…", databaseURL: "https://…firebasedatabase.app" },\n    firestore: { apiKey: "…", projectId: "…" }\n  }\n\nEvery block is commented in that file. Fill one in and reload.',
      showLeaveDemo: AStore.demo,
      exportJson: () => {
        const ids = Object.values(s.pages).filter(x => !x.trashed).map(x => x.id);
        this.toast('Fetching ' + ids.length + ' pages…');
        this.ensureBodies(ids)
          .then(() => Promise.all(ids.map(i => {
            const pg = this.state.pages[i];
            return pg && pg.blocks ? this.ensureRowsFor(pg.blocks) : null;
          })))
          .then(() => {
            navigator.clipboard.writeText(JSON.stringify({ pages: this.state.pages, dbs: this.state.dbs }, null, 2));
            this.toast('Workspace JSON copied');
          });
      },
      /* the one place the whole corpus IS wanted — fetch it explicitly, and
         only when the user asks for an export */
      exportMd: () => {
        const ids = Object.values(s.pages).filter(x => !x.trashed).map(x => x.id);
        this.toast('Fetching ' + ids.length + ' pages…');
        this.ensureBodies(ids)
          .then(() => Promise.all(ids.map(i => {
            const pg = this.state.pages[i];
            return pg && pg.blocks ? this.ensureRowsFor(pg.blocks) : null;
          })))
          .then(() => {
            const st = this.state;
            const all = Object.values(st.pages).filter(x => !x.trashed)
              .map(x => '# ' + (x.title || 'Untitled') + '\n\n' + AMD.toMarkdown(x.blocks || [], { pages: st.pages, dbs: st.dbs }))
              .join('\n\n---\n\n');
            navigator.clipboard.writeText(all);
            this.toast('All pages copied as Markdown');
          });
      },
      /* Tables whose block was deleted before deletion collected them are
         unreachable but still stored — and `dbmeta` is subscribed, so each one
         is re-downloaded on every boot. This finds them; it has to read every
         body first, so it is a button rather than something that runs at boot. */
      tableCount: Object.keys(s.dbs || {}).length,
      cleanTables: () => this.cleanUnusedTables(),
      resetDemo: () => { AStore.reset(); this.forgetVersions(); const d = window.ASEED(); this._els = {}; this._refs = {}; this.setState({ pages: d.pages, dbs: d.dbs, pageId: 'p_spec', route: 'app', roVersion: null }, () => this.persist()); },
      /* the same builder createVersion uses, so this IS the text that gets
         saved rather than a second, differently-worded guess at it */
      autoMsgPreview: !p || !wantVer ? ''
        : pendUnknown ? 'Working it out…'
        : this.autoMessage(lastSnap ? lastSnap.b : [], p.blocks, pendNested, pendGone),
      versionStatLine: versions.length ? versions.length + ' snapshots · latest ' + relTime(lastV.createdAt) : 'No snapshots on this page yet.',
      shortcuts: SHORTCUTS.map((k, i) => ({
        name: k.name, keys: k.keys,
        section: (i === 0 || SHORTCUTS[i - 1].s !== k.s) ? k.s : '',
        showSection: i === 0 || SHORTCUTS[i - 1].s !== k.s
      })),

      /* ---- public reader ----------------------------------------------
         Two readers share this screen: a visitor who followed a link, whose
         whole page arrived as `pubDoc`, and the owner previewing their own.
         The visitor's copy is sealed if it has a password, so "unlock" is a
         decryption rather than a string comparison — the stored bytes are
         unreadable without the password, not merely hidden behind a prompt. */
      showPublic: s.ready && s.route === 'public',
      exitPublic: () => {
        if (s.pubSlug) { location.hash = ''; }
        this.setState({ route: 'app', pwOk: false, pubDoc: null, pubSlug: null, pwTry: '', pwErr: '' });
      },
      exitPublicLabel: s.pubSlug ? 'Open Alamza' : 'Exit preview',
      publicMissing: !!s.pubMissing,
      publicLoading: !!s.pubLoading,
      publicLocked: s.pubSlug ? !!s.pubLocked : !!(sh.password && !s.pwOk),
      publicOpen: s.pubSlug
        ? (!s.pubLocked && !s.pubMissing && !s.pubLoading)
        : !(sh.password && !s.pwOk),
      pwTry: s.pwTry || '',
      setPwTry: (e) => this.setState({ pwTry: e.target.value }),
      submitPw: () => {
        if (!s.pubSlug) {
          this.setState(st => ({ pwOk: st.pwTry === sh.password, pwErr: st.pwTry !== sh.password ? 'That password does not match.' : '' }));
          return;
        }
        this.openPublic(s.pubSlug, this.state.pwTry);
      },
      pwHint: s.pwErr || (s.pubSlug ? '' : 'Preview password: ' + (sh.password || '—')),
      publicTitle: s.pubDoc ? (s.pubDoc.t || 'Untitled') : ((p && p.title) || 'Untitled'),
      publicIcon: s.pubDoc ? (s.pubDoc.i || '') : ((p && p.icon) || ''),
      publicWhen: s.pubDoc
        ? (s.pubDoc.u ? 'Published ' + relTime(s.pubDoc.u) : '')
        : (p ? 'Edited by ' + (p.updatedBy || 'you') + ' · ' + relTime(p.updatedAt) : ''),
      publicRef: (el) => { this._publicEl = el; if (el) el.__k = undefined; },

      /* slash */
      hasSlash: !!sl && slashItems.length >= 0,
      slashX: sl ? Math.min(sl.x, window.innerWidth - 305) + 'px' : '0px',
      slashY: sl ? Math.min(sl.y, window.innerHeight - 330) + 'px' : '0px',
      slashItems, slashEmpty: !!sl && slashItems.length === 0,
      slashRef: (el) => { this._slashEl = el; },
      slashTitle: isMention ? 'Link to a page' : 'Blocks',
      slashEmptyMsg: isMention ? 'No page matches that.' : 'No block matches that.',

      /* floating format bar */
      /* On touch the floating format bar is not wanted: a long press should
         bring up one menu, not a colour bar on top of it. The bottom format
         strip already covers bold/italic/code while the keyboard is open. */
      hasSelBar: !!s.selBar && !s.isMobile,
      selBarX: s.selBar ? Math.max(150, Math.min(s.selBar.x, window.innerWidth - 150)) + 'px' : '0px',
      selBarY: s.selBar ? Math.max(46, s.selBar.y - 46) + 'px' : '0px',
      selTools: [
        { label: 'B', mk: '**', weight: '700', font: 'var(--ui)' },
        { label: 'i', mk: '*', weight: '500', font: 'var(--serif)' },
        { label: 'S', mk: '~~', weight: '500', font: 'var(--ui)', deco: 'line-through' },
        { label: '</>', mk: '`', weight: '500', font: 'var(--mono)' },
        { label: '◼', mk: '==', weight: '500', font: 'var(--ui)' }
      ].map(t => ({
        label: t.label, weight: t.weight, font: t.font, deco: t.deco || 'none',
        run: (e) => { e.preventDefault(); if (s.selBar) this.wrapSel(s.selBar.id, t.mk); }
      })),
      selLink: (e) => {
        e.preventDefault();
        if (!s.selBar) return;
        const el = this._els[s.selBar.id]; if (!el) return;
        const g = window.getSelection(); const label = g ? g.toString() : '';
        const url = window.prompt('Link URL', 'https://');
        if (!url) return;
        const text = el.textContent;
        const r = g.getRangeAt(0);
        const pre = document.createRange(); pre.selectNodeContents(el); pre.setEnd(r.startContainer, r.startOffset);
        const st2 = pre.toString().length;
        const next = text.slice(0, st2) + '[' + label + '](' + url + ')' + text.slice(st2 + label.length);
        this.mutate(bs => { const q = this.locate(s.selBar.id, bs); if (q) q.block.text = next; });
        this.setState({ selBar: null });
      },
      selColor: (e) => {
        e.preventDefault();
        if (!s.selBar) return;
        const r = e.currentTarget.getBoundingClientRect();
        const host = document.querySelector('[data-bid="' + s.selBar.id + '"]');
        this.setState({ menu: { kind: 'block', id: s.selBar.id, x: r.left - 60, y: r.bottom + 8, y0: r.bottom + 8, anchor: s.selBar.id, anchorTop: host ? host.getBoundingClientRect().top : r.top }, selBar: null });
      },

      /* link hover card */
      hasLinkCard: !!s.linkCard,
      linkX: s.linkCard ? Math.min(s.linkCard.x, window.innerWidth - 280) + 'px' : '0px',
      linkY: s.linkCard ? s.linkCard.y + 'px' : '0px',
      linkTitle: s.linkCard ? s.linkCard.title : '',
      linkSub: s.linkCard ? s.linkCard.sub : '',
      linkOpen: () => { const c = s.linkCard; if (!c) return; const mm = c.href.match(/^#\/page\/([\w-]+)/); if (mm) this.openPage(mm[1]); else window.open(c.href, '_blank', 'noopener'); this.setState({ linkCard: null }); },
      linkCopy: () => { navigator.clipboard.writeText(s.linkCard.href); this.toast('Link copied'); this.setState({ linkCard: null }); },

      /* menus */
      hasMenu: !!s.menu && menuItems.length > 0,
      menuX: Math.min(mu.x || 0, window.innerWidth - 250) + 'px',
      menuY: Math.min(mu.y || 0, window.innerHeight - 300) + 'px',
      menuW, menuItems,

      /* modal shell */
      hasModal: !!s.modal,
      closeModal: () => { this.flushPublish(); this.setState({ modal: null }); },
      stop: (e) => e.stopPropagation(),
      modalAlign: m.kind === 'search' ? 'flex-start' : 'center',
      modalPad: m.kind === 'diff' ? (s.isMobile ? '0' : '3vh 2vw') : m.kind === 'search' ? '12vh 16px 16px' : '16px',
      modalW: m.kind === 'diff' ? (s.isMobile ? '100%' : '1180px') : m.kind === 'share' ? '460px' : m.kind === 'emoji' ? '400px' : m.kind === 'row' ? '520px' : m.kind === 'search' ? '560px' : m.kind === 'inbox' ? '520px' : '440px',
      modalMaxH: m.kind === 'diff' ? (s.isMobile ? '94vh' : '90vh') : '80vh',
      modalH: m.kind === 'diff' ? (s.isMobile ? '94vh' : '90vh') : 'auto',
      showModalClose: m.kind !== 'diff',

      /* new version */
      mIsNewVersion: m.kind === 'newVersion',
      /* what a capture here actually covers — the copy used to say "the page" */
      verScopeLine: (() => {
        if (!p || m.kind !== 'newVersion') return '';
        const sc = this.captureScope(p.id);
        const bits = [];
        if (sc.nested) bits.push(sc.nested + (sc.nested === 1 ? ' sub-page' : ' sub-pages'));
        if (sc.dbs) bits.push(sc.dbs + (sc.dbs === 1 ? ' table' : ' tables'));
        return bits.length
          ? 'This captures the page plus ' + bits.join(' and ') + ', as they are right now.'
          : 'This captures the page as it is right now.';
      })(),
      verBusy: !!s.capturing,
      verAutoFocus: true,
      /* ⌘⏎ / Ctrl+⏎ commits, the way every other one-field dialog behaves */
      verMsgKey: (e) => {
        if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
        e.preventDefault();
        if (!pendNone && !pendUnknown && !s.capturing && this.canWriteHistory(p)) this.createVersion(m.msg);
      },
      pendAdd: pend.added, pendDel: pend.removed, pendChg: pend.changed,
      pendSince: lastV ? 'v' + lastV.n : 'the first draft',
      pendNestedLabel: pendNested ? ' · ' + pendNested + ' nested' : '',
      /* three states, not two: known-and-changed, known-and-identical, and
         still comparing — the last must not print counts or offer Save */
      pendUnknown: pendUnknown,
      pendKnown: !pendUnknown,
      verBlocked: pendNone,
      /* The primary action stays on screen and goes grey. It used to be removed
         from the dialog entirely, so the reason it had gone was a paragraph the
         reader had to connect to a button that was no longer there. */
      showSaveVersion: true,
      verSaveOff: pendNone || pendUnknown || !!s.capturing || !this.canWriteHistory(p),
      verSaveLabel: s.capturing ? 'Saving…' : 'Save version',
      verSaveBg: (pendNone || pendUnknown || s.capturing || !this.canWriteHistory(p)) ? 'var(--soft)' : 'var(--accent)',
      verSaveColor: (pendNone || pendUnknown || s.capturing || !this.canWriteHistory(p)) ? 'var(--faint)' : '#fff',
      verCanSave: !pendNone && !pendUnknown && this.canWriteHistory(p),
      verBlockedMsg: 'Nothing has changed since v' + (lastV ? lastV.n : 1)
        + '. Edit the page — or any page inside it — then take a snapshot.',
      verMsg: m.msg || '',
      setVerMsg: (e) => this.upModal({ msg: e.target.value }),
      commitVersion: () => this.createVersion(m.msg),

      /* restore ------------------------------------------------------------
         A restore reaches further than the page it is offered on: it rewrites
         every nested page the snapshot captured and replaces every table they
         embed. The dialog used to say only "the working copy is overwritten
         with this version", so the reach was discovered afterwards — and a
         table shared with a page OUTSIDE this subtree meant a restore here
         silently changed a page over there. Both are stated up front now. */
      mIsRestore: m.kind === 'restore',
      restoreTag: m.vid && this.versionById(m.vid) ? 'v' + this.versionById(m.vid).n : '',
      restoreMsg: m.vid && this.versionById(m.vid) ? this.versionById(m.vid).message : '',
      restoreLoading: rScope === null,
      isRestoring: !!s.restoring,
      restoreReach: rReach,
      restoreOpts: (this.canWriteHistory(p) ? [
        { glyph: '⇄', name: 'Replace the current page', desc: 'The working copy is overwritten with this version' + rReachTail + '. Nothing is snapshotted first, so ⌘Z is the only way back.', run: () => this.restore(m.vid, 'replace') },
        { glyph: '⑂', name: 'Restore as a new version', desc: 'Snapshot what you have now first — the whole subtree — then bring this version back as the working copy.', run: () => this.restore(m.vid, 'new') }
      ] : []).concat([
        { glyph: '👁', name: 'Open read-only', desc: 'Just look at it. Nothing is written and you can leave at any time.', run: () => this.restore(m.vid, 'ro') }
      ]),
      restoreWarn: !!(rScope && rScope.sharedDbs.length),
      restoreWarnText: !(rScope && rScope.sharedDbs.length) ? '' :
        rScope.sharedDbs.map(d => '“' + d.name + '” is also used on ' +
          d.where.map(pid => (s.pages[pid] && s.pages[pid].title) || 'Untitled').join(', ')).join(' · ')
        + ' — restoring this version replaces ' + (rScope.sharedDbs.length === 1 ? 'that table' : 'those tables') + ' everywhere.',

      /* confirm — one modal for any irreversible action, so the wording lives
         with the thing being deleted rather than in a browser alert */
      mIsConfirm: m.kind === 'confirm',
      confirmTitle: m.title || 'Are you sure?',
      confirmBody: m.body || '',
      confirmLabel: m.confirmLabel || 'Delete',
      confirmBg: m.tone === 'danger' ? 'var(--del-fg)' : 'var(--accent)',
      runConfirm: () => {
        const act = m.act;
        if (act === 'deleteDatabase') this.deleteDatabase(m.dbId);
        else if (act === 'deleteVersion') {
          this.deleteVersion(m.vid);
          this.setState({ modal: null });
          this.toast('Snapshot deleted');
        }
        else this.setState({ modal: null });
      },

      /* emoji */
      mIsEmoji: m.kind === 'emoji',
      emojiQ: m.q || '', setEmojiQ: (e) => this.upModal({ q: e.target.value }),
      emojiList,
      randomEmoji: () => { const e = EMOJI[Math.floor(Math.random() * EMOJI.length)]; if (m.target === 'ws') this.setState(st => ({ workspace: { ...st.workspace, icon: e.ch }, modal: null }), () => this.persist()); else if (m.target === 'block') { this.mutate(bs => { const f = this.locate(m.id, bs); if (f) f.block.icon = e.ch; }); this.setState({ modal: null }); } else { this.patchPageHist(s.pageId, { icon: e.ch }); this.setState({ modal: null }); } },
      removeEmoji: () => {
        if (m.target === 'db') this.patchDb(m.dbId, d => { d.icon = ''; });
        else if (m.target === 'page') this.patchPageHist(s.pageId, { icon: '' });
        else if (m.target === 'ws') this.setState(st => ({ workspace: { ...st.workspace, icon: '' } }), () => this.persist());
        else if (m.target === 'block') this.mutate(bs => { const f = this.locate(m.id, bs); if (f) f.block.icon = '💡'; });
        this.setState({ modal: null });
      },

      /* share */
      mIsShare: m.kind === 'share',
      togglePublish: () => this.setPublished(s.pageId, !sh.published),
      canRepublish: !!sh.published,
      republish: () => this.republish(s.pageId),
      pubTrack: sh.published ? 'var(--accent)' : 'var(--border)', pubKnob: sh.published ? '21px' : '3px',
      shareUrl: this.shareUrl(p).replace(/^https?:\/\//, ''),
      copyShare: () => { navigator.clipboard.writeText(this.shareUrl(p)); this.toast('Public link copied'); },
      shareHostNote: 'Built from ' + location.host + ' — the link follows whichever domain you serve the app from.',
      pwOn: !!sh.password, pwVal: sh.password || '',
      /* A password changes what gets STORED, not just what the reader is
         asked — the published copy is sealed with it. So the re-send follows
         the VALUE on a short fuse, and closing the dialog flushes it. It used
         to wait for the input to lose focus, which never happens if you close
         with Escape: the switch said "protected" over a copy anyone could
         read. */
      setPw: (e) => {
        patchShare({ password: e.target.value });
        if (sh.published) this.schedulePublish(s.pageId);
      },
      commitPw: () => this.flushPublish(),
      togglePw: () => {
        const next = sh.password ? null : 'alamza2026';
        patchShare({ password: next });
        if (sh.published) setTimeout(() => this.republish(s.pageId), 0);
      },
      /* the state of the STORED copy, not of the text box */
      pwSynced: this.publishInSync(p),
      pwSealing: !!s.sealing,
      pwStatus: !sh.published ? ''
        : s.sealing ? 'Sending the sealed copy…'
        : !this.publishInSync(p) ? 'Not applied yet — the copy on the web is still readable without it.'
        : sh.password ? 'The copy on the web is encrypted with this password.'
        : '',
      pwStatusColor: (!s.sealing && !this.publishInSync(p)) ? 'var(--del-fg)' : 'var(--muted)',
      showPwStatus: !!sh.published && !!(s.sealing || !this.publishInSync(p) || sh.password),
      pwNote: sh.password
        ? 'The published copy is encrypted with this password. Without it the stored page is unreadable — not merely hidden.'
        : 'Anyone with the link can read the published copy.',
      pwTrack: sh.password ? 'var(--accent)' : 'var(--border)', pwKnob: sh.password ? '21px' : '3px',
      previewPublic: () => this.setState({ route: 'public', modal: null, pwOk: false, pwTry: '' }),
      inviteEmail: m.email || '', setInviteEmail: (e) => this.upModal({ email: e.target.value }),
      inviteKey: (e) => { if (e.key === 'Enter') { e.preventDefault(); this.extraVals().addInvite(); } },
      inviteOff: !String(m.email || '').trim() || AStore.mode !== 'firebase',
      inviteColor: (!String(m.email || '').trim() || AStore.mode !== 'firebase') ? 'var(--faint)' : 'var(--text)',
      inviteRole: 'viewer',
      /* the member list is written FIRST so the mirror sendInvite() sends
         already carries the new reader; the toast comes from sendInvite,
         which is the only thing that knows whether it actually left */
      addInvite: () => {
        const email = String(m.email || '').trim().toLowerCase();
        if (!email) return;
        if ((sh.invites || []).some(x => x.email === email)) {
          this.toast('That person already has access'); return;
        }
        patchShare({ invites: (sh.invites || []).concat([{ email, role: 'viewer' }]) });
        this.sendInvite(s.pageId, email, 'viewer');
        this.upModal({ email: '' });
      },
      inviteRoles: this.shareRoles(),
      shareIsLive: AStore.mode === 'firebase',
      shareModeNote: AStore.mode === 'firebase'
        ? 'They will find it in their invitations, and see the page as it stands whenever you edit it.'
        : 'Sign in to share with another account — the demo workspace has nobody to share with.',
      /* Invitations addressed to THIS account, read from the shared inbox node
         rather than from anything this workspace wrote itself. */
      inbox: (s.inbox || []).map(i => ({
        id: i.id, title: i.title || 'Untitled', from: i.fromName || i.fromEmail || 'Someone',
        role: 'view', when: relTime(i.at),
        iconEl: this.iconEl({ icon: i.icon }, 16),
        accept: () => this.answerInvite(i.id, true),
        decline: () => this.answerInvite(i.id, false)
      })),
      hasInbox: (s.inbox || []).length > 0,
      inboxCount: (s.inbox || []).length,
      openInbox: () => { this.setState({ modal: { kind: 'inbox' } }); this.refreshInbox(); },
      mIsInbox: m.kind === 'inbox',
      /* "Nothing waiting" and the badge now ask the same question. They did
         not: the badge counted every pending invite in the list including the
         ones this account had SENT, so sharing a page lit up your own inbox
         and opening it showed an empty box. */
      inboxEmpty: !!s.inboxLoaded && !(s.inbox || []).length,
      inboxLoading: !s.inboxLoaded,
      invites: (sh.invites || []).map((iv) => ({
        email: iv.email, role: 'Can view', initial: (iv.email || '?').slice(0, 1).toUpperCase(),
        color: this.chipColor(iv.email).fg,
        remove: () => {
          patchShare({ invites: (sh.invites || []).filter(x => x.email !== iv.email) });
          this.revokeInvite(s.pageId, iv.email);
        }
      })),

      /* search */
      mIsSearch: m.kind === 'search',
      searchQ: s.search || '', setSearch: (e) => this.setState({ search: e.target.value }),
      searchResults: results, searchEmpty: results.length === 0 && !this.headingHits(q).length,
      headingResults: this.headingHits(q).map(h => ({
        text: h.text,
        where: (h.page.title || 'Untitled') + ' · ' + (h.block.type === 'h1' ? 'Heading 1' : h.block.type === 'h2' ? 'Heading 2' : 'Heading 3'),
        open: () => { this.openPage(h.page.id, h.block.id); this.setState({ modal: null, sheet: null }); }
      })),
      hasHeadingResults: this.headingHits(q).length > 0,

      /* row */
      mIsRow: m.kind === 'row',
      rowIconEl: this.iconEl(rrow || {}, 24),
      rowTitle: rrow && rdb ? (rrow.cells[rdb.props[0].id] || '') : '',
      setRowTitle: (e) => {
        if (!rdb || !rrow) return;
        const val = e.target.value;
        this.patchDb(rdb.id, d => {
          const r2 = d.rows.find(x => x.id === rrow.id);
          if (r2) r2.cells[d.props[0].id] = val;
        });
        if (rrow.pageId && s.pages[rrow.pageId]) this.patchPage(rrow.pageId, { title: val }, true);
      },
      rowFields,

      /* diff */
      mIsDiff: m.kind === 'diff',
      diffA: dA, diffB: dB,
      setDiffA: (e) => this.pickDiffSide('a', e.target.value),
      setDiffB: (e) => this.pickDiffSide('b', e.target.value),
      diffOptsA: diffOpts, diffOptsB: diffOpts,
      /* nested-page rail */
      /* A 216px rail beside the diff eats half a phone. On mobile the same
         list becomes a horizontal chip scroller above the content. */
      diffHasTree: dScope.length > 1 && !s.isMobile,
      diffHasChips: dScope.length > 1 && s.isMobile,
      diffBodyDir: s.isMobile ? 'column' : 'row',
      diffChips: dScope.map(x => ({
        name: x.title,
        bg: x.id === dPage ? 'var(--accent-soft)' : 'var(--surface)',
        bd: x.id === dPage ? 'var(--accent)' : 'var(--border)',
        color: x.id === dPage ? 'var(--accent)' : (x.touched ? 'var(--text)' : 'var(--muted)'),
        weight: x.id === dPage ? '600' : '500',
        badge: x.pending ? '···' : (x.touched ? '+' + x.added + ' −' + x.removed : ''),
        showBadge: x.pending || x.touched,
        pick: () => this.setState({ diffPage: x.id })
      })),
      diffTreeCount: dScope.length + ' pages',
      diffTouchedCount: (() => {
        if (dScope.some(x => x.pending)) return 'comparing…';
        const n = dScope.filter(x => x.touched).length;
        return n ? n + ' changed' : 'No changes';
      })(),
      diffTree: dScope.map(x => ({
        name: x.title,
        icon: x.icon || (x.isRoot ? '📄' : '↳'),
        pad: x.isRoot ? '9px 10px' : '9px 10px 9px 22px',
        bg: x.id === dPage ? 'var(--accent-soft)' : 'transparent',
        color: x.id === dPage ? 'var(--accent)' : (x.touched ? 'var(--text)' : 'var(--muted)'),
        weight: x.id === dPage ? '600' : (x.touched ? '500' : '400'),
        showStat: x.touched && !x.pending,
        showPending: !!x.pending,
        add: x.added, del: x.removed, chg: x.changed,
        pick: () => this.setState({ diffPage: x.id })
      })),
      diffPagePending: !!dEntry.pending,
      /* the header carries two selects, a stat block, a mode toggle and a
         close button — on a phone the title has to go and the selects share
         one row of their own */
      diffShowTitle: !s.isMobile,
      diffHeadPad: s.isMobile ? '10px 12px' : '14px 18px',
      diffHeadGap: s.isMobile ? '7px' : '10px',
      diffSelFlex: s.isMobile ? '1 1 40%' : '0 0 auto',
      diffStatGap: s.isMobile ? '0' : '6px',
      diffPageName: (dScope.find(x => x.id === dPage) || {}).title || '',
      diffALabel: this.labelOf(dA), diffBLabel: this.labelOf(dB),
      diffAdd: dTotal.add, diffDel: dTotal.del, diffChg: dTotal.chg,
      diffScopeNote: dScope.length > 1 ? 'across ' + dScope.length + ' pages' : '',
      showDiffPageStat: dScope.length > 1 && !dEntry.pending,
      diffPageStat: dScope.length <= 1 ? '' :
        ((dEntry.title || 'this page') + ': +' + dStats.add + ' −' + dStats.del + ' ~' + dStats.chg),
      /* B4 — side-by-side is unreadable on a phone; force inline below 860px */
      diffIsSplit: !dEntry.pending && !s.isMobile && s.diffMode !== 'inline' && !(dStats.add + dStats.del + dStats.chg === 0),
      diffIsInline: !dEntry.pending && (s.isMobile || s.diffMode === 'inline') && !(dStats.add + dStats.del + dStats.chg === 0),
      diffModeLocked: s.isMobile,
      diffNone: !dEntry.pending && dStats.add + dStats.del + dStats.chg === 0,
      /* "These two versions are identical" was printed for a page that had not
         changed inside a comparison where something else had — which is a
         different, and much more confusing, statement */
      diffNoneText: (dTotal.add + dTotal.del + dTotal.chg === 0)
        ? 'These two versions are identical.'
        : 'This page is unchanged — the changes are on another page in this snapshot.',
      diffRows, diffInline,
      showDiffModes: !s.isMobile,
      modeSplit: () => this.setState({ diffMode: 'split' }), modeInline: () => this.setState({ diffMode: 'inline' }),
      splitBg: s.diffMode !== 'inline' ? 'var(--surface)' : 'transparent', splitColor: s.diffMode !== 'inline' ? 'var(--text)' : 'var(--muted)', splitWeight: s.diffMode !== 'inline' ? '600' : '400',
      inlineBg: s.diffMode === 'inline' ? 'var(--surface)' : 'transparent', inlineColor: s.diffMode === 'inline' ? 'var(--text)' : 'var(--muted)', inlineWeight: s.diffMode === 'inline' ? '600' : '400',
      /* Restore whichever side IS a version. Keying off the A side alone meant
         that swapping the two selects — a perfectly ordinary thing to do —
         removed the button rather than pointing it the other way. */
      diffCanRestore: dRestoreSide !== null && this.canWriteHistory(p),
      diffRestoreLabel: dRestoreSide ? this.labelOf(dRestoreSide) : '',
      diffRestore: () => { if (dRestoreSide) this.setState({ modal: { kind: 'restore', vid: dRestoreSide } }); },

      /* toast */
      hasToast: !!s.toast, toastMsg: s.toast || '', toastBottom: s.isMobile ? '86px' : '26px',

      /* mobile */
      showCommandBar: s.ready && s.route === 'app' && s.isMobile && !s.focusId,
      showFormatStrip: s.ready && s.route === 'app' && s.isMobile && !!s.focusId,
      commandBar: bar, formatTools: fmt,
      dismissKeyboard: (e) => { e.preventDefault(); const el = this._els[s.focusId]; if (el) el.blur(); this.setState({ focusId: null }); },
      hasSheet: !!s.sheet,
      closeSheet: () => this.setState({ sheet: null }),
      sheetTitle: sheetTitles[s.sheet] || '',
      sheetIsPages: s.sheet === 'pages', sheetIsSearch: s.sheet === 'search',
      sheetIsInsert: s.sheet === 'insert', sheetIsVersions: s.sheet === 'versions', sheetIsMore: s.sheet === 'more',
      sheetIsComments: s.sheet === 'comments',
      insertItems: CATALOG.map(c => ({
        name: c.name, glyph: c.glyph,
        run: () => { const bs = this.activeBlocks(); const last = bs[bs.length - 1]; this.insertOfType(s.focusId || (last && last.id), c.type); }
      })),
      moreItems: [
        /* On a phone this sheet is the only route to either of these — there is
           no ⌘Z to fall back on — and it offered neither. */
        { glyph: '↺', label: 'Undo', off: !this.canUndo(), color: this.canUndo() ? 'var(--text)' : 'var(--faint)',
          run: () => { this.undo(); this.setState({ sheet: null }); } },
        { glyph: '↻', label: 'Redo', off: !this.canRedo(), color: this.canRedo() ? 'var(--text)' : 'var(--faint)',
          run: () => { this.redo(); this.setState({ sheet: null }); } },
        { glyph: '💬', label: 'Comments', hint: String(this.commentCount() || ''), run: () => this.setState({ sheet: 'comments' }) },
        { glyph: '😀', label: p && p.icon ? 'Change page icon' : 'Add page icon', run: () => this.setState({ modal: { kind: 'emoji', target: 'page' }, sheet: null }) },
        { glyph: '↧', label: 'Copy as Markdown', run: () => { this.copyMarkdown(); this.setState({ sheet: null }); } },
        { glyph: '</>', label: s.prefs.sourceView ? 'Hide source' : 'Show markdown source', run: () => { this.toggleSource(); this.setState({ sheet: null }); } },
        { glyph: '🌐', label: 'Share', hint: sh.published ? 'Public' : 'Private', run: () => this.setState({ modal: { kind: 'share' }, sheet: null }) },
        { glyph: dark ? '☼' : '☾', label: dark ? 'Light theme' : 'Dark theme', run: () => { this.toggleTheme(); this.setState({ sheet: null }); } },
        { glyph: '⚙', label: 'Settings', run: () => this.setState({ route: 'settings', sheet: null }) },
        /* through trashPage, not a bare patchPage: only that route takes the
           subtree with it, strips the sub-page block that pointed here, and —
           on a database row page — carries the row into the Trash too */
        { glyph: '🗑', label: p && p.dbRef ? 'Move row to trash' : 'Move page to trash', color: 'var(--del-fg)',
          run: () => { this.setState({ sheet: null }); this.trashPage(s.pageId); } }
      ].map(x => Object.assign({ color: 'var(--text)', hint: '', off: false }, x))
    };
  }
}, 'part-menus');
