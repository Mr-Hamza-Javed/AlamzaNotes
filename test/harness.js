/* Alamza Notes — test harness.
 *
 * The app is a browser class assembled from lib/part-*.js onto one prototype
 * (see ARCHITECTURE.md). None of that needs a DOM to be exercised: the parts
 * are plain methods over `this.state`, so this file builds the same prototype
 * inside a Node `vm` context and hands back a live instance.
 *
 *   const { makeApp } = require('./harness');
 *   const app = makeApp({ pages: {...}, dbs: {...} });
 *
 * `setState` is applied SYNCHRONOUSLY here. React batches; nothing in the
 * version code depends on batching, and a synchronous commit is what makes a
 * test able to assert on the state a call produced.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/* Everything the parts read off the global scope. markdown/diff/helpers are
   real; the browser-only surfaces are stubs, because no test drives the DOM. */
function newContext(consoleOver) {
  const sandbox = {
    console: Object.assign({}, console, consoleOver || {}),
    setTimeout, clearTimeout, setInterval, clearInterval,
    Promise, JSON, Math, Date, Object, Array, String, Number, Boolean,
    RegExp, Error, Map, Set, isNaN, parseInt, parseFloat, encodeURIComponent,
    decodeURIComponent, Intl, TextEncoder, TextDecoder
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.navigator = { clipboard: { writeText: () => Promise.resolve() } };
  sandbox.location = { origin: 'https://test.local', pathname: '/', hash: '' };
  sandbox.document = {
    createElement: () => ({ style: {} }),
    activeElement: null,
    documentElement: { getAttribute: () => 'light', setAttribute: () => {}, style: { setProperty: () => {} } },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {}
  };
  sandbox.matchMedia = () => ({ matches: false });
  /* renderVals() builds icons with React.createElement; a plain descriptor is
     enough to let the value-building code run and be asserted on. */
  sandbox.React = {
    createElement: (type, props, ...kids) => ({ type, props: props || {}, children: kids })
  };
  vm.createContext(sandbox);

  const load = (rel) => vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
  ['lib/helpers.js', 'lib/markdown.js', 'lib/diff.js', 'lib/parts.js'].forEach(load);
  fs.readdirSync(path.join(ROOT, 'lib'))
    .filter(f => /^part-.*\.js$/.test(f))
    .sort()
    .forEach(f => load('lib/' + f));
  return { sandbox, load };
}

/* The store the app talks to. Every call is recorded so a test can assert on
   what reached storage — which is where most of the version bugs lived. */
function makeStore(over) {
  const s = {
    mode: 'firebase',
    indexReady: true,
    demo: false,
    stats: { down: 0, up: 0, reads: 0, writes: 0 },
    calls: [],
    vdata: {},                 // pageId -> vId -> payload   (the server)
    vmetaStore: {},            // pageId -> version list     (the server)
    bodies: {},                // pageId -> blocks           (the server)
    rows: {},                  // dbId -> rows               (the server)
    _vmetaSeen: {},
    log(name, args) { s.calls.push({ name, args }); },

    loadBody(id) { s.log('loadBody', [id]); return Promise.resolve(s.bodies[id] || null); },
    loadRows(id) { s.log('loadRows', [id]); return Promise.resolve(s.rows[id] || null); },
    loadDigests() { return Promise.resolve({}); },
    peekDigests() { return null; },

    putVersionBlocks(pageId, vId, blocks) {
      s.log('putVersionBlocks', [pageId, vId]);
      (s.vdata[pageId] = s.vdata[pageId] || {})[vId] = JSON.parse(JSON.stringify(blocks));
    },
    getVersionBlocks(pageId, vId) {
      s.log('getVersionBlocks', [pageId, vId]);
      const hit = s.vdata[pageId] && s.vdata[pageId][vId];
      return Promise.resolve(hit ? JSON.parse(JSON.stringify(hit)) : null);
    },
    dropVersionBlocks(pageId, vId) {
      s.log('dropVersionBlocks', [pageId, vId]);
      if (s.vdata[pageId]) delete s.vdata[pageId][vId];
    },
    loadVersionMeta(pageId) {
      s.log('loadVersionMeta', [pageId]);
      /* faithful to the real adapter: `seen` is set when the READ LANDS, not
         when it is issued — the whole A1 race lives in that gap */
      return Promise.resolve().then(() => {
        s._vmetaSeen[pageId] = true;
        return s.vmetaStore[pageId] ? JSON.parse(JSON.stringify(s.vmetaStore[pageId])) : [];
      });
    },
    vmetaKnown(pageId) { return !!s._vmetaSeen[pageId]; },
    markVersionMeta(pageId) { s.log('markVersionMeta', [pageId]); s._vmetaSeen[pageId] = true; },
    purgeDatabases() { return Promise.resolve(0); },
    write() {}, flush() {}, reset() {}
  };
  return Object.assign(s, over || {});
}

function makeApp(initial, storeOver) {
  const { sandbox } = newContext();
  const store = makeStore(storeOver);
  sandbox.AStore = store;

  vm.runInContext(`
    class App {
      constructor() {
        this.state = {
          ready: true, route: 'app', main: 'page',
          pages: {}, dbs: {}, prefs: { theme: 'light', showChanges: false },
          workspace: { name: 'Alamza', icon: 'x' },
          user: { uid: 'u1', name: 'Tester' }, pageId: null, stack: [],
          expanded: {}, invites: [],
          focusId: null, panel: null, modal: null, sheet: null, menu: null, slash: null,
          dbView: {}, dbQuery: {}, roVersion: null, toast: null,
          diffA: null, diffB: 'current', diffMode: 'split',
          isMobile: false, blockSel: []
        };
        this._els = {}; this._refs = {}; this._mathEls = {}; this._mathRefs = {};
        this.renders = 0; this.toasts = []; this.persists = 0;
      }
      setState(patch, cb) {
        const next = typeof patch === 'function' ? patch(this.state) : patch;
        if (next) this.state = Object.assign({}, this.state, next);
        this.renders++;
        if (cb) cb();
      }
      forceUpdate() { this.renders++; }
      persist() { this.persists++; }
      /* browser-only surfaces the version code brushes past */
      syncDom() {} applyTheme() {} flashBlock() {}
      repairRowPages() {} reconcileChildren() { return Promise.resolve(); }
      normAllDbs(d) { return d; }
    }
    AlamzaParts.applyTo(App.prototype);
    globalThis.App = App;
  `, sandbox, { filename: 'test/app.js' });

  const app = new sandbox.App();
  /* toast() is real (it lives in part-versions) but its timer is noise here */
  const realToast = app.toast.bind(app);
  app.toast = (m) => { app.toasts.push(m); app.setState({ toast: m }); };
  app._realToast = realToast;

  Object.assign(app.state, initial || {});
  app.store = store;
  app.sandbox = sandbox;
  return app;
}

/* let every pending microtask/timer settle — the version paths chain several */
function settle(n) {
  let p = Promise.resolve();
  for (let i = 0; i < (n || 12); i++) p = p.then(() => new Promise(r => setTimeout(r, 0)));
  return p;
}

/* ---- the real lib/store.js -------------------------------------------
   push() is where the write bookkeeping lives, and it is closed over module
   private state (`fb`, `sent`, `vqueue`, `vmetaSeen`, `pending`). Rather than
   put a test backdoor in shipped code, the source is instrumented HERE, on the
   way into the vm: one line is appended to the IIFE's variable block that
   hands those bindings back out. The rest of the file runs verbatim. */
const STORE_ANCHOR = "var remote = null;";
const STORE_HOOK = `
  window.__storeInternals = function () {
    return {
      setFb: function (v) { fb = v; },
      setUser: function (u) { AStore.user = u; },
      setPending: function (p) { pending = p; },
      setRemote: function (r) { remote = r; },
      sent: function () { return sent; },
      vqueue: function () { return vqueue; },
      vcache: function () { return vcache; },
      vmetaSeen: function () { return vmetaSeen; },
      rowGone: function () { return rowGone; }
    };
  };`;

function loadRealStore(opts) {
  const { sandbox } = newContext();
  let mem = {};
  sandbox.localStorage = {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; },
    clear: () => { mem = {}; }
  };
  sandbox.ALAMZA_FIREBASE_CONFIG = { apiKey: 'test', databaseURL: 'https://test.firebaseio.com' };
  sandbox.addEventListener = () => {};
  sandbox.document.addEventListener = () => {};
  sandbox.document.visibilityState = 'visible';
  sandbox.requestIdleCallback = null;

  let src = fs.readFileSync(path.join(ROOT, 'lib/store.js'), 'utf8');
  if (src.indexOf(STORE_ANCHOR) < 0) throw new Error('harness: store.js anchor moved — update STORE_ANCHOR');
  src = src.replace(STORE_ANCHOR, STORE_ANCHOR + STORE_HOOK);
  vm.runInContext(src, sandbox, { filename: 'lib/store.js' });

  const store = sandbox.AStore;
  const inner = sandbox.__storeInternals();
  /* a Firebase stub whose update() resolves or rejects on command */
  const fb = {
    updates: [],
    behaviour: 'ok',              // 'ok' | 'reject' | 'throw'
    update(ref, patch) {
      fb.updates.push(JSON.parse(JSON.stringify(patch)));
      if (fb.behaviour === 'throw') throw new Error('synchronous failure');
      if (fb.behaviour === 'reject') return Promise.reject(new Error('permission denied'));
      return Promise.resolve();
    },
    ref: (db, p) => ({ path: p }),
    get: () => Promise.resolve({ val: () => null })
  };
  inner.setFb(fb);
  inner.setUser({ uid: 'u1', name: 'Tester' });
  Object.assign(store.stats, { down: 0, up: 0, reads: 0, writes: 0 });
  return { store, fb, inner, sandbox, mem: () => mem };
}

module.exports = { makeApp, makeStore, settle, newContext, loadRealStore };
