/* =============================================================================
 * Alamza Notes — BACKEND: Google Cloud Firestore
 * =============================================================================
 *
 * The second real database. Everything the app does works on it unchanged;
 * lib/config.js decides which one runs. Deploy lib/firestore.rules with it.
 *
 * -----------------------------------------------------------------------------
 * 1. PATHS.  Firestore alternates collection / document / collection / document
 * forever, so a path has to have an EVEN number of segments to name a document
 * and an ODD number to name a collection. The app's own paths do not care about
 * that, so one mechanical rule reconciles them:
 *
 *     to name a DOCUMENT and the count is odd  -> insert `_` before the last
 *     to name a COLLECTION and the count is even -> append `_`
 *
 *     logical                     Firestore
 *     ------------------------    --------------------------------------------
 *     meta                        workspaces/<uid>/_/meta
 *     idx/<pageId>                workspaces/<uid>/idx/<pageId>
 *     body/<pageId>               workspaces/<uid>/body/<pageId>
 *     dbrow/<dbId>/<rowId>        workspaces/<uid>/dbrow/<dbId>/_/<rowId>
 *     vdata/<pageId>/<vId>        workspaces/<uid>/vdata/<pageId>/_/<vId>
 *     pub/<slug>                  pub/<slug>
 *     inbox/<emailKey>/<id>       inbox/<emailKey>/_/<id>
 *
 * The rule is consistent in both directions: the collection holding the rows of
 * a table is `dbrow/<dbId>/_`, and its documents are `dbrow/<dbId>/_/<rowId>`,
 * which is exactly what the document rule produces. That is why a single rule
 * is safe rather than a pair that can drift apart.
 *
 * -----------------------------------------------------------------------------
 * 2. VALUES.  A Firestore document is a map of fields, and it will not store an
 * array inside an array. A page's blocks are full of them — a table block is
 * `rows: [[..],[..]]`, and every toggle has `children`. So the value is stored
 * as ONE JSON string field, `_j`.
 *
 * That is not a workaround, it is the cheaper answer: Firestore bills per
 * document read, not per byte, so there is nothing to gain by spreading a page
 * across fields, and a string is exact — no coercion, no dropped empty map, no
 * argument about how `null` inside an array should be represented.
 *
 * The exception is the three paths a SECURITY RULE has to look inside. A rule
 * cannot parse JSON, so for those the fields it needs are copied out alongside
 * `_j`. Which fields, for which path, is the EXPOSE table below — it is short
 * on purpose, and it is the only place this backend knows anything about what
 * the app stores.
 *
 * -----------------------------------------------------------------------------
 * 3. WRITES.  A Firestore batch is atomic but holds at most 500 operations, so
 * a bigger patch is split. A split commit is NOT atomic, and `caps.maxCommit`
 * says so rather than leaving the store to assume otherwise.
 *
 * 4. DELETING.  Deleting a document does NOT delete the collections under it.
 * `dbrow/<dbId>: null` means "this whole table is gone", so the subcollection
 * is listed and removed too. That costs one read per row, which is why it only
 * happens when a table or a page is actually deleted.
 *
 * 5. SIZE.  One document may not exceed 1 MiB. A page far past that is refused
 * with a message that names the page, rather than failing as a generic write
 * error somewhere the user cannot connect to what they did.
 * ========================================================================== */
