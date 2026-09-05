/* =============================================================================
 * Alamza Notes — WHO IS SIGNED IN
 * =============================================================================
 *
 * Sign-in is a SEPARATE choice from storage, and this file holds all three
 * providers because they are small and are only ever read together.
 *
 * Keeping them apart is not tidiness. In practice the two change at different
 * times: moving a workspace to your own API is a storage decision, and you will
 * almost certainly want to keep Google sign-in while you do it. lib/config.js
 * therefore has `backend` and `auth` as two lines, and `auth: 'auto'` only
 * guesses when you have not said.
 *
 * THE CONTRACT
 *   connect()        -> Promise<void>
 *   signIn(cred)     -> Promise<user|null>   null = went to a redirect.
 *                       `cred` is whatever the provider needs and is passed
 *                       straight through: Google's provider ignores it, an API
 *                       gets it as the body of its sign-in request. It exists
 *                       because a provider that cannot be handed a password or
 *                       an authorization code can only serve a server that
 *                       authenticates by some entirely separate means.
 *   signOut()        -> Promise<void>
 *   onChange(cb)     -> unsubscribe. cb(user|null), and it fires with the
 *                       CURRENT answer as soon as one is known — the app waits
 *                       on this to decide between the sign-in screen and the
 *                       workspace, so a provider that only reports changes
 *                       leaves it on the loading screen forever.
 *   token()          -> string|null, for a backend that needs a bearer token
 *
 * A user is { uid, name, email, photoURL, provider }. `uid` is the workspace
 * key, so it must be stable for the life of the account and unique across it.
 * ========================================================================== */
