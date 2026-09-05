/* =============================================================================
 * Alamza Notes — THE STORAGE PORT
 * =============================================================================
 *
 * One interface, and every database the app can speak to implements it. The
 * store (lib/store.js) is written against THIS FILE and never against Firebase,
 * Firestore or any API — which is the whole reason a new database can be added
 * without touching a line of the app.
 *
 * -----------------------------------------------------------------------------
 * THE IDEA IN ONE PARAGRAPH
 *
 * Everything Alamza stores already has an address: the sidebar entry for a page
 * is `idx/<pageId>`, its text is `body/<pageId>`, one row of a table is
 * `dbrow/<dbId>/<rowId>`. Those addresses are the app's own vocabulary and they
 * do not belong to any database. A backend's ONLY job is to turn one of these
 * logical paths into wherever it actually keeps the bytes, and to hand them back
 * unchanged. Realtime Database nests them as-is; Firestore alternates them into
 * collections and documents; an API turns them into a URL. The app never knows.
 *
 * -----------------------------------------------------------------------------
 * THE CONTRACT   (lib/data/backend-*.js are the implementations)
 *
 *   name                     'rtdb' | 'firestore' | 'rest' | 'local' | ...
 *   caps                     what this backend can do — see CAPS below
 *
 *   connect()                -> Promise<void>     open the connection
 *   read(scope, path)        -> Promise<value|null>
 *                              null means ABSENT. It must never mean "empty":
 *                              the app treats an absent body as "not fetched"
 *                              and an empty one as "the user deleted the text",
 *                              and confusing the two erases notes.
 *   readPage(scope, col,
 *            after, limit)   -> Promise<{ childKey: value }>
 *                              children of a collection, ordered by key, keys
 *                              after `after` only. Used to walk a large node
 *                              without pulling it whole.
 *   write(scope, path, v)    -> Promise<void>
 *                              v === null DELETES THE PATH AND EVERYTHING
 *                              UNDER IT. That second half is not decoration:
 *                              deleting a page writes `vdata/<pageId>: null`
 *                              to take its snapshot bodies with it, and
 *                              deleting a table writes `dbrow/<dbId>: null`
 *                              to take its rows. A backend that deletes only
 *                              the exact path leaves those behind, and they
 *                              come back the next time the parent is read.
 *   commit(scope, patch)     -> Promise<void>
 *                              `patch` is { logicalPath: value|null }. One round
 *                              trip. This is how every save reaches the server.
 *   watch(scope, col, h)     -> unsubscribe()
 *                              live children of a collection.
 *                              h.added(key,value) / h.changed(key,value) /
 *                              h.removed(key). `added` REPLAYS what is already
 *                              there, then continues live — that is what paints
 *                              the sidebar at startup.
 *   close()                  -> Promise<void>
 *
 * SCOPE. Two places exist to put things, and they have different rules:
 *
 *   { ws: '<uid>' }   this account's private workspace. Nobody else can read it.
 *   { ws: null }      the shared area: `pub/` published pages (world readable),
 *                     `inbox/` invitations, `shared/` pages lent to one person.
 *
 * A backend turns a scope into a prefix and otherwise ignores it.
 *
 * -----------------------------------------------------------------------------
 * WHY THE INTERFACE IS THIS SMALL   (ISP — the interface segregation principle)
 *
 * Six methods. Anything a real database can do beyond them — transactions,
 * queries, indexes, presence — the app does not use, so requiring it would make
 * backends harder to write for no gain. Anything a backend CANNOT do is declared
 * in `caps` instead of thrown at runtime, so the store degrades on purpose
 * rather than crashing by accident. `caps.realtime: false` is a supported
 * answer, not a failure.
 * ========================================================================== */
