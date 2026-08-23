/* Alamza Notes — Editor — DOM sync, code blocks, typing, keys, paste
 *
 * Methods of the app class, moved out verbatim. They run on the same
 * instance as everything in index.dc.html: `this.state`, `this.setState`,
 * `this.props` and every other method are all available here.
 * Registered onto Component.prototype by lib/parts.js.
 */
AlamzaParts.register(class {
  /* ------------------------------------------------------------ dom sync */
  /* Only blocks near the viewport need their innerHTML rebuilt. On a long
     document this is the difference between a smooth caret and a locked tab. */
  nearView(el) {
    const sc = this._scroll;
    if (!sc) return true;
    const r = el.getBoundingClientRect();
    const v = sc.getBoundingClientRect();
    const pad = 1200;
    return r.bottom > v.top - pad && r.top < v.bottom + pad;
  }

  syncDom() {
    const p = this.page();
    if (this._titleEl && p && document.activeElement !== this._titleEl) {
      const t = this.state.roVersion ? (this.versionById(this.state.roVersion) || p).title : p.title;
      if (this._titleEl.textContent !== (t || '')) this._titleEl.textContent = t || '';
    }
    const index = {};
    (function walk(list) {
      (list || []).forEach(b => {
        index[b.id] = b;
        if (b.children) walk(b.children);
        if (b.cols) b.cols.forEach(walk);
      });
    })(this.activeBlocks());
    /* Undo, restore, a language switch or any other model-side change lands
       here. This runs before the block loop because that loop can bail early
       when it defers off-screen work, and a stale gutter must never be the
       thing that gets skipped. */
    Object.keys(this._gutEls).forEach(id => {
      const g = this._gutEls[id];
      if (!g || !g.isConnected) { delete this._gutEls[id]; return; }
      const b = index[id]; if (b) this.paintGutter(id, b.text || '');
    });
    const deferred = [];
    Object.keys(this._els).forEach(id => {
      const el = this._els[id]; if (!el || !el.isConnected) { delete this._els[id]; return; }
      const b = index[id]; if (!b) return;
      /* a code block mid-edit belongs to the debounced highlighter; repainting
         it here would fight the caret */
      if (el.__dirty) return;
      const focused = document.activeElement === el;
      const html = this.blockHtml(b, focused);
      if (el.__h === html) return;
      /* far-off blocks are repainted when the browser is idle, so a long
         document never blocks the frame the caret lives in */
      if (!focused && !this.nearView(el)) { deferred.push([el, html]); return; }
      const off = focused ? caretOffset(el) : null;
      el.innerHTML = html; el.__h = html;
      if (focused && off != null) setCaret(el, off);
    });
    if (deferred.length) {
      const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 32));
      if (this._defT) return;
      this._defT = idle(() => {
        this._defT = null;
        deferred.forEach(([el, html]) => { if (el.isConnected && el.__h !== html) { el.innerHTML = html; el.__h = html; } });
      });
    }
    if (this._publicEl && this._publicEl.isConnected) {
      const p2 = this.page();
      const key = this.state.pageId + ':' + (p2 ? (p2.blocks || []).length : 0) + ':' + (p2 ? p2.updatedAt : 0);
      if (this._publicEl.__k !== key) { this._publicEl.__k = key; this._publicEl.innerHTML = this.readHtml(p2 ? p2.blocks : []); }
    }
    Object.keys(this._mathEls).forEach(id => {
      const el = this._mathEls[id]; if (!el || !el.isConnected) { delete this._mathEls[id]; return; }
      const b = index[id]; if (!b || el.__t === b.text) return;
      el.__t = b.text;
      try { window.katex.render(b.text || 'x', el, { displayMode: true, throwOnError: false }); }
      catch (e) { el.textContent = b.text; }
    });
  }

  blockHtml(b, focused) {
    const src = this.state.prefs.sourceView;
    /* Code stays coloured while you are inside it. It used to fall back to
       plain text on focus so the DOM could be read back as source; domText
       reads the highlighted DOM exactly, so that trade is gone. The result is
       memoised per block — syncDom asks for this on every state change, and a
       5000-line file must not be re-tokenised because a menu opened. */
    if (b.type === 'code') {
      const code = b.text || '';
      const lang = b.lang || 'plaintext';
      const m = this._hlMemo[b.id];
      if (m && m.t === code && m.l === lang) return m.h;
      let out;
      /* past ~120k characters tokenising costs more than the colour is worth */
      if (!window.hljs || code.length > 120000) out = AMD.esc(code);
      else {
        try { out = window.hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; }
        catch (e) { out = AMD.esc(code); }
      }
      if (code.charCodeAt(code.length - 1) === 10) out += '<br>';
      this._hlMemo[b.id] = { t: code, l: lang, h: out };
      return out;
    }
    if (b.type === 'math') return AMD.esc(b.text || '');
    let html = AMD.inline(b.text || '', src);
    /* inline $…$ is rendered only while the block is NOT being edited, so the
       DOM the editor reads back is always the exact markdown source */
    /* R6 — "$303 billion" is money, not maths. Only treat $…$ as an equation
       when it actually looks like LaTeX: no padding spaces, and at least one
       TeX construct (\command, ^, _, {}, or a fraction slash). */
    if (!focused && !src && window.katex && /\$[^$\n]+\$/.test(b.text || '')) {
      html = html.replace(/\$([^$\n]+)\$/g, (m0, tex) => {
        if (/^\s|\s$/.test(tex)) return m0;
        if (!/[\\^_{}]/.test(tex)) return m0;
        if (/^\d[\d,. ]*$/.test(tex)) return m0;
        try { return '<span style="display:inline-block;vertical-align:baseline">' + window.katex.renderToString(tex, { throwOnError: false }) + '</span>'; }
        catch (e) { return m0; }
      });
    }
    return html;
  }

  /* `sc-for` keys its rows by INDEX, so when a row leaves the middle of the
     list React hands the same editable element to whichever block now sits at
     that position. React detaches the old ref before attaching the new one —
     and this used to ignore the detach, which left `_els` pointing two block
     ids at one element. syncDom then painted that element twice, once per id,
     and the last write won: collapsing a toggle blanked the paragraph BELOW
     it, because the toggle's hidden child and that paragraph were sharing a
     node. Letting go on detach is the whole fix; the id that still owns the
     element re-registers on the same commit. */
  elRef(id) {
    if (!this._refs[id]) this._refs[id] = (el) => {
      if (!el) { if (this._els[id]) delete this._els[id]; return; }
      this._els[id] = el; el.__h = undefined;
      if (this._fresh && this._fresh[id]) {
        delete this._fresh[id];
        const host = el.closest('[data-block]') || el;
        if (host.animate) host.animate(
          [{ opacity: 0, transform: 'translateY(-5px)' }, { opacity: 1, transform: 'none' }],
          { duration: 190, easing: 'cubic-bezier(.22,.8,.3,1)' }
        );
      }
    };
    return this._refs[id];
  }
  mathRef(id) {
    if (!this._mathRefs[id]) this._mathRefs[id] = (el) => { if (el) { this._mathEls[id] = el; el.__t = undefined; } };
    return this._mathRefs[id];
  }
  /* The gutter has exactly one owner: this code. React renders the span empty
     and never writes its text, because two writers to one node desynchronise
     React's record of it — after an imperative write React compares against a
     value that is no longer there, decides nothing changed, and the gutter
     stays stale for good (paste, undo, and the count was wrong forever). */
  gutRef(id) {
    if (!this._gutRefs[id]) this._gutRefs[id] = (el) => {
      if (!el) { delete this._gutEls[id]; return; }
      this._gutEls[id] = el;
      const f = this.locate(id);
      if (f) this.paintGutter(id, f.block.text || '');
    };
    return this._gutRefs[id];
  }

  /* ------------------------------------------------- code block plumbing
     Typing in a code block must not re-render anything: no setState, no
     innerHTML rewrite, no markdown pass. The model is updated in place, the
     gutter is one text node write, and the colour catches up on a debounce. */
  paintGutter(id, text) {
    const g = this._gutEls[id]; if (!g) return;
    const s = lineNoStr(text);
    /* compared against the live node, never a cached copy that could itself
       be the thing that has drifted */
    if (g.textContent !== s) g.textContent = s;
  }
  afterEdit(id, text) {
    const el = this._els[id];
    if (el) codeFiller(el, text);
    this.paintGutter(id, text);
    /* Re-tokenising is the one expensive thing left, so the longer the file
       the longer we wait for a pause before doing it. Nothing is lost by
       waiting: the text is already correct, only its colour is behind. */
    clearTimeout(this._hlT);
    this._hlT = setTimeout(() => this.highlightNow(id), Math.min(600, 130 + text.length / 400));
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => this.readBlock(id), 300);
    clearTimeout(this._histT);
    this._histT = setTimeout(() => this.syncTail(), 900);
  }
  highlightNow(id) {
    clearTimeout(this._hlT);
    const el = this._els[id]; if (!el || !el.isConnected) return;
    const f = this.locate(id);
    if (!f || f.block.type !== 'code') { el.__dirty = false; return; }
    const html = this.blockHtml(f.block, true);
    if (el.__h !== html) {
      const focused = document.activeElement === el;
      const off = focused ? caretOffset(el) : null;
      el.innerHTML = html; el.__h = html;
      if (off != null) setCaret(el, off);
    }
    el.__dirty = false;
  }
  /* insert literal text at the caret and keep the model in step */
  codeEdit(id, str) {
    const el = this._els[id]; if (!el) return;
    insertRaw(el, str);
    const text = domText(el);
    const f = this.locate(id); if (f) f.block.text = text;
    el.__h = undefined; el.__dirty = true;
    this.afterEdit(id, text);
  }
  /* replace the whole body — used where an edit is not a plain insertion */
  setCodeText(id, text, caret) {
    const el = this._els[id]; if (!el) return;
    const f = this.locate(id); if (f) f.block.text = text;
    const html = this.blockHtml(f ? f.block : { id, type: 'code', text }, true);
    el.innerHTML = html; el.__h = html; el.__dirty = false;
    this.paintGutter(id, text);
    if (caret != null) setCaret(el, caret);
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => this.readBlock(id), 300);
    clearTimeout(this._histT);
    this._histT = setTimeout(() => this.syncTail(), 900);
  }

  /* ------------------------------------------------------------ editing */
  /* The debounced write behind every keystroke.

     Its guard used to be `f.block.text === text`, which reads correctly and
     never once fired: onInput writes the model on the way past, so by the time
     this ran the two were always equal and `persist()` was skipped every
     time. Typing alone therefore never reached storage — the text only got
     there when some OTHER edit (⏎, Tab, a menu, a checkbox) wrote the page,
     which is exactly why the loss stayed hidden: almost every session
     contains one. Type a sentence, close the tab, and it was gone.

     So compare against what was last SAVED. The model is not evidence of
     anything here — this is the code that puts the text into it. */
  readBlock(id) {
    const el = this._els[id]; if (!el) return;
    const f = this.locate(id); if (!f) return;
    const multi = f.block.type === 'code' || f.block.type === 'math';
    const text = multi ? domText(el) : el.textContent;
    if (el.__saved === text) return;
    f.block.text = text;
    el.__saved = text;
    const p = this.page();
    if (p) { p.updatedAt = Date.now(); p.updatedBy = (this.state.user && this.state.user.name) || 'You'; }
    this.persist(); // no setState: typing must never re-render the document
  }

  /* Replace a focused block's text: model, DOM and caret in one step, at the
     cost of a keystroke rather than a render. `mutate` would be wrong here —
     it deep-clones the document, repaints every block and files an undo entry
     per keystroke, so held-down ⌫ would fill the history with single
     characters. This is the same deal onInput makes: write through, save on a
     debounce, and let the history catch up during the next pause. */
  editText(id, text, caret) {
    const el = this._els[id]; if (!el) return;
    const f = this.locate(id);
    if (f) f.block.text = text;
    const html = this.blockHtml(f ? f.block : { id, type: 'p', text }, true);
    el.innerHTML = html; el.__h = html; el.__saved = text;
    if (caret != null) setCaret(el, caret);
    const p = this.page();
    if (p) { p.updatedAt = Date.now(); p.updatedBy = (this.state.user && this.state.user.name) || 'You'; }
    this.persist();
    clearTimeout(this._histT);
    this._histT = setTimeout(() => this.syncTail(), 900);
  }

  onInput(id) {
    const el = this._els[id]; if (!el) return;
    const f = this.locate(id);
    const bt = f ? f.block.type : 'p';

    /* A code or equation block is literal text. No markdown shortcut, no slash
       menu (a `/usr/bin` path used to open the block picker), and above all no
       innerHTML rewrite per keystroke: the old path ran highlight.js, rebuilt
       the element and restored the caret on every character, which is what
       made a large block crawl. Here a keystroke costs one DOM read. */
    if (bt === 'code' || bt === 'math') {
      el.__dirty = true; el.__h = undefined;
      /* key-repeat and IME can fire several input events inside one frame;
         reading the DOM once per frame caps the cost no matter how fast the
         events arrive */
      if (this._readRaf) return;
      this._readRaf = requestAnimationFrame(() => {
        this._readRaf = 0;
        const e2 = this._els[id]; if (!e2) return;
        const t = domText(e2);
        const g = this.locate(id); if (g) g.block.text = t;
        this.afterEdit(id, t);
      });
      return;
    }

    const prev = f ? (f.block.text || '') : '';
    let text = el.textContent;
    let forced = null;

    /* ---- put the typed character where the reader aimed it ---------------
       A `display:none` span has no caret position inside it, so the caret we
       park after a finished run does not survive: the browser slides it back
       to the last VISIBLE spot, which is inside the run. Everything typed
       next then landed inside the delimiters — `**bold**` plus a space came
       back as `**bold more**`, the whole phrase bold, and the same slide made
       ⏎ split at an offset no reader could see.

       We know where we put the caret (`_want`), and we can see where the
       browser actually inserted. When the only thing between those two
       offsets is invisible, they are the SAME place on screen and the
       character simply landed on the wrong side of a marker: move it back.
       When the reader has genuinely moved the caret — a click, an arrow, any
       key that is not a plain character — `_want` is dropped, so real edits
       inside a bold word still extend it.

       And the caret is never READ BACK from the browser here, only derived
       from the insertion itself. By the time this runs the slide has already
       happened, so asking where the caret is returns the wrong side of the
       run — which is how the parked position came to be wrong to begin with:
       the keystroke that closed `**bold**` reported 7 of 8, already inside
       its own closing delimiters. An insertion of n characters at p puts the
       caret at p + n, and that is not a matter of opinion. */
    const w = this._want;
    if (text.length > prev.length) {
      let p = 0;
      while (p < prev.length && prev.charCodeAt(p) === text.charCodeAt(p)) p++;
      const n = text.length - prev.length;
      if (prev.slice(p) === text.slice(p + n)) {
        if (w && w.id === id && w.off != null && p !== w.off && AMD.hiddenBetween(prev, p, w.off)) {
          text = prev.slice(0, w.off) + text.slice(p, p + n) + prev.slice(w.off);
          forced = w.off + n;
        } else if (p > 0 && AMD.hiddenBetween(prev, 0, p)) {
          /* Same reasoning at the other edge, and it needs no `_want`: if
             EVERYTHING before the insertion is invisible, the reader was
             standing at column 0 — `Home` in `**bold** tail` cannot park a
             caret before the hidden `**`, so the browser slid it to 2 and the
             next character came back bold, as `**Xbold**`. Nothing sits left
             of column 0 for formatting to be inherited from, so the character
             belongs outside the run, which is what every editor does. */
          text = text.slice(p, p + n) + prev;
          forced = n;
        } else forced = p + n;
      }
    }

    if (f) f.block.text = text;
    el.__h = el.innerHTML;
    if (/^([#>\-*[$`|]|\d+[.)]\s|---|```)/.test(text) && this.tryShortcut(id, text, forced)) { this._want = null; return; }

    /* `/` and `@` triggers work anywhere in the line, not just at position 0 */
    /* R10 — render completed inline markdown the instant it is typed, exactly
       as the block-level shortcuts already do. syncDom would only catch this
       after the debounced save, which felt broken. */
    const want = this.blockHtml(f ? f.block : { text }, true);
    const at = forced != null ? forced : caretOffset(el);
    if (want !== el.innerHTML) {
      el.innerHTML = want; el.__h = want;
      if (at != null) setCaret(el, at);
    }
    this._want = { id, off: at };

    const off = caretOffset(el);
    const before = text.slice(0, off == null ? text.length : off);
    const trig = before.match(/(^|\s)([\/@])([^\s\/@]*)$/);
    if (trig && el) {
      const kind = trig[2] === '/' ? 'block' : 'mention';
      const from = before.length - trig[3].length - 1;
      const rect = this.caretRect(el);
      const host = el.closest ? el.closest('[data-block]') : null;
      const cur = this.state.slash;
      const keep = cur && cur.id === id;
      this.setState({
        slash: {
          id, kind, q: trig[3], from, i: keep ? (cur.i || 0) : 0,
          x: keep ? cur.x : rect.left,
          y: keep ? cur.y : rect.bottom + 6,
          y0: keep ? cur.y0 : rect.bottom + 6,
          anchor: id, anchorTop: keep ? cur.anchorTop : (host ? host.getBoundingClientRect().top : rect.top)
        }
      });
    } else if (this.state.slash) this.setState({ slash: null });

    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => this.readBlock(id), 260);
    clearTimeout(this._histT);
    this._histT = setTimeout(() => this.syncTail(), 900);
  }

  caretRect(el) {
    const s = window.getSelection();
    if (s && s.rangeCount) {
      const r = s.getRangeAt(0).cloneRange(); r.collapse(true);
      const rects = r.getClientRects();
      if (rects.length) return rects[0];
    }
    return el.getBoundingClientRect();
  }

  /* remove the "/query" or "@query" the user typed before inserting */
  clearTrigger(id) {
    const sl = this.state.slash; if (!sl || sl.id !== id) return;
    const el = this._els[id]; if (!el) return;
    const text = el.textContent;
    const next = text.slice(0, sl.from) + text.slice(sl.from + 1 + sl.q.length);
    const f = this.locate(id); if (f) f.block.text = next;
    el.innerHTML = this.blockHtml(f ? f.block : { text: next }, true);
    el.__h = el.innerHTML;
    setCaret(el, sl.from);
  }

  insertMention(id, page) {
    const sl = this.state.slash;
    const el = this._els[id];
    if (!el || !sl) return;
    const text = el.textContent;
    const link = '[' + (page.icon ? page.icon + ' ' : '') + (page.title || 'Untitled') + '](#/page/' + page.id + ')';
    const next = text.slice(0, sl.from) + link + text.slice(sl.from + 1 + sl.q.length);
    this.setState({ slash: null });
    this.mutate(bs => { const g = this.locate(id, bs); if (g) g.block.text = next; });
    setTimeout(() => { const q = this._els[id]; if (q) { q.focus(); setCaret(q, sl.from + link.length); } }, 25);
  }

  /* `caret` is where the reader was when the shortcut fired — one past the
     space they just typed. The prefix is about to be removed, so the caret
     belongs that many characters further left, NOT at the end of the line:
     typing `# ` in front of an existing "Hello world" made the heading but
     threw the caret to column 11, and everything typed next went to the back
     of the line the reader was standing at the front of. */
  tryShortcut(id, text, caret) {
    const keep = (rest) => {
      const c = caret == null ? text.length : caret;
      return Math.max(0, Math.min(rest.length, c - (text.length - rest.length)));
    };
    /* ---- `#` inside a toggle sets the TOGGLE's heading level -------------
       Falling through to the map below would turn the block into a plain
       heading, which drops its children on the floor — a toggle is the one
       block whose contents are inside it. One to three hashes pick the level,
       and any of the three can be swapped for any other at any time. Past
       three there is no heading to mean, so nothing happens and the text
       stays exactly as typed. */
    const f0 = this.locate(id);
    if (f0 && f0.block.type === 'toggle') {
      const h = /^(#{1,3})\s/.exec(text);
      if (h) {
        const rest = text.slice(h[0].length), lvl = h[1].length;
        this.mutate(bs => {
          const g = this.locate(id, bs); if (!g) return;
          g.block.level = lvl; g.block.text = rest;
        });
        const el0 = this._els[id]; if (el0) { el0.innerHTML = ''; el0.__h = undefined; }
        this.setState({ slash: null });
        setTimeout(() => { const e2 = this._els[id]; if (e2) { e2.focus(); setCaret(e2, keep(rest)); } }, 10);
        return true;
      }
    }
    const map = [
      [/^#\s/, 'h1'], [/^##\s/, 'h2'], [/^###\s/, 'h3'],
      [/^[-*]\s/, 'ul'], [/^\d+[.)]\s/, 'ol'], [/^\[\]\s/, 'todo'], [/^\[x\]\s/i, 'todo'],
      [/^>\s/, 'quote'], [/^```$/, 'code'], [/^\$\$$/, 'math'], [/^---$/, 'divider'], [/^\|\s/, 'callout']
    ];
    for (const [re, type] of map) {
      if (re.test(text)) {
        const rest = text.replace(re, '');
        this.mutate(bs => {
          const f = this.locate(id, bs); if (!f) return;
          f.block.type = type; f.block.text = type === 'divider' ? '' : rest;
          if (type === 'code') f.block.lang = 'plaintext';
          if (type === 'callout') f.block.icon = '💡';
          if (/^\[x\]/i.test(text)) f.block.checked = true;
        });
        const el = this._els[id]; if (el) { el.innerHTML = ''; el.__h = undefined; }
        this.setState({ slash: null });
        if (type === 'divider') setTimeout(() => this.insertAfter(id, 'p'), 10);
        else setTimeout(() => { const e2 = this._els[id]; if (e2) { e2.focus(); setCaret(e2, keep(rest)); } }, 10);
        return true;
      }
    }
    return false;
  }

  insertAfter(id, type) {
    const nb = { id: uid('b'), type: type || 'p', text: '', indent: 0 };
    this._fresh = this._fresh || {}; this._fresh[nb.id] = 1;
    this.mutate(bs => {
      const f = this.locate(id, bs);
      if (!f) { bs.push(nb); return; }
      nb.indent = f.block.indent || 0;
      /* "Below" an OPEN toggle is inside it. The gutter's ＋ sits beside the
         toggle's own title, so the line it opens has to appear right under
         that title — putting it after the toggle dropped it below all the
         contents instead, far from the button that was clicked, and it then
         did not collapse with them. A closed toggle has no inside on show, so
         there the next line is a sibling, as it looks. */
      if (f.block.type === 'toggle' && !f.block.collapsed) {
        nb.indent = 0;
        f.block.children = f.block.children || [];
        f.block.children.unshift(nb);
        return;
      }
      f.list.splice(f.i + 1, 0, nb);
    });
    setTimeout(() => { const el = this._els[nb.id]; if (el) el.focus(); }, 20);
    return nb.id;
  }

  removeBlock(id) {
    /* Removing a sub-page block sends the page to Trash rather than orphaning
       it — the only route to deleting a note (R1, R8). */
    const f0 = this.locate(id);
    if (f0 && f0.block.type === 'subpage' && this.state.pages[f0.block.pageId]) {
      this.trashPage(f0.block.pageId);
      return;
    }
    let prev = null;
    this.mutate(bs => {
      const f = this.locate(id, bs); if (!f) return;
      prev = f.i > 0 ? f.list[f.i - 1] : null;
      f.list.splice(f.i, 1);
      if (!bs.length) bs.push({ id: uid('b'), type: 'p', text: '', indent: 0 });
    });
    delete this._els[id];
    if (prev) setTimeout(() => { const el = this._els[prev.id]; if (el) { el.focus(); setCaret(el, (prev.text || '').length); } }, 20);
  }

  onKey(id, e) {
    const el = this._els[id]; const f = this.locate(id); if (!f) return;
    const b = f.block;
    const multi = b.type === 'code' || b.type === 'math';
    const text = el ? (multi ? domText(el) : el.textContent) : '';
    const off = el ? caretOffset(el) : 0;
    const mod = e.metaKey || e.ctrlKey;
    /* Anything that is not a plain character is the reader moving or editing
       deliberately, so the caret we parked on the last keystroke stops being
       evidence of where they are aiming. */
    if (mod || e.key.length !== 1) this._want = null;
    /* Where the READER sees this block starting and ending. Not the same as
       offset 0 and text.length: §5.1 keeps the delimiters in the DOM, and
       typing `**bold**` parks the caret between the two closing asterisks —
       inside a display:none span, visually at the end of the line. Computed
       once, lazily, and only for blocks that are markdown at all; code and
       equations hold literal text. */
    let _marks;
    const allHidden = (from, to) => {
      if (multi) return false;
      if (_marks === undefined) _marks = AMD.markMap(text);
      for (let k = from; k < to; k++) if (!_marks[k]) return false;
      return from < to;
    };
    const atVisualStart = () => off === 0 || allHidden(0, off);
    const atVisualEnd = () => off === text.length || allHidden(off, text.length);
    if (this.state.slash && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) { this.slashKey(e); return; }

    /* move / duplicate / delete the block itself */
    if (mod && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault(); this.readBlock(id);
      const rows = this.flat().map(r => r.id);
      const i = rows.indexOf(id), j = i + (e.key === 'ArrowDown' ? 1 : -1);
      if (j >= 0 && j < rows.length) { this.moveBlock(id, rows[j], e.key === 'ArrowDown'); setTimeout(() => { const q = this._els[id]; if (q) q.focus(); }, 40); }
      return;
    }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); this.readBlock(id); this.duplicateBlock(id); return; }
    if (mod && e.shiftKey && e.key === 'Backspace') { e.preventDefault(); this.removeBlock(id); return; }

    /* Enter inside a literal block. Left to the browser it produced a <div>
       or a <br>, which then read back as no break at all. Insert the newline
       ourselves, carry the current line's indentation, and step in one level
       after an opening bracket. ⇧⏎ / ⌘⏎ escape the block instead. */
    if (e.key === 'Enter' && multi) {
      e.preventDefault();
      if (e.shiftKey || mod) {
        this.readBlock(id);
        const nid = this.insertAfter(id, 'p');
        setTimeout(() => { const q = this._els[nid]; if (q) { q.focus(); setCaret(q, 0); } }, 25);
        return;
      }
      const line = text.slice(0, off).split('\n').pop();
      let pad = (/^[ \t]*/.exec(line) || [''])[0];
      if (b.type === 'code' && /[{([]\s*$/.test(line)) pad += '  ';
      this.codeEdit(id, '\n' + pad);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && b.type !== 'code' && b.type !== 'math') {
      e.preventDefault(); this.readBlock(id);
      if (['ul', 'ol', 'todo'].includes(b.type) && !text.trim()) {
        this.mutate(bs => { const g = this.locate(id, bs); if (g) { g.block.type = 'p'; g.block.indent = 0; g.block.checked = false; } });
        return;
      }
      /* ---- getting OUT of a toggle -------------------------------------
         A toggle used to be a one-way door. Enter on its title called focus on
         `children[0]`, so a toggle with no children yet consumed the key and
         did nothing at all; and once inside, Enter only ever made more
         children, with no keystroke that climbed back out. Three exits: */

      /* 1. An empty title over empty contents is not a toggle anyone wants —
            the same escape ⏎ already gives an empty list item. "Empty" has to
            mean "nothing written inside", not "no children": repair() keeps one
            blank child on every toggle, so a length check alone would never be
            true and this exit would be dead code. */
      if (b.type === 'toggle' && !text.trim()
          && !(b.children || []).some(c => (c.text || '').trim() || c.children || c.cols)) {
        this.mutate(bs => { const g = this.locate(id, bs); if (g) { setBlockType(g.block, 'p'); g.block.indent = 0; delete g.block.children; delete g.block.collapsed; } });
        return;
      }
      /* 2. a titled toggle with nothing inside opens a first child to type in,
            rather than swallowing the keystroke */
      if (b.type === 'toggle') {
        let kid = (b.children || [])[0];
        if (!kid) {
          kid = { id: uid('b'), type: 'p', text: '', indent: 0 };
          this._fresh = this._fresh || {}; this._fresh[kid.id] = 1;
        }
        this.mutate(bs => {
          const g = this.locate(id, bs); if (!g) return;
          g.block.collapsed = false;
          g.block.children = g.block.children || [];
          if (!g.block.children.some(c => c.id === kid.id)) g.block.children.push(kid);
        });
        setTimeout(() => { const q = this._els[kid.id]; if (q) { q.focus(); setCaret(q, (kid.text || '').length); } }, 30);
        return;
      }
      /* 3. ⏎ on an empty last child climbs out and lands after the toggle —
            the way ⏎ on an empty list item leaves the list */
      const own = this.locate(id);
      if (own && own.parent && own.parent.type === 'toggle' && !text.trim()
          && own.i === own.list.length - 1) {
        const tgId = own.parent.id;
        this._fresh = this._fresh || {}; this._fresh[id] = 1;
        this.mutate(bs => {
          const g = this.locate(id, bs); if (!g || !g.parent) return;
          const moved = g.list.splice(g.i, 1)[0];
          moved.type = 'p'; moved.indent = 0; moved.text = '';
          const t = this.locate(tgId, bs);
          if (t) t.list.splice(t.i + 1, 0, moved); else bs.push(moved);
        });
        setTimeout(() => { const q = this._els[id]; if (q) { q.focus(); setCaret(q, 0); } }, 30);
        return;
      }
      const type = ['ul', 'ol', 'todo'].includes(b.type) ? b.type : 'p';
      /* Splitting inside a **bold** or ==marked== run would leave one half of
         each delimiter pair on either side, so both blocks lose their
         formatting and show raw tags. Close the open runs at the cut and
         reopen them on the new block. */
      /* snapOut first: the browser parks the caret INSIDE the closing
         delimiters of a run it has just finished, and splitting there tore
         the pair in half — `**bold**` became `**bold***` above `*…**` */
      const cut = AMD.splitMarked(text, AMD.snapOut(text, off));
      const head = cut.head, tail = cut.tail;
      const nb = { id: uid('b'), type, text: tail, indent: b.indent || 0 };
      this._fresh = this._fresh || {}; this._fresh[nb.id] = 1;
      this.mutate(bs => {
        const g = this.locate(id, bs); if (!g) return;
        g.block.text = head;
        g.list.splice(g.i + 1, 0, nb);
      });
      setTimeout(() => { const q = this._els[nb.id]; if (q) { q.focus(); setCaret(q, 0); } }, 25);
      return;
    }
    /* ---- ⌃/⌥ + ⌫ or ⌦ removes a whole word ----------------------------
       The browser's own word delete cannot be trusted next to a hidden
       delimiter — it takes the `display:none` span away with the character
       beside it, the same fault a single ⌫ had — and it counts delimiters as
       letters, so it stopped in the middle of a run. Our own delimiter-aware
       branch below then made this worse in the other direction: it took the
       key and removed exactly ONE character, so in any formatted block the
       shortcut looked broken. The boundary is measured on what the reader
       sees and the deletion is that many single steps, so an emptied run
       drops its delimiters by the rule one keystroke already follows. */
    if ((e.ctrlKey || e.altKey) && !e.metaKey && !e.shiftKey && off != null &&
        (e.key === 'Backspace' || e.key === 'Delete') &&
        !multi && !this.state.prefs.sourceView) {
      const wsel = window.getSelection();
      if (!wsel || wsel.isCollapsed) {
        const word = e.key === 'Backspace' ? AMD.wordBackAt(text, off) : AMD.wordForwardAt(text, off);
        if (word && word.text != null) {
          e.preventDefault(); this.editText(id, word.text, word.caret);
          return;
        }
        /* nothing of the reader's left on that side: fall through to the
           single-key branches, which own merging with the neighbouring block */
      }
    }
    if (e.key === 'Backspace' && !e.shiftKey && off != null) {
      const sel = window.getSelection();
      const collapsed = !sel || sel.isCollapsed;
      /* ---- ⌫ against hidden delimiters -----------------------------------
         §5.1 keeps the markdown source in the DOM with its delimiters hidden,
         so the character in front of the caret is not always the character
         the reader sees. At the end of `**bold**` the caret sits behind two
         invisible asterisks: a plain ⌫ ate one of them and the whole run lost
         its formatting in one keystroke. Delete the last VISIBLE character
         instead, and when the run runs out of them drop its delimiters too,
         so the text falls back to plain rather than showing `****`.
         In source view the delimiters ARE visible, so they are the reader's
         to delete and this stays out of the way. */
      const cut = (collapsed && !multi && !this.state.prefs.sourceView)
        ? AMD.backspaceAt(text, off) : null;
      if (cut && cut.text != null) {
        e.preventDefault(); this.editText(id, cut.text, cut.caret);
        return;
      }
      /* `atStart`: only delimiters lie between the caret and column 0, which
         is where the reader sees it — so this is the block-level ⌫ */
      if (collapsed && (off === 0 || (cut && cut.atStart))) {
        if (b.type !== 'p') { e.preventDefault(); this.mutate(bs => { const g = this.locate(id, bs); if (g) { setBlockType(g.block, 'p'); g.block.indent = 0; g.block.checked = false; } }); return; }
        if (b.indent) { e.preventDefault(); this.mutate(bs => { const g = this.locate(id, bs); if (g) g.block.indent = 0; }); return; }
        e.preventDefault(); this.readBlock(id);
        if (!this.mergePrev(id) && !text) this.removeBlock(id);
        return;
      }
    }
    if (e.key === 'Delete' && !e.shiftKey && off != null) {
      const dsel = window.getSelection();
      if (!dsel || dsel.isCollapsed) {
        /* ⌦ has the same quarrel with hidden delimiters that ⌫ has: Chromium
           takes a display:none span away together with the character beside
           it, so ⌦ over the `m` of `==mark==` removed the opening `==` too and
           left the other half showing as literal text. Delete the next
           character the reader can SEE, and drop the pair when that empties
           the run. */
        const cut = (!multi && !this.state.prefs.sourceView) ? AMD.deleteAt(text, off) : null;
        if (cut && cut.text != null) { e.preventDefault(); this.editText(id, cut.text, cut.caret); return; }
        /* `atEnd`: only delimiters lie ahead, which is where the reader sees
           the end of the block — so the merge rule below belongs here too */
        if (off === text.length || (cut && cut.atEnd)) {
          /* R1 / B11 — forward-delete may only merge two plain blocks of the same
             kind. A sub-page, database, heading or other typed block is never
             silently absorbed; it is selected instead. */
          const nx = f.list[f.i + 1];
          if (nx) {
            const solid = ['subpage', 'database', 'divider', 'table', 'code', 'math', 'columns', 'toggle'];
            if (solid.indexOf(nx.type) >= 0 || nx.type !== b.type) {
              e.preventDefault();
              this.setState({ blockSel: [nx.id] });
              return;
            }
            e.preventDefault(); this.readBlock(id);
            this.mutate(bs => {
              const g = this.locate(id, bs); if (!g) return;
              const after = g.list[g.i + 1]; if (!after) return;
              g.block.text = (g.block.text || '') + (after.text || '');
              g.list.splice(g.i + 1, 1);
            });
            setTimeout(() => { const q = this._els[id]; if (q) { q.focus(); setCaret(q, text.length); } }, 20);
            return;
          }
          /* nothing ahead to join, and nothing visible to remove — but the
             browser would still eat the trailing delimiters if we let it */
          if (cut && cut.atEnd) { e.preventDefault(); return; }
        }
      }
    }
    if (e.key === 'Tab') {
      e.preventDefault(); this.readBlock(id);
      if (multi) {
        if (!e.shiftKey) { this.codeEdit(id, '  '); return; }
        const ls = text.lastIndexOf('\n', Math.max(0, off - 1)) + 1;
        const cut = /^ {1,2}/.exec(text.slice(ls, ls + 2));
        if (cut) this.setCodeText(id, text.slice(0, ls) + text.slice(ls + cut[0].length), Math.max(ls, off - cut[0].length));
        return;
      }
      /* Tab right under a toggle nests the block into it */
      if (!e.shiftKey && f.i > 0 && f.list[f.i - 1].type === 'toggle' && b.type !== 'toggle') {
        this.mutate(bs => {
          const g = this.locate(id, bs); if (!g || g.i === 0) return;
          const tg = g.list[g.i - 1]; if (tg.type !== 'toggle') return;
          const moved = g.list.splice(g.i, 1)[0];
          moved.indent = 0; tg.collapsed = false;
          tg.children = (tg.children || []).filter(c => c.text || c.type !== 'p');
          tg.children.push(moved);
        });
        setTimeout(() => { const q = this._els[id]; if (q) { q.focus(); setCaret(q, off); } }, 25);
        return;
      }
      this.mutate(bs => { const g = this.locate(id, bs); if (g) g.block.indent = Math.max(0, Math.min(5, (g.block.indent || 0) + (e.shiftKey ? -1 : 1))); });
      setTimeout(() => { const e2 = this._els[id]; if (e2) { e2.focus(); setCaret(e2, off); } }, 15);
      return;
    }
    if (mod && ['b', 'i', 'e', 'u', 'h'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      const k = e.key.toLowerCase();
      this.wrapSel(id, k === 'b' ? '**' : k === 'i' ? '*' : k === 'e' ? '`' : k === 'u' ? '~~' : '==');
      return;
    }
    if (b.type === 'code' && '([{"\''.indexOf(e.key) >= 0) {
      const s2 = window.getSelection();
      if (s2 && !s2.isCollapsed) {
        e.preventDefault();
        const close = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" }[e.key];
        const t = s2.toString();
        document.execCommand('insertText', false, e.key + t + close);
        this.readBlock(id);
        return;
      }
    }
    /* ← at the very start of a block, → at the very end: step into the
       neighbour, the way every other editor does. Each block is its own
       contenteditable element, and to the browser two of those are two
       separate documents — its caret motion stops dead at the boundary, so
       the caret simply refused to go any further and the only ways across
       were the mouse and ↑/↓. Same skip rule as the vertical keys: a
       divider, table, sub-page or database holds no caret, so step over it to
       the next block that does. Held modifiers and ⇧ are left alone — those
       are word jumps and selection, which belong to the browser. */
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !mod && !e.shiftKey && off != null) {
      const sel3 = window.getSelection();
      const back = e.key === 'ArrowLeft';
      /* The caret parked between the two closing asterisks of `**bold**` has
         no rect of its own and the browser cannot move it from there at all:
         → did nothing, for ever, from a position typing one bold word
         reaches. atVisualEnd() is what rescues it. (Mid-text needs no help —
         Chromium steps over a whole marker run in one press.) */
      if ((!sel3 || sel3.isCollapsed) && (back ? atVisualStart() : atVisualEnd())) {
        const rows = this.flat();
        const idx = rows.findIndex(r => r.id === id);
        const step = back ? -1 : 1;
        let el2 = null;
        for (let j = idx + step; j >= 0 && j < rows.length; j += step) {
          const cand = this._els[rows[j].id];
          if (cand && cand.isConnected) { el2 = cand; break; }
        }
        if (el2) {
          e.preventDefault();
          this._col = null;          // a sideways move ends the vertical run
          el2.focus();
          setCaret(el2, back ? (el2.textContent || '').length : 0);
          return;
        }
      }
    }
    /* ⇧ makes this a selection, not a caret move, and selection belongs to
       the browser — the same rule the horizontal keys follow above. Without
       it, crossing to the next block called focus() on it, which collapses
       the selection: ⇧↓ from mid-block wiped what was selected and dropped
       the caret in the block below. (Extending a selection ACROSS blocks is a
       different job: two contenteditable elements are two editing hosts, and
       no browser selection can span them — that wants the app's own
       block-level selection, not a caret move.) */
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const up = e.key === 'ArrowUp';
      /* A COLLAPSED range has no bounding box — Chromium answers
         getBoundingClientRect() with zeroes — so the "is the caret on the last
         line?" test was measuring against a rect at the top of the document
         and came out false for every press that was not already at the end of
         the text. The first ↓ from mid-line therefore never left the block; it
         took a second press, after the browser's own default had parked the
         caret at the end of the line. getClientRects() does answer for a
         collapsed range, and with no rects at all the offset test below is
         the honest fallback. */
      const sel0 = window.getSelection();
      let r0 = null;
      if (sel0 && sel0.rangeCount) {
        const cr = sel0.getRangeAt(0).cloneRange(); cr.collapse(true);
        const rects = cr.getClientRects();
        if (rects.length) r0 = rects[0];
      }
      const box = el.getBoundingClientRect();
      /* "Is the caret on the last visual line of this block?" — the test used
         to allow a flat 6px, which is less than the padding plus half-leading
         that sits under a single line (7px in a plain paragraph), so it
         answered NO for every caret that was not already at the very end of
         the text. Measured against the caret's own height instead: three
         quarters of a line is far more than the few pixels under the last
         line, and far less than the whole line that would sit below it if
         there were another one. */
      const slop = r0 ? Math.max(6, r0.height * 0.75) : 6;
      const atEdge = up ? (off === 0 || (r0 && r0.top - box.top < slop))
                        : (off === text.length || (r0 && box.bottom - r0.bottom < slop));
      /* ⇧ inside the block is the browser's to extend; ⇧ at the edge is the
         moment the selection has to change kind (see selectBlockRange) */
      if (e.shiftKey) {
        this._col = null;
        /* The handover waits for the true edge of the TEXT, not merely the
           last visual line: from mid-block the first ⇧↓ still gets to select
           the rest of this block, and only the next one crosses. */
        if (!(up ? atVisualStart() : atVisualEnd())) return;
        const rows2 = this.flat();
        const i0 = rows2.findIndex(r => r.id === id);
        const j0 = i0 + (up ? -1 : 1);
        if (i0 < 0 || j0 < 0 || j0 >= rows2.length) return;
        e.preventDefault();
        /* React's listener sits on the root container, so this event would go
           on to the window handler that grows an existing block selection —
           and the range would jump two rows on the press that created it. */
        e.stopPropagation();
        this.selectBlockRange(id, rows2[j0].id);
        return;
      }
      if (!atEdge) { this._col = null; return; }
      /* The column the caret set out from is held for the whole run of ↑/↓
         presses, so crossing a short line — or a rule with no text in it at
         all — and carrying on lands back under where you started, the way
         every other editor behaves. It is dropped the moment the caret is
         placed by anything else: a click, or any other key. */
      if (this._col == null) this._col = this.caretX();
      const rows = this.flat();
      const idx = rows.findIndex(r => r.id === id);
      const step = up ? -1 : 1;
      /* Step OVER whatever cannot hold a caret. A divider, a table, a
         sub-page and a database have no editable element between them, and
         this used to ask for exactly one neighbour and give up when it was
         one of those — so a divider was a wall. The caret could not get past
         it in either direction, which left everything beyond it unreachable
         by keyboard on a page that opens with one. */
      let el2 = null;
      for (let j = idx + step; j >= 0 && j < rows.length; j += step) {
        const cand = this._els[rows[j].id];
        if (cand && cand.isConnected) { el2 = cand; break; }
      }
      if (el2) { e.preventDefault(); this.caretToX(el2, this._col, up); }
      return;
    }
    this._col = null;
  }

  /* ---- selecting ACROSS blocks ---------------------------------------
     Two contenteditable elements are two editing hosts, and no browser
     selection can span them: a selection that needs to leave its block
     cannot grow, it has to change KIND. So at the edge of a block ⇧↑/↓ hands
     over to the whole-block selection the app already has — `blockSel` draws
     the highlight, and copy, cut, delete and replace-on-typing are all
     already written against it. `_selAnchor` is the end that stays put and
     `_selHead` the end that moves, so ⇧ back the other way shrinks the range
     instead of growing it the wrong way. */
  selectBlockRange(anchorId, headId) {
    const rows = this.flat();
    const a = rows.findIndex(r => r.id === anchorId);
    const h = rows.findIndex(r => r.id === headId);
    if (a < 0 || h < 0) return;
    this._selAnchor = anchorId; this._selHead = headId;
    const ids = rows.slice(Math.min(a, h), Math.max(a, h) + 1).map(r => r.id);
    const g = window.getSelection(); if (g) g.removeAllRanges();
    const act = document.activeElement; if (act && act.blur) act.blur();
    /* Nothing is focused in this mode, so the browser has no caret to keep on
       screen and the page just sat still while the selection ran off the
       bottom of it. Follow the moving end ourselves — `nearest` scrolls by the
       least that brings it into view, so a selection growing inside the
       viewport does not jerk the page around. */
    this.setState({ blockSel: ids, focusId: null, selBar: null, slash: null }, () => {
      const host = document.querySelector('[data-bid="' + headId + '"]');
      if (host && host.scrollIntoView) host.scrollIntoView({ block: 'nearest' });
    });
  }
  /* the moving end of an existing block selection, walked one row at a time */
  growBlockSel(step) {
    const sel = this.state.blockSel || []; if (!sel.length) return;
    const rows = this.flat();
    const has = (id) => id && sel.indexOf(id) >= 0;
    const anchor = has(this._selAnchor) ? this._selAnchor : sel[0];
    const head = has(this._selHead) ? this._selHead : sel[sel.length - 1];
    const h = rows.findIndex(r => r.id === head);
    const j = h + step;
    if (h < 0 || j < 0 || j >= rows.length) return;
    this.selectBlockRange(anchor, rows[j].id);
  }

  wrapSel(id, mk) {
    const el = this._els[id]; if (!el) return;
    const s = window.getSelection();
    const text = el.textContent;
    let start = (text || '').length, end = start;
    if (s && s.rangeCount && el.contains(s.anchorNode)) {
      const r = s.getRangeAt(0);
      const pre = document.createRange(); pre.selectNodeContents(el); pre.setEnd(r.startContainer, r.startOffset);
      start = pre.toString().length; end = start + r.toString().length;
    }
    /* Nothing selected. Wrapping an empty range wrote `****` — four asterisks
       the reader can see, since a run with nothing inside it is not emphasis
       and renders as the literal characters it is. Take the word under the
       caret instead, which is what ⌘B does in a word processor and is the
       only reading of "bold this" available when nothing is selected. The
       word stops at whitespace AND at any delimiter, so ⌘B inside `**bold**`
       offers `bold` — and the toggle below then strips the pair — rather than
       swallowing the asterisks and building `***bold***` out of them. With no
       word under the caret (a blank block, or a space) there is nothing to
       emphasise, and the key does nothing at all. */
    if (start === end) {
      const hidden = AMD.markMap(text);
      let a = start, z = end;
      while (a > 0 && !hidden[a - 1] && !/\s/.test(text[a - 1])) a--;
      while (z < text.length && !hidden[z] && !/\s/.test(text[z])) z++;
      if (a === z) return;
      start = a; end = z;
    }
    const inner = text.slice(start, end);
    /* toggling: strip the marks again if they are already there */
    const wrapped = text.slice(Math.max(0, start - mk.length), start) === mk && text.slice(end, end + mk.length) === mk;
    let next, caret;
    if (wrapped) {
      next = text.slice(0, start - mk.length) + inner + text.slice(end + mk.length);
      caret = end - mk.length;
    } else {
      next = text.slice(0, start) + mk + inner + mk + text.slice(end);
      caret = start + mk.length + inner.length;
    }
    this.mutate(bs => { const g = this.locate(id, bs); if (g) g.block.text = next; });
    this.setState({ selBar: null });
    setTimeout(() => { const e2 = this._els[id]; if (e2) { e2.focus(); setCaret(e2, caret); } }, 20);
  }

  onPaste(id, e) {
    const md = e.clipboardData.getData('text/plain');
    if (!md) return;
    e.preventDefault();
    const f0 = this.locate(id);
    const type = f0 ? f0.block.type : 'p';

    /* A code or equation block is a literal container: whatever you paste stays
       inside it, newlines and all, even nested ``` fences. It must never be
       parsed as markdown and never split the block. */
    if (type === 'code' || type === 'math') {
      /* Verbatim, newlines and all. execCommand used to shred a multi-line
         paste into <div>s that then read back as one line; one text node
         cannot be misread, and it is O(1) DOM work however large the paste. */
      this.codeEdit(id, md.replace(/\r\n?/g, '\n'));
      this.highlightNow(id);   // a paste is worth colouring at once
      this.syncTail();
      return;
    }

    if (!/\n/.test(md)) {
      document.execCommand('insertText', false, md); // plain text only — never paste HTML
      this.readBlock(id);
      return;
    }
    const parsed = AMD.fromMarkdown(md);

    /* A large paste used to lock the tab: one mutate deep-cloned the whole
       document, React committed hundreds of nodes, syncDom then rebuilt the
       innerHTML of every one of them, and a history snapshot re-serialised the
       lot — all in one frame. Insert the first screenful immediately so the
       page stays responsive, then stream the rest in idle chunks. */
    const FIRST = 40, CHUNK = 30;
    const head = parsed.slice(0, FIRST);
    const rest = parsed.slice(FIRST);

    this.mutate(bs => {
      const f = this.locate(id, bs); if (!f) return;
      f.list.splice(f.i + 1, 0, ...head);
      if (!f.block.text) f.list.splice(f.i, 1);
    });

    if (!rest.length) return;

    this.toast('Pasting ' + parsed.length + ' blocks…');
    let afterId = head.length ? head[head.length - 1].id : id;
    let at = 0;
    const idle = window.requestIdleCallback || ((fn) => setTimeout(() => fn({ timeRemaining: () => 8 }), 16));
    const pump = () => {
      const slice = rest.slice(at, at + CHUNK);
      if (!slice.length) { this.toast('Pasted ' + parsed.length + ' blocks'); return; }
      at += slice.length;
      const anchor = afterId;
      afterId = slice[slice.length - 1].id;
      /* no history entry per chunk — the whole paste is one undo step */
      this.mutate(bs => {
        const f = this.locate(anchor, bs);
        if (f) f.list.splice(f.i + 1, 0, ...slice); else bs.push(...slice);
      }, { noHist: true });
      idle(pump);
    };
    idle(pump);
  }

  onFocus(id) { this.setState({ focusId: id, kbOpen: true }); }
  onBlur(id) {
    this.readBlock(id);
    /* B12 — a hanging slash menu after the block loses focus is a ghost */
    setTimeout(() => {
      if (this.state.focusId === id) this.setState({ focusId: null });
      const sl = this.state.slash;
      if (sl && sl.id === id && document.activeElement !== this._els[id]) this.setState({ slash: null });
    }, 140);
  }
});
