/* B11 — the snapshot payload memo grew without a ceiling and was never
   cleared: browsing a long history kept every payload it touched alive for the
   life of the tab, and signing out or stepping into the demo workspace left
   the previous account's notes in memory. */
const { makeApp, settle, loadRealStore } = require('./harness');
const { page, block, version } = require('./fixtures');

function manySnapshots(n) {
  const app = makeApp({ pages: { p1: page('p1') }, pageId: 'p1' });
  app.store._vmetaSeen.p1 = true;
  for (let i = 0; i < n; i++) {
    const vid = 'v' + i;
    app.cacheVersion('p1', vid, { b: [block('b' + i, 'snapshot ' + i)], d: {}, p: {} });
  }
  return app;
}

describe('B11 — the payload cache', () => {
  it('is bounded', () => {
    const app = manySnapshots(80);
    const held = Object.keys(app._vb).length;
    assert.ok(held <= 24, 'held ' + held + ' whole subtrees in memory');
    assert.ok(held >= 20, 'but it must still be a useful cache, got ' + held);
  });

  it('evicts the least recently used, and keeps what was just read', () => {
    const app = manySnapshots(24);
    app.vsnap('v0');                       // v0 becomes the most recent
    app.cacheVersion('p1', 'vNew', { b: [], d: {}, p: {} });
    assert.ok(app._vb.v0, 'a payload just read must not be the one evicted');
    assert.notOk(app._vb.v1, 'the oldest untouched one goes');
  });

  it('never evicts the version being previewed', () => {
    const app = manySnapshots(24);
    app.setState({ roVersion: 'v0' });
    for (let i = 0; i < 40; i++) app.cacheVersion('p1', 'x' + i, { b: [], d: {}, p: {} });
    assert.ok(app._vb.v0, 'the reader is looking at it');
  });

  it('is dropped on sign-out', () => {
    const app = manySnapshots(5);
    app._vbGone = { gone: 1 };
    app._verGone = { deleted: 1 };
    app.forgetVersions();
    assert.deep(app._vb, {});
    assert.deep(app._vbGone, {});
    assert.deep(app._verGone, {});
    assert.deep(app._vbLru, []);
  });

  it('a fresh session in the store starts with an empty payload cache', () => {
    const h = loadRealStore();
    h.store.putVersionBlocks('p1', 'v1', { b: [], d: {}, p: {} });
    assert.ok(Object.keys(h.inner.vcache()).length > 0);
    h.store.reset();
    assert.eq(Object.keys(h.inner.vcache()).length, 0, 'reset() must forget the payloads too');
  });

  it('the store bounds its own payload cache once the writes have gone out', async () => {
    const h = loadRealStore();
    h.inner.setPending({ pages: {}, dbs: {}, prefs: {} });
    for (let i = 0; i < 80; i++) {
      h.store.putVersionBlocks('p1', 'v' + i, { b: [{ id: 'b', text: 'x' }], d: {}, p: {} });
      h.store.push();
      await settle(1);
    }
    const held = Object.keys(h.inner.vcache()).length;
    assert.ok(held <= 32, 'the store held ' + held + ' payloads');
  });

  it('a payload still owed to the server is never evicted', () => {
    const h = loadRealStore();
    /* nothing is pushed, so every one of these is an unsent write */
    for (let i = 0; i < 80; i++) h.store.putVersionBlocks('p1', 'v' + i, { b: [], d: {}, p: {} });
    assert.eq(Object.keys(h.inner.vqueue()).length, 80);
    for (let i = 0; i < 80; i++) {
      assert.ok(h.inner.vcache()['p1/v' + i], 'v' + i + ' was dropped before it was written');
    }
  });
});
