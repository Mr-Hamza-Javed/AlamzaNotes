/* =============================================================================
 * Alamza Notes — BACKEND: Firebase Realtime Database
 * =============================================================================
 *
 * What every existing account is stored in, and the shape the app was designed
 * around. A logical path is stored EXACTLY as written:
 *
 *     workspaces/<uid>/idx/<pageId>
 *     workspaces/<uid>/dbrow/<dbId>/<rowId>
 *     pub/<slug>          inbox/<emailKey>/<inviteId>      shared/<pageId>
 *
 * so there is no mapping to go wrong and nothing to migrate. Deploy
 * lib/database.rules.json with it.
 *
 * -----------------------------------------------------------------------------
 * THE COST MODEL, WHICH IS WHY THIS BACKEND IS SHAPED LIKE THIS
 *
 * RTDB bills bytes DOWNLOADED. Uploads are free. Two consequences are baked
 * into the contract this file implements, and a replacement backend does not
 * have to honour them but the store still assumes them:
 *
 *   - commit() is one multi-path update, so a save of twenty changed paths is
 *     one round trip and one upload rather than twenty.
 *   - watch() is per-CHILD, not per-node. Subscribing to `idx` streams ~110
 *     bytes per page once and then only what changes. Subscribing to the whole
 *     node instead would re-download every page on every keystroke, which is
 *     the bug this layout was built to kill.
 *
 * TWO RULES ABOUT MULTI-PATH UPDATES, both learned by losing data:
 *   1. Never put an ancestor and its descendant in one update — RTDB rejects
 *      the WHOLE update, so nothing is written and the failure is silent.
 *      Writer ids therefore go INSIDE the object, never as a sibling path.
 *   2. `undefined` anywhere in a payload is rejected outright. Everything is
 *      passed through JSON before it is sent.
 * ========================================================================== */
(function () {
  var D = window.AlamzaData;

  function factory(config) {
    var fb = null;

    function base(scope) {
      return (scope && scope.ws) ? 'workspaces/' + scope.ws : '';
    }
    function full(scope, path) {
      var b = base(scope);
      return b ? (path ? b + '/' + path : b) : path;
    }
    function ref(scope, path) { return fb.ref(fb.db, full(scope, path)); }

    /* JSON round trip: strips `undefined`, and is the same normalisation the
       store's dirty check uses, so what is compared is what is sent. */
    function wire(v) {
      if (v === undefined) return null;
      try { return JSON.parse(JSON.stringify(v)); } catch (e) { return null; }
    }

    return D.defineBackend({
      name: 'rtdb',
      caps: {
        realtime: true,
        atomicCommit: true,    /* a multi-path update is all-or-nothing */
        maxCommit: 0,
        paged: true,
        publicRead: true,      /* pub/<slug> is world readable by rule */
        legacyLayouts: true    /* only this backend can hold a pre-v4 workspace */
      },

      connect: async function () {
        if (fb) return;
        var app = await D.firebaseApp(config);
        var db = await D.firebaseModule('firebase-database.js');
        fb = {
          db: db.getDatabase(app),
          ref: db.ref, set: db.set, get: db.get, update: db.update,
          query: db.query, orderByKey: db.orderByKey,
          limitToFirst: db.limitToFirst, startAfter: db.startAfter,
          onChildAdded: db.onChildAdded, onChildChanged: db.onChildChanged,
          onChildRemoved: db.onChildRemoved
        };
      },

      read: function (scope, path) {
        return fb.get(ref(scope, path)).then(function (s) {
          var v = s.val();
          return v === undefined ? null : v;
        });
      },

      readPage: function (scope, col, after, limit) {
        var cons = [fb.orderByKey()];
        if (after) cons.push(fb.startAfter(after));
        if (limit) cons.push(fb.limitToFirst(limit));
        return fb.get(fb.query.apply(null, [ref(scope, col)].concat(cons)))
          .then(function (s) { return s.val() || {}; });
      },

      write: function (scope, path, value) {
        return fb.set(ref(scope, path), wire(value));
      },

      /* One update for the whole patch: atomic, one round trip, and free —
         uploads are not billed. `null` deletes the path and everything under
         it, which is how a removed page takes its body, digest and history with
         it in the same write that removes its index entry. */
      commit: function (scope, patch) {
        var out = {};
        Object.keys(patch || {}).forEach(function (p) {
          out[p] = patch[p] === null || patch[p] === undefined ? null : wire(patch[p]);
        });
        return fb.update(ref(scope, ''), out);
      },

      watch: function (scope, col, handlers) {
        var r = ref(scope, col), offs = [];
        function on(attach, fn) {
          offs.push(attach(r, function (snap) { fn(snap.key, snap.val()); }));
        }
        if (handlers.added) on(fb.onChildAdded, handlers.added);
        if (handlers.changed) on(fb.onChildChanged, handlers.changed);
        if (handlers.removed) offs.push(fb.onChildRemoved(r, function (s) { handlers.removed(s.key); }));
        return function () { offs.forEach(function (u) { try { u(); } catch (e) {} }); };
      },

      close: function () { fb = null; return Promise.resolve(); }
    });
  }

  /* `databaseURL` is the field that means "a Realtime Database exists". An
     apiKey alone describes a Firebase PROJECT, which may well have only
     Firestore in it — treating that as configured would point every read at a
     database that is not there. */
  factory.configured = function (cfg) { return !!(cfg && cfg.apiKey && cfg.databaseURL); };

  D.registerBackend('rtdb', factory);
})();
