/* =============================================================================
 * Alamza Notes — BACKEND: this browser (localStorage)
 * =============================================================================
 *
 * The floor. Always available, needs no account, no network and no config, and
 * so it is what the app falls back to when everything else is unavailable and
 * what "Explore the demo" runs on.
 *
 * It is also the REFERENCE IMPLEMENTATION. It is the only backend a test can
 * drive end to end with no network, so the port's conformance suite runs
 * against it in full and the others are held to the behaviour it establishes.
 * When the contract in lib/data/port.js is ambiguous, what this file does is
 * the answer.
 *
 * LAYOUT.  One localStorage key per logical path:
 *
 *     alamza:d:ws:<uid>:idx/<pageId>
 *     alamza:d:root:pub/<slug>
 *
 * Flat, so `readPage` is a prefix scan and `watch` is a prefix filter. It costs
 * a key per page rather than one big blob, which is what makes a single page
 * save cheap instead of a rewrite of the workspace.
 *
 * LIVE UPDATES.  Two halves, and both are needed:
 *   - another tab writing fires the browser's `storage` event, which is the
 *     only cross-tab signal that exists without a server;
 *   - this tab's own writes never fire it, so they are dispatched by hand.
 * The result is that two tabs of the demo genuinely stay in step.
 * ========================================================================== */