(function () {
  var D = window.AlamzaData;
  var AUTH_KEY = 'alamza.auth.v1';

  /* the REST backend asks for this on every request; whichever provider is
     active keeps it current */
  var currentToken = null;
  D.authToken = function () { return currentToken; };

  /* ------------------------------------------------------------- firebase */
  D.registerAuth('firebase', function (config) {
    var fb = null, cbs = [], user = null, known = false;

    function tell() { cbs.forEach(function (c) { try { c(user); } catch (e) {} }); }
    function shape(u) {
      return u ? {
        uid: u.uid, name: u.displayName || 'Member',
        email: u.email || '', photoURL: u.photoURL || '', provider: 'google'
      } : null;
    }

    return {
      name: 'firebase',
      lastError: null,

      connect: async function () {
        if (fb) return;
        var app = await D.firebaseApp(config);
        var m = await D.firebaseModule('firebase-auth.js');
        fb = { m: m, auth: m.getAuth(app) };
        /* a sign-in that went out as a full-page redirect finishes here */
        try { await m.getRedirectResult(fb.auth); } catch (e) { this.lastError = e && e.code; }
        var self = this;
        m.onAuthStateChanged(fb.auth, function (u) {
          user = shape(u);
          known = true;
          if (u && u.getIdToken) {
            u.getIdToken().then(function (t) { currentToken = t; }).catch(function () {});
          } else currentToken = null;
          tell();
          void self;
        });
      },

      /* `cred` is accepted and ignored: Google's own screen collects it. The
         argument is part of the contract so that swapping providers is a config
         change and not a change at every call site. */
      signIn: async function (cred) {
        void cred;
        var p = new fb.m.GoogleAuthProvider();
        p.setCustomParameters({ prompt: 'select_account' });
        try {
          await fb.m.signInWithPopup(fb.auth, p);
          this.lastError = null;
          return user;
        } catch (e) {
          var code = (e && e.code) || 'auth/unknown';
          this.lastError = code;
          /* Popups are blocked inside sandboxed previews and some in-app
             browsers. A full-page redirect works where a popup cannot, and
             returning null says "ask again after the reload". */
          var retryable = [
            'auth/popup-blocked', 'auth/popup-closed-by-user',
            'auth/cancelled-popup-request',
            'auth/operation-not-supported-in-this-environment',
            'auth/web-storage-unsupported'
          ];
          if (retryable.indexOf(code) >= 0) {
            try { await fb.m.signInWithRedirect(fb.auth, p); return null; }
            catch (e2) { this.lastError = (e2 && e2.code) || code; throw e2; }
          }
          throw e;
        }
      },

      signOut: function () { currentToken = null; return fb.m.signOut(fb.auth); },

      onChange: function (cb) {
        cbs.push(cb);
        if (known) { try { cb(user); } catch (e) {} }
        return function () { var i = cbs.indexOf(cb); if (i >= 0) cbs.splice(i, 1); };
      },

      token: function () { return currentToken; }
    };
  });

  /* ---------------------------------------------------------------- local
     No server, so no verification is possible and none is pretended. A uid is
     invented once and kept in this browser; it is the key the demo workspace
     hangs off and nothing more. */
  D.registerAuth('local', function () {
    var cbs = [], user = null;

    function read() {
      try { var raw = localStorage.getItem(AUTH_KEY); return raw ? JSON.parse(raw) : null; }
      catch (e) { return null; }
    }
    function save(u) {
      try { u ? localStorage.setItem(AUTH_KEY, JSON.stringify(u)) : localStorage.removeItem(AUTH_KEY); }
      catch (e) {}
    }
    function tell() { cbs.forEach(function (c) { try { c(user); } catch (e) {} }); }

    return {
      name: 'local',
      lastError: null,
      connect: function () { user = read(); tell(); return Promise.resolve(); },
      signIn: function (cred) {
        void cred;
        user = {
          uid: 'local-' + Math.random().toString(36).slice(2, 9),
          name: 'Alamza', email: 'demo@alamza.notes', photoURL: '', provider: 'demo'
        };
        save(user); tell();
        return Promise.resolve(user);
      },
      signOut: function () { user = null; save(null); tell(); return Promise.resolve(); },
      onChange: function (cb) {
        cbs.push(cb);
        try { cb(user); } catch (e) {}
        return function () { var i = cbs.indexOf(cb); if (i >= 0) cbs.splice(i, 1); };
      },
      token: function () { return null; }
    };
  });

  /* ----------------------------------------------------------------- rest
     For the API you may write. Three routes:
     
       POST /auth/signin   body: whatever signIn(cred) was given, or {}
                           -> { token, user: { uid, name, email, photoURL } }
                           -> 401 when the credential is refused
       POST /auth/signout          -> 200/204
       GET  /auth/me               -> the same shape, or 401 when the stored
                                      token has expired
     
     The token is kept in localStorage so a reload does not sign the user out.
     That means any script on this origin can read it, which is true of every
     browser session token — issue short-lived ones and refresh them. */
  D.registerAuth('rest', function (config) {
    var baseUrl = String((config && config.baseUrl) || '').replace(/\/+$/, '');
    var TOKEN_KEY = 'alamza.token.v1';
    var cbs = [], user = null;

    function tell() { cbs.forEach(function (c) { try { c(user); } catch (e) {} }); }
    function stash(t) {
      currentToken = t || null;
      try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {}
    }
    async function call(method, route, body) {
      var h = { 'Content-Type': 'application/json' };
      if (currentToken) h['Authorization'] = 'Bearer ' + currentToken;
      var res = await fetch(baseUrl + route, {
        method: method, headers: h, body: body === undefined ? undefined : JSON.stringify(body)
      });
      if (res.status === 401) return null;
      if (!res.ok) throw new Error('[auth/rest] ' + route + ' -> ' + res.status);
      var text = await res.text();
      return text ? JSON.parse(text) : {};
    }

    return {
      name: 'rest',
      lastError: null,
      connect: async function () {
        try { currentToken = localStorage.getItem(TOKEN_KEY) || null; } catch (e) {}
        if (currentToken) {
          try {
            var me = await call('GET', '/auth/me');
            user = me && me.user ? Object.assign({ provider: 'api' }, me.user) : null;
            if (!user) stash(null);
          } catch (e) { this.lastError = (e && e.message) || 'auth/unreachable'; }
        }
        tell();
      },
      signIn: async function (cred) {
        var got = await call('POST', '/auth/signin', cred || {});
        if (!got || !got.user) { this.lastError = 'auth/rejected'; return null; }
        stash(got.token);
        user = Object.assign({ provider: 'api' }, got.user);
        tell();
        return user;
      },
      signOut: async function () {
        try { await call('POST', '/auth/signout', {}); } catch (e) {}
        stash(null); user = null; tell();
      },
      onChange: function (cb) {
        cbs.push(cb);
        try { cb(user); } catch (e) {}
        return function () { var i = cbs.indexOf(cb); if (i >= 0) cbs.splice(i, 1); };
      },
      token: function () { return currentToken; }
    };
  });
})();
