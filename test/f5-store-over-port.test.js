/* The store is the same store on every database.
 *
 * Everything else in this suite tests a backend. This file tests the CLAIM: the
 * real lib/store.js, unchanged, driven twice — once against the localStorage
 * backend and once against Firestore through the fake SDK — must produce the
 * same workspace both times. If it does not, "change one line in lib/config.js"
 * is not true, whatever the other tests say.
 *
 * Nothing here stubs the store. `push()` is the real one, with its real diff,
 * its real writer ids, and its real retry.
 */
const { loadRealStore } = require('./harness');
const { makeFakeFirestore } = require('./fake-firestore');

const PAGES = {
  p1: {
    id: 'p1', title: 'First', icon: '', blocks: [{ id: 'b1', type: 'p', text: 'hello world' }],
    updatedAt: 100, createdAt: 50, versions: [], share: { published: false, slug: 'p1', password: null, invites: [] }
  },
  p2: {
    id: 'p2', title: 'Second', parentId: 'p1', order: 1,
    blocks: [{ id: 'b2', type: 'table', rows: [['a', 'b'], ['c', 'd']] }],
    updatedAt: 120, createdAt: 60, versions: [], share: { published: false, slug: 'p2', password: null, invites: [] }
  }
};
const DBS = {
  d1: { id: 'd1', name: 'Tasks', props: [{ id: 'c1', name: 'Name' }], views: [],
        rows: [{ id: 'r1', c: { c1: 'one' } }, { id: 'r2', c: { c1: 'two' } }] }
};
const STATE = { pages: PAGES, dbs: DBS, prefs: { theme: 'dark' }, workspace: { name: 'W' }, invites: [], shares: [] };

/* what a fresh workspace looks like on `name`, after one real save */
async function saveOn(make) {
  const h = loadRealStore({ backend: make });
  const backend = h.inner.backend();
  /* the real store awaits connect() inside openBackend() before anything can
     reach the port; a test that injects a backend has to do the same */
  await backend.__ready;
  h.inner.setRemote({ pages: {}, dbmeta: {}, vmeta: {}, prefs: {}, invites: [], shares: [] });
  h.inner.setPending(JSON.parse(JSON.stringify(STATE)));
  h.store.push();
  await new Promise(r => setTimeout(r, 30));
  return { h, backend, store: h.store };
}

function localBackend(D) {
  const b = D.createBackend('local', { namespace: 'probe' });
  b.__ready = b.connect();
  return b;
}

function firestoreBackend(D) {
  const fake = makeFakeFirestore();
  D.firebaseApp = () => Promise.resolve({ options: {} });
  D.firebaseModule = () => Promise.resolve(fake);
  const b = D.createBackend('firestore', { apiKey: 'k', projectId: 'p' });
  b.__fake = fake;
  b.__ready = b.connect();
  return b;
}

async function readBack(backend) {
  const ws = { ws: 'u1' };
  return {
    idx: await backend.readPage(ws, 'idx', null, 0),
    body1: await backend.read(ws, 'body/p1'),
    body2: await backend.read(ws, 'body/p2'),
    dig1: await backend.read(ws, 'dig/p1'),
    dbmeta: await backend.read(ws, 'dbmeta/d1'),
    rows: await backend.readPage(ws, 'dbrow/d1', null, 0),
    meta: await backend.read(ws, 'meta')
  };
}

/* the writer id is per-tab and deliberately random, so it is not part of
   "the same workspace" — everything else is */
function stripW(o) {
  return JSON.parse(JSON.stringify(o), function (k, v) {
    if (v && typeof v === 'object' && !Array.isArray(v) && 'w' in v) { var c = Object.assign({}, v); delete c.w; return c; }
    return v;
  });
}

describe('the store over the port — one save, two databases', () => {
  it('a save through localStorage lands where the app expects it', async () => {
    const { backend } = await saveOn(localBackend);
    const got = await readBack(backend);
    assert.deep(Object.keys(got.idx).sort(), ['p1', 'p2']);
    assert.eq(got.idx.p1.t, 'First');
    assert.eq(got.idx.p2.p, 'p1', 'the parent link is what builds the sidebar tree');
    assert.deep(got.body1, { b: PAGES.p1.blocks });
    assert.includes(got.dig1, 'hello world');
    assert.deep(Object.keys(got.rows).sort(), ['r1', 'r2']);
    assert.eq(got.meta.prefs.theme, 'dark');
  });

  it('the identical save through Firestore lands identically', async () => {
    const a = await saveOn(localBackend);
    const b = await saveOn(firestoreBackend);
    const A = stripW(await readBack(a.backend));
    const B = stripW(await readBack(b.backend));
    assert.deep(B, A, 'the same store on two databases produced two different workspaces');
  });

  it('a table block full of nested arrays survives on both', async () => {
    const a = await saveOn(localBackend);
    const b = await saveOn(firestoreBackend);
    assert.deep((await readBack(a.backend)).body2, { b: PAGES.p2.blocks });
    assert.deep((await readBack(b.backend)).body2, { b: PAGES.p2.blocks },
      'Firestore refuses nested arrays — the encoding is what makes this pass');
  });

  it('the cost meter counts on whichever backend is behind the port', async () => {
    const { store } = await saveOn(localBackend);
    assert.ok(store.stats.writes > 0, 'a save was not counted');
    assert.ok(store.stats.up > 0, 'uploaded bytes were not counted');
  });
});

