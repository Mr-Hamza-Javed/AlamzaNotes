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
    async function send(method, u, body) {
      var res = await fetch(u, {
        method: method, headers: headers(body !== undefined),
        body: body === undefined ? undefined : JSON.stringify(body)
      });
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
        var got = await send('GET', url(scope, '/list', { path: col, after: after, limit: limit }));
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
        var t = D.authToken && D.authToken();
        var es;
        try { es = new EventSource(url(scope, '/live', { path: col, token: t })); }
        catch (e) { return poll(scope, col, handlers); }

        es.onmessage = function (ev) {
          var m;
          try { m = JSON.parse(ev.data); } catch (e) { return; }
          if (!m || !m.type) return;
          if (m.type === 'removed') { if (handlers.removed) handlers.removed(m.key); }
          else if (m.type === 'changed') { if (handlers.changed) handlers.changed(m.key, m.value); }
          else if (handlers.added) handlers.added(m.key, m.value);
        };
        var fallback = null;
        es.onerror = function () {
          /* EventSource reconnects on its own; a stream that never opens at all
             is a server that does not do SSE, so drop to polling once */
          if (es.readyState === 2 && !fallback) {
            console.warn('[rest] the /live stream closed — falling back to polling every ' + pollMs + 'ms');
            fallback = poll(scope, col, handlers);
          }
        };
        return function () {
          try { es.close(); } catch (e) {}
          if (fallback) fallback();
        };
      },

      close: function () { return Promise.resolve(); }
    });
  }

  factory.configured = function (cfg) { return !!(cfg && cfg.baseUrl); };

  D.registerBackend('rest', factory);
})();
