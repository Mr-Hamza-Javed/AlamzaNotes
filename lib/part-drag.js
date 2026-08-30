/* Alamza Notes — Drag & drop — one gesture, one measurement
 *
 * Methods of the app class, moved out verbatim. They run on the same
 * instance as everything in index.dc.html: `this.state`, `this.setState`,
 * `this.props` and every other method are all available here.
 * Registered onto Component.prototype by lib/parts.js.
 */
AlamzaParts.register(class {
  /* ---------------------------------------------------------------- drag
     One gesture, one measurement.

     The previous engine hit-tested the live DOM with elementFromPoint on every
     frame while it was also translating the cards. That is a feedback loop: a
     card slides out from under the pointer, the pointer lands on its
     neighbour, the insertion index flips, the card slides back — sixty times a
     second. Worse, a hovered card matched its own `:hover` rule, whose
     `transform: translateY(-2px)` is emitted with !important and outranks the
     inline transform, so gallery and board cards snapped home mid-drag.

     Now: layout is measured once, before anything moves, and every later
     decision is arithmetic over that snapshot. Scrolling is subtracted rather
     than re-measured, rows are made pointer-inert for the duration, and the
     drop reuses the very index the indicator was showing instead of
     re-resolving against a DOM that has just been reset. */
  rowGrab(dbId, rowId, e, viewId) {
    if (e.button !== 0) return;
    if (e.target.closest && (e.target.closest('input') || e.target.closest('select') || e.target.closest('a'))) return;
    e.preventDefault();
    this._rowMoved = false;

    const srcEl = e.currentTarget && e.currentTarget.closest
      ? e.currentTarget.closest('[data-dbrow]') : null;
    if (!srcEl) return;
    /* A sorted view renders its own order, so reordering the underlying array
       would be discarded the moment it re-rendered — the drag looked like it
       did nothing. Say so instead, once the pointer has actually moved, so a
       plain click still opens the row. */
    const sortedView = (() => {
      const d = this.state.dbs[dbId];
      const v = d && (d.views || []).find(x => x.id === viewId);
      return !!(v && (v.sorts || []).length);
    })();

    const srcBox = srcEl.getBoundingClientRect();
    /* which column the card was picked up FROM — a multi-select drop needs it
       to know which tag to remove */
    const srcCol = srcEl.closest && srcEl.closest('[data-dbgroup]');
    const fromKey = srcCol ? srcCol.getAttribute('data-dbgroup') : null;
    const grabX = e.clientX - srcBox.left, grabY = e.clientY - srcBox.top;
    const startX = e.clientX, startY = e.clientY;
    const root = srcEl.closest('[data-db]') || srcEl.parentElement;
    const EASE = 'cubic-bezier(.2,.9,.25,1)';

    let dragging = false, cancelled = false, ghost = null, raf = null;
    let lastX = startX, lastY = startY;
    let zone = null, index = -1, shownKey = '', shownX = 0, shownY = 0;

    /* a gallery flows cards left-to-right, so its seam is vertical */
    const isGrid = !!(srcEl.parentElement &&
      getComputedStyle(srcEl.parentElement).display === 'grid');

    /* the horizontal scroller a board or wide table lives in */
    let hScroll = srcEl.parentElement;
    while (hScroll && hScroll !== document.body) {
      const ov = getComputedStyle(hScroll).overflowX;
      if ((ov === 'auto' || ov === 'scroll') && hScroll.scrollWidth > hScroll.clientWidth + 2) break;
      hScroll = hScroll.parentElement;
    }
    if (hScroll === document.body) hScroll = null;
    const vScroll = this._scroll;
    const baseH = hScroll ? hScroll.scrollLeft : 0;
    const baseV = vScroll ? vScroll.scrollTop : 0;
    /* how far the content has slid under a pointer that has not moved */
    const ox = () => (hScroll ? baseH - hScroll.scrollLeft : 0);
    const oy = () => (vScroll ? baseV - vScroll.scrollTop : 0);

    /* ---- the snapshot: containers, their rows, and one spare slot each ---- */
    const boxOf = (n) => { const r = n.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
    const cols = root ? [...root.querySelectorAll('[data-dbgroup]')] : [];
    const holders = cols.length
      ? cols.map(c => {
          const f = c.querySelector('[data-dbrow]');
          return { el: (f && f.parentElement) || c.lastElementChild || c, group: c.getAttribute('data-dbgroup'), box: c };
        })
      : [{ el: srcEl.parentElement, group: null, box: srcEl.parentElement }];

    const zones = [];
    holders.forEach(h => {
      if (!h.el) return;
      const nodes = [...h.el.querySelectorAll('[data-dbrow]')];
      const rects = nodes.map(boxOf);
      const others = [], from = [];
      nodes.forEach((n, i) => { if (n !== srcEl) { others.push(n); from.push(i); } });
      let tail;
      if (rects.length) {
        const last = rects[rects.length - 1];
        const gx = rects.length > 1 ? Math.max(0, Math.round(rects[1].x - (rects[0].x + rects[0].w))) : 12;
        const gy = rects.length > 1 ? Math.max(0, Math.round(rects[1].y - (rects[0].y + rects[0].h))) : 6;
        if (isGrid) {
          const g = gx || 12;
          const right = h.el.getBoundingClientRect().right;
          tail = (last.x + last.w * 2 + g <= right + 1)
            ? { x: last.x + last.w + g, y: last.y, w: last.w, h: last.h }
            : { x: rects[0].x, y: last.y + last.h + g, w: last.w, h: last.h };
        } else tail = { x: last.x, y: last.y + last.h + gy, w: last.w, h: last.h };
      } else {
        const bx = boxOf(h.el);
        tail = { x: bx.x, y: bx.y, w: Math.max(60, bx.w), h: srcBox.height };
      }
      zones.push({
        group: h.group, nodes, rects, others, from,
        srcAt: nodes.indexOf(srcEl),
        slots: rects.concat([tail]),
        box: boxOf(h.box)
      });
    });
    const rootBox = root ? boxOf(root) : null;

    const line = document.createElement('div');
    line.style.cssText = 'position:fixed;border-radius:3px;background:var(--accent);z-index:999;pointer-events:none;opacity:0;transition:opacity .12s ease,left .13s ' + EASE + ',top .13s ' + EASE;
    const hi = document.createElement('div');
    hi.style.cssText = 'position:fixed;z-index:998;pointer-events:none;opacity:0;border-radius:6px;background:var(--accent-tint);box-shadow:inset 0 0 0 1.5px var(--accent);transition:opacity .12s ease';

    /* ---- where does the carried card belong, given a pointer? ---- */
    const resolve = (px, py) => {
      const dx = ox(), dy = oy();
      if (rootBox) {
        const l = rootBox.x + dx, t = rootBox.y + dy;
        if (px < l - 70 || px > l + rootBox.w + 70 || py < t - 70 || py > t + rootBox.h + 70) {
          zone = null; index = -1; return;
        }
      }
      let best = null, bestD = Infinity;
      zones.forEach(z => {
        const l = z.box.x + dx, t = z.box.y + dy;
        const cx = Math.max(l, Math.min(px, l + z.box.w));
        const cy = Math.max(t, Math.min(py, t + z.box.h));
        const d = Math.abs(px - cx) + Math.abs(py - cy);
        if (d < bestD) { bestD = d; best = z; }
      });
      if (!best) { zone = null; index = -1; return; }
      let k = best.others.length;
      for (let i = 0; i < best.others.length; i++) {
        const r = best.rects[best.from[i]], x = r.x + dx, y = r.y + dy;
        /* in a wrapping grid a card is "past" the pointer when its row is
           below the pointer, or it shares the row and its centre is to the
           right; in a column it is simply the first midpoint below. */
        const past = isGrid
          ? (py < y ? true : (py <= y + r.h ? px < x + r.w / 2 : false))
          : py < y + r.h / 2;
        if (past) { k = i; break; }
      }
      zone = best; index = k;
    };

    /* ---- open the gap: every card moves to the REAL slot it will settle in -- */
    const paint = () => {
      const dx = ox(), dy = oy();
      const key = zone ? (zone.group == null ? '_' : zone.group) + ':' + index : 'none';
      if (key === shownKey && dx === shownX && dy === shownY) return;
      shownKey = key; shownX = dx; shownY = dy;

      zones.forEach(z => {
        z.others.forEach((n, i) => {
          const a = z.rects[z.from[i]];
          const b = (z === zone && index >= 0) ? z.slots[i < index ? i : i + 1] : a;
          const tx = a && b ? Math.round(b.x - a.x) : 0;
          const ty = a && b ? Math.round(b.y - a.y) : 0;
          const want = (tx || ty) ? 'translate(' + tx + 'px,' + ty + 'px)' : '';
          if (n.__dbTr == null) {
            n.__dbTr = n.style.transition || '';
            if (n.__dbTr.indexOf('transform') < 0)
              n.style.transition = (n.__dbTr ? n.__dbTr + ',' : '') + 'transform .2s ' + EASE;
          }
          if (n.style.transform !== want) n.style.transform = want;
        });
      });

      const slot = zone && index >= 0 ? zone.slots[index] : null;
      if (!slot) line.style.opacity = '0';
      else {
        line.style.opacity = '1';
        if (isGrid) {
          line.style.width = '3px'; line.style.height = slot.h + 'px';
          line.style.left = (slot.x + dx - 7) + 'px'; line.style.top = (slot.y + dy) + 'px';
        } else {
          line.style.height = '3px'; line.style.width = slot.w + 'px';
          line.style.left = (slot.x + dx) + 'px'; line.style.top = (slot.y + dy - 4) + 'px';
        }
      }
      if (zone && zone.group != null) {
        hi.style.opacity = '1';
        hi.style.left = (zone.box.x + dx) + 'px'; hi.style.top = (zone.box.y + dy) + 'px';
        hi.style.width = zone.box.w + 'px'; hi.style.height = zone.box.h + 'px';
      } else hi.style.opacity = '0';
    };

    const move = (ev) => {
      if (!dragging) {
        if (Math.abs(ev.clientY - startY) + Math.abs(ev.clientX - startX) < 5) return;
        if (sortedView) {
          /* the gesture was a real drag, so it deserves an answer */
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          window.removeEventListener('keydown', onKey, true);
          this._rowMoved = true;
          setTimeout(() => { this._rowMoved = false; }, 80);
          this.toast('This view is sorted — switch Sort to “Manual” to drag rows');
          return;
        }
        dragging = true;
        document.body.classList.add('noSel', 'dbDrag');
        document.body.appendChild(hi);
        document.body.appendChild(line);
        ghost = srcEl.cloneNode(true);
        ghost.removeAttribute('data-dbrow');
        ghost.querySelectorAll('[data-dbrow]').forEach(n => n.removeAttribute('data-dbrow'));
        ghost.style.cssText += ';position:fixed;z-index:1000;pointer-events:none;margin:0;' +
          'width:' + srcBox.width + 'px;height:' + srcBox.height + 'px;opacity:.95;' +
          'left:' + srcBox.left + 'px;top:' + srcBox.top + 'px;' +
          'background:var(--surface);border:1px solid var(--border);border-radius:6px;' +
          'box-shadow:0 14px 30px rgba(15,15,15,.20),0 2px 6px rgba(15,15,15,.12);' +
          'transform:rotate(1.2deg) scale(1.02);transition:none;cursor:grabbing';
        document.body.appendChild(ghost);
        if (ghost.animate) ghost.animate(
          [{ transform: 'rotate(0deg) scale(1)', boxShadow: '0 0 0 rgba(15,15,15,0)' },
           { transform: 'rotate(1.2deg) scale(1.02)', boxShadow: '0 14px 30px rgba(15,15,15,.20)' }],
          { duration: 150, easing: EASE });
        srcEl.style.opacity = '0';
        document.body.style.cursor = 'grabbing';

        /* Keep scrolling while the pointer is HELD near an edge — a single
           mousemove step cannot reach a column that is off-screen. */
        const tick = () => {
          raf = requestAnimationFrame(tick);
          const PAD = 64, SPEED = 14;
          const VW = window.innerWidth, VH = window.innerHeight;
          if (hScroll) {
            const hr = hScroll.getBoundingClientRect();
            const l = Math.max(hr.left, 0), r = Math.min(hr.right, VW);
            if (lastX < l + PAD) hScroll.scrollLeft -= Math.max(4, (l + PAD - lastX) / PAD * SPEED);
            else if (lastX > r - PAD) hScroll.scrollLeft += Math.max(4, (lastX - (r - PAD)) / PAD * SPEED);
          }
          if (vScroll) {
            const vr = vScroll.getBoundingClientRect();
            const t = Math.max(vr.top, 0), b = Math.min(vr.bottom, VH);
            if (lastY < t + PAD) vScroll.scrollTop -= Math.max(4, (t + PAD - lastY) / PAD * SPEED);
            else if (lastY > b - PAD) vScroll.scrollTop += Math.max(4, (lastY - (b - PAD)) / PAD * SPEED);
          }
          resolve(lastX, lastY);
          paint();
        };
        tick();
      }
      lastX = ev.clientX; lastY = ev.clientY;
      if (ghost) {
        ghost.style.left = (ev.clientX - grabX) + 'px';
        ghost.style.top = (ev.clientY - grabY) + 'px';
      }
      resolve(lastX, lastY);
      paint();
    };

    const onKey = (ev) => { if (ev.key === 'Escape') { cancelled = true; up(null); } };

    const up = (ev) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('keydown', onKey, true);
      document.body.classList.remove('noSel', 'dbDrag');
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      if (!dragging) return;
      if (ev && ev.clientX != null) { lastX = ev.clientX; lastY = ev.clientY; }
      document.body.style.cursor = '';
      line.remove(); hi.remove();

      const z = cancelled ? null : zone;
      const k = cancelled ? -1 : index;

      /* Where every card is RIGHT NOW, mid-tween. The commit animates out of
         what the eye last saw, so nothing can jump between the gap closing and
         the new order rendering. */
      const seen = new Map();
      document.querySelectorAll('[data-dbrow]').forEach(n =>
        seen.set(n.getAttribute('data-dbrow'), n.getBoundingClientRect()));
      if (ghost) seen.set(rowId, ghost.getBoundingClientRect());
      if (ghost) { ghost.remove(); ghost = null; }

      zones.forEach(zz => zz.others.forEach(n => {
        n.style.transform = '';
        if (n.__dbTr != null) { n.style.transition = n.__dbTr; delete n.__dbTr; }
      }));
      srcEl.style.opacity = '';

      /* The drop is the index the indicator was showing — never a fresh
         hit-test against a DOM whose transforms have just been cleared. */
      let changed = false;
      if (z && k >= 0 && !(z.srcAt >= 0 && z.srcAt === k)) {
        let target = null;
        if (z.others.length) {
          const pick = k === 0 ? z.others[0] : z.others[k - 1];
          target = { id: pick.getAttribute('data-dbrow'), after: k !== 0 };
        }
        this._noFlip = true;
        const res = this.applyRowDrop(dbId, viewId, rowId, z.group, target, fromKey);
        this._noFlip = false;
        changed = res.moved || res.regrouped;
      } else if (z && z.group != null) {
        this._noFlip = true;
        changed = this.setRowGroup(dbId, viewId, rowId, z.group, fromKey);
        this._noFlip = false;
      }

      /* FLIP: from the last seen frame to the committed layout. */
      const flip = () => document.querySelectorAll('[data-dbrow]').forEach(n => {
        const id = n.getAttribute('data-dbrow');
        const a = seen.get(id);
        if (!a || !n.animate) return;
        const b = n.getBoundingClientRect();
        const dx = a.left - b.left, dy = a.top - b.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        const me = id === rowId;
        n.animate(
          me
            ? [{ transform: 'translate(' + dx + 'px,' + dy + 'px) rotate(1.2deg) scale(1.02)', boxShadow: '0 14px 30px rgba(15,15,15,.20)', zIndex: 5 },
               { transform: 'none', boxShadow: '0 0 0 rgba(15,15,15,0)', zIndex: 5 }]
            : [{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }],
          { duration: me ? 240 : 200, easing: EASE }
        );
      });
      if (changed) requestAnimationFrame(() => requestAnimationFrame(flip));
      else flip();

      this._rowMoved = true;
      setTimeout(() => { this._rowMoved = false; }, 80);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('keydown', onKey, true);
  }

  /* Every write to a database is animated: rows that move slide, rows that
     appear fade up. Rows that did not move are skipped, so a cell edit costs
     one measurement and nothing else. The drag runs its own FLIP out of the
     positions the pointer left behind, so it opts out with _noFlip. */
  patchDb(dbId, fn, noHist) {
    /* Guard, same as mutate(): patching a table whose rows have not arrived
       would serialise an empty row set over real data. */
    if (!this.rowsReady(dbId)) { this.ensureRows(dbId); return; }
    /* `true` marks these as a change this page is making, so the history files
       them — a database is shared, and a snapshot that differs only in its
       databases is otherwise taken to be someone else's work */
    if (!noHist) this.syncTail(true);
    const run = () => this.setState(s => {
      const dbs = { ...s.dbs };
      /* what each row looked like before, so the stamping below can tell which
         ones this mutation actually touched */
      const was = {};
      ((s.dbs[dbId] || {}).rows || []).forEach(r => { was[r.id] = JSON.stringify(r); });
      const d = JSON.parse(JSON.stringify(dbs[dbId]));
      fn(d);
      this.stampRows(d, was, s);
      dbs[dbId] = d;
      return { dbs };
    }, () => { this.persist(); if (!noHist) this.syncTail(true); });
    if (this._noFlip) run(); else this.flipRows(run, dbId);
  }
}, 'part-drag');