(function () {
  var D = window.AlamzaData;

  function factory(config) {
    var ns = (config && config.namespace) || 'alamza';
    var PRE = ns + ':d:';
    var watchers = [];          // { key, col, handlers }
    var wired = false;

    function scopeKey(scope) {
      return (scope && scope.ws) ? 'ws:' + scope.ws : 'root';
    }
    function keyFor(scope, path) { return PRE + scopeKey(scope) + ':' + path; }

    /* localStorage stores strings. `undefined` is not a value the app ever
       means to store, and JSON.stringify(undefined) is undefined rather than a
       string, so it is normalised to null — which is the contract's "absent". */
    function put(k, v) {
      try {
        if (v === null || v === undefined) localStorage.removeItem(k);
        else localStorage.setItem(k, JSON.stringify(v));
        return true;
      } catch (e) {
        console.warn('[local] could not store ' + k + ' — ' + ((e && e.name) || e));
        return false;
      }
    }
    function get(k) {
      try {
        var raw = localStorage.getItem(k);
        return raw === null ? null : JSON.parse(raw);
      } catch (e) { return null; }
    }
    function allKeys() {
      var out = [];
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf(PRE) === 0) out.push(k);
        }
      } catch (e) {}
      return out;
    }

    /* the direct children of a collection, as { childKey: value }. A path
       further down (a grandchild) is not a child and is left out — see the note
       on readPage in lib/data/port.js. */
    function childrenOf(scope, col) {
      var head = keyFor(scope, col) + '/';
      var out = {};
      allKeys().forEach(function (k) {
        if (k.indexOf(head) !== 0) return;
        var rest = k.slice(head.length);
        if (rest.indexOf('/') >= 0) return;
        out[rest] = get(k);
      });
      return out;
    }

    /* Deleting a path deletes the subtree under it — see write() in
       lib/data/port.js. Flat keys make that a prefix sweep. It has to be in
       write() as well as commit(): a page delete goes through commit, but
       "leave this share" and "unpublish" go through write, and a rule that only
       half applies is worse than one that does not exist. */
    function removeTree(scope, path) {
      var head = keyFor(scope, path) + '/';
      allKeys().forEach(function (k) { if (k.indexOf(head) === 0) put(k, null); });
    }

    function notify(scope, path, value, existed) {
      var sk = scopeKey(scope);
      var cut = path.lastIndexOf('/');
      if (cut < 0) return;                     // a single-segment path has no collection
      var col = path.slice(0, cut), childKey = path.slice(cut + 1);
      watchers.forEach(function (w) {
        if (w.scopeKey !== sk || w.col !== col) return;
        try {
          if (value === null) { if (w.handlers.removed) w.handlers.removed(childKey); }
          else if (existed) { if (w.handlers.changed) w.handlers.changed(childKey, value); }
          else if (w.handlers.added) w.handlers.added(childKey, value);
        } catch (e) {}
      });
    }

    /* another tab wrote. The event gives us the key and the new value, so the
       change can be delivered without re-reading anything. */
    function wire() {
      if (wired || typeof window.addEventListener !== 'function') return;
      wired = true;
      window.addEventListener('storage', function (e) {
        if (!e || !e.key || e.key.indexOf(PRE) !== 0) return;
        var rest = e.key.slice(PRE.length);
        var colon = rest.indexOf(':');
        if (colon < 0) return;
        var sk = rest.slice(0, colon), path = rest.slice(colon + 1);
        var cut = path.lastIndexOf('/');
        if (cut < 0) return;
        var col = path.slice(0, cut), childKey = path.slice(cut + 1);
        var value = null;
        try { value = e.newValue === null ? null : JSON.parse(e.newValue); } catch (e2) { return; }
        watchers.forEach(function (w) {
          if (w.scopeKey !== sk || w.col !== col) return;
          try {
            if (value === null) { if (w.handlers.removed) w.handlers.removed(childKey); }
            else if (e.oldValue === null) { if (w.handlers.added) w.handlers.added(childKey, value); }
            else if (w.handlers.changed) w.handlers.changed(childKey, value);
          } catch (e3) {}
        });
      });
    }

    return D.defineBackend({
      name: 'local',
      caps: {
        realtime: true,
        atomicCommit: false,   /* localStorage has no transaction; see commit() */
        maxCommit: 0,
        paged: true,
        publicRead: true,      /* there is nobody to deny — it is this browser */
        legacyLayouts: false
      },

      connect: function () { wire(); return Promise.resolve(); },

      read: function (scope, path) {
        return Promise.resolve(get(keyFor(scope, path)));
      },

      readPage: function (scope, col, after, limit) {
        var all = childrenOf(scope, col);
        var keys = Object.keys(all).sort();
        if (after) keys = keys.filter(function (k) { return k > after; });
        if (limit) keys = keys.slice(0, limit);
        var out = {};
        keys.forEach(function (k) { out[k] = all[k]; });
        return Promise.resolve(out);
      },

      write: function (scope, path, value) {
        var k = keyFor(scope, path);
        var existed = get(k) !== null;
        if (value === null || value === undefined) removeTree(scope, path);
        put(k, value);
        notify(scope, path, value === undefined ? null : value, existed);
        return Promise.resolve();
      },

      /* Applied in order, one key at a time, because localStorage offers
         nothing better. `atomicCommit: false` says so rather than pretending.
         A patch that runs out of quota half way leaves the rest unwritten; the
         store's retry re-sends the whole patch, and every write it makes is a
         replace rather than an append, so re-sending is safe. */
      commit: function (scope, patch) {
        var self = this;
        Object.keys(patch || {}).forEach(function (p) {
          self.write(scope, p, patch[p] === undefined ? null : patch[p]);
        });
        return Promise.resolve();
      },

      watch: function (scope, col, handlers) {
        wire();
        var w = { scopeKey: scopeKey(scope), col: col, handlers: handlers || {} };
        watchers.push(w);
        /* replay first, exactly like onChildAdded — the sidebar is painted from
           this replay, so a backend that only reports future changes boots the
           app empty */
        var have = childrenOf(scope, col);
        Object.keys(have).sort().forEach(function (k) {
          if (w.handlers.added) { try { w.handlers.added(k, have[k]); } catch (e) {} }
        });
        return function () {
          var i = watchers.indexOf(w);
          if (i >= 0) watchers.splice(i, 1);
        };
      },

      close: function () { watchers = []; return Promise.resolve(); }
    });
  }

  /* always usable — that is the point of it */
  factory.configured = function () { return true; };

  D.registerBackend('local', factory);
})();
