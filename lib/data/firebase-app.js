/* =============================================================================
 * Alamza Notes — shared Firebase app loader
 * =============================================================================
 *
 * Three files need a Firebase app object: the Realtime Database backend, the
 * Firestore backend and the Google auth provider. `initializeApp` may only be
 * called once per project, and the SDK is fetched over the network, so both the
 * app and the module imports are made once here and shared.
 *
 * This exists so the two database backends can run AT THE SAME TIME — which the
 * `routing` backend allows — without fighting over the SDK. Without it, the
 * second one to load would either re-initialise the app or import a second copy
 * of the SDK over the network.
 * ========================================================================== */
(function () {
  var D = window.AlamzaData = window.AlamzaData || {};
  if (D.firebaseApp) return;

  var BASE = 'https://www.gstatic.com/firebasejs/10.12.2/';
  var appP = null, mods = {};

  function mod(file) {
    if (!mods[file]) mods[file] = import(BASE + file);
    return mods[file];
  }

  D.firebaseModule = mod;

  /* One app for the whole page. The config the FIRST caller passes wins, which
     is correct: rtdb and firestore blocks in lib/config.js describe the same
     Firebase project, and `databaseURL` is the only field that differs. It is
     merged in when present so whichever loads first, both work. */
  D.firebaseApp = function (config) {
    if (!appP) {
      appP = mod('firebase-app.js').then(function (m) {
        var existing = m.getApps && m.getApps().length ? m.getApp() : null;
        if (existing) {
          if (config && config.databaseURL && !existing.options.databaseURL) {
            /* an app created without a databaseURL cannot serve RTDB; name a
               second one rather than silently failing every read */
            return m.initializeApp(Object.assign({}, existing.options, config), 'alamza-rtdb');
          }
          return existing;
        }
        return m.initializeApp(config || {});
      });
    }
    return appP;
  };

  /* Only the tests need this: a fresh page has no app, and a test that swaps
     the config has to be able to say so. */
  D.firebaseReset = function () { appP = null; mods = {}; };
})();