(function () {
  var D = window.AlamzaData;

  /* the only app knowledge in this file: fields a security rule must read */
  var EXPOSE = {
    pub:    ['o'],              /* owner uid — only the owner may overwrite */
    inbox:  ['from', 'role'],   /* sender uid, and the role being granted */
    shared: ['o', 'm']          /* owner uid, and the member map keyed by email */
  };

  /* Kinds whose documents NEVER have anything beneath them.
     Deleting a document in Firestore does not delete the collections under it,
     so a delete has to go looking — and looking costs a billed read and, worse,
     a network round trip, even when the collection has never existed. Deleting
     one page writes five nulls and only ONE of them (`vdata/<pageId>`) can hold
     anything, so four round trips were spent finding nothing; deleting a
     hundred pages spent four hundred, one after another.

     Listed as LEAVES rather than as "these ones nest", so the default for
     anything not named — a kind added later, another app's data, the port's own
     contract probe — is to sweep it. Being slow is recoverable; leaving orphans
     behind is not. */
  var LEAVES = { idx: 1, body: 1, dig: 1, vmeta: 1, dbmeta: 1, dbrev: 1, pub: 1, shared: 1 };

  /* The deepest the app ever nests: `dbrow/<dbId>/<rowId>` and
     `vdata/<pageId>/<versionId>`, both three segments. Nothing is stored below
     one of those, so a three-segment path is a leaf whatever its kind — which
     is what stops the sweep of a deleted page from descending into every
     snapshot it just listed. */
  var MAX_DEPTH = 3;

  function canNest(path) {
    var segs = D.splitPath(path);
    if (segs.length >= MAX_DEPTH) return false;
    if (segs.length >= 2 && LEAVES[segs[0]]) return false;
    return true;
  }

  /* Firestore's hard limit is 1 MiB of UTF-8 BYTES per document, and it counts
     the field names and the document path towards it as well as the value. The
     margin below is for that overhead. */
  var DOC_LIMIT = 1048576;
  var DOC_MARGIN = 4096;

  /* JavaScript measures a string in UTF-16 units; Firestore measures it in
     UTF-8 bytes. For English those are nearly the same number and the
     difference never shows. For Urdu, Arabic, Hindi or emoji one character is
     two to four bytes and one unit, so `json.length` under-counted a page by up
     to three times: a document well over the limit walked past the friendly
     error and was refused by Firestore with a raw one naming nothing.

     TextEncoder is exact and is in every browser that can run this app (the
     store already uses it to seal a published page). The fallback counts the
     same thing by hand, for a context that has none. */
  function utf8Bytes(str) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(str).length;
    var n = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; }   /* surrogate pair */
      else n += 3;
    }
    return n;
  }

  function factory(config) {
    var fs = null, db = null;

    function baseSegs(scope) {
      return (scope && scope.ws) ? ['workspaces', scope.ws] : [];
    }
    /* the two rules from the header, and nothing else */
    function docSegs(scope, path) {
      var segs = baseSegs(scope).concat(D.splitPath(path));
      if (segs.length % 2 === 1) segs.splice(segs.length - 1, 0, '_');
      return segs;
    }
    function colSegs(scope, path) {
      var segs = baseSegs(scope).concat(D.splitPath(path));
      if (segs.length % 2 === 0) segs.push('_');
      return segs;
    }
    function docRef(scope, path) { return fs.doc.apply(null, [db].concat(docSegs(scope, path))); }
    function colRef(scope, path) { return fs.collection.apply(null, [db].concat(colSegs(scope, path))); }

    /* ---- encoding ---- */
    function encode(path, value) {
      var json;
      try { json = JSON.stringify(value === undefined ? null : value); }
      catch (e) { throw new Error('[firestore] ' + path + ' could not be serialised: ' + e.message); }
      var bytes = utf8Bytes(json);
      if (bytes > DOC_LIMIT - DOC_MARGIN) {
        throw new Error('[firestore] ' + path + ' is ' + Math.round(bytes / 1024) +
          ' KB, over Firestore\'s 1 MB limit for one document. Split the page, or keep this' +
          ' kind of data on another backend with the `routing` option in lib/config.js.');
      }
      var out = { _j: json };
      var fields = EXPOSE[D.kindOf(path)] || [];
      if (fields.length && value && typeof value === 'object' && !Array.isArray(value)) {
        fields.forEach(function (f) { if (value[f] !== undefined) out[f] = value[f]; });
      }
      return out;
    }
    function decode(data) {
      if (!data) return null;
      if (typeof data._j === 'string') {
        try { return JSON.parse(data._j); } catch (e) { return null; }
      }
      /* written by something that is not this app — hand back what is there
         rather than pretending the document is absent */
      var out = {}, any = false;
      Object.keys(data).forEach(function (k) { if (k[0] !== '_') { out[k] = data[k]; any = true; } });
      return any ? out : null;
    }

    /* every document in a collection and, recursively, under it */
    async function deleteTree(scope, path) {
      if (!canNest(path)) return;
      var refs = [], seen = 0;
      async function walk(p) {
        var snap;
        try { snap = await fs.getDocs(colRef(scope, p)); } catch (e) { return; }
        for (var i = 0; i < snap.docs.length; i++) {
          var id = snap.docs[i].id;
          refs.push(snap.docs[i].ref);
          if (++seen > 5000) return;                /* a runaway is a bug, not a table */
          /* the same rule on the way down: a child that cannot itself hold
             anything is not worth a round trip to confirm it */
          if (canNest(p + '/' + id)) await walk(p + '/' + id);
        }
      }
      await walk(path);
      for (var i = 0; i < refs.length; i += 400) {
        var b = fs.writeBatch(db);
        refs.slice(i, i + 400).forEach(function (r) { b.delete(r); });
        await b.commit();
      }
    }

    return D.defineBackend({
      name: 'firestore',
      caps: {
        realtime: true,
        atomicCommit: true,
        maxCommit: 450,        /* Firestore's cap is 500; the margin is for the
                                  extra deletes a subtree removal adds */
        paged: true,
        publicRead: true,      /* pub/<slug> is world readable by rule */
        legacyLayouts: false   /* a Firestore workspace has no older shape */
      },

      connect: async function () {
        if (db) return;
        var app = await D.firebaseApp(config);
        var m = await D.firebaseModule('firebase-firestore.js');
        fs = m;
        db = (config && config.databaseId)
          ? m.getFirestore(app, config.databaseId)
          : m.getFirestore(app);
      },

      read: async function (scope, path) {
        var snap = await fs.getDoc(docRef(scope, path));
        return snap.exists() ? decode(snap.data()) : null;
      },

      readPage: async function (scope, col, after, limit) {
        var cons = [fs.orderBy(fs.documentId())];
        if (after) cons.push(fs.startAfter(after));
        if (limit) cons.push(fs.limit(limit));
        var q = fs.query.apply(null, [colRef(scope, col)].concat(cons));
        var snap = await fs.getDocs(q);
        var out = {};
        /* No filtering by id. The `_` filler is inserted at COLLECTION
           positions and never at a document one — see docSegs() — so skipping
           documents called `_` protected against nothing and hid a real page
           whose id happened to be `_`: writable, readable directly, and absent
           from every listing and every listener. */
        snap.forEach(function (d) { out[d.id] = decode(d.data()); });
        return out;
      },

      write: async function (scope, path, value) {
        if (value === null || value === undefined) {
          await fs.deleteDoc(docRef(scope, path));
          await deleteTree(scope, path);
          return;
        }
        await fs.setDoc(docRef(scope, path), encode(path, value));
      },

      commit: async function (scope, patch) {
        var paths = Object.keys(patch || {});
        if (!paths.length) return;

        /* subtree deletes first and on their own: they are reads plus their own
           batches, and folding them into the value batch would make one failure
           take the whole save with it */
        var plain = [], sweeps = [];
        for (var i = 0; i < paths.length; i++) {
          var p = paths[i], v = patch[p];
          plain.push({ p: p, v: (v === null || v === undefined) ? null : v });
          /* IN PARALLEL. They were awaited one at a time, so a patch deleting
             several pages spent one round trip per null in sequence before a
             single byte was written. They touch different subtrees, so there is
             nothing to order them for. */
          if (v === null || v === undefined) sweeps.push(deleteTree(scope, p));
        }
        if (sweeps.length) await Promise.all(sweeps);

        for (var j = 0; j < plain.length; j += 450) {
          var batch = fs.writeBatch(db);
          plain.slice(j, j + 450).forEach(function (e) {
            var r = docRef(scope, e.p);
            if (e.v === null) batch.delete(r);
            else batch.set(r, encode(e.p, e.v));
          });
          await batch.commit();
        }
      },

      watch: function (scope, col, handlers) {
        return fs.onSnapshot(colRef(scope, col), function (snap) {
          snap.docChanges().forEach(function (c) {
            if (c.type === 'removed') { if (handlers.removed) handlers.removed(c.doc.id); return; }
            var v = decode(c.doc.data());
            if (c.type === 'added') { if (handlers.added) handlers.added(c.doc.id, v); }
            else if (handlers.changed) handlers.changed(c.doc.id, v);
          });
        }, function (err) {
          console.warn('[firestore] watch on ' + col + ' stopped — ' + ((err && err.message) || err));
        });
      },

      close: function () { fs = null; db = null; return Promise.resolve(); }
    });
  }

  /* Firestore is named by its projectId and by nothing else. `databaseURL` is
     the Realtime Database's field: if it turns up here the two blocks have been
     confused, and pointing Firestore at an RTDB URL fails in a way that is very
     hard to read, so it is refused up front. */
  factory.configured = function (cfg) {
    if (!cfg || !cfg.apiKey || !cfg.projectId) return false;
    if (cfg.databaseURL) {
      console.warn('[AlamzaData] the `firestore` block in lib/config.js has a databaseURL. ' +
        'That field belongs to the Realtime Database — remove it from the firestore block.');
      return false;
    }
    return true;
  };

  D.registerBackend('firestore', factory);
})();
