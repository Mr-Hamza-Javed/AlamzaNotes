/* =============================================================================
 * Alamza Notes — BACKEND: your own API
 * =============================================================================
 *
 * For the Node server that does not exist yet. It is written and tested now so
 * that the day it does exist, the only edit is `rest.baseUrl` in lib/config.js.
 *
 * -----------------------------------------------------------------------------
 * THE SERVER HAS TO ANSWER SIX ROUTES. THAT IS THE WHOLE API.
 *
 * A "logical path" below is exactly the string the app uses — `idx/abc123`,
 * `dbrow/db1/row9`. Treat it as an opaque key. You do not have to store it as a
 * path; a single table with a `path` column and a JSON `value` column is a
 * complete and perfectly good implementation of all six.
 *
 * Every request carries `Authorization: Bearer <token>` when someone is signed
 * in, plus whatever is in `rest.headers`. The workspace is in the URL, and your
 * server MUST check the token owns it — the app cannot enforce that for you.
 *
 *   GET    /ws/:uid/doc?path=idx/abc
 *          -> 200 { "value": <whatever was stored> }
 *          -> 404 when it was never written        <- must be 404, not 200 null
 *
 *   GET    /ws/:uid/list?path=idx&after=abc&limit=20
 *          -> 200 { "items": { "<childKey>": <value>, ... } }
 *             direct children only, ordered by key, keys strictly after
 *             `after`, at most `limit` of them.
 *             `after` and `limit` are OMITTED when they do not apply. No
 *             `limit` in the query means EVERY child, and that is the common
 *             case — the inbox, and the whole index.
 *
 *   PUT    /ws/:uid/doc?path=idx/abc      body: { "value": <value> }
 *          -> 200/204.  Replaces. Never merges.
 *
 *   DELETE /ws/:uid/doc?path=idx/abc
 *          -> 200/204, and the same for a path that was already absent.
 *             Deleting `dbrow/db1` must delete everything under it too.
 *
 *   POST   /ws/:uid/commit                body: { "patch": { "<path>": <value|null> } }
 *          -> 200/204.  Apply them ALL or apply NONE. `null` deletes.
 *             This is the one the app uses for every save, so it is the one
 *             worth making fast. If you cannot make it atomic, set
 *             `atomicCommit: false` in the caps below and say so.
 *
 *   GET    /ws/:uid/live?path=idx         Server-Sent Events
 *          -> a stream of:  data: {"type":"added","key":"abc","value":{...}}
 *             type is "added" | "changed" | "removed".
 *             On connect, replay everything already stored as "added" — that
 *             replay is what paints the sidebar, so a stream that only reports
 *             future changes boots the app empty.
 *             Not building this is fine: set `live: "poll"` in lib/config.js
 *             and the app asks on a timer instead.
 *
 * The shared area — published pages, invitations, pages lent to one person —
 * is the same six routes with `/global` in place of `/ws/:uid`. Reading
 * `/global/doc?path=pub/<slug>` must work with NO token at all, or published
 * links stop opening for the people they were sent to.
 * ========================================================================== */
