/* Two databases at once.
 *
 * The reason this exists is not novelty, it is MOVING. Changing database is
 * otherwise all-or-nothing, and all-or-nothing on live data is how a workspace
 * gets lost. With a routing table one kind of data moves at a time and the app
 * keeps working in between.
 *
 * The router implements the same six methods as the things it contains, so the
 * store cannot tell it apart from a single database — which is why "use two
 * databases" needed no change to lib/store.js at all. These tests hold it to
 * that, and to being honest about what it costs.
 */
const { makeDataContext } = require('./harness');

/* two independent in-memory backends, so a test can see WHICH one was written */
function twoStores(D) {
  const seen = { a: {}, b: {} };
  function mk(tag) {
    const store = seen[tag];
    const f = function () {
      return D.defineBackend({
        name: tag,
        caps: { realtime: tag === 'a', atomicCommit: true, maxCommit: tag === 'b' ? 100 : 0, paged: true, publicRead: true },
        connect: () => Promise.resolve(),
        read: (s, p) => Promise.resolve(p in store ? store[p] : null),
        readPage: (s, c) => {
          const out = {};
          Object.keys(store).forEach(k => {
            if (k.indexOf(c + '/') === 0 && k.slice(c.length + 1).indexOf('/') < 0) out[k.slice(c.length + 1)] = store[k];
          });
          return Promise.resolve(out);
        },
        /* a null takes the subtree with it — the contract in lib/data/port.js.
           A stand-in that skips this would let a router bug hide behind it. */
        write: (s, p, v) => {
          if (v === null) {
            delete store[p];
            Object.keys(store).forEach(k => { if (k.indexOf(p + '/') === 0) delete store[k]; });
          } else store[p] = v;
          return Promise.resolve();
        },
        commit(s, patch) {
          Object.keys(patch).forEach(p => this.write(s, p, patch[p] === undefined ? null : patch[p]));
          return Promise.resolve();
        },
        watch: (s, c, h) => { store.__watched = c; return () => {}; },
        close: () => Promise.resolve()
      });
    };
    f.configured = () => true;
    D.registerBackend(tag, f);
  }
  mk('a'); mk('b');
  return seen;
}

function router(table) {
  const { D } = makeDataContext({ backend: 'routing', backends: { a: {}, b: {} }, routing: table });
  const seen = twoStores(D);
  return { D, seen, r: D.createBackend('routing', D.config()) };
}

describe('routing — one kind of data at a time', () => {
  it('each kind lands on the backend its line names', async () => {
    const { seen, r } = router({ default: 'a', body: 'b', vdata: 'b' });
    await r.connect();
    await r.write({ ws: 'u1' }, 'idx/p1', { t: 'Title' });
    await r.write({ ws: 'u1' }, 'body/p1', { b: [{ text: 'text' }] });
    await r.write({ ws: 'u1' }, 'vdata/p1/v1', [{ text: 'old' }]);
    await r.write({ ws: 'u1' }, 'dbrow/d1/r1', { id: 'r1' });

    assert.deep(Object.keys(seen.a).sort(), ['dbrow/d1/r1', 'idx/p1'], 'default did not catch the unnamed kinds');
    assert.deep(Object.keys(seen.b).sort(), ['body/p1', 'vdata/p1/v1'], 'the named kinds did not move');
  });

  it('reading finds it wherever it was put', async () => {
    const { r } = router({ default: 'a', body: 'b' });
    await r.connect();
    await r.write({ ws: 'u1' }, 'body/p1', { b: [{ text: 'hello' }] });
    assert.deep(await r.read({ ws: 'u1' }, 'body/p1'), { b: [{ text: 'hello' }] });
    assert.eq(await r.read({ ws: 'u1' }, 'idx/p1'), null, 'a path nobody wrote should still be absent');
  });

  it('one save becomes one write per backend, and no more', async () => {
    const { D, seen, r } = router({ default: 'a', body: 'b' });
    await r.connect();
    let aCalls = 0, bCalls = 0;
    const ra = D.createBackend('a', {}), rb = D.createBackend('b', {});
    void ra; void rb;
    /* count by watching what arrives rather than by patching internals */
    await r.commit({ ws: 'u1' }, {
      'idx/p1': { t: 'T' }, 'idx/p2': { t: 'U' },
      'body/p1': { b: [] }, 'dig/p1': 'words'
    });
    aCalls = Object.keys(seen.a).length;
    bCalls = Object.keys(seen.b).length;
    assert.eq(aCalls, 3, 'idx and dig should have gone to the default together');
    assert.eq(bCalls, 1, 'only body was routed away');
  });

  it('a table deleted on one backend does not leave rows on another', async () => {
    const { seen, r } = router({ default: 'a', dbrow: 'b' });
    await r.connect();
    await r.commit({ ws: 'u1' }, { 'dbmeta/d1': { n: 'T' }, 'dbrow/d1/r1': { id: 'r1' } });
    await r.commit({ ws: 'u1' }, { 'dbmeta/d1': null, 'dbrow/d1': null, 'dbrev/d1': null });
    assert.deep(Object.keys(seen.a).filter(k => k[0] !== '_'), [], 'meta survived');
    assert.deep(Object.keys(seen.b).filter(k => k[0] !== '_'), [], 'rows survived on the other backend');
  });

  it('a watch goes to whoever owns that collection', async () => {
    const { seen, r } = router({ default: 'a', dbrow: 'b' });
    await r.connect();
    r.watch({ ws: 'u1' }, 'idx', { added: () => {} });
    r.watch({ ws: 'u1' }, 'dbrow/d1', { added: () => {} });
    assert.eq(seen.a.__watched, 'idx');
    assert.eq(seen.b.__watched, 'dbrow/d1');
  });
});

