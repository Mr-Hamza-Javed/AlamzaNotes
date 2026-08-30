/* Alamza Notes — Blocks — move, duplicate, convert, insert
 *
 * Methods of the app class, moved out verbatim. They run on the same
 * instance as everything in index.dc.html: `this.state`, `this.setState`,
 * `this.props` and every other method are all available here.
 * Registered onto Component.prototype by lib/parts.js.
 */
AlamzaParts.register(class {
  /* ------------------------------------------------------------- blocks */
  moveBlock(dragIds, targetId, after) {
    const ids = Array.isArray(dragIds) ? dragIds : [dragIds];
    if (!ids.length || ids.indexOf(targetId) >= 0) return;
    if (ids.some(id => this.isAncestor(id, targetId))) { this.toast('A block cannot be moved inside itself'); return; }
    this.mutate(bs => {
      const picked = [];
      ids.forEach(id => { const f = this.locate(id, bs); if (f) picked.push(f.list.splice(f.i, 1)[0]); });
      const t = this.locate(targetId, bs);
      if (!t) { bs.push.apply(bs, picked); return; }
      picked.forEach(b => { if (['ul', 'ol', 'todo'].indexOf(b.type) >= 0) b.indent = t.block.indent || 0; });
      t.list.splice(t.i + (after ? 1 : 0), 0, ...picked);
    });
    ids.forEach(id => this.flashBlock(id));
  }

  /* Pointer-driven block drag: floating ghost + animated insertion line. */
  startDrag(id, e) {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const rowEl = e.currentTarget.closest('[data-block]');
    const sel = this.state.blockSel || [];
    const group = sel.length > 1 && sel.indexOf(id) >= 0 ? sel.slice() : [id];
    const found = this.locate(id);
    const label = found ? (AMD.stripMarks(found.block.text) || CATALOG.filter(c => c.type === found.block.type).map(c => c.name)[0] || 'Block') : 'Block';
    const startX = e.clientX, startY = e.clientY;
    let moved = false, target = null;

    const ghost = document.createElement('div');
    ghost.textContent = group.length > 1 ? group.length + ' blocks' : label.slice(0, 64);
    ghost.style.cssText = 'position:fixed;left:0;top:0;z-index:220;pointer-events:none;padding:7px 13px;border-radius:5px;background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow);font-family:var(--ui);font-size:13.5px;font-weight:500;color:var(--text);max-width:340px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0;transform:translate(-24px,-50%) scale(.94) rotate(-1deg);transition:opacity .13s ease,transform .13s cubic-bezier(.22,.8,.3,1)';
    const line = document.createElement('div');
    line.style.cssText = 'position:fixed;left:0;top:0;z-index:219;height:3px;border-radius:3px;background:var(--accent);pointer-events:none;opacity:0;box-shadow:0 0 0 3px var(--accent-soft);transition:opacity .12s ease,transform .11s cubic-bezier(.22,.8,.3,1),width .11s ease';

    const move = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      if (!moved) {
        moved = true;
        document.body.appendChild(ghost); document.body.appendChild(line);
        document.body.style.cursor = 'grabbing';
        if (rowEl) { rowEl.style.transition = 'opacity .15s ease'; rowEl.style.opacity = '.35'; }
        requestAnimationFrame(() => { ghost.style.opacity = '1'; ghost.style.transform = 'translate(-24px,-50%) scale(1) rotate(-1deg)'; });
      }
      ghost.style.transform = 'translate(-24px,-50%) scale(1) rotate(-1deg)';
      ghost.style.left = ev.clientX + 'px';
      ghost.style.top = ev.clientY + 'px';
      /* auto-scroll when the pointer nears the edge of the document */
      const sc = this._scroll;
      if (sc) {
        const sr = sc.getBoundingClientRect();
        const pad = 70;
        if (ev.clientY < sr.top + pad) sc.scrollTop -= Math.max(4, (sr.top + pad - ev.clientY) / 3);
        else if (ev.clientY > sr.bottom - pad) sc.scrollTop += Math.max(4, (ev.clientY - (sr.bottom - pad)) / 3);
      }
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const row = el && el.closest ? el.closest('[data-block]') : null;
      if (!row || group.indexOf(row.getAttribute('data-bid')) >= 0) { line.style.opacity = '0'; target = null; return; }
      const rect = row.getBoundingClientRect();
      const after = ev.clientY > rect.top + rect.height / 2;
      target = { id: row.getAttribute('data-bid'), after };
      line.style.opacity = '1';
      line.style.width = Math.max(80, rect.width - 46) + 'px';
      line.style.transform = 'translate(' + (rect.left + 46) + 'px,' + ((after ? rect.bottom : rect.top) - 1.5) + 'px)';
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      document.body.style.cursor = '';
      if (rowEl) rowEl.style.opacity = '';
      if (moved) {
        ghost.style.opacity = '0'; ghost.style.transform = 'translate(-24px,-50%) scale(.9)';
        line.style.opacity = '0';
        setTimeout(() => { ghost.remove(); line.remove(); }, 160);
        if (target && target.id) this.moveBlock(group, target.id, target.after);
      } else {
        const r = rowEl ? rowEl.getBoundingClientRect() : { left: 60, top: 60 };
        this.setState({ menu: { kind: 'block', id, x: r.left + 46, y: r.top + 26, y0: r.top + 26, anchor: id, anchorTop: r.top } });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  }
  turnInto(id, type) {
    const spec = blockSpec(type);
    this.mutate(bs => {
      const f = this.locate(id, bs); if (!f) return;
      setBlockType(f.block, spec.type, spec.level);
      if (spec.type === 'code' && !f.block.lang) f.block.lang = 'plaintext';
      if (spec.type === 'callout' && !f.block.icon) f.block.icon = '💡';
      if (spec.type === 'toggle' && !f.block.children) f.block.children = [{ id: uid('b'), type: 'p', text: '', indent: 0 }];
    });
    const el = this._els[id]; if (el) el.__h = undefined;
    this.setState({ menu: null });
  }
  /* Duplicating a sub-page or a database copies the real thing, never the
     reference — two blocks pointing at one page was confusing. */
  duplicateBlock(id) {
    const src = this.locate(id);
    if (!src) return;
    const extra = { pages: null, dbs: null };
    const copy = JSON.parse(JSON.stringify(src.block));
    const rename = (b) => {
      b.id = uid('b');
      if (b.type === 'subpage' && this.state.pages[b.pageId]) {
        const orig = this.state.pages[b.pageId];
        const np = JSON.parse(JSON.stringify(orig));
        np.id = uid('p'); np.title = (orig.title || 'Untitled') + ' copy';
        np.versions = []; np.createdAt = np.updatedAt = Date.now();
        extra.pages = extra.pages || {}; extra.pages[np.id] = np;
        b.pageId = np.id;
      }
      if (b.type === 'database' && this.state.dbs[b.dbId] && this.state.dbs[b.dbId].rows) {
        const nd = JSON.parse(JSON.stringify(this.state.dbs[b.dbId]));
        nd.id = uid('db'); nd.name = (nd.name || 'Database') + ' copy';
        nd.rows.forEach(r => { r.id = uid('r'); delete r.pageId; });
        extra.dbs = extra.dbs || {}; extra.dbs[nd.id] = nd;
        b.dbId = nd.id;
      }
      (b.children || []).forEach(rename);
      (b.cols || []).forEach(c => c.forEach(rename));
    };
    rename(copy);
    if (extra.pages || extra.dbs) {
      this.setState(s => ({
        pages: extra.pages ? { ...s.pages, ...extra.pages } : s.pages,
        dbs: extra.dbs ? { ...s.dbs, ...extra.dbs } : s.dbs
      }));
    }
    this._fresh = this._fresh || {}; this._fresh[copy.id] = 1;
    this.mutate(bs => { const f = this.locate(id, bs); if (f) f.list.splice(f.i + 1, 0, copy); });
    this.setState({ menu: null });
  }
  insertOfType(afterId, rawType) {
    /* `toggle1`…`toggle3` name a heading toggle in the menus; from here down
       it is a toggle with a level, like every other one */
    const spec = blockSpec(rawType);
    const type = spec.type;
    if (type === 'subpage') {
      const pid = this.newPage(this.state.pageId, afterId);
      this.setState({ slash: null, sheet: null });
      return pid;
    }
    if (type === 'table') {
      this.setState({ slash: null, sheet: null });
      const nb = { id: uid('b'), type: 'table', text: '', indent: 0, rows: [['Column 1', 'Column 2', 'Column 3'], ['', '', ''], ['', '', '']] };
      this._fresh = this._fresh || {}; this._fresh[nb.id] = 1;
      this.mutate(bs => {
        const f = this.locate(afterId, bs);
        if (!f) { bs.push(nb); return; }
        f.list.splice(f.i + 1, 0, nb);
        if (!f.block.text && f.block.type === 'p') f.list.splice(f.i, 1);
      });
      return;
    }
    if (type === 'columns' || type === 'columns3') {
      const n = type === 'columns3' ? 3 : 2;
      const cols = [];
      for (let k = 0; k < n; k++) cols.push([{ id: uid('b'), type: 'p', text: '', indent: 0 }]);
      const nb = { id: uid('b'), type: 'columns', text: '', indent: 0, cols };
      this.setState({ slash: null, sheet: null });
      this.mutate(bs => {
        const f = this.locate(afterId, bs);
        if (!f) { bs.push(nb); return; }
        f.list.splice(f.i + 1, 0, nb);
        if (!f.block.text && f.block.type === 'p') f.list.splice(f.i, 1);
      });
      setTimeout(() => { const q = this._els[cols[0][0].id]; if (q) q.focus(); }, 40);
      return;
    }
    if (type === 'database') {
      const id = uid('db');
      const db = {
        id, name: 'New database',
        props: [
          { id: 'name', name: 'Name', type: 'text' },
          { id: 'created', name: 'Created', type: 'date' }
        ],
        pageHidden: [],
        views: [
          { id: uid('v'), name: 'All', type: 'list', filters: [], sorts: [], hidden: [] },
          { id: uid('v'), name: 'Table', type: 'table', filters: [], sorts: [], hidden: [] },
          { id: uid('v'), name: 'Gallery', type: 'card', filters: [], sorts: [], hidden: [] }
        ],
        rows: [
          { id: uid('r'), icon: '', cover: '', cells: { name: 'First item', created: new Date().toISOString().slice(0, 10) } }
        ]
      };
      this.setState(s => ({ dbs: { ...s.dbs, [id]: db }, slash: null, sheet: null }), () => {
        this.mutate(bs => {
          const f = this.locate(afterId, bs);
          const nb = { id: uid('b'), type: 'database', text: '', indent: 0, dbId: id };
          if (f) f.list.splice(f.i + 1, 0, nb); else bs.push(nb);
          if (f && !f.block.text && f.block.type === 'p') f.list.splice(f.i, 1);
        });
      });
      return;
    }
    const f = this.locate(afterId);
    if (f && f.block.type === 'p' && !(f.block.text || '').trim()) {
      this.mutate(bs => {
        const g = this.locate(afterId, bs); if (!g) return;
        setBlockType(g.block, type, spec.level); g.block.text = '';
        if (type === 'code') g.block.lang = 'plaintext';
        if (type === 'callout') g.block.icon = '💡';
        if (type === 'toggle') g.block.children = [{ id: uid('b'), type: 'p', text: '', indent: 0 }];
      });
      const el = this._els[afterId]; if (el) { el.innerHTML = ''; el.__h = undefined; }
      this.setState({ slash: null, sheet: null });
      setTimeout(() => { const e2 = this._els[afterId]; if (e2 && type !== 'divider') e2.focus(); }, 20);
      return;
    }
    this.setState({ slash: null, sheet: null });
    const nid = this.insertAfter(afterId, type);
    if (type === 'code' || type === 'callout' || type === 'toggle') setTimeout(() => this.mutate(bs => {
      const g = this.locate(nid, bs); if (!g) return;
      if (type === 'code') g.block.lang = 'plaintext';
      if (type === 'callout') g.block.icon = '💡';
      if (type === 'toggle') {
        g.block.children = [{ id: uid('b'), type: 'p', text: '', indent: 0 }];
        if (spec.level) g.block.level = spec.level;
      }
    }), 10);
  }
  slashKey(e) {
    const s = this.state.slash; if (!s) return;
    if (e.key === 'Escape') { e.preventDefault(); this.clearTrigger(s.id); this.setState({ slash: null }); return; }
    const items = s.kind === 'mention' ? this.mentionCatalog(s.q) : this.slashCatalog(s.q);
    if (!items.length) return;
    const i = Math.max(0, Math.min(items.length - 1, s.i || 0));
    /* The popup is 320px tall and scrolls, but moving the selection never moved
       the scroll with it — so past the sixth item the highlight walked out of
       sight and the arrow keys looked broken. It read worst on the wrap from
       last back to first, which looked like the selection sticking at the
       bottom: it HAD gone back to the top, 300px above the visible rows. */
    const step = (n) => this.setState({ slash: { ...s, i: n } }, () => this.scrollSlashIntoView());
    if (e.key === 'ArrowDown') { e.preventDefault(); step((i + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); step((i - 1 + items.length) % items.length); }
    else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (s.kind === 'mention') this.insertMention(s.id, items[i]);
      else { this.clearTrigger(s.id); this.insertOfType(s.id, items[i].type); }
    }
  }
  /* Keep the highlighted row visible. scrollIntoView() would also scroll the
     editor behind the popup (and the page on mobile), so move scrollTop by the
     smallest amount that brings the row inside the box. */
  scrollSlashIntoView() {
    const box = this._slashEl, s = this.state.slash;
    if (!box || !s) return;
    const row = box.querySelector('[data-slash-i="' + (s.i || 0) + '"]');
    if (!row) return;
    /* the first row scrolls fully to the top, so the section title above it is
       not left half-clipped when the selection wraps round from the last */
    if (!(s.i || 0)) { box.scrollTop = 0; return; }
    const top = row.offsetTop, bot = top + row.offsetHeight;
    if (top < box.scrollTop) box.scrollTop = Math.max(0, top - 6);
    else if (bot > box.scrollTop + box.clientHeight) box.scrollTop = bot - box.clientHeight + 6;
  }
  slashCatalog(q) {
    const t = (q || '').toLowerCase().trim();
    return CATALOG.filter(c => !t || c.name.toLowerCase().includes(t) || c.type.includes(t) || c.desc.toLowerCase().includes(t));
  }
  mentionCatalog(q) {
    const t = (q || '').toLowerCase().trim();
    return Object.values(this.state.pages)
      .filter(p => !p.trashed && p.id !== this.state.pageId)
      .filter(p => !t || (p.title || '').toLowerCase().includes(t))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 8);
  }
}, 'part-blocks');
