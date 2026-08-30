/* A1 — a snapshot taken before the version METADATA has been read must never
   replace the real history with the one item this session happens to know. */
const { makeApp, settle } = require('./harness');
const { page, block, version } = require('./fixtures');

function coldHistoryApp() {
  /* the server holds five snapshots; this device has not read them yet */
  const app = makeApp({ pages: { p1: page('p1') }, pageId: 'p1' });
  app.store.vmetaStore.p1 = [1, 2, 3, 4, 5].map(n => version('v' + n, n));
  app.store.vdata.p1 = {};
  app.store.vmetaStore.p1.forEach(v => { app.store.vdata.p1[v.id] = { b: [block('old', 'v' + v.n)], d: {}, p: {} }; });
  return app;
}

describe('A1 — version metadata race', () => {
  it('cacheVersion() does not claim the metadata is known', () => {
    const app = coldHistoryApp();
    app.cacheVersion('p1', 'v_new', { b: [], d: {}, p: {} });
    assert.notOk(app.store.vmetaKnown('p1'),
      'marking metadata "seen" without reading it lets push() write a short list over the real one');
  });

  it('createVersion() waits for the real history before authoring', async () => {
    const app = coldHistoryApp();
    app.state.pages.p1.blocks = [block('b1', 'edited')];
    app.createVersion('manual');
    await settle();
    const vs = app.state.pages.p1.versions;
    assert.eq(vs.length, 6, 'the five stored snapshots must survive the new one');
    assert.eq(vs[vs.length - 1].n, 6, 'the new snapshot numbers itself after the stored ones');
  });

  it('the panel reports history as loading, not as empty', () => {
    const app = coldHistoryApp();
    app.setState({ panel: 'versions' });
    const v = app.renderVals();
    assert.ok(v.versionsLoading, 'an unread history must not render as "no snapshots yet"');
    assert.notOk(v.noVersions, 'and must not offer "take the first snapshot"');
  });

  it('local/demo mode has nothing to fetch, so nothing is blocked', async () => {
    const app = makeApp({ pages: { p1: page('p1') }, pageId: 'p1' }, { mode: 'local' });
    assert.ok(app.versionMetaKnown('p1'));
    app.createVersion('first');
    await settle();
    assert.eq(app.state.pages.p1.versions.length, 1);
  });

  it('a failed metadata read stops with a message, it does not loop', async () => {
    const app = coldHistoryApp();
    app.store.loadVersionMeta = () => { app.store.log('loadVersionMeta', ['p1']); return Promise.resolve(null); };
    app.state.pages.p1.blocks = [block('b1', 'edited')];
    app.createVersion('manual');
    await settle(20);
    const reads = app.store.calls.filter(c => c.name === 'loadVersionMeta').length;
    assert.ok(reads <= 2, 'one retry at most, got ' + reads + ' reads');
    assert.eq(app.state.pages.p1.versions.length, 0, 'nothing may be authored against an unknown history');
    assert.includes(app.toasts.join(' | '), 'history');
    assert.notOk(app._verLock, 'the lock must be released or the button stays dead');
  });
});