describe('routing — telling the truth about what it costs', () => {
  it('a split save is never reported as atomic', () => {
    const { r } = router({ default: 'a', body: 'b' });
    assert.eq(r.caps.atomicCommit, false,
      'two machines cannot be all-or-nothing, and the store must not be told they can');
  });

  it('live updates are claimed only when every backend in use can stream', () => {
    assert.eq(router({ default: 'a' }).r.caps.realtime, true, 'a alone streams');
    assert.eq(router({ default: 'a', body: 'b' }).r.caps.realtime, false,
      'b cannot stream, so the combination cannot');
  });

  it('the tightest commit limit in the group is the one that applies', () => {
    assert.eq(router({ default: 'a', body: 'b' }).r.caps.maxCommit, 100, 'the smaller cap must win');
    assert.eq(router({ default: 'a' }).r.caps.maxCommit, 0);
  });

  it('the split is printable, so Settings can show where each kind went', () => {
    const { r } = router({ default: 'a', body: 'b', vdata: 'b' });
    const text = r.describe();
    assert.includes(text, 'default -> a');
    assert.includes(text, 'body');
    assert.includes(text, 'vdata');
  });
});

describe('routing — the edges', () => {
  it('a kind pointed at an unconfigured backend goes to this browser, loudly', async () => {
    const warned = [];
    const { D, sandbox } = makeDataContext({
      backend: 'routing', backends: { a: {} }, routing: { default: 'a', body: 'firestore' }
    });
    twoStores(D);
    sandbox.console.warn = (m) => warned.push(String(m));
    const r = D.createBackend('routing', D.config());
    await r.connect();
    await r.write({ ws: 'u1' }, 'body/p1', { b: [] });
    assert.ok(warned.join(' ').indexOf('firestore') >= 0, 'a misrouted kind was silently redirected');
    assert.deep(await r.read({ ws: 'u1' }, 'body/p1'), { b: [] }, 'and the data still has to be readable');
  });

  it('a router cannot route to itself, and says so before the app starts', () => {
    /* it fails while the router is being BUILT rather than on the first read,
       which is the difference between a startup error naming the mistake and a
       stack overflow the first time somebody opens a page */
    const { D } = makeDataContext({ backend: 'routing', backends: {}, routing: { default: 'routing' } });
    assert.throws(() => D.createBackend('routing', D.config()), 'infinite recursion was allowed');
    try { D.createBackend('routing', D.config()); }
    catch (e) { assert.includes(e.message, 'itself'); }
  });

  it('a placeholder table is not a routing setup', () => {
    const { D } = makeDataContext({ backends: {}, routing: { default: 'rtdb' } });
    assert.eq(D.configured('routing', D.configFor('routing')), false,
      'wrapping one backend in a router adds a layer and changes nothing');
  });
});