(function () {
  var D = window.AlamzaData;

  function factory(config) {
    var baseUrl = String((config && config.baseUrl) || '').replace(/\/+$/, '');
    var live = (config && config.live) || 'sse';
    var pollMs = Math.max(2000, (config && config.pollMs) || 15000);
    var timeoutMs = (config && config.timeoutMs) || 20000;
    var extra = (config && config.headers) || {};

    function prefix(scope) { return (scope && scope.ws) ? '/ws/' + encodeURIComponent(scope.ws) : '/global'; }
    function url(scope, route, params) {
      var q = Object.keys(params || {})
        .filter(function (k) { return params[k] !== null && params[k] !== undefined && params[k] !== ''; })
        .map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
      return baseUrl + prefix(scope) + route + (q ? '?' + q : '');
    }
    function headers(json) {
      var h = Object.assign({}, extra);
      if (json) h['Content-Type'] = 'application/json';
      /* the auth provider publishes the token; a signed-out read of a public
         page simply goes without one */
      var t = D.authToken && D.authToken();
      if (t) h['Authorization'] = 'Bearer ' + t;
      return h;
    }
    /* EVERY REQUEST HAS A DEADLINE.
       A fetch with no timeout waits for the operating system to give up, which
       on a dropped connection can be minutes. The store's retry never fires,
       because the first attempt has not failed yet — the app simply looks
       frozen and the user cannot tell a slow server from a dead one. */
    async function send(method, u, body) {
      var ctl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = null;
      var expired = new Promise(function (_, reject) {
        timer = setTimeout(function () {
          if (ctl) { try { ctl.abort(); } catch (e) {} }
          reject(new Error('[rest] ' + method + ' ' + u + ' timed out after ' + timeoutMs + 'ms'));
        }, timeoutMs);
      });
      var res;
      try {
        /* The race is the deadline that always applies. AbortController is the
           better half — it stops the request rather than only stopping the
           wait — but it is not everywhere, and a caller left hanging because
           one global is missing is the failure this exists to prevent. */
        res = await Promise.race([
          fetch(u, {
            method: method, headers: headers(body !== undefined),
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: ctl ? ctl.signal : undefined
          }),
          expired
        ]);
      } catch (e) {
        if (ctl && ctl.signal.aborted) {
          throw new Error('[rest] ' + method + ' ' + u + ' timed out after ' + timeoutMs + 'ms');
        }
        throw e;
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (res.status === 404) return { missing: true };
      if (!res.ok) throw new Error('[rest] ' + method + ' ' + u + ' -> ' + res.status + ' ' + res.statusText);
      if (res.status === 204) return {};
      var text = await res.text();
      if (!text) return {};
      try { return JSON.parse(text); } catch (e) { throw new Error('[rest] ' + u + ' did not return JSON'); }
    }

    /* ---- polling, for a server with no event stream ---- */
    function poll(scope, col, handlers) {
      var stopped = false, seen = {}, first = true, timer = null;
      async function round() {
        if (stopped) return;
        try {
          var got = await send('GET', url(scope, '/list', { path: col }));
          var items = (got && got.items) || {};
          Object.keys(items).forEach(function (k) {
            var s = JSON.stringify(items[k]);
            if (!(k in seen)) { if (handlers.added) handlers.added(k, items[k]); }
            else if (seen[k] !== s && handlers.changed) handlers.changed(k, items[k]);
            seen[k] = s;
          });
          Object.keys(seen).forEach(function (k) {
            if (!(k in items)) { delete seen[k]; if (handlers.removed) handlers.removed(k); }
          });
          first = false;
        } catch (e) {
          if (first) console.warn('[rest] first poll of ' + col + ' failed — ' + ((e && e.message) || e));
        }
        if (!stopped) timer = setTimeout(round, pollMs);
      }
      round();
      return function () { stopped = true; if (timer) clearTimeout(timer); };
    }

    return D.defineBackend({
      name: 'rest',
      caps: {
        realtime: live !== 'off',
        atomicCommit: true,     /* the contract above requires it of /commit */
        maxCommit: 0,
        paged: true,
        publicRead: true,
        legacyLayouts: false
      },

      connect: function () {
        if (!baseUrl) return Promise.reject(new Error('[rest] backends.rest.baseUrl is empty in lib/config.js'));
        return Promise.resolve();
      },

      read: async function (scope, path) {
        var got = await send('GET', url(scope, '/doc', { path: path }));
        if (got.missing) return null;
        return got.value === undefined ? null : got.value;
      },

      readPage: async function (scope, col, after, limit) {
        /* `limit` is omitted entirely when it is 0, because 0 means NO LIMIT
           (see readPage in lib/data/port.js) and a server that reads it
           literally returns nothing. Sending it was how the inbox came back
           empty on every load, with no error anywhere to explain it. */
        var got = await send('GET', url(scope, '/list',
          { path: col, after: after, limit: limit > 0 ? limit : null }));
        return (got && got.items) || {};
      },

      write: function (scope, path, value) {
        if (value === null || value === undefined) {
          return send('DELETE', url(scope, '/doc', { path: path })).then(function () {});
        }
        return send('PUT', url(scope, '/doc', { path: path }), { value: value }).then(function () {});
      },

      commit: function (scope, patch) {
        return send('POST', url(scope, '/commit'), { patch: patch || {} }).then(function () {});
      },

      watch: function (scope, col, handlers) {
        if (live === 'off') return function () {};
        if (live === 'poll' || typeof window.EventSource !== 'function') return poll(scope, col, handlers);

        /* EventSource cannot carry an Authorization header, so the token rides
           in the query string. Anything you accept there you must also accept
           being written into a proxy's access log — a short-lived token, not a
           long-lived key. */
        /* THE STREAM IS OWNED, NOT LEFT ALONE.
           The token in the query string is short-lived — it has to be, because
           anything in a URL ends up in a proxy log. EventSource's own reconnect
           replays the URL it was first given, so once that token expired the
           stream reconnected for ever with a credential the server rejects, and
           nothing anywhere said so: live updates just stopped, an hour into the
           session. So the connection is re-made here, with the token read fresh
           each time, and a token that changed underneath a live stream reopens
           it. */
        var es = null, fallback = null, stopped = false, seenToken = null, watchdog = null;
        var tokenNow = function () { return (D.authToken && D.authToken()) || null; };

        function open() {
          if (stopped) return;
          seenToken = tokenNow();
          try { es = new EventSource(url(scope, '/live', { path: col, token: seenToken })); }
          catch (e) { fallback = fallback || poll(scope, col, handlers); return; }

          es.onmessage = function (ev) {
            var m;
            try { m = JSON.parse(ev.data); } catch (e) { return; }
            if (!m || !m.type) return;
            if (m.type === 'removed') { if (handlers.removed) handlers.removed(m.key); }
            else if (m.type === 'changed') { if (handlers.changed) handlers.changed(m.key, m.value); }
            else if (handlers.added) handlers.added(m.key, m.value);
          };
          es.onerror = function () {
            /* readyState 2 is CLOSED: the browser has given up. A server with no
               SSE at all lands here on the first try, so drop to polling rather
               than reopening for ever. */
            if (es && es.readyState === 2 && !fallback && !stopped) {
              console.warn('[rest] the /live stream closed — falling back to polling every ' + pollMs + 'ms');
              fallback = poll(scope, col, handlers);
            }
          };
        }

        open();
        /* the only way to notice a refresh: EventSource offers no hook, and the
           token is not this file's to be told about */
        watchdog = setInterval(function () {
          if (stopped || fallback) return;
          if (tokenNow() !== seenToken) {
            try { if (es) es.close(); } catch (e) {}
            open();
          }
        }, 60000);

        return function () {
          stopped = true;
          if (watchdog) clearInterval(watchdog);
          try { if (es) es.close(); } catch (e) {}
          if (fallback) fallback();
        };
      },

      close: function () { return Promise.resolve(); }
    });
  }

  factory.configured = function (cfg) { return !!(cfg && cfg.baseUrl); };

  D.registerBackend('rest', factory);
})();
