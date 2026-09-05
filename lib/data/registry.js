/* =============================================================================
 * Alamza Notes — THE BACKEND REGISTRY
 * =============================================================================
 *
 * Where a backend says "I exist", and where lib/config.js's one-line choice is
 * turned into a live object.
 *
 * ADDING A DATABASE IS TWO STEPS AND NEITHER OF THEM IS IN AN EXISTING FILE:
 *
 *   1. write lib/data/backend-<yours>.js, ending with
 *
 *        AlamzaData.registerBackend('yours', function (config) {
 *          return AlamzaData.defineBackend({ name: 'yours', caps: {...}, ... });
 *        });
 *
 *   2. add its <script> tag to index.html and a `yours: { ... }` block to
 *      lib/config.js.
 *
 * That is the open/closed principle doing something useful rather than being
 * quoted: the app is open to a new database and closed to being edited for one.
 * Nothing in lib/store.js, and nothing in any lib/part-*.js, knows the name of
 * a single database.
 *
 * The registry is also what makes the selection HONEST. `resolve()` below is
 * the only code that decides which backend runs, it explains its choice in
 * `AlamzaData.chose`, and Settings -> Data & sync shows that explanation. When
 * the app is not using the database you expected, that string says why.
 * ========================================================================== */
(function () {
  var D = window.AlamzaData = window.AlamzaData || {};
  if (D.registerBackend) return;

  var backends = {}, auths = {};

  D.registerBackend = function (name, factory) { backends[name] = factory; };
  D.registerAuth = function (name, factory) { auths[name] = factory; };
  D.backendNames = function () { return Object.keys(backends); };
  D.authNames = function () { return Object.keys(auths); };

  D.createBackend = function (name, config) {
    var f = backends[name];
    if (!f) throw new Error('[AlamzaData] no backend named "' + name + '". Registered: ' + Object.keys(backends).join(', '));
    return f(config || {});
  };
  D.createAuth = function (name, config) {
    var f = auths[name];
    if (!f) throw new Error('[AlamzaData] no auth provider named "' + name + '". Registered: ' + Object.keys(auths).join(', '));
    return f(config || {});
  };

  /* ------------------------------------------------------------------ config */
  D.config = function () {
    var c = window.ALAMZA_CONFIG || {};
    return {
      backend: c.backend || 'auto',
      auth: c.auth || 'auto',
      backends: c.backends || {},
      routing: c.routing || { default: 'rtdb' },
      tuning: Object.assign({
        cacheBudget: 2400000, pushDelayMs: 2200, mirrorDelayMs: 240, strictContract: false
      }, c.tuning || {})
    };
  };

  /* Which slice of the config a backend is handed.
     Every backend reads its own block — except the router, which is not a
     database and whose configuration IS the routing table plus every other
     block, because it has to build the backends it routes to. Getting this
     asymmetry wrong is subtle: the router was asked "are you configured?" with
     an empty object, said no, and 'auto' silently skipped it. Both the
     configured check and the create call now come through here, so there is one
     answer rather than two that can drift. */
  D.configFor = function (name, conf) {
    conf = conf || D.config();
    var f = backends[name];
    /* A COMPOSITE ASKS FOR THE WHOLE CONFIG; it is not granted by name.
       This used to read `name === 'routing' ? conf : …`, which made the shipped
       router privileged: anyone writing their own backend that holds others
       got only its own block and had to reach for window.ALAMZA_CONFIG behind
       the registry's back. A factory declares `wantsWholeConfig` and is treated
       exactly as the built-in one is. */
    if (f && f.wantsWholeConfig) return conf;
    return conf.backends[name] || {};
  };

  /* Is this backend's block filled in enough to use? Each backend answers for
     itself — `configured` on its factory — because only it knows which field is
     the one that matters. RTDB needs a databaseURL; Firestore needs a projectId
     and must NOT be confused with RTDB just because they share an apiKey. */
  D.configured = function (name, cfg) {
    var f = backends[name];
    if (!f) return false;
    if (typeof f.configured === 'function') return !!f.configured(cfg || {});
    return true;
  };

  /* ----------------------------------------------------------------- resolve
     Turn `backend:` from the config into a name, and say why.

     THE ORDER IS "NEVER MOVE ANYONE BY ACCIDENT", not "newest first".

     The two Firebase blocks describe the same project and differ by one field,
     so filling in the Firestore block — which is the natural first step when
     trying it out — leaves BOTH configured. If 'auto' preferred the newer one,
     that edit alone would point a live account at an empty Firestore database
     and every note in it would appear to be gone. Nothing would actually be
     lost, and it would look exactly like everything had been.

     So the Realtime Database, which is where this app has always kept data,
     comes first among the two. Moving to Firestore is then a thing you SAY
     (`backend: 'firestore'`) rather than a thing that happens to you.

     Ahead of both: a routing table and your own API, because neither can be
     configured by accident — an empty `baseUrl` and a placeholder routing
     table are both treated as "not set up". `local` is the floor. */
  var AUTO_ORDER = ['routing', 'rest', 'rtdb', 'firestore', 'local'];

  D.resolveBackendName = function (conf) {
    conf = conf || D.config();
    var want = conf.backend;

    if (want && want !== 'auto') {
      if (!backends[want]) {
        D.chose = 'config asked for "' + want + '", which is not registered — falling back to local storage';
        return 'local';
      }
      if (!D.configured(want, D.configFor(want, conf))) {
        D.chose = 'config asked for "' + want + '", but its block in lib/config.js is empty — falling back to local storage';
        return 'local';
      }
      D.chose = 'lib/config.js selected "' + want + '"';
      return want;
    }

    for (var i = 0; i < AUTO_ORDER.length; i++) {
      var n = AUTO_ORDER[i];
      if (D.configured(n, D.configFor(n, conf))) {
        D.chose = 'backend is "auto"; "' + n + '" is the first one configured';
        return n;
      }
    }
    D.chose = 'backend is "auto" and nothing is configured — using local storage';
    return 'local';
  };

  /* A routing table counts as "configured" only when it actually splits the
     data. `{ default: 'rtdb' }` on its own is the shipped placeholder and means
     "I have not set this up", so 'auto' must not pick it and quietly wrap a
     single backend in a router. */
  D.routingIsExplicit = function (conf) {
    var r = (conf || D.config()).routing || {};
    return Object.keys(r).filter(function (k) { return k !== 'default'; }).length > 0;
  };

  D.resolveAuthName = function (conf, backendName) {
    conf = conf || D.config();
    if (conf.auth && conf.auth !== 'auto') return conf.auth;
    if (backendName === 'rtdb' || backendName === 'firestore') return 'firebase';
    if (backendName === 'rest') return 'rest';
    if (backendName === 'routing') {
      /* a routed app signs in wherever the bulk of it lives */
      var r = conf.routing || {};
      var names = Object.keys(r).map(function (k) { return r[k]; });
      if (names.indexOf('rest') >= 0) return 'rest';
      if (names.indexOf('firestore') >= 0 || names.indexOf('rtdb') >= 0) return 'firebase';
    }
    return 'local';
  };

  /* The one call the store makes. Returns { backend, auth, name, authName }. */
  D.open = function (over) {
    var conf = D.config();
    if (over && over.backend) conf.backend = over.backend;
    var name = D.resolveBackendName(conf);
    var authName = D.resolveAuthName(conf, name);
    var backend = D.createBackend(name, D.configFor(name, conf));
    var auth = D.createAuth(authName, conf.backends[authName === 'firebase'
      ? (conf.backends.rtdb && conf.backends.rtdb.apiKey ? 'rtdb' : 'firestore')
      : authName] || {});
    return { name: name, authName: authName, backend: backend, auth: auth, conf: conf, why: D.chose };
  };
})();
