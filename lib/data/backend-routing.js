/* =============================================================================
 * Alamza Notes — BACKEND: several databases at once
 * =============================================================================
 *
 * A backend that is not a database. It holds the others and forwards each call
 * to whichever one owns that KIND of data, following the `routing` table in
 * lib/config.js:
 *
 *     backend: 'routing',
 *     routing: { default: 'rtdb', body: 'rest', vdata: 'rest' }
 *
 * Because it implements the same six methods as everything it contains, the
 * store cannot tell it apart from a single database — which is the point, and
 * the reason "use two databases" needed no change to lib/store.js at all.
 *
 * WHAT IT IS ACTUALLY FOR: moving. A change of database is otherwise all-or-
 * nothing, and all-or-nothing on live data is how workspaces get lost. With
 * this, one kind of data moves at a time, and the app keeps working in between.
 *
 * -----------------------------------------------------------------------------
 * THE THREE HONEST WARNINGS
 *
 * 1. A SAVE IS NO LONGER ONE WRITE. `commit` is split by kind and sent to each
 *    backend separately, so a save that touches a page's text and its sidebar
 *    entry is now two writes to two machines. Either can fail on its own. The
 *    store already re-sends a failed patch in full and every write it makes is
 *    a replace rather than an append, so a retry repairs it — but there is a
 *    window where one is newer than the other, and `caps.atomicCommit` is
 *    reported as false to say so.
 *
 * 2. NOTHING IS COPIED. Changing a line in the routing table does not move
 *    data. What was written to the old backend stays there and stops being
 *    visible. Export from Settings -> Data & sync before you re-point a kind
 *    that already holds anything.
 *
 * 3. LIVE UPDATES ARE PER KIND. If `idx` is routed somewhere without live
 *    updates, the sidebar stops updating by itself even though other kinds
 *    still do. The combined `caps.realtime` below is deliberately pessimistic —
 *    it is true only when EVERY backend in use can stream — so the app tells
 *    the user the truth rather than the best case.
 * ========================================================================== */
(function () {
  var D = window.AlamzaData;

  function factory(conf) {
    var table = (conf && conf.routing) || {};
    var blocks = (conf && conf.backends) || {};
    var made = {};              /* name -> backend, created once */

    function nameFor(kind) { return table[kind] || table.default || 'local'; }

    /* Memoised under the name that was ASKED FOR, not the name that answered.
       A kind pointed at an unconfigured backend falls back to local storage —
       and the fallback used to be cached under 'local', so the original name
       was never remembered, the configured check ran again on every single
       call, and the same warning was printed once per read and once per write.
       Twenty saves meant twenty identical lines in the console. Deciding once
       and remembering the answer is both quieter and cheaper. */
    function backendNamed(name) {
      if (made[name]) return made[name];
      if (name === 'routing') throw new Error('[routing] cannot route to itself');
      if (!D.configured(name, D.configFor(name, conf))) {
        console.warn('[routing] "' + name + '" is named in the routing table but its block in ' +
          'lib/config.js is empty — that data is going to local storage instead.');
        made[name] = made.local || (made.local = D.createBackend('local', blocks.local || {}));
        return made[name];
      }
      made[name] = D.createBackend(name, D.configFor(name, conf));
      return made[name];
    }

    function pick(path) { return backendNamed(nameFor(D.kindOf(path))); }

    /* every backend the table can reach, so connect/close/caps cover them all */
    function used() {
      var names = {};
      names[nameFor('default')] = 1;
      Object.keys(table).forEach(function (k) { if (k !== 'default') names[table[k]] = 1; });
      return Object.keys(names).map(backendNamed);
    }

    /* the pessimistic combination — see warning 3 */
    var caps = (function () {
      var all = used();
      var maxes = all.map(function (b) { return b.caps.maxCommit; }).filter(function (n) { return n > 0; });
      return {
        realtime:      all.every(function (b) { return b.caps.realtime; }),
        atomicCommit:  false,   /* split across machines — never atomic */
        maxCommit:     maxes.length ? Math.min.apply(null, maxes) : 0,
        paged:         all.every(function (b) { return b.caps.paged; }),
        publicRead:    all.every(function (b) { return b.caps.publicRead; }),
        legacyLayouts: all.some(function (b) { return b.caps.legacyLayouts; })
      };
    })();

    return D.defineBackend({
      name: 'routing',
      caps: caps,
      /* what Settings -> Data & sync prints, so the split is visible */
      describe: function () {
        var out = [];
        Object.keys(D.KINDS).forEach(function (k) {
          if (table[k]) out.push('  ' + k.padEnd(7) + ' -> ' + table[k]);
        });
        return 'default -> ' + (table.default || 'local') + (out.length ? '\n' + out.join('\n') : '');
      },

      connect: function () { return Promise.all(used().map(function (b) { return b.connect(); })).then(function () {}); },
      read: function (scope, path) { return pick(path).read(scope, path); },
      readPage: function (scope, col, after, limit) { return pick(col).readPage(scope, col, after, limit); },
      write: function (scope, path, value) { return pick(path).write(scope, path, value); },

      /* one patch in, one patch per backend out */
      commit: function (scope, patch) {
        var byName = {};
        Object.keys(patch || {}).forEach(function (p) {
          var n = nameFor(D.kindOf(p));
          (byName[n] = byName[n] || {})[p] = patch[p];
        });
        return Promise.all(Object.keys(byName).map(function (n) {
          return backendNamed(n).commit(scope, byName[n]);
        })).then(function () {});
      },

      watch: function (scope, col, handlers) { return pick(col).watch(scope, col, handlers); },
      close: function () { return Promise.all(used().map(function (b) { return b.close(); })).then(function () {}); }
    });
  }

  /* only "configured" once it actually splits something — a table that is just
     `{ default: 'rtdb' }` is the shipped placeholder, and wrapping one backend
     in a router would add a layer and change nothing */
  /* This backend is built from the whole config, not from a block of its own:
     it has to reach the blocks of everything it routes to. Declaring it is how
     any composite gets the same treatment — see configFor() in registry.js. */
  factory.wantsWholeConfig = true;

  factory.configured = function (conf) {
    var t = (conf && conf.routing) || {};
    return Object.keys(t).filter(function (k) { return k !== 'default'; }).length > 0;
  };

  D.registerBackend('routing', factory);
})();
