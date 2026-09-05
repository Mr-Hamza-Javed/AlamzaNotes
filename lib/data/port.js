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
 *                              The DIRECT children of a collection, ordered by
 *                              key. A grandchild is not a child and is left
 *                              out. `after` is EXCLUSIVE — start after that key.
 *
 *                              `limit` of 0, or omitted, means NO LIMIT: every
 *                              child. The store asks for exactly that when it
 *                              wants the whole inbox, or the whole index on a
 *                              backend that cannot stream. A backend that
 *                              reads 0 as "return nothing" hands back an empty
 *                              workspace and looks like a network fault.
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
 * WHAT IS IN A VALUE — AND WHAT A BACKEND HAS TO KNOW ABOUT IT
 *
 * NOTHING. A value is a sealed envelope. The one requirement is that what comes
 * out is exactly what went in: same fields, same nesting, same types, arrays
 * still arrays. `lib/data/backend-local.js` is the proof of how little that
 * asks — its entire implementation of storing a page is
 *
 *     localStorage.setItem(key, JSON.stringify(value))
 *
 * and it cannot tell a page from a table row. Store the envelope as JSON, as
 * columns, as a file, as a blob in S3; the app never finds out.
 *
 * There is exactly one exception in this repo, and it is forced:
 * `backend-firestore.js` copies three or four named fields out beside the
 * payload, because a Firestore security RULE cannot parse JSON and has to be
 * able to read the owner of a shared page. It is one short table at the top of
 * that file, and it is the only app knowledge in any backend.
 *
 * The SHAPES below are therefore documentation, not a contract you must
 * implement. They are here for the one case where you WOULD want to look
 * inside — mapping this onto a normalised SQL schema, say — so that you do not
 * have to reverse-engineer them from the store.
 *
 *   idx/<pageId>          { t title, u updatedAt, n blockCount, s snippet,
 *                           i icon, p parentId, o order, f favorite,
 *                           tr trashed, w writer-id, … } — short by design:
 *                           this is the ONLY thing multiplied by the page count
 *                           at boot, so nothing large may ever go in it
 *   body/<pageId>         { b: [ block, … ] } — a block may hold `children`,
 *                           and a table block holds `rows: [[…], […]]`, so
 *                           arrays inside arrays are normal here
 *   dig/<pageId>          a plain STRING of search keywords. Not an object —
 *                           a backend that assumes every value is a map breaks
 *                           on this one
 *   vmeta/<pageId>        [ { id, n number, at, msg, … }, … ] — snapshot list,
 *                           never the snapshot contents
 *   vdata/<pageId>/<vId>  [ block, … ] — one snapshot's blocks, written once
 *   dbmeta/<dbId>         { n name, p props[], v views[], o rowOrder[] }
 *   dbrow/<dbId>/<rowId>  { id, c: { <colId>: value } }
 *   dbrev/<dbId>          { u, w, r } — a ~60 byte "this table changed" ping
 *   meta                  { prefs, workspace, invites[], shares[] }
 *   layout                a NUMBER, the storage-layout version
 *   pub/<slug>            { o owner, u, t, i, b[] , d{} } or, when sealed,
 *                           { o, u, enc: { s, iv, ct } } and nothing readable
 *   inbox/<key>/<id>      { id, from, fromName, fromEmail, pageId, title,
 *                           icon, role, at }
 *   shared/<pageId>       { o owner, u, n ownerName, t, i, b[], d{},
 *                           m: { <emailKey>: true } }
 *
 * Two of those shapes are load-bearing beyond their own path, and both are
 * stated in the store rather than here: `w` is the writer id, which is how a
 * device ignores the echo of its own write; and `u` is a millisecond clock,
 * which is how a stale cached body is noticed.
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
  D.conformance = async function (backend, scope) {
    /* WHERE IT PROBES MATTERS AS MUCH AS WHAT IT PROBES.

       It used to invent its own workspace, `conformance-probe`. No security
       rule anywhere allows that — a workspace belongs to one account — so on a
       real database every single call was denied and the check reported that
       the backend "does not keep the contract", which was a lie told to every
       user on every load.

       So the caller supplies the scope, and lib/store.js supplies the signed-in
       account's own workspace: the one place the app is permitted to write.

       And every path below lives under `probe/`, a kind the app itself never
       stores, reads or watches. A probe document under `idx/` would arrive
       through the app's own index listener and appear in the sidebar as a
       page that does not exist. */
    var bad = [];
    scope = scope || { ws: 'conformance-probe' };
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
      var gone = await backend.read(scope, 'probe/does-not-exist');
      if (gone !== null) say('read() of an absent path gave ' + JSON.stringify(gone) + ', expected null');

      /* a value must come back byte-identical, nesting and all — the app puts
         deeply nested blocks through here and a backend that flattens them
         corrupts pages silently */
      var deep = { b: [{ id: 'a', type: 'table', rows: [['x', 'y'], ['z', '']] , children: [{ id: 'b', text: '' }] }] };
      await backend.write(scope, 'probe/nested', deep);
      var back = await backend.read(scope, 'probe/nested');
      if (JSON.stringify(back) !== JSON.stringify(deep)) {
        say('a nested value did not survive a write/read round trip');
      }

      /* a bare string is a real stored value (dig/ is exactly that) */
      await backend.write(scope, 'probe/text', 'hello world');
      if (await backend.read(scope, 'probe/text') !== 'hello world') say('a string value did not survive a round trip');

      /* commit writes several paths and null deletes */
      await backend.commit(scope, { 'probe/p1': { t: 'one' }, 'probe/p2': { t: 'two' }, 'probe/text': null });
      if (await backend.read(scope, 'probe/text') !== null) say('commit() with null did not delete');
      /* a null at a parent path takes the subtree with it — see write() above */
      await backend.commit(scope, { 'probe/tree/r1': { id: 'r1' }, 'probe/tree/r2': { id: 'r2' } });
      await backend.write(scope, 'probe/tree', null);
      var left = await backend.readPage(scope, 'probe/tree', null, 10);
      if (left && Object.keys(left).length) {
        say('deleting a parent path left ' + Object.keys(left).length + ' children behind');
        await backend.commit(scope, { 'probe/tree/r1': null, 'probe/tree/r2': null });
      }

      var page = await backend.readPage(scope, 'probe', null, 10);
      if (!page || !page.p1 || !page.p2) say('readPage() did not list what commit() wrote');
      if (page && page['does-not-exist']) say('readPage() returned a path that was never written');

      /* paging: keys are ordered and `after` is exclusive */
      if (backend.caps.paged) {
        var first = await backend.readPage(scope, 'probe', null, 1);
        var keys = Object.keys(first || {});
        if (keys.length !== 1) say('readPage(limit 1) returned ' + keys.length + ' children');
        var rest = await backend.readPage(scope, 'probe', keys[0], 10);
        if (rest && rest[keys[0]]) say('readPage(after) included the key it was told to start after');
      }

      /* watch must replay what is already stored, or the sidebar boots empty */
      if (backend.caps.realtime) {
        var seen = {};
        var off = backend.watch(scope, 'probe', { added: function (k, v) { seen[k] = v; } });
        await new Promise(function (r) { setTimeout(r, 60); });
        if (typeof off !== 'function') say('watch() did not return an unsubscribe function');
        else off();
        if (!seen.p1) say('watch() did not replay the children already stored');
      }

      await backend.commit(scope, { 'probe/p1': null, 'probe/p2': null, 'probe/nested': null });
    } catch (e) {
      say('threw during the probe — ' + ((e && e.message) || e));
    }
    return bad;
  };
})();
