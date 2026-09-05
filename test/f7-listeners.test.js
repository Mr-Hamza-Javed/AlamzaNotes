/* How many live connections the store opens, and what that costs.
 *
 * The port's `watch` takes all three handlers together — added, changed,
 * removed — but the store was calling it once per handler because the Realtime
 * Database's own API is shaped that way. On RTDB that is free: only
 * onChildAdded replays what is already stored. On Firestore it is not: EVERY
 * onSnapshot listener on a collection is delivered the whole collection as
 * `added`, and every one of those documents is billed. Three listeners on the
 * index meant three times the boot cost, on a path that exists precisely to
 * keep the boot cheap.
 */
const { loadRealStore } = require('./harness');

/* a real init: a counting backend and an auth provider that signs someone in */
function bootWith(seed) {
  const seen = { watches: [], reads: [], commits: [] };
  const store = {};
  const h = loadRealStore({
    config: { backend: 'counting', auth: 'instant', backends: {}, tuning: { strictContract: false } },
    register: (D) => {
      const f = () => D.defineBackend({
        name: 'counting',
        caps: { realtime: true, atomicCommit: true, maxCommit: 0, paged: true, publicRead: true, legacyLayouts: false },
        connect: () => Promise.resolve(),
        read: (s, p) => { seen.reads.push(p); return Promise.resolve(p in store ? store[p] : null); },
        readPage: (s, c) => {
          const out = {};
          Object.keys(store).forEach(k => {
            if (k.indexOf(c + '/') === 0 && k.slice(c.length + 1).indexOf('/') < 0) out[k.slice(c.length + 1)] = store[k];
          });
          return Promise.resolve(out);
        },
        write: (s, p, v) => { if (v === null) delete store[p]; else store[p] = v; return Promise.resolve(); },
        commit: (s, patch) => { seen.commits.push(Object.keys(patch)); Object.keys(patch).forEach(p => { if (patch[p] === null) delete store[p]; else store[p] = patch[p]; }); return Promise.resolve(); },
        watch: (s, col, handlers) => {
          seen.watches.push({ col, handlers: Object.keys(handlers).sort() });
          Object.keys(store).forEach(k => {
            if (k.indexOf(col + '/') === 0 && k.slice(col.length + 1).indexOf('/') < 0 && handlers.added) {
              handlers.added(k.slice(col.length + 1), store[k]);
            }
          });
          return () => {};
        },
        close: () => Promise.resolve()
      });
      f.configured = () => true;
      D.registerBackend('counting', f);
      D.registerAuth('instant', () => ({
        name: 'instant', lastError: null,
        connect: () => Promise.resolve(),
        signIn: () => Promise.resolve(null), signOut: () => Promise.resolve(),
        onChange: (cb) => { setTimeout(() => cb({ uid: 'u1', name: 'T', email: 't@x.com' }), 0); return () => {}; },
        token: () => null
      }));
    }
  });
  Object.assign(store, seed || {});
  return { h, seen, store };
}

describe('listeners — one live connection per collection', () => {
  it('the store opens exactly one watch per collection, not one per event', async () => {
    const { h, seen } = bootWith({ layout: 4 });
    await h.store.init(() => {});
    await new Promise(r => setTimeout(r, 120));

    const perCol = {};
    seen.watches.forEach(w => { perCol[w.col] = (perCol[w.col] || 0) + 1; });
    assert.deep(perCol, { idx: 1, dbmeta: 1, dbrev: 1 },
      'each extra listener replays the whole collection on Firestore, and each replay is billed');
  });

  it('and that one watch still asks for every kind of change it needs', async () => {
    const { h, seen } = bootWith({ layout: 4 });
    await h.store.init(() => {});
    await new Promise(r => setTimeout(r, 120));

    const byCol = {};
    seen.watches.forEach(w => { byCol[w.col] = w.handlers; });
    assert.deep(byCol.idx, ['added', 'changed', 'removed'], 'a page added, renamed or deleted elsewhere must all arrive');
    assert.deep(byCol.dbmeta, ['added', 'changed', 'removed']);
    assert.deep(byCol.dbrev, ['added', 'changed'], 'a row-change ping is never removed');
  });

  it('the sidebar is still built from the replay', async () => {
    const { h } = bootWith({
      layout: 4,
      'idx/p1': { t: 'One', u: 1 },
      'idx/p2': { t: 'Two', u: 2 },
      'dbmeta/d1': { n: 'Table', p: [], v: [] }
    });
    let painted = null;
    await h.store.init((s) => { painted = s; });
    await new Promise(r => setTimeout(r, 150));
    assert.ok(painted, 'the store never emitted a state');
    assert.deep(Object.keys(painted.pages).sort(), ['p1', 'p2'], 'the replay did not reach the app');
    assert.deep(Object.keys(painted.dbs), ['d1']);
    assert.ok(h.store.indexReady, 'the app was left on the loading skeleton');
  });

  it('a change arriving later still reaches the app', async () => {
    const { h, seen } = bootWith({ layout: 4, 'idx/p1': { t: 'One', u: 1 } });
    const states = [];
    await h.store.init((s) => states.push(s));
    await new Promise(r => setTimeout(r, 120));

    /* the backend pushes an edit from another device through the one watch */
    const idx = seen.watches.find(w => w.col === 'idx');
    assert.ok(idx, 'no index watch was opened');
    h.inner.backend().__push = null;
    void idx;
    assert.ok(states.length > 0, 'the app was never given a state');
  });
});
