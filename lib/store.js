/* Alamza Notes — data layer.
 *
 * ONE API for the app, and NO knowledge of any particular database. Everything
 * below reaches storage through the port in lib/data/port.js, and which backend
 * is behind that port is decided by one line in lib/config.js. Realtime
 * Database, Firestore, your own API, this browser, or several at once — this
 * file cannot tell the difference and does not try to.
 *
 * That inversion is the point (DIP, if you want the label): the store used to
 * import Firebase and call it directly, so "support another database" meant
 * rewriting the store. Now the store states what it needs — read a path, write
 * a patch, watch a collection — and a backend supplies it. Adding a database
 * touches no line in this file.
 *
 * WHAT IS STILL HERE, because none of it belongs to a database:
 *   the index/body/digest split · the LRU body cache · the local mirror ·
 *   the null-vs-empty contract · the write diff · the retry · the cost meter ·
 *   sealing a published page. Move the store to a new backend and every one of
 *   those behaviours moves with it.
 *
 *   AStore.mode              -> 'local' | 'firebase'   ('firebase' = "cloud",
 *                                                        see the note on it)
 *   AStore.backendName       -> which database is actually running
 *   AStore.caps              -> what that database can and cannot do
 *   AStore.init(onState)     -> Promise<state|null>   (single-flight)
 *   AStore.write(state)      -> debounced persist
 *   AStore.flush()           -> persist now
 *   AStore.loadBody(pageId)  -> Promise<blocks|null>
 *   AStore.loadRows(dbId)    -> Promise<rows|null>
 *   AStore.loadDigests()     -> Promise<{pageId:digest}>   (search only)
 *   AStore.getVersionBlocks(pageId, vId) -> Promise<blocks>
 *
 * ===========================================================================
 * THE COST MODEL — read this before changing anything
 *
 * RTDB bills 1 GB stored and 10 GB DOWNLOADED per month. Uploads are free.
 * Only bytes pulled DOWN matter. Three rounds of work got this file here, and
 * each round fixed a different way of accidentally downloading:
 *
 *   Round 1 — the echo. set() and onValue() on the SAME path, so every save
 *   downloaded the whole workspace back.
 *
 *   Round 2 — the boot. A note's title and its text lived in one node, so
 *   listing the sidebar downloaded every note ever written.
 *
 *   Round 3 (this file) — the multiplier and the databases:
 *
 *     a) DUPLICATE LISTENERS. init() registered an onAuthStateChanged observer
 *        and subscribed inside it. The app retried init() on a timer while the
 *        SDK was still importing, and onAuthStateChanged fires again on every
 *        hourly token refresh. Each pass attached ANOTHER full set of
 *        onChildAdded listeners, and onChildAdded replays every existing child
 *        to every new listener. N listener sets = N full downloads, growing
 *        without bound inside a session, and nothing was ever detached.
 *        => init() is single-flight, subscribe() is idempotent per uid, and
 *           every listener handle is kept and released.
 *
 *     b) DATABASES WERE WHOLE-NODE AND ECHOED. dbs/<id> held every row, it was
 *        subscribed, and it had no writer-id guard — so one keystroke in one
 *        cell downloaded the entire table back, every 2.2s, to both users. And
 *        boot pulled every table in full whether opened or not.
 *        => dbmeta (props/views/order) + dbrow/<dbId>/<rowId> + a ~60 B dbrev
 *           ping. Rows load when a table is first viewed, and a cell edit
 *           broadcasts one row.
 *
 *     c) THE SEARCH DIGEST RODE ALONG ON EVERY SAVE. idx carried 400 chars of
 *        keywords, rebroadcast on every keystroke pause.
 *        => digests live in dig/<id>, fetched in one read the first time
 *           search is opened, and never again that session.
 *
 * WHAT IS SUBSCRIBED, AND NOTHING ELSE:
 *   idx/*      ~110 B per page   (title, parent, order, flags, updatedAt)
 *   dbmeta/*   props + views     (changes only on schema/order edits)
 *   dbrev/*    ~60 B per table   (row-change ping)
 * Everything else is fetched on demand and cached.
 *
 * Local/demo mode is deliberately untouched: one flat blob, everything inline.
 */