describe('the store over the port — the behaviours that survive a change of database', () => {
  it('the write diff still sends only what changed', async () => {
    const { h, store, backend } = await saveOn(localBackend);
    const before = store.stats.writes;
    /* nothing changed — the second push must be free */
    h.inner.setPending(JSON.parse(JSON.stringify(STATE)));
    store.push();
    await new Promise(r => setTimeout(r, 20));
    assert.eq(store.stats.writes, before, 'an unchanged save still hit the network');

    const next = JSON.parse(JSON.stringify(STATE));
    next.pages.p1.title = 'Renamed';
    h.inner.setPending(next);
    store.push();
    await new Promise(r => setTimeout(r, 20));
    assert.eq((await backend.readPage({ ws: 'u1' }, 'idx', null, 0)).p1.t, 'Renamed');
    assert.eq(store.stats.writes, before + 1, 'a real change should be exactly one more write');
  });

  it('a page deleted takes its body, digest and snapshots with it', async () => {
    const { h, store, backend } = await saveOn(localBackend);
    const next = JSON.parse(JSON.stringify(STATE));
    delete next.pages.p2;
    h.inner.setPending(next);
    store.push();
    await new Promise(r => setTimeout(r, 20));
    const ws = { ws: 'u1' };
    assert.eq(await backend.read(ws, 'idx/p2'), null);
    assert.eq(await backend.read(ws, 'body/p2'), null, 'the body outlived the page');
    assert.eq(await backend.read(ws, 'dig/p2'), null, 'the search digest outlived the page');
  });

  it('a failed write is put back and retried, whatever the database', async () => {
    /* the A3 finding, re-asserted at the port: a rejected commit must leave the
       bookkeeping exactly as it was, or the next push sees no difference and
       the edit is lost in silence */
    const h = loadRealStore({
      backend: (D) => {
        const b = D.createBackend('local', { namespace: 'flaky' });
        b.__ready = b.connect();
        const real = b.commit.bind(b);
        b.commit = (scope, patch) => (b.__fail ? Promise.reject(new Error('permission denied')) : real(scope, patch));
        return b;
      }
    });
    const backend = h.inner.backend();
    await backend.__ready;
    backend.__fail = true;
    h.inner.setRemote({ pages: {}, dbmeta: {}, vmeta: {}, prefs: {}, invites: [], shares: [] });
    h.inner.setPending(JSON.parse(JSON.stringify(STATE)));
    h.store.push();
    await new Promise(r => setTimeout(r, 30));
    assert.eq(await backend.read({ ws: 'u1' }, 'idx/p1'), null, 'the write should have failed');
    assert.ok(h.store.retryPending(), 'a failed write was simply forgotten');

    backend.__fail = false;
    h.store.push();
    await new Promise(r => setTimeout(r, 30));
    assert.ok(await backend.read({ ws: 'u1' }, 'idx/p1'), 'the retry did not re-send the same bytes');
  });

  it('a backend with a commit ceiling gets the save in pieces, not a rejection', async () => {
    const h = loadRealStore({
      backend: (D) => {
        const b = D.createBackend('local', { namespace: 'small' });
        b.__ready = b.connect();
        b.caps.maxCommit = 2;
        const real = b.commit.bind(b);
        b.sizes = [];
        b.commit = (scope, patch) => {
          const n = Object.keys(patch).length;
          b.sizes.push(n);
          if (n > 2) return Promise.reject(new Error('batch too large'));
          return real(scope, patch);
        };
        return b;
      }
    });
    const backend = h.inner.backend();
    await backend.__ready;
    h.inner.setRemote({ pages: {}, dbmeta: {}, vmeta: {}, prefs: {}, invites: [], shares: [] });
    h.inner.setPending(JSON.parse(JSON.stringify(STATE)));
    h.store.push();
    await new Promise(r => setTimeout(r, 40));
    assert.ok(backend.sizes.length > 1, 'the patch was not split');
    assert.ok(Math.max(...backend.sizes) <= 2, 'a piece went over the ceiling');
    assert.eq((await backend.readPage({ ws: 'u1' }, 'idx', null, 0)).p1.t, 'First',
      'splitting the save lost part of it');
  });
});