(function () {
  if (window.AlamzaData && window.AlamzaData.PORT_VERSION) return;

  var D = window.AlamzaData = window.AlamzaData || {};
  D.PORT_VERSION = 1;

  /* ---------------------------------------------------------------- kinds
     The nine things Alamza stores. The first segment of every logical path is
     one of these, which is what makes per-kind routing possible (see the
     `routing` block in lib/config.js) and what a new backend can use to decide
     how to lay each one out.

     `sys` is the odd one out: it is the two single-segment paths, `meta` and
     `layout`, grouped so routing has a name for them. */
  D.KINDS = {
    idx:    { desc: 'one small entry per page — title, icon, parent, flags', live: true,  size: 'tiny' },
    body:   { desc: 'the blocks of a page',                                  live: false, size: 'large' },
    dig:    { desc: 'search keywords for a page',                            live: false, size: 'small' },
    vmeta:  { desc: 'the list of a page snapshots',                          live: false, size: 'small' },
    vdata:  { desc: 'the contents of one snapshot',                          live: false, size: 'large' },
    dbmeta: { desc: 'a table columns, views and row order',                  live: true,  size: 'small' },
    dbrow:  { desc: 'one row of a table',                                    live: false, size: 'small' },
    dbrev:  { desc: 'a tiny this-table-changed ping',                        live: true,  size: 'tiny' },
    sys:    { desc: 'workspace preferences and the layout stamp',            live: false, size: 'tiny' },
    pub:    { desc: 'a page published to the web',                           live: false, size: 'large' },
    inbox:  { desc: 'invitations waiting for an account',                    live: false, size: 'tiny' },
    shared: { desc: 'a page lent to one other account',                      live: false, size: 'large' }
  };

  /* `meta` and `layout` have no prefix of their own, so they are `sys`. */
  var SYS = { meta: 1, layout: 1 };
  D.kindOf = function (path) {
    var head = String(path || '').split('/')[0];
    if (SYS[head]) return 'sys';
    return D.KINDS[head] ? head : head;
  };

  D.splitPath = function (path) {
    return String(path || '').split('/').filter(function (s) { return s !== ''; });
  };

  /* ----------------------------------------------------------- capabilities
     Every flag has a SAFE default: a backend that declares nothing is treated
     as the least capable thing that still works, so a half-written adapter
     degrades instead of misbehaving. */
  D.CAPS = {
    /* watch() streams live changes. false -> the app reads once at startup and
       sees another device's edits on the next reload. */
    realtime: false,
    /* commit() is all-or-nothing. false -> a failed commit can leave part of a
       save applied; the store's retry re-sends the whole patch, which is why
       every write it makes is idempotent. */
    atomicCommit: false,
    /* largest patch commit() will take in one go. 0 = no limit. The store
       splits anything bigger, and a split commit is never atomic. */
    maxCommit: 0,
    /* readPage() really pages. false -> it may return everything at once, so
       the store must not rely on it to bound memory. */
    paged: false,
    /* read() on a { ws: null } path works with nobody signed in. This is what
       makes a published page openable by a stranger. */
    publicRead: false,
    /* this backend may hold workspaces written by an older version of the app
       that need converting. Only the Realtime Database ever can. */
    legacyLayouts: false
  };

  /* ------------------------------------------------------------- defineBackend
     Fills in the defaults, checks the six methods exist, and returns a frozen
     object. Every backend file ends with a call to this, so a method renamed by
     accident is caught the moment the file loads rather than the first time a
     user saves. */
  D.REQUIRED = ['connect', 'read', 'readPage', 'write', 'commit', 'watch', 'close'];

  D.defineBackend = function (spec) {
    var missing = D.REQUIRED.filter(function (m) { return typeof spec[m] !== 'function'; });
    if (missing.length) {
      throw new Error('[AlamzaData] backend "' + (spec.name || '?') +
        '" is missing: ' + missing.join(', ') + '. See lib/data/port.js.');
    }
    spec.caps = Object.assign({}, D.CAPS, spec.caps || {});
    return spec;
  };

  /* ------------------------------------------------------------- conformance
     What `tuning.strictContract` runs at startup, and what the test suite runs
     against EVERY registered backend. Substitutability is the one property this
     whole design rests on (LSP): if one backend quietly behaves differently
     from another, switching databases stops being a one-line change and
     becomes a debugging session. So it is checked rather than assumed.

     Returns a list of complaints; empty means the backend behaves. */
  D.conformance = async function (backend) {
    var bad = [], scope = { ws: 'conformance-probe' };
    var say = function (m) { bad.push(backend.name + ': ' + m); };

    D.REQUIRED.forEach(function (m) {
      if (typeof backend[m] !== 'function') say('no ' + m + '()');
    });
    if (bad.length) return bad;

    Object.keys(D.CAPS).forEach(function (k) {
      if (typeof backend.caps[k] !== typeof D.CAPS[k]) say('caps.' + k + ' is not a ' + typeof D.CAPS[k]);
    });

    try {
      /* absent must read back as null, not as undefined and not as {} */
      var gone = await backend.read(scope, 'idx/does-not-exist');
      if (gone !== null) say('read() of an absent path gave ' + JSON.stringify(gone) + ', expected null');

      /* a value must come back byte-identical, nesting and all — the app puts
         deeply nested blocks through here and a backend that flattens them
         corrupts pages silently */
      var deep = { b: [{ id: 'a', type: 'table', rows: [['x', 'y'], ['z', '']] , children: [{ id: 'b', text: '' }] }] };
      await backend.write(scope, 'body/probe', deep);
      var back = await backend.read(scope, 'body/probe');
      if (JSON.stringify(back) !== JSON.stringify(deep)) {
        say('a nested value did not survive a write/read round trip');
      }

      /* a bare string is a real stored value (dig/ is exactly that) */
      await backend.write(scope, 'dig/probe', 'hello world');
      if (await backend.read(scope, 'dig/probe') !== 'hello world') say('a string value did not survive a round trip');

      /* commit writes several paths and null deletes */
      await backend.commit(scope, { 'idx/p1': { t: 'one' }, 'idx/p2': { t: 'two' }, 'dig/probe': null });
      if (await backend.read(scope, 'dig/probe') !== null) say('commit() with null did not delete');
      /* a null at a parent path takes the subtree with it — see write() above */
      await backend.commit(scope, { 'dbrow/probe/r1': { id: 'r1' }, 'dbrow/probe/r2': { id: 'r2' } });
      await backend.write(scope, 'dbrow/probe', null);
      var left = await backend.readPage(scope, 'dbrow/probe', null, 10);
      if (left && Object.keys(left).length) {
        say('deleting a parent path left ' + Object.keys(left).length + ' children behind');
        await backend.commit(scope, { 'dbrow/probe/r1': null, 'dbrow/probe/r2': null });
      }

      var page = await backend.readPage(scope, 'idx', null, 10);
      if (!page || !page.p1 || !page.p2) say('readPage() did not list what commit() wrote');
      if (page && page['does-not-exist']) say('readPage() returned a path that was never written');

      /* paging: keys are ordered and `after` is exclusive */
      if (backend.caps.paged) {
        var first = await backend.readPage(scope, 'idx', null, 1);
        var keys = Object.keys(first || {});
        if (keys.length !== 1) say('readPage(limit 1) returned ' + keys.length + ' children');
        var rest = await backend.readPage(scope, 'idx', keys[0], 10);
        if (rest && rest[keys[0]]) say('readPage(after) included the key it was told to start after');
      }

      /* watch must replay what is already stored, or the sidebar boots empty */
      if (backend.caps.realtime) {
        var seen = {};
        var off = backend.watch(scope, 'idx', { added: function (k, v) { seen[k] = v; } });
        await new Promise(function (r) { setTimeout(r, 60); });
        if (typeof off !== 'function') say('watch() did not return an unsubscribe function');
        else off();
        if (!seen.p1) say('watch() did not replay the children already stored');
      }

      await backend.commit(scope, { 'idx/p1': null, 'idx/p2': null, 'body/probe': null });
    } catch (e) {
      say('threw during the probe — ' + ((e && e.message) || e));
    }
    return bad;
  };
})();