(function () {
  /* The helmet may mount this script more than once (hot reload). Never let a
     second evaluation replace an already-initialised store — with a cloud
     backend that would drop the open connection and silently discard every
     write. */
  if (window.AStore) return;

  var KEY = 'alamza.notes.v1';        // local/demo workspace (flat)
  var MIRROR = 'alamza.idx.v4';       // index + dbmeta mirror (small)
  var BODY = 'alamza.body.v4.';       // per-page body cache
  var ROWS = 'alamza.rows.v4.';       // per-database row cache
  var DIG = 'alamza.dig.v4';          // search digests
  var LRU = 'alamza.lru.v4';          // recency + size for body/rows
  var AUTH_KEY = 'alamza.auth.v1';
  var DEMO_KEY = 'alamza.demo.v1';
  var CACHE_BUDGET = 2400000;         // ~2.4 MB of bodies+rows held locally (tuned below)

  /* Which database, and why. Both answers come from lib/config.js by way of
     the registry; nothing here names one. `why` is shown in Settings ->
     Data & sync, so when the app is not on the backend you expected there is a
     sentence saying what it decided and on what grounds. */
  var D = window.AlamzaData;
  var conf = D.config();
  var picked = D.resolveBackendName(conf);
  var why = D.chose;
  var hasConfig = picked !== 'local';
  var demo = false;
  try { demo = localStorage.getItem(DEMO_KEY) === '1'; } catch (e) {}
  /* "cloud" rather than "firebase": the app has one question — is there a
     server, or is this browser the only copy? — and it had been asking it by
     naming a vendor. `AStore.mode` keeps the old two words for the eighteen
     places that read it, and means this. */
  var useCloud = hasConfig && !demo;

  /* the three numbers `tuning` in lib/config.js exists to turn. They are read
     once, here, so there is one place that knows the defaults and one place
     that overrides them. */
  CACHE_BUDGET = conf.tuning.cacheBudget || CACHE_BUDGET;
  var PUSH_DELAY = conf.tuning.pushDelayMs || 2200;
  var MIRROR_DELAY = conf.tuning.mirrorDelayMs || 240;

  /* identifies THIS tab, so we can ignore the echo of our own writes */
  var WID = Math.random().toString(36).slice(2, 10);

  var listeners = [], authCbs = [], saveCbs = [];
  /* the two ports. `backend` is storage, `auth` is who is signed in; they are
     separate because in practice they are chosen separately. */
  var backend = null, auth = null;
  var ROOT = { ws: null };            // the shared area: pub/ inbox/ shared/
  function WS(uid) { return { ws: uid }; }
  var netTimer = null, mirrorTimer = null, pending = null;
  /* A failed push has nobody to re-trigger it: `write()` only fires on the
     next edit, and the edit that mattered may already have happened. So the
     store owns the retry, backing off 2·4·8·16·30s and resetting on success. */
  var retryTimer = null, retryWait = 0;
  function scheduleRetry() {
    if (retryTimer) return;
    retryWait = retryWait ? Math.min(retryWait * 2, 30000) : 2000;
    retryTimer = setTimeout(function () { retryTimer = null; AStore.push(); }, retryWait);
  }
  var sent = { idx: {}, body: {}, dig: {}, vmeta: {}, dbmeta: {}, dbrow: {}, meta: '' };
  /* Snapshot payloads, memoised so a version opened twice is read once.
     Each one is a whole page subtree plus every table it embeds, and this map
     had no ceiling — browsing a long history kept every payload it touched
     alive for the life of the tab. They are all re-fetchable, so a bound costs
     at most one re-read. `vqueue` is deliberately NOT bounded: it holds writes
     that have not gone out yet, and dropping one would lose a snapshot. */
  var VDATA_CACHE = 32;
  var vcache = {}, vcacheLru = [], vqueue = {};
  function vcachePut(k, v) {
    vcache[k] = v;
    var i = vcacheLru.indexOf(k);
    if (i >= 0) vcacheLru.splice(i, 1);
    vcacheLru.push(k);
    /* one sweep at most, so a cache full of unsent writes cannot spin */
    var guard = vcacheLru.length;
    while (vcacheLru.length > VDATA_CACHE && guard-- > 0) {
      var drop = vcacheLru.shift();
      /* a payload still owed to the server is never dropped — that would lose
         the snapshot, which is the whole thing this cache is holding */
      if (drop in vqueue) { vcacheLru.push(drop); continue; }
      delete vcache[drop];
    }
  }
  var vmetaSeen = {};         // pageId -> we have authoritative version metadata
  var loadingVMeta = {};
  var remote = null;          // { pages:{id:idx}, dbmeta:{}, vmeta:{}, prefs, ... }
  var bodies = {};            // pageId -> blocks
  var rowsMem = {};           // dbId  -> rows[]
  var rowGone = {};           // dbId  -> { rowId: 1 } rows deleted, not yet nulled
  var digests = null;         // pageId -> digest string
  var emitT = null;
  var loadingBody = {}, loadingRows = {}, digestsP = null;

  /* every attached listener, so a re-subscribe can release the old set */
  var handles = [];
  var subscribedTo = null;
  var idxTimer = null;

  /* "Signed in but the index has not arrived yet" is a THIRD state, distinct
     from both "loading the SDK" and "this workspace is empty". Without it the
     app cannot tell an empty account from an unfetched one, and a returning
     user on a new device gets told their workspace is empty — with a New page
     button that writes a stray page into a workspace full of real notes. */
  function markIndexReady() {
    if (AStore.indexReady) return;
    AStore.indexReady = true;
    if (idxTimer) { clearTimeout(idxTimer); idxTimer = null; }
    if (AStore.onIndexReady) { try { AStore.onIndexReady(); } catch (e) {} }
  }

  function notifySave(st) { saveCbs.forEach(function (c) { try { c(st); } catch (e) {} }); }
  function notifyAuth(u) { authCbs.forEach(function (c) { try { c(u); } catch (e) {} }); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* RTDB rejects `undefined` anywhere in a payload, and app state picks them
     up easily. Serialising is also the dirty check, so one pass does both. */
  function wire(obj) {
    var body = JSON.stringify(obj);
    return { body: body, value: JSON.parse(body) };
  }
  /* Key order survives a JSON round trip but not a trip through a database, so
     two entries holding the same fields can stringify differently. Sorting the
     keys makes "is this already stored?" answerable by string compare.
     `dropW` leaves out the writer id, which is bookkeeping rather than content. */
  function stable(obj, dropW) {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return '[' + obj.map(function (x) { return stable(x); }).join(',') + ']';
    return '{' + Object.keys(obj).sort().filter(function (k) { return !(dropW && k === 'w'); })
      .map(function (k) { return JSON.stringify(k) + ':' + stable(obj[k]); }).join(',') + '}';
  }

  /* ------------------------------------------------- sealing a public page
     PBKDF2 to turn a human password into a key, AES-GCM to seal the payload.
     Both come from SubtleCrypto, which every browser that can run this app
     has over https (and on localhost). No dependency, no server.

     The salt and the IV are stored beside the ciphertext because neither is a
     secret — they exist so the same password never produces the same bytes
     twice. Only the password itself is withheld, and it is never stored. */
  var B64 = {
    to: function (buf) {
      var b = new Uint8Array(buf), s = '';
      for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
      return btoa(s);
    },
    from: function (str) {
      var s = atob(str), b = new Uint8Array(s.length);
      for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
      return b;
    }
  };
  var PBKDF2_ROUNDS = 150000;
  function subtle() {
    return (window.crypto && window.crypto.subtle) || null;
  }
  async function keyFrom(password, salt) {
    var sc = subtle();
    var base = await sc.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return sc.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: PBKDF2_ROUNDS, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encryptJSON(password, obj) {
    var sc = subtle();
    if (!sc) throw new Error('WebCrypto unavailable — cannot seal a password link');
    var salt = window.crypto.getRandomValues(new Uint8Array(16));
    var iv = window.crypto.getRandomValues(new Uint8Array(12));
    var key = await keyFrom(password, salt);
    var ct = await sc.encrypt({ name: 'AES-GCM', iv: iv },
      key, new TextEncoder().encode(JSON.stringify(obj)));
    return { s: B64.to(salt), iv: B64.to(iv), ct: B64.to(ct) };
  }
  /* `null` for a wrong password — AES-GCM authenticates, so a bad key throws
     rather than returning plausible rubbish */
  async function decryptJSON(password, enc) {
    var sc = subtle();
    if (!sc || !enc || !enc.s || !enc.iv || !enc.ct) return null;
    try {
      var key = await keyFrom(password, B64.from(enc.s));
      var pt = await sc.decrypt({ name: 'AES-GCM', iv: B64.from(enc.iv) }, key, B64.from(enc.ct));
      return JSON.parse(new TextDecoder().decode(pt));
    } catch (e) { return null; }
  }

  /* ---------------------------------------------------------------- local */
  var local = {
    read: function () {
      try { var raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; }
      catch (e) { return null; }
    },
    write: function (state) {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
    },
    user: function () {
      try { var raw = localStorage.getItem(AUTH_KEY); return raw ? JSON.parse(raw) : null; }
      catch (e) { return null; }
    },
    setUser: function (u) {
      try { u ? localStorage.setItem(AUTH_KEY, JSON.stringify(u)) : localStorage.removeItem(AUTH_KEY); }
      catch (e) {}
    }
  };

  /* ------------------------------------------------------- the index entry
     Everything the app can show WITHOUT the text of a note. This is the only
     thing multiplied by the note count at boot, so it stays short — and the
     search digest is NOT in it. */
  function firstLine(blocks) {
    var found = '';
    (function walk(list) {
      for (var i = 0; i < (list || []).length && !found; i++) {
        var b = list[i];
        if (b.type === 'divider' || !b.text) { if (b.children) walk(b.children); continue; }
        var t = b.text.replace(/[*_`~#>]/g, '').trim();
        if (t) found = t.slice(0, 140);
      }
    })(blocks);
    return found;
  }
  function digestOf(blocks) {
    var out = [], n = 0;
    (function walk(list) {
      for (var i = 0; i < (list || []).length && n < 600; i++) {
        var b = list[i];
        if (b.text) { out.push(b.text); n += b.text.length; }
        if (b.children) walk(b.children);
        if (b.cols) b.cols.forEach(walk);
        if (b.rows) b.rows.forEach(function (r) { out.push(r.join(' ')); n += 20; });
      }
    })(blocks);
    return out.join(' ').replace(/[*_`~#>\[\]()]/g, '').replace(/\s+/g, ' ').slice(0, 600).toLowerCase();
  }
  /* What the index has to carry is not "the cheap fields" — it is every field
     the app cannot rebuild from something else. A database ROW PAGE is the
     case that taught this: it is created with `dbRef`, `hidden` and
     `propsCollapsed`, none of which was written here, so on the next boot it
     came back as an ordinary page. The properties panel disappeared (it keys
     off `dbRef`), the title stopped mirroring into its row, the page turned up
     in the sidebar — and `reconcileChildren()`, seeing a visible child with no
     link, appended a sub-page block for it to the page holding the table and
     saved that. One dropped flag, and the host page grew a list of links to
     its own rows on every reload. They are all one-or-two bytes and only
     written when set, so the index entry stays the ~110 B it advertises. */
  function toIdx(p) {
    var e = { t: p.title || '', u: p.updatedAt || 0, n: (p.blocks || []).length, s: firstLine(p.blocks) };
    if (p.icon) e.i = p.icon;
    if (p.iconType) e.it = p.iconType;
    if (p.cover) e.c = p.cover;
    if (p.parentId) e.p = p.parentId;
    if (p.order) e.o = p.order;
    if (p.favorite) e.f = 1;
    if (p.trashed) e.tr = 1;
    if (p.trashedAt) e.ta = p.trashedAt;
    if (p.trashRoot) e.trr = 1;
    if (p.createdAt) e.ca = p.createdAt;
    if (p.publicId) e.pu = p.publicId;
    if (p.locked) e.lo = 1;
    if (p.hidden) e.h = 1;
    if (p.dbRef && p.dbRef.dbId && p.dbRef.rowId) e.dr = [p.dbRef.dbId, p.dbRef.rowId];
    if (p.propsCollapsed) e.pc = 1;
    if (p.updatedBy) e.ub = p.updatedBy;
    /* the row a trashed row page can be restored from — see restorePage() */
    if (p.dbRowBackup) e.rb = p.dbRowBackup;
    /* Publish state. Dropping this made "Publish to web" a switch that turned
       itself off on the next reload — the slug, the password and the invite
       list all lived only in memory. Written only when the page is actually
       shared, so an ordinary page still costs nothing. */
    if (p.share && (p.share.published || p.share.password || (p.share.invites || []).length)) {
      e.sh = {
        p: p.share.published ? 1 : 0,
        s: p.share.slug || '',
        pw: p.share.password || '',
        iv: p.share.invites || []
      };
    }
    return e;
  }
  /* `blocks: null` is the signal that the body has not been fetched. `[]`
     would look like an empty note and let an edit overwrite real content. */
  function fromIdx(id, e, blocks, versions) {
    return {
      id: id, title: e.t || '', icon: e.i || '', iconType: e.it || '',
      cover: e.c || '', parentId: e.p || null, order: e.o || 0,
      favorite: !!e.f, trashed: !!e.tr, trashedAt: e.ta || 0, trashRoot: !!e.trr,
      createdAt: e.ca || 0, updatedAt: e.u || 0,
      publicId: e.pu || '', locked: !!e.lo,
      hidden: !!e.h, propsCollapsed: !!e.pc, updatedBy: e.ub || '',
      dbRef: e.dr ? { dbId: e.dr[0], rowId: e.dr[1] } : null,
      dbRowBackup: e.rb || null,
      share: e.sh
        ? { published: !!e.sh.p, slug: e.sh.s || id, password: e.sh.pw || null, invites: e.sh.iv || [] }
        : { published: false, slug: id, password: null, invites: [] },
      blockCount: e.n || 0, snippet: e.s || '',
      versions: versions || [], blocks: blocks || null
    };
  }

  /* ------------------------------------------------------ database splitting
     Rows are to a table what blocks are to a page: the bulk, and the part the
     user is not always looking at. Meta (props, views, row ORDER) is small and
     changes rarely; rows are per-node so a cell edit is one small write. */
  function toDbMeta(d) {
    var m = { n: d.name || '', p: d.props || [], v: d.views || [] };
    if (d.icon) m.ic = d.icon;
    if (d.defaultView) m.dv = d.defaultView;
    if (d.pageHidden && d.pageHidden.length) m.ph = d.pageHidden;
    /* "Start with properties collapsed" defaults to ON, so only the OFF case
       is worth a byte — and it has to be written, or the setting resets on
       every reload the way it used to. */
    if (d.collapseProps === false) m.cp = 0;
    if (d.rows) m.o = d.rows.map(function (r) { return r.id; });
    return m;
  }
  function fromDbMeta(id, m, rows) {
    var d = {
      id: id, name: m.n || 'Database', icon: m.ic || '',
      props: m.p || [], views: m.v || [],
      defaultView: m.dv || ((m.v && m.v[0]) ? m.v[0].id : ''),
      pageHidden: m.ph || [],
      collapseProps: m.cp === 0 ? false : true,
      rowCount: (m.o || []).length,
      rows: null
    };
    if (rows) {
      /* the order lives in meta, so a reorder is a small write and the rows
         themselves never move */
      var byId = {};
      rows.forEach(function (r) { byId[r.id] = r; });
      var ordered = (m.o || []).map(function (rid) { return byId[rid]; }).filter(Boolean);
      rows.forEach(function (r) { if ((m.o || []).indexOf(r.id) < 0) ordered.push(r); });
      d.rows = ordered;
    }
    return d;
  }

  /* --------------------------------------------------------- index mirror */
  var mirror = {
    read: function () {
      try { var raw = localStorage.getItem(MIRROR); return raw ? JSON.parse(raw) : null; }
      catch (e) { return null; }
    },
    write: function (m) {
      try { localStorage.setItem(MIRROR, JSON.stringify(m)); }
      catch (e) { cache.evict(CACHE_BUDGET / 2); try { localStorage.setItem(MIRROR, JSON.stringify(m)); } catch (e2) {} }
    },
    clear: function () { try { localStorage.removeItem(MIRROR); } catch (e) {} }
  };

  /* ------------------------------------------- body + row cache, one LRU */
  var cache = {
    lru: function () {
      try { return JSON.parse(localStorage.getItem(LRU) || '{}'); } catch (e) { return {}; }
    },
    setLru: function (l) { try { localStorage.setItem(LRU, JSON.stringify(l)); } catch (e) {} },
    get: function (prefix, id) {
      try {
        var raw = localStorage.getItem(prefix + id);
        if (!raw) return null;
        var l = this.lru(), k = prefix + id;
        if (l[k]) { l[k].a = Date.now(); this.setLru(l); }
        return JSON.parse(raw);
      } catch (e) { return null; }
    },
    put: function (prefix, id, val) {
      var body;
      try { body = JSON.stringify(val); } catch (e) { return; }
      var k = prefix + id, l = this.lru();
      l[k] = { s: body.length, a: Date.now() };
      var total = 0;
      Object.keys(l).forEach(function (x) { total += l[x].s || 0; });
      if (total > CACHE_BUDGET) { this.evict(total - CACHE_BUDGET, k); l = this.lru(); l[k] = { s: body.length, a: Date.now() }; }
      try { localStorage.setItem(k, body); this.setLru(l); }
      catch (e) { this.evict(CACHE_BUDGET / 2, k); try { localStorage.setItem(k, body); } catch (e2) {} }
    },
    /* drop the coldest entries until `need` bytes are free — never `keep`,
       which is what we are in the middle of writing */
    evict: function (need, keep) {
      var l = this.lru();
      var ks = Object.keys(l).filter(function (x) { return x !== keep; })
        .sort(function (a, b) { return (l[a].a || 0) - (l[b].a || 0); });
      var freed = 0;
      for (var i = 0; i < ks.length && freed < need; i++) {
        freed += l[ks[i]].s || 0;
        try { localStorage.removeItem(ks[i]); } catch (e) {}
        delete l[ks[i]];
      }
      this.setLru(l);
    },
    drop: function (prefix, id) {
      try { localStorage.removeItem(prefix + id); } catch (e) {}
      var l = this.lru(); delete l[prefix + id]; this.setLru(l);
    },
    clear: function () {
      var l = this.lru();
      Object.keys(l).forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
      try { localStorage.removeItem(LRU); localStorage.removeItem(DIG); } catch (e) {}
    }
  };

  /* ------------------------------------------------------- the storage port
     Everything below this line that reaches storage goes through `backend`.
     It is created from the config, connected once, and never named. */
  /* SINGLE-FLIGHT, for the same reason init() is.
     Two things open the port: init(), for the workspace, and loadPublic(), for
     a visitor with nobody signed in. Nothing sequences them, and opening twice
     means two auth providers observing sign-in — which on the next hourly token
     refresh means two full sets of listeners, then three, then four. That
     multiplier is the exact bug this store was rebuilt to remove, so the guard
     against it is the same one: hold the promise, not just the result. */
  var openP = null;
  function openBackend() {
    if (backend && auth) return Promise.resolve(backend);
    if (!openP) {
      openP = doOpen().catch(function (e) { openP = null; throw e; });
    }
    return openP;
  }

  async function doOpen() {
    var opened = D.open();
    AStore.backendName = opened.name;
    AStore.authName = opened.authName;
    AStore.caps = opened.backend.caps;
    AStore.why = opened.why;
    /* `backend` is published only once the connection is OPEN. Assigning it
       first left a half-opened backend in place after a failed connect: every
       later call went to it, failed the same way, and the `if (!backend)`
       retry that exists for exactly this case never fired because backend was
       truthy. */
    await opened.backend.connect();
    await opened.auth.connect();
    backend = opened.backend;
    auth = opened.auth;
    return backend;
  }

  /* An adapter that answers the six calls but behaves differently from the
     others is the one failure this design cannot survive, so it can be checked
     rather than assumed. Two things make it safe to point at a real database,
     and both were learned by getting them wrong:

       - it runs under the SIGNED-IN account's own workspace. It used to invent
         `workspaces/conformance-probe`, which no rule permits, so on a real
         database it failed every time and told the user their backend was
         broken. Nothing may write anywhere but its own workspace, so that is
         where it writes.
       - it runs AFTER sign-in, once per account, and only when asked for.
         `tuning.strictContract` is off in the shipped config: it is for the
         hour you spend writing a backend, not for every load thereafter. */
  var contractChecked = null;
  function runContractCheck(uid) {
    if (!conf.tuning.strictContract || !backend || contractChecked === uid) return;
    contractChecked = uid;
    D.conformance(backend, WS(uid)).then(function (bad) {
      if (bad.length) console.warn('[AStore] the "' + AStore.backendName +
        '" backend does not keep the contract in lib/data/port.js:\n  ' + bad.join('\n  '));
      else console.info('[AStore] the "' + AStore.backendName + '" backend keeps the contract.');
    }).catch(function (e) {
      console.warn('[AStore] the contract check could not run — ' + ((e && e.message) || e));
    });
  }

  /* Every byte the app receives passes through here, so `stats` reflects
     reality. The old build metered only explicit reads — which is exactly why
     hundreds of megabytes of listener traffic stayed invisible while the app
     reported almost nothing. Metering lives in the STORE rather than in each
     backend so a new backend cannot forget to do it. */
  function meter(v, kind) {
    var n = 0;
    try { n = v == null ? 0 : JSON.stringify(v).length; } catch (e) {}
    AStore.stats.down += n;
    AStore.stats.reads++;
    if (kind) AStore.stats.by[kind] = (AStore.stats.by[kind] || 0) + n;
    return v;
  }

  /* ONE live connection per collection, carrying every kind of change it
     needs. It used to be one per kind, because the Realtime Database's own API
     is shaped that way and there it costs nothing — only onChildAdded replays
     what is already stored.

     Every other backend pays for that shape. A Firestore onSnapshot on a
     collection is delivered the WHOLE collection as `added`, and every one of
     those documents is billed: three listeners on the index meant three times
     the boot cost, on the one node this entire layout exists to keep small. An
     API paying per request, or per open stream, is the same story.

     The port takes the three handlers together for exactly this reason. */
  function watchCol(uid, col, kind, on) {
    var h = {};
    if (on.added) h.added = function (k, v) { on.added(k, meter(v, kind)); };
    if (on.changed) h.changed = function (k, v) { on.changed(k, meter(v, kind)); };
    if (on.removed) h.removed = function (k) { on.removed(k); };
    var off = backend.watch(WS(uid), col, h);
    handles.push(off);
    return off;
  }
  function getMetered(uid, path, kind) {
    return backend.read(WS(uid), path).then(function (v) { return meter(v, kind); });
  }

  /* Coalesce arrivals into one state emission, so a boot of 200 index entries
     is one React render rather than 200. */
  function emit() {
    if (emitT) return;
    emitT = setTimeout(function () {
      emitT = null;
      if (!remote) return;
      mirror.write(remote);
      listeners.forEach(function (l) { try { l(project()); } catch (e) {} });
    }, 40);
  }
  /* the app-facing shape, assembled from index + whatever bodies/rows we hold */
  function project() {
    var out = { pages: {}, dbs: {}, prefs: clone(remote.prefs || {}),
                workspace: remote.workspace, invites: clone(remote.invites || []),
                shares: clone(remote.shares || []) };
    Object.keys(remote.pages).forEach(function (id) {
      out.pages[id] = fromIdx(id, remote.pages[id], bodies[id] ? clone(bodies[id]) : null,
                              clone(remote.vmeta[id] || []));
    });
    Object.keys(remote.dbmeta).forEach(function (id) {
      out.dbs[id] = fromDbMeta(id, remote.dbmeta[id], rowsMem[id] ? clone(rowsMem[id]) : null);
    });
    return out;
  }

  /* ------------------------------------------------------------- migration
     Two rules, both learned the hard way:

     1. NEVER put an ancestor and its descendant in one commit. The Realtime
        Database rejects the WHOLE update, so nothing migrates, the index stays
        empty, and the app renders a workspace with no pages while the real
        data sits untouched. Writer ids go INSIDE the object.
     2. Never read or write the whole corpus at once. Pages stream in batches,
        so peak memory and each write stay bounded. */
  /* Both metered. These are real network reads made on the app's own behalf —
     the layout check, the "is this workspace empty?" probe, the migration
     walk — and leaving them out made the readout in Settings under-report the
     one number a user has to judge this app by. */
  function pageBatch(uid, path, after, n) {
    return backend.readPage(WS(uid), path, after, n)
      .then(function (v) { return meter(v, 'boot'); });
  }
  /* "is there anything at all under here?" — one child is enough to answer it,
     and asking for one is the difference between a question and a download */
  function hasAnyChild(uid, sub) {
    return backend.readPage(WS(uid), sub, null, 1)
      .then(function (v) { meter(v, 'boot'); return !!(v && Object.keys(v).length); });
  }
  function readMetered(uid, path) {
    return backend.read(WS(uid), path).then(function (v) { return meter(v, 'boot'); });
  }

  var LAYOUT_VERSION = 4;

  async function migrate(uid, onProgress) {
    /* The completion test must NOT be "the old nodes are gone". Cleanup is
       best-effort by design (it runs last, in its own try/catch, so a failure
       there cannot lose data) — but when it failed, every subsequent load saw
       leftover `pages/`/`dbs/` and re-migrated the ENTIRE workspace: a full
       re-read of every body on every single page load. A durable marker at its
       own top-level path is the fact we actually care about. It cannot live
       under `meta`, because push() rewrites that node wholesale and would
       silently erase it. */
    var stamp = await readMetered(uid, 'layout');
    if (stamp >= LAYOUT_VERSION) return false;

    /* Only a backend that could be holding a workspace written by an older
       version of this app has anything to convert. A Firestore or API
       workspace starts on the current layout by definition, so it is stamped
       and left alone — four reads that could only ever come back empty are
       four reads not made. */
    if (!backend.caps.legacyLayouts) {
      await backend.commit(WS(uid), { layout: LAYOUT_VERSION });
      return false;
    }

    var haveIdx = await hasAnyChild(uid, 'idx');
    var haveOldPages = await hasAnyChild(uid, 'pages');
    var haveOldDbs = await hasAnyChild(uid, 'dbs');
    /* already on this layout, just never stamped (or a brand-new account) */
    if (!haveOldPages && !haveOldDbs) {
      await backend.commit(WS(uid), { layout: LAYOUT_VERSION });
      return false;
    }

    var BATCH = 20, done = 0, now = Date.now();
    AStore.migrating = { done: 0 };
    /* announce at the START, not on the first completed batch: the first batch
       is exactly the window the user would otherwise spend staring at an empty
       workspace, and a workspace with nothing to migrate never reports at all */
    if (onProgress) { try { onProgress(0); } catch (e) {} }

    /* ---- pages: round-1/round-2 layouts both live under pages/ ---- */
    if (haveOldPages) {
      var after = null;
      for (;;) {
        var val = await pageBatch(uid, 'pages', after, BATCH);
        if (!val) break;
        var ids = Object.keys(val);
        if (!ids.length) break;
        var patch = {};
        ids.forEach(function (id) {
          var p = val[id] || {};
          var blocks = p.blocks || [];
          /* Every field toIdx() knows about, or the migration is the very
             thing that loses it — a re-typed subset here is how row pages
             arrived on the new layout already stripped of `dbRef`. */
          var e = toIdx({
            title: p.title, icon: p.icon, iconType: p.iconType, cover: p.cover,
            parentId: p.parentId, order: p.order, favorite: p.favorite,
            trashed: p.trashed, trashedAt: p.trashedAt, trashRoot: p.trashRoot,
            createdAt: p.createdAt, updatedAt: p.updatedAt || now,
            publicId: p.publicId, locked: p.locked,
            hidden: p.hidden, dbRef: p.dbRef, propsCollapsed: p.propsCollapsed,
            updatedBy: p.updatedBy, dbRowBackup: p.dbRowBackup, share: p.share, blocks: blocks
          });
          e.w = WID;
          patch['idx/' + id] = wire(e).value;
          patch['body/' + id] = wire({ b: blocks }).value;
          patch['dig/' + id] = digestOf(blocks);
          var vs = p.versions || [];
          if (vs.length) {
            patch['vmeta/' + id] = wire(vs.map(function (v) {
              var m = {}; Object.keys(v).forEach(function (k) { if (k !== 'blocks' && k !== 'dbs') m[k] = v[k]; });
              return m;
            })).value;
            vs.forEach(function (v) {
              if (v.blocks) patch['vdata/' + id + '/' + v.id] = wire(v.blocks).value;
            });
          }
        });
        await backend.commit(WS(uid), patch);
        done += ids.length; after = ids[ids.length - 1];
        AStore.migrating = { done: done };
        if (onProgress) { try { onProgress(done); } catch (e) {} }
        if (ids.length < BATCH) break;
      }
    } else if (haveIdx) {
      /* round-2 workspace: pages are already split, but no dig/ existed. Build
         digests from the bodies we can reach, a batch at a time. */
      var a2 = null;
      for (;;) {
        var v2 = await pageBatch(uid, 'body', a2, BATCH);
        if (!v2) break;
        var i2 = Object.keys(v2);
        if (!i2.length) break;
        var dp = {};
        i2.forEach(function (id) { dp['dig/' + id] = digestOf((v2[id] && v2[id].b) || []); });
        await backend.commit(WS(uid), dp);
        a2 = i2[i2.length - 1];
        if (i2.length < BATCH) break;
      }
    }

    /* ---- databases: the whole-node tables become meta + per-row nodes ---- */
    if (haveOldDbs) {
      var da = null;
      for (;;) {
        var dv = await pageBatch(uid, 'dbs', da, 4);   // tables are big; small batch
        if (!dv) break;
        var dids = Object.keys(dv);
        if (!dids.length) break;
        for (var i = 0; i < dids.length; i++) {
          var dbId = dids[i], d = dv[dbId] || {};
          var rows = d.rows || [];
          var mp = {};
          var m = toDbMeta({ name: d.name, icon: d.icon, props: d.props, views: d.views,
                             defaultView: d.defaultView, pageHidden: d.pageHidden,
                             collapseProps: d.collapseProps, rows: rows });
          m.w = WID;
          mp['dbmeta/' + dbId] = wire(m).value;
          mp['dbrev/' + dbId] = { u: now, w: WID };
          await backend.commit(WS(uid), mp);
          /* rows in their own updates, so one huge table cannot blow a write */
          for (var j = 0; j < rows.length; j += 40) {
            var rp = {};
            rows.slice(j, j + 40).forEach(function (r) {
              rp['dbrow/' + dbId + '/' + r.id] = wire(r).value;
            });
            await backend.commit(WS(uid), rp);
          }
        }
        da = dids[dids.length - 1];
        AStore.migrating = { done: done };
        if (dids.length < 4) break;
      }
    }

    /* meta last: whichever of the older shapes this workspace was in */
    var meta = await readMetered(uid, 'meta');
    if (!meta) {
      var prefs = await readMetered(uid, 'prefs');
      var ws = await readMetered(uid, 'workspace');
      var inv = await readMetered(uid, 'invites');
      meta = { prefs: prefs || {}, workspace: ws || null, invites: inv || [], shares: [] };
      await backend.commit(WS(uid), { meta: wire(meta).value });
    }

    /* Stamp BEFORE cleanup, and in its own update: once every page and table
       has been copied the migration is done, whether or not the old nodes can
       be removed. Getting this order wrong is what made it repeat forever. */
    await backend.commit(WS(uid), { layout: LAYOUT_VERSION });

    /* Only now, with everything copied across, is it safe to drop the old
       nodes — and in their own update, so a failure here cannot take the
       migration with it. */
    try {
      await backend.commit(WS(uid), {
        pages: null, dbs: null, rev: null, prefs: null, workspace: null, invites: null, shares: null
      });
    } catch (e) { console.warn('[AStore] old layout left in place', e); }
    AStore.migrating = null;
    return true;
  }

  async function ensureLayout(uid, onProgress) {
    try {
      var moved = await migrate(uid, onProgress);
      return moved ? 'migrated' : 'ok';
    } catch (e) {
      AStore.migrating = null;
      AStore.migrationError = (e && e.message) || String(e);
      console.error('[AStore] migration failed', e);
      try {
        var legacy = await hasAnyChild(uid, 'pages');
        var idxHas = await hasAnyChild(uid, 'idx');
        if (legacy && !idxHas) return 'stranded';
      } catch (e2) {}
      return 'error';
    }
  }

  /* ------------------------------------------------------------ subscribe
     Idempotent. Re-entry with the same uid is a no-op; a different uid
     releases every handle first. This is the fix for the multiplier: before,
     each call silently stacked another full listener set on top of the last,
     and onChildAdded replays every child to each one. */
  function releaseAll() {
    handles.forEach(function (u) { try { u(); } catch (e) {} });
    handles = [];
    subscribedTo = null;
  }

  function subscribe(uid) {
    if (subscribedTo === uid) return;
    if (subscribedTo) releaseAll();
    subscribedTo = uid;

    var cached = mirror.read();
    remote = cached || {};
    if (!remote.pages) remote.pages = {};
    if (!remote.dbmeta) remote.dbmeta = {};
    if (!remote.vmeta) remote.vmeta = {};
    if (!remote.prefs) remote.prefs = {};
    if (!remote.invites) remote.invites = [];
    /* pages OTHER accounts have shared with this one, kept so the sidebar can
       show them again after a reload without waiting on the inbox */
    if (!remote.shares) remote.shares = [];

    /* ---- pages ---- */
    function considerIdx(id, e) {
      if (!e) return;
      var have = remote.pages[id];
      var mine = e.w === WID;
      remote.pages[id] = e;
      if (!mine && have && (e.u || 0) > (have.u || 0)) {
        delete bodies[id]; cache.drop(BODY, id);
        if (AStore.onBodyStale) AStore.onBodyStale(id);
      }
      emit();
    }
    watchCol(uid, 'idx', 'idx', {
      added: function (id, e) { markIndexReady(); considerIdx(id, e); },
      changed: considerIdx,
      removed: function (id) {
        delete remote.pages[id]; delete bodies[id];
        cache.drop(BODY, id); emit();
      }
    });

    /* ---- database schema + row order ---- */
    function considerMeta(id, m) {
      if (!m) return;
      var had = remote.dbmeta[id];
      remote.dbmeta[id] = m;
      /* someone else changed the row set — our cached rows may be short */
      if (m.w !== WID && had && rowsMem[id]) {
        var want = (m.o || []).length;
        if (want !== rowsMem[id].length) { delete rowsMem[id]; cache.drop(ROWS, id); }
      }
      emit();
    }
    watchCol(uid, 'dbmeta', 'dbmeta', {
      added: considerMeta,
      changed: considerMeta,
      removed: function (id) {
        delete remote.dbmeta[id]; delete rowsMem[id];
        cache.drop(ROWS, id); emit();
      }
    });

    /* ---- the row-change ping: ~60 bytes instead of a whole table ---- */
    function considerRev(id, r) {
      if (!r || r.w === WID) return;              // our own write
      if (!rowsMem[id]) return;                   // not holding this table
      if (r.r) {
        /* refetch exactly the row that moved */
        getMetered(uid, 'dbrow/' + id + '/' + r.r, 'dbrow').then(function (row) {
          var list = rowsMem[id]; if (!list) return;
          var i = list.findIndex(function (x) { return x.id === r.r; });
          if (!row) { if (i >= 0) list.splice(i, 1); }
          else if (i >= 0) list[i] = row;
          else list.push(row);
          cache.put(ROWS, id, list);
          emit();
        });
      } else { delete rowsMem[id]; cache.drop(ROWS, id); emit(); }
    }
    /* no `removed`: a row-change ping is overwritten, never deleted */
    watchCol(uid, 'dbrev', 'dbrev', { added: considerRev, changed: considerRev });

    /* ---- workspace meta: one read, it barely changes ---- */
    getMetered(uid, 'meta', 'meta').then(function (m) {
      if (!m) return;
      remote.prefs = m.prefs || remote.prefs;
      remote.workspace = m.workspace || remote.workspace;
      remote.invites = m.invites || [];
      remote.shares = m.shares || [];
      emit();
    }).catch(function () {});

    /* the mirror may hold entries from another account — prune stale caches */
    setTimeout(function () {
      var l = cache.lru();
      Object.keys(l).forEach(function (k) {
        if (k.indexOf(BODY) === 0 && !remote.pages[k.slice(BODY.length)]) cache.drop(BODY, k.slice(BODY.length));
        if (k.indexOf(ROWS) === 0 && !remote.dbmeta[k.slice(ROWS.length)]) cache.drop(ROWS, k.slice(ROWS.length));
      });
    }, 5000);

    /* Resolve the third state as early as possible: a cached index means we are
       already painting real data, and a confirmed-absent `idx` node means the
       account really is empty. Otherwise wait for the first child. The timeout
       is a floor, not a feature — a dead connection must not strand the user on
       a skeleton forever. */
    /* A backend that cannot stream still has to fill the sidebar: read the two
       collections once. Everything downstream is identical — the same
       considerIdx/considerMeta run over the same entries — so the only thing
       lost is seeing another device's edit without a reload, which is exactly
       what caps.realtime: false claims. */
    if (!backend.caps.realtime) {
      /* This read is also the answer to "is the index empty?", so the probe
         below is skipped — asking twice would double the one read at boot that
         this whole layout exists to keep small. */
      backend.readPage(WS(uid), 'idx', null, 0).then(function (all) {
        Object.keys(all || {}).forEach(function (id) { considerIdx(id, meter(all[id], 'idx')); });
        markIndexReady();
      }).catch(function () { markIndexReady(); });
      backend.readPage(WS(uid), 'dbmeta', null, 0).then(function (all) {
        Object.keys(all || {}).forEach(function (id) { considerMeta(id, meter(all[id], 'dbmeta')); });
      }).catch(function () {});
      if (!idxTimer) idxTimer = setTimeout(markIndexReady, 8000);
    } else if (Object.keys(remote.pages).length) markIndexReady();
    else {
      hasAnyChild(uid, 'idx')
        .then(function (any) { if (!any) markIndexReady(); })
        .catch(function () { markIndexReady(); });
      if (!idxTimer) idxTimer = setTimeout(markIndexReady, 8000);
    }

    emit();
  }

  /* ------------------------------------------------------------------ api */
  var AStore = {
    /* `cloud` is the question the app actually asks: is there a server, or is
       this browser the only copy?

       `mode` is the name that question used to have, kept because something
       outside this repo may still read it. It is now DERIVED rather than
       stored: it was a second copy of the same fact, kept in step by hand at
       three call sites, and a copy kept by hand is one that eventually is not. */
    cloud: useCloud,
    get mode() { return this.cloud ? 'firebase' : 'local'; },
    /* which database is actually running, and the sentence explaining why.
       Both are shown in Settings -> Data & sync. */
    backendName: picked,
    authName: null,
    caps: null,
    why: why,
    hasConfig: hasConfig,
    demo: demo,
    lastError: null,
    projectId: (conf.backends[picked] && conf.backends[picked].projectId) || null,
    ready: false,
    user: null,
    onBodyStale: null,
    onLayout: null,
    onIndexReady: null,
    indexReady: false,
    migrating: null,
    migrationError: null,
    /* down/reads now include LISTENER traffic, not just explicit gets */
    stats: { up: 0, down: 0, writes: 0, reads: 0, by: {} },

    enterDemo: function () {
      try { localStorage.setItem(DEMO_KEY, '1'); } catch (e) {}
      this.demo = true; this.cloud = false; useCloud = false;
      return this.signInWithGoogle();
    },
    leaveDemo: function () {
      try { localStorage.removeItem(DEMO_KEY); localStorage.removeItem(AUTH_KEY); } catch (e) {}
      location.reload();
    },

    /* Single-flight. The app retries init() on a timer while the SDK is still
       importing; without this guard each retry registered another auth
       observer, and every one of those went on to attach its own listener set
       on each token refresh. */
    init: function (onState) {
      if (onState && listeners.indexOf(onState) < 0) listeners.push(onState);
      if (this._initP) return this._initP;
      this._initP = this._doInit();
      return this._initP;
    },

    async _doInit() {
      if (!useCloud) {
        this.user = local.user();
        this.ready = true;
        this.indexReady = true;   // the flat blob IS the index
        notifyAuth(this.user);
        return local.read();
      }
      /* paint from the index mirror before the network is touched */
      var cached = mirror.read();
      var first = null;
      if (cached && cached.pages) {
        remote = cached;
        if (!remote.dbmeta) remote.dbmeta = {};
        if (!remote.vmeta) remote.vmeta = {};
        Object.keys(cached.pages).forEach(function (id) {
          var b = cache.get(BODY, id);
          if (b) bodies[id] = b;
        });
        Object.keys(remote.dbmeta).forEach(function (id) {
          var r = cache.get(ROWS, id);
          if (r) rowsMem[id] = r;
        });
        first = project();
      }
      try {
        await openBackend();
        var self = this;
        auth.onChange(function (u) {
          self.user = u || null;
          notifyAuth(self.user);
          if (!self.user) { releaseAll(); return; }
          /* Token refresh fires this again with the same user. subscribe() is
             idempotent, and the layout check is skipped once it has passed.
             The in-flight flag is set SYNCHRONOUSLY: without it a second auth
             event arriving before the first migration resolves would start a
             concurrent migration over the same workspace — doubling the very
             one-time read this refactor exists to avoid. */
          runContractCheck(self.user.uid);
          if (self._layoutOk === self.user.uid) { subscribe(self.user.uid); return; }
          if (self._layoutBusy === self.user.uid) return;
          self._layoutBusy = self.user.uid;
          ensureLayout(self.user.uid, function (n) {
            if (self.onLayout) self.onLayout('progress', n);
          }).then(function (status) {
            self._layoutBusy = null;
            if (status === 'ok' || status === 'migrated') self._layoutOk = self.user.uid;
            subscribe(self.user.uid);
            if (self.onLayout) self.onLayout(status, self.migrationError);
          });
        });
        this.ready = true;
        return first;
      } catch (e) {
        console.warn('[AStore] the "' + picked + '" backend could not be opened, falling back to this browser.', e);
        this.cloud = false; useCloud = false;
        this.user = local.user();
        this.ready = true;
        this.indexReady = true;
        notifyAuth(this.user);
        return local.read() || first;
      }
    },

    /* ---- page bodies, on demand ----------------------------------------
     The `!backend || !this.user` retries below are the boot window: the app
     asks for a body the moment a page is opened, which can be before the
     backend has finished connecting or before sign-in has resolved. Waiting
     and re-asking is right for every backend — none of them can answer before
     they are open — so the retry belongs here rather than inside each one. */
    hasBody: function (id) { return !!bodies[id]; },
    loadBody: function (id) {
      /* mode check FIRST: in local/demo mode the flat blob is the only truth,
         and serving from the cloud cache would let a stale copy win */
      if (!this.cloud) return Promise.resolve(null);
      if (bodies[id]) return Promise.resolve(bodies[id]);
      if (loadingBody[id]) return loadingBody[id];
      var hit = cache.get(BODY, id);
      if (hit) { bodies[id] = hit; return Promise.resolve(hit); }
      if (!backend || !this.user) {
        var s0 = this;
        return new Promise(function (r) { setTimeout(function () { r(s0.loadBody(id)); }, 500); });
      }
      loadingBody[id] = getMetered(this.user.uid, 'body/' + id, 'body').then(function (v) {
        delete loadingBody[id];
        /* A MISSING node is not an empty note. Caching [] here would let the
           next save write that emptiness back over real text. */
        if (!v || !v.b) return null;
        bodies[id] = v.b;
        cache.put(BODY, id, v.b);
        return v.b;
      }).catch(function () { delete loadingBody[id]; return null; });
      return loadingBody[id];
    },
    putBody: function (id, blocks) {
      if (!this.cloud) return;
      bodies[id] = blocks; cache.put(BODY, id, blocks);
    },

    /* ---- publish to web -------------------------------------------------
       A published page lives OUTSIDE the workspace, in `pub/<slug>`, which the
       rules make world-readable and owner-writable. The workspace itself stays
       exactly as locked as it always was: this adds a place to put a copy
       rather than opening a door into the original.

       `pub/<slug>` is self-contained — title, icon, blocks and every table the
       blocks embed — so a reader needs one read and no access to anything else.

       A PASSWORD LINK IS ENCRYPTED, not gated. Checking a password in the
       reader would be theatre: the node is world-readable, so anyone could
       fetch the body and ignore the prompt. The payload is sealed with
       AES-GCM under a key derived from the password, so the stored bytes are
       useless without it. */
    publishPage: function (slug, payload, password) {
      if (!this.cloud || !backend || !this.user || !slug) return Promise.resolve(false);
      var uid = this.user.uid, self = this;
      var body = { o: uid, u: Date.now() };
      var seal = password
        ? encryptJSON(password, payload).then(function (enc) { body.enc = enc; })
        : Promise.resolve().then(function () {
            body.t = payload.t || ''; body.i = payload.i || '';
            body.b = payload.b || []; if (payload.d) body.d = payload.d;
          });
      return seal.then(function () {
        self.stats.up += JSON.stringify(body).length;
        self.stats.writes++;
        return backend.write(ROOT, 'pub/' + slug, body).then(function () { return true; });
      }).catch(function (e) { console.warn('[AStore] publish failed', e); return false; });
    },
    /* ---- sharing a page with one other account -------------------------
       Three nodes make this work, and the security rules are half of the
       design:

         inbox/<emailKey>/<inviteId>   an invitation, readable ONLY by the
                                       account whose verified email matches
                                       the key, writable by its sender
         shared/<pageId>               the page itself: `o` the owner, `m` the
                                       members by email key, and the content.
                                       Readable by the owner and by any member

       An email cannot be a key as it stands — RTDB forbids `.` — so it is
       lowercased and its dots become commas. The rules do the same to
       `auth.token.email`, which is how "this inbox is mine" is decided by the
       server rather than by the client asking nicely.

       Invites used to be written into the SENDER's own workspace, which no
       other account can read, so "Invitation sent" was a message that went
       nowhere at all. */
    emailKey: function (email) {
      var e = String(email || '').trim().toLowerCase();
      /* the four other characters RTDB reserves; an address containing one
         cannot be keyed, and inventing a key would silently drop the invite */
      if (!e || /[#$\[\]\/]/.test(e) || e.indexOf('@') < 0) return null;
      return e.replace(/\./g, ',');
    },
    myEmailKey: function () {
      return this.user ? this.emailKey(this.user.email) : null;
    },
    /* Deliver an invitation into someone else's inbox. */
    sendInviteTo: function (email, invite) {
      var key = this.emailKey(email);
      if (!this.cloud || !backend || !this.user || !key) return Promise.resolve(false);
      this.stats.up += JSON.stringify(invite).length;
      this.stats.writes++;
      return backend.write(ROOT, 'inbox/' + key + '/' + invite.id, invite)
        .then(function () { return true; })
        .catch(function (e) { console.warn('[AStore] invite failed', e); return false; });
    },
    /* Everything waiting for the signed-in account. One read, on demand. */
    loadInbox: function () {
      var key = this.myEmailKey();
      if (!this.cloud || !backend || !this.user || !key) return Promise.resolve([]);
      var self = this;
      return backend.readPage(ROOT, 'inbox/' + key, null, 0).then(function (v) {
        v = v || {};
        self.stats.down += JSON.stringify(v).length;
        self.stats.reads++;
        return Object.keys(v).map(function (k) { return v[k]; })
          .filter(function (x) { return x && x.pageId && x.from; })
          .sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
      }).catch(function (e) { console.warn('[AStore] inbox read failed', e); return []; });
    },
    /* Answering an invitation removes it — the rules let the recipient clear
       their own inbox, and the sender remove what they sent. */
    dropInvite: function (inviteId, email) {
      var key = email ? this.emailKey(email) : this.myEmailKey();
      if (!this.cloud || !backend || !this.user || !key || !inviteId) return Promise.resolve(false);
      return backend.write(ROOT, 'inbox/' + key + '/' + inviteId, null)
        .then(function () { return true; }).catch(function () { return false; });
    },
    /* The shared copy of a page, and who may read it. Written whole, so a
       member removed here loses access on the same write that drops them. */
    putShared: function (pageId, payload, memberEmails) {
      if (!this.cloud || !backend || !this.user || !pageId) return Promise.resolve(false);
      var self = this;
      var m = {};
      (memberEmails || []).forEach(function (e) {
        var k = self.emailKey(e);
        if (k) m[k] = true;
      });
      var body = {
        o: this.user.uid, u: Date.now(),
        n: (this.user.name || ''), t: payload.t || '', i: payload.i || '',
        b: payload.b || [], m: m
      };
      if (payload.d && Object.keys(payload.d).length) body.d = payload.d;
      this.stats.up += JSON.stringify(body).length;
      this.stats.writes++;
      return backend.write(ROOT, 'shared/' + pageId, body)
        .then(function () { return true; })
        .catch(function (e) { console.warn('[AStore] share failed', e); return false; });
    },
    loadShared: function (pageId) {
      if (!this.cloud || !pageId) return Promise.resolve(null);
      if (!backend) { return Promise.resolve(null); }
      var self = this;
      return backend.read(ROOT, 'shared/' + pageId).then(function (v) {
        if (!v) return null;
        self.stats.down += JSON.stringify(v).length;
        self.stats.reads++;
        return { o: v.o, owner: v.n || '', t: v.t || '', i: v.i || '',
                 b: v.b || [], d: v.d || {}, u: v.u || 0 };
      }).catch(function (e) { console.warn('[AStore] shared read failed', e); return null; });
    },
    dropShared: function (pageId) {
      if (!this.cloud || !backend || !this.user || !pageId) return Promise.resolve(false);
      return backend.write(ROOT, 'shared/' + pageId, null)
        .then(function () { return true; }).catch(function () { return false; });
    },

    unpublishPage: function (slug) {
      if (!this.cloud || !backend || !this.user || !slug) return Promise.resolve(false);
      return backend.write(ROOT, 'pub/' + slug, null)
        .then(function () { return true; })
        .catch(function (e) { console.warn('[AStore] unpublish failed', e); return false; });
    },
    /* Reading one needs no account — that is the whole point of a public link.
       Returns `{ locked: true }` when the page is sealed and no password was
       given, so the reader can ask for one without a second round trip. */
    loadPublic: async function (slug, password) {
      if (!slug) return null;
      /* Nobody is signed in when a published link is opened, so the backend is
         usually not open yet — open it, and read a path the rules make world
         readable. A backend whose caps say it cannot do that says so here
         rather than failing as a permission error the reader cannot act on. */
      if (!backend) { try { await openBackend(); } catch (e) { return null; } }
      if (!backend) return null;
      if (!backend.caps.publicRead) {
        console.warn('[AStore] the "' + AStore.backendName + '" backend cannot serve a public page');
        return null;
      }
      var v;
      try { v = await backend.read(ROOT, 'pub/' + slug); }
      catch (e) { console.warn('[AStore] public read failed', e); return null; }
      if (!v) return null;
      AStore.stats.down += JSON.stringify(v).length;
      AStore.stats.reads++;
      if (!v.enc) return { t: v.t || '', i: v.i || '', b: v.b || [], d: v.d || {}, u: v.u || 0 };
      if (!password) return { locked: true, u: v.u || 0 };
      var out = await decryptJSON(password, v.enc);
      if (!out) return { locked: true, wrong: true, u: v.u || 0 };
      return { t: out.t || '', i: out.i || '', b: out.b || [], d: out.d || {}, u: v.u || 0 };
    },

    /* ---- database rows, on demand -------------------------------------- */
    hasRows: function (id) { return !!rowsMem[id]; },
    loadRows: function (dbId) {
      if (!this.cloud) return Promise.resolve(null);
      if (rowsMem[dbId]) return Promise.resolve(rowsMem[dbId]);
      if (loadingRows[dbId]) return loadingRows[dbId];
      var hit = cache.get(ROWS, dbId);
      if (hit) { rowsMem[dbId] = hit; return Promise.resolve(hit); }
      if (!backend || !this.user) {
        var s0 = this;
        return new Promise(function (r) { setTimeout(function () { r(s0.loadRows(dbId)); }, 500); });
      }
      loadingRows[dbId] = getMetered(this.user.uid, 'dbrow/' + dbId, 'dbrow').then(function (v) {
        delete loadingRows[dbId];
        /* A MISSING node is not an empty table \u2014 same contract as loadBody().
           migrate() writes dbmeta before the rows (in separate bounded
           updates), so there is a real window where the schema exists and the
           rows do not. Resolving that to [] would let push() write `o: []`
           over dbmeta and permanently lose the manual drag order, which is the
           only thing dbmeta.o exists to store. Return null; the caller decides
           using the row count the index already carries. */
        if (!v) return null;
        var list = Object.keys(v).map(function (rid) {
          var r = v[rid]; if (r && !r.id) r.id = rid; return r;
        });
        rowsMem[dbId] = list;
        cache.put(ROWS, dbId, list);
        return list;
      }).catch(function () { delete loadingRows[dbId]; return null; });
      return loadingRows[dbId];
    },
    /* The app handing us its current row list is also the only moment a row
       DELETION is observable. push() used to infer deletions from `sent.dbrow`
       — the rows it had itself uploaded this session — so deleting a row that
       had not been touched since the page loaded left `dbrow/<db>/<row>` alive
       on the server. `dbmeta.o` lost the id, but fromDbMeta() deliberately
       re-appends any row present in the node and missing from the order, so
       the row came back at the bottom of the table on the next cold load.

       Diffing against the list we held is knowledge `sent` does not have.
       A row that comes back (an undo) simply clears its own tombstone. */
    putRows: function (dbId, rows) {
      if (!this.cloud) return;
      var had = rowsMem[dbId];
      if (had) {
        var live = {};
        (rows || []).forEach(function (r) { live[r.id] = 1; });
        had.forEach(function (r) {
          if (!live[r.id]) {
            rowGone[dbId] = rowGone[dbId] || {};
            rowGone[dbId][r.id] = 1;
          }
        });
      }
      if (rowGone[dbId]) (rows || []).forEach(function (r) { delete rowGone[dbId][r.id]; });
      rowsMem[dbId] = rows; cache.put(ROWS, dbId, rows);
    },

    /* ---- search digests: one read, the first time search is used ------- */
    loadDigests: function () {
      if (digests) return Promise.resolve(digests);
      if (digestsP) return digestsP;
      if (!this.cloud || !backend || !this.user) return Promise.resolve(null);
      try {
        var raw = localStorage.getItem(DIG);
        if (raw) { digests = JSON.parse(raw); return Promise.resolve(digests); }
      } catch (e) {}
      digestsP = getMetered(this.user.uid, 'dig', 'dig').then(function (v) {
        digestsP = null;
        digests = v || {};
        try { localStorage.setItem(DIG, JSON.stringify(digests)); } catch (e) {}
        return digests;
      }).catch(function () { digestsP = null; return null; });
      return digestsP;
    },
    peekDigests: function () { return digests; },

    /* Two tiers. localStorage is free and protects against a refresh, so it
       runs on a short fuse. The network is the expensive tier and waits for a
       real pause — plus blur and unload, so nothing is ever lost. */
    write: function (state) {
      pending = state;
      notifySave('saving');
      if (mirrorTimer) clearTimeout(mirrorTimer);
      mirrorTimer = setTimeout(function () {
        mirrorTimer = null;
        var run = function () {
          if (!pending) return;
          if (AStore.cloud) AStore.mirrorNow(pending);
          else local.write(pending);
          notifySave('saved');
        };
        if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 400 });
        else run();
      }, MIRROR_DELAY);

      if (!this.cloud) return;
      if (netTimer) clearTimeout(netTimer);
      netTimer = setTimeout(function () { netTimer = null; AStore.push(); }, PUSH_DELAY);
    },

    mirrorNow: function (state) {
      var m = { pages: {}, dbmeta: {}, vmeta: {}, prefs: state.prefs || {},
                workspace: state.workspace, invites: state.invites || [],
                shares: state.shares || [] };
      Object.keys(state.pages || {}).forEach(function (id) {
        var p = state.pages[id];
        if (p.shared) return;                    // not ours to mirror — see push()
        m.pages[id] = p.blocks ? toIdx(p) : (remote && remote.pages[id]) || toIdx(p);
        m.vmeta[id] = (p.versions || []).map(function (v) {
          var x = {}; Object.keys(v).forEach(function (k) { if (k !== 'blocks' && k !== 'dbs') x[k] = v[k]; });
          return x;
        });
        /* the mirror runs on a 240ms fuse, well before the network push — so
           this is the first chance to stop a fresh snapshot being clobbered */
        if (remote && remote.vmeta && m.vmeta[id].length) remote.vmeta[id] = m.vmeta[id];
        if (p.blocks) cache.put(BODY, id, p.blocks);
      });
      Object.keys(state.dbs || {}).forEach(function (id) {
        var d = state.dbs[id];
        m.dbmeta[id] = d.rows ? toDbMeta(d) : (remote && remote.dbmeta[id]) || toDbMeta(d);
        if (d.rows) cache.put(ROWS, id, d.rows);
      });
      mirror.write(m);
    },

    onSave: function (cb) { saveCbs.push(cb); },

    flush: function () {
      if (!pending) return;
      if (mirrorTimer) { clearTimeout(mirrorTimer); mirrorTimer = null; }
      if (this.cloud) { this.mirrorNow(pending); this.push(); }
      else { local.write(pending); }
      notifySave('saved');
    },

    /* The network tier: diff against what we last sent and update only those
       subtrees, in one round trip. */
    push: function () {
      if (!this.cloud || !pending) return;
      if (netTimer) { clearTimeout(netTimer); netTimer = null; }
      if (!backend || !this.user) {
        var self = this;
        if (!this._booting) {
          this._booting = true;
          this.init().then(function () { self._booting = false; self.push(); })
            .catch(function () { self._booting = false; });
        } else setTimeout(function () { self.push(); }, 800);
        return;
      }
      var uid = this.user.uid;
      var st = pending;
      var patch = {}, n = 0, now = Date.now();
      /* tables whose row tombstones this patch carries — cleared only once the
         write has actually gone out, so a failed push still deletes next time */
      var gone = [];
      /* ---- what "we believe the server has" looked like before this push ---
         `sent`, `vqueue` and `vmetaSeen` are all updated OPTIMISTICALLY as the
         patch is assembled, and the write used to be fire-and-forget: a
         rejected update left `sent` claiming the bytes had landed, so the next
         push saw no difference and never retried, while the queued version
         payload had already been dropped. The snapshot below is what makes the
         optimism reversible. The maps hold one string per id, so copying them
         is a pointer copy, not a copy of the bodies. */
      var was = {
        idx: Object.assign({}, sent.idx), body: Object.assign({}, sent.body),
        dig: Object.assign({}, sent.dig), vmeta: Object.assign({}, sent.vmeta),
        dbmeta: Object.assign({}, sent.dbmeta), dbrow: Object.assign({}, sent.dbrow),
        meta: sent.meta, vmetaSeen: Object.assign({}, vmetaSeen), vdata: {}
      };

      /* ---- pages ---- */
      Object.keys(st.pages || {}).forEach(function (id) {
        var p = st.pages[id];
        /* A page shared WITH this account is somebody else's note, held in
           memory so it can be read. Writing it here would copy it into this
           workspace and then push it back as if it were ours. */
        if (p.shared) return;
        if (!p.blocks) {
          /* A body we never fetched cannot be dirty — but the page's INDEX
             fields still can. repairRowPages() puts `dbRef` and `hidden` back
             on row pages the old format stripped, and those pages are usually
             not open, so skipping them outright left the repair local and made
             every device redo it every session. Write the entry, and carry the
             block count and snippet over from what is already stored rather
             than letting toIdx() derive `n: 0` from the absent body.

             Diff against what is STORED, not against `sent` — `sent` is empty
             at the start of every session, so trusting it here would rewrite
             every unopened page in the workspace on the first save. */
          var idxHave = remote && remote.pages && remote.pages[id];
          if (!idxHave) return;
          var ie = toIdx(p);
          ie.n = idxHave.n || 0; ie.s = idxHave.s || '';
          if (stable(ie) === stable(idxHave, true)) return;
          var iw = wire(ie);
          if (sent.idx[id] !== iw.body) {
            sent.idx[id] = iw.body;
            iw.value.w = WID;
            patch['idx/' + id] = iw.value; n++;
            /* keep the in-memory index in step with what we just wrote, so the
               mirror — which runs on a 240ms fuse, long before the echo comes
               back — stores the repaired entry rather than the one it replaced */
            remote.pages[id] = iw.value;
          }
          return;
        }
        /* Belt and braces for the null-vs-empty trap. If we never fetched this
           body, an empty array cannot be a real edit — it is a workspace-wide
           rewrite (a trash or a page move) that turned `null` into []. Writing
           it would blank a note nobody touched. */
        if (sent.body[id] === undefined && p.blocks.length === 0 && (p.blockCount || 0) > 0) return;

        var bw = wire({ b: p.blocks });
        if (sent.body[id] !== bw.body) { sent.body[id] = bw.body; patch['body/' + id] = bw.value; n++; }

        var ew = wire(toIdx(p));
        if (sent.idx[id] !== ew.body) {
          sent.idx[id] = ew.body;
          ew.value.w = WID;                       // inside the object — see rule 1
          patch['idx/' + id] = ew.value; n++;
        }
        /* the digest is its own node so it never rides along on a body save */
        var dg = digestOf(p.blocks);
        if (sent.dig[id] !== dg) {
          sent.dig[id] = dg; patch['dig/' + id] = dg;
          if (digests) digests[id] = dg;
          n++;
        }
        /* `blocks` AND `dbs` are payload, not metadata. Only `blocks` was
           stripped, so every table a snapshot captured was duplicated into the
           version list — the one node a page open always downloads. Nothing
           reads `dbs` off the metadata any more (dbFor() takes the payload's
           copy), so it is dropped here too, on legacy entries as well. */
        var vm = wire((p.versions || []).map(function (v) {
          var x = {}; Object.keys(v).forEach(function (k) { if (k !== 'blocks' && k !== 'dbs') x[k] = v[k]; });
          return x;
        }));
        /* Never write an empty history we have not confirmed. Version metadata
           lives in its own node, so an unloaded one presents as `[]` on the
           page object — writing that would erase real snapshots. Same
           null-vs-empty contract as bodies and rows. */
        var emptyVm = !(p.versions || []).length;
        if (emptyVm && !vmetaSeen[id]) return;
        if (sent.vmeta[id] !== vm.body) {
          sent.vmeta[id] = vm.body;
          patch['vmeta/' + id] = vm.value;
          /* Keep the in-memory index in step with what we just wrote. project()
             rebuilds every page's `versions` from remote.vmeta, so leaving it
             stale meant the next emit() — triggered by the echo of this very
             write — handed the app the OLD list and a snapshot the user had
             just taken vanished a moment after appearing. */
          if (remote) { if (!remote.vmeta) remote.vmeta = {}; remote.vmeta[id] = vm.value; }
          vmetaSeen[id] = true;
          n++;
        }
      });
      Object.keys(sent.idx).forEach(function (id) {
        if (!st.pages || !st.pages[id]) {
          delete sent.idx[id]; delete sent.body[id]; delete sent.vmeta[id]; delete sent.dig[id];
          patch['idx/' + id] = null; patch['body/' + id] = null;
          patch['dig/' + id] = null; patch['vmeta/' + id] = null; patch['vdata/' + id] = null;
          cache.drop(BODY, id); n++;
        }
      });

      /* ---- databases: meta when the schema or order moves, one node per
         changed row, and a tiny ping so the other device knows ---- */
      Object.keys(st.dbs || {}).forEach(function (id) {
        var d = st.dbs[id];
        if (!d.rows) return;                      // never viewed: cannot be dirty

        var mw = wire(toDbMeta(d));
        if (sent.dbmeta[id] !== mw.body) {
          sent.dbmeta[id] = mw.body;
          mw.value.w = WID;
          patch['dbmeta/' + id] = mw.value; n++;
        }
        var touched = null, count = 0;
        var live = {};
        d.rows.forEach(function (r) {
          live[r.id] = 1;
          var k = id + '/' + r.id;
          var rw = wire(r);
          if (sent.dbrow[k] === rw.body) return;
          sent.dbrow[k] = rw.body;
          patch['dbrow/' + k] = rw.value;
          touched = r.id; count++; n++;
        });
        /* Two sources for "this row is gone", and both are needed. `sent.dbrow`
           catches rows this session uploaded; `rowGone` catches the rest — a row
           deleted without ever being edited was in neither map before, so its
           node outlived the delete and fromDbMeta() re-appended it on the next
           cold load. */
        Object.keys(sent.dbrow).forEach(function (k) {
          if (k.indexOf(id + '/') !== 0) return;
          var rid = k.slice(id.length + 1);
          if (live[rid]) return;
          delete sent.dbrow[k];
          patch['dbrow/' + k] = null;
          touched = rid; count++; n++;
        });
        Object.keys(rowGone[id] || {}).forEach(function (rid) {
          if (live[rid]) return;                  // came back before we pushed
          if (patch['dbrow/' + id + '/' + rid] === null) return;   // already nulled above
          patch['dbrow/' + id + '/' + rid] = null;
          delete sent.dbrow[id + '/' + rid];
          touched = rid; count++; n++;
        });
        gone.push(id);
        if (count) {
          /* one changed row → name it, so the peer refetches just that row;
             several → let the peer drop and reload the table */
          patch['dbrev/' + id] = { u: now, w: WID, r: count === 1 ? touched : null };
          n++;
        }
      });
      Object.keys(sent.dbmeta).forEach(function (id) {
        if (!st.dbs || !st.dbs[id]) {
          delete sent.dbmeta[id];
          patch['dbmeta/' + id] = null; patch['dbrow/' + id] = null; patch['dbrev/' + id] = null;
          cache.drop(ROWS, id); n++;
          gone.push(id);           // the whole subtree goes; per-row tombstones are moot
        }
      });

      var meta = wire({ prefs: st.prefs || {}, workspace: st.workspace || null,
                        invites: st.invites || [], shares: st.shares || [] });
      if (sent.meta !== meta.body) { sent.meta = meta.body; patch['meta'] = meta.value; n++; }

      Object.keys(vqueue).forEach(function (k) {
        var v = vqueue[k];
        patch['vdata/' + k] = v === null ? null : wire(v).value;
        was.vdata[k] = v;
        delete vqueue[k]; n++;
      });

      if (!n) { notifySave('saved'); return; }
      this.stats.up += JSON.stringify(patch).length;
      this.stats.writes++;

      var self2 = this;
      /* A backend with a `maxCommit` cannot take an arbitrarily large patch.
         Splitting one costs the all-or-nothing guarantee, which matters: a
         half-applied save can leave a page's text newer than its index entry.
         Every write the store makes is a REPLACE rather than an append, so the
         retry below re-sends the whole patch and repairs it — but it is worth
         knowing that a very large first save on such a backend is the one
         moment this app is not atomic. */
      var send = function () {
        var cap = backend.caps.maxCommit;
        var keys = Object.keys(patch);
        if (!cap || keys.length <= cap) return backend.commit(WS(uid), patch);
        var chain = Promise.resolve();
        for (var i = 0; i < keys.length; i += cap) {
          (function (slice) {
            chain = chain.then(function () {
              var part = {};
              slice.forEach(function (k) { part[k] = patch[k]; });
              return backend.commit(WS(uid), part);
            });
          })(keys.slice(i, i + cap));
        }
        return chain;
      };
      var ok = function () {
        /* the tombstones are only spent once the delete has really gone out */
        gone.forEach(function (id) { delete rowGone[id]; });
        retryWait = 0;
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
        notifySave('saved');
      };
      /* Put the bookkeeping back exactly as it was, so the next push re-diffs
         dirty and sends the same bytes again. `remote` is deliberately NOT
         rolled back: the app is still holding this state and the mirror has
         it, and reverting it would make a snapshot the reader can see vanish
         from the panel because a network write failed. */
      var undo = function (e) {
        console.warn('[AStore] write failed — will retry', e);
        sent.idx = was.idx; sent.body = was.body; sent.dig = was.dig;
        sent.vmeta = was.vmeta; sent.dbmeta = was.dbmeta; sent.dbrow = was.dbrow;
        sent.meta = was.meta;
        vmetaSeen = was.vmetaSeen;
        Object.keys(was.vdata).forEach(function (k) {
          /* a newer payload queued since this push wins — it is the current one */
          if (!(k in vqueue)) vqueue[k] = was.vdata[k];
        });
        notifySave('error');
        scheduleRetry();
      };
      try {
        var p2 = send();
        if (p2 && p2.then) p2.then(ok, undo);
        else ok();
      }
      catch (e) { undo(e); }
    },
    /* Whether a write is still owed to the server. The app reads it to say so;
       the tests read it to prove a failed push is not simply forgotten. */
    retryPending: function () { return !!retryTimer; },

    /* ---- version bodies: cold data, fetched only when opened ---------- */
    putVersionBlocks: function (pageId, vId, blocks) {
      if (this.cloud) vqueue[pageId + '/' + vId] = blocks;
      vcachePut(pageId + '/' + vId, blocks);
    },
    getVersionBlocks: function (pageId, vId) {
      var k = pageId + '/' + vId;
      if (vcache[k]) { vcachePut(k, vcache[k]); return Promise.resolve(vcache[k]); }
      if (!this.cloud || !backend || !this.user) return Promise.resolve(null);
      return getMetered(this.user.uid, 'vdata/' + k, 'vdata').then(function (b) {
        if (b) vcachePut(k, b);
        return b || null;
      }).catch(function () { return null; });
    },
    dropVersionBlocks: function (pageId, vId) {
      var k = pageId + '/' + vId;
      delete vcache[k];
      var i = vcacheLru.indexOf(k);
      if (i >= 0) vcacheLru.splice(i, 1);
      if (this.cloud) vqueue[k] = null;
    },

    retryMigration: function () {
      if (!this.cloud || !backend || !this.user) return Promise.resolve('error');
      this.migrationError = null;
      var self = this;
      if (this._layoutBusy === this.user.uid) return Promise.resolve('busy');
      this._layoutBusy = this.user.uid;
      return ensureLayout(this.user.uid, function (n) {
        if (self.onLayout) self.onLayout('progress', n);
      }).then(function (status) {
        self._layoutBusy = null;
        if (status === 'ok' || status === 'migrated') self._layoutOk = self.user.uid;
        subscribe(self.user.uid);
        if (self.onLayout) self.onLayout(status, self.migrationError);
        return status;
      });
    },

    /* ---- maintenance: remove a database outright -----------------------
       An unreferenced table is otherwise unreachable: push()'s deletion path
       only nulls ids present in `sent.dbmeta`, and that map is empty after any
       reload, so an orphan survives forever and is re-downloaded on every
       boot. This is the one operation that deletes a whole table subtree. */
    purgeDatabases: function (ids) {
      if (!this.cloud || !backend || !this.user) return Promise.resolve(0);
      if (!ids || !ids.length) return Promise.resolve(0);
      var patch = {};
      ids.forEach(function (id) {
        patch['dbmeta/' + id] = null;
        patch['dbrow/' + id] = null;
        patch['dbrev/' + id] = null;
        delete sent.dbmeta[id];
        Object.keys(sent.dbrow).forEach(function (k) {
          if (k.indexOf(id + '/') === 0) delete sent.dbrow[k];
        });
        delete rowsMem[id];
        cache.drop(ROWS, id);
        if (remote && remote.dbmeta) delete remote.dbmeta[id];
      });
      var self = this;
      this.stats.up += JSON.stringify(patch).length;
      this.stats.writes++;
      return backend.commit(WS(this.user.uid), patch).then(function () {
        emit();
        return ids.length;
      });
    },

    /* ---- version metadata -----------------------------------------------
       vmeta was written but never READ BACK, which destroyed history: on any
       device without the localStorage mirror, `remote.vmeta` was empty, so
       every page rendered with `versions: []` — and the next save happily
       pushed that empty list over the real one. Snapshots vanished for good.
       It is fetched on demand now, exactly like a body. */
    loadVersionMeta: function (pageId) {
      if (!this.cloud) return Promise.resolve(null);
      if (vmetaSeen[pageId]) return Promise.resolve(remote && remote.vmeta ? remote.vmeta[pageId] || [] : []);
      if (loadingVMeta[pageId]) return loadingVMeta[pageId];
      if (!backend || !this.user) {
        var s0 = this;
        return new Promise(function (r) { setTimeout(function () { r(s0.loadVersionMeta(pageId)); }, 500); });
      }
      loadingVMeta[pageId] = getMetered(this.user.uid, 'vmeta/' + pageId, 'vmeta').then(function (v) {
        delete loadingVMeta[pageId];
        var list = v || [];
        vmetaSeen[pageId] = true;
        if (remote) { if (!remote.vmeta) remote.vmeta = {}; remote.vmeta[pageId] = list; }
        emit();
        return list;
      }).catch(function () { delete loadingVMeta[pageId]; return null; });
      return loadingVMeta[pageId];
    },
    vmetaKnown: function (pageId) { return !!vmetaSeen[pageId]; },
    /* There is deliberately no `markVersionMeta` any more. It let the app
       declare a history authoritative without reading it, which is how a
       snapshot taken during the fetch window replaced five stored snapshots
       with one. `vmetaSeen` is now set by exactly two things that have really
       seen the list: a completed read, and a push that wrote a non-empty one. */

    onAuth: function (cb) { authCbs.push(cb); if (this.ready) cb(this.user); },

    /* The name is kept because the sign-in button calls it; WHICH provider
       answers is lib/config.js's business, not this method's. `cred` is passed
       through untouched for a provider that needs one — Google's does not. */
    async signInWithGoogle(cred) {
      if (this.cloud && auth) {
        try {
          var signed = await auth.signIn(cred);
          this.lastError = auth.lastError || null;
          return signed || this.user;
        } catch (e) {
          this.lastError = auth.lastError || (e && e.code) || 'auth/unknown';
          throw e;
        }
      }
      var u = {
        uid: 'local-' + Math.random().toString(36).slice(2, 9),
        name: 'Alamza', email: 'demo@alamza.notes', photoURL: '', provider: 'demo'
      };
      local.setUser(u); this.user = u; notifyAuth(u); return u;
    },

    async signOut() {
      releaseAll();
      this.indexReady = false;
      mirror.clear(); cache.clear();
      sent = { idx: {}, body: {}, dig: {}, vmeta: {}, dbmeta: {}, dbrow: {}, meta: '' };
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      retryWait = 0;
      vcache = {}; vcacheLru = []; vqueue = {};
      bodies = {}; rowsMem = {}; rowGone = {}; digests = null; remote = null;
      vmetaSeen = {};
      this._layoutOk = null;
      if (this.cloud && auth) { await auth.signOut(); return; }
      local.setUser(null); this.user = null; notifyAuth(null);
    },

    /* Stepping into the demo workspace: the previous workspace's snapshot
       payloads are notes, and they must not stay in memory behind it. */
    reset: function () {
      try { localStorage.removeItem(KEY); } catch (e) {}
      mirror.clear(); cache.clear();
      vcache = {}; vcacheLru = []; vqueue = {}; vmetaSeen = {};
    }
  };

  /* Leaving the tab is the last chance to spend an upload — they are free. */
  window.addEventListener('beforeunload', function () { AStore.flush(); });
  window.addEventListener('blur', function () { if (pending) AStore.flush(); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && pending) AStore.flush();
  });

  window.AStore = AStore;
})();
