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

  var DOC_LIMIT = 1048576;      /* Firestore's hard limit, in bytes */

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
      if (json.length > DOC_LIMIT) {
        throw new Error('[firestore] ' + path + ' is ' + Math.round(json.length / 1024) +
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
      var refs = [], seen = 0;
      async function walk(p, depth) {
        if (depth > 4) return;                      /* the app never nests deeper */
        var snap;
        try { snap = await fs.getDocs(colRef(scope, p)); } catch (e) { return; }
        for (var i = 0; i < snap.docs.length; i++) {
          var id = snap.docs[i].id;
          if (id === '_') continue;
          refs.push(snap.docs[i].ref);
          if (++seen > 5000) return;                /* a runaway is a bug, not a table */
          await walk(p + '/' + id, depth + 1);
        }
      }
      await walk(path, 0);
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
        snap.forEach(function (d) { if (d.id !== '_') out[d.id] = decode(d.data()); });
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
        var plain = [];
        for (var i = 0; i < paths.length; i++) {
          var p = paths[i], v = patch[p];
          if (v === null || v === undefined) {
            await deleteTree(scope, p);
            plain.push({ p: p, v: null });
          } else {
            plain.push({ p: p, v: v });
          }
        }

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
            if (c.doc.id === '_') return;
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
