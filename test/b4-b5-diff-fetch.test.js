/* B4 — openDiff prefetched both sides, but changing a version in either
   dropdown only set state. Nothing fetched the newly chosen snapshot, and the
   pending branch fetched page BODIES, not payloads — so picking another
   version left the diff on "comparing…" for good.
   B5 — a payload the server does not hold was re-fetched on every render and
   every remote delta, because nothing remembered the miss. */
const { makeApp, settle } = require('./harness');
const { page, block, version } = require('./fixtures');

async function twoVersions() {
  const app = makeApp({ pages: { p1: page('p1', { blocks: [block('b1', 'one')] }) }, pageId: 'p1' });
  app.store._vmetaSeen.p1 = true;
  app.createVersion('first');
  await settle();
  app.state.pages.p1 = Object.assign({}, app.state.pages.p1, { blocks: [block('b1', 'two')] });
  app.createVersion('second');
  await settle();
  app.state.pages.p1 = Object.assign({}, app.state.pages.p1, { blocks: [block('b1', 'three')] });
  return app;
}

describe('B4 — picking a version in the diff', () => {
  it('fetches the side that was chosen', async () => {
    const app = await twoVersions();
    const [v1, v2] = app.state.pages.p1.versions;
    app.openDiff(v2.id, 'current');
    await settle();
    /* v1 is cold: drop the memo, as a reload would */
    delete app._vb[v1.id];

    app.setState({ modal: { kind: 'diff' } });
    app.pickDiffSide('a', v1.id);
    await settle();
    assert.ok(app.vsnap(v1.id), 'choosing a version must fetch it');
    assert.notOk(app.diffPending(v1.id, 'p1'), 'or the pane never leaves "comparing…"');
  });

  it('the dropdown handlers go through that path', async () => {
    const app = await twoVersions();
    const [v1] = app.state.pages.p1.versions;
    app.openDiff('current', 'current');
    await settle();
    delete app._vb[v1.id];
    const vals = app.extraVals();
    vals.setDiffA({ target: { value: v1.id } });
    await settle();
    assert.eq(app.state.diffA, v1.id);
    assert.ok(app.vsnap(v1.id), 'setDiffA must prefetch, not only set state');
    vals.setDiffB({ target: { value: v1.id } });
    await settle();
    assert.eq(app.state.diffB, v1.id);
  });
});

describe('B5 — a payload that is not there', () => {
  it('is asked for once, not on every render', async () => {
    const app = await twoVersions();
    const v1 = app.state.pages.p1.versions[0];
    delete app._vb[v1.id];
    delete app.store.vdata.p1[v1.id];

    for (let i = 0; i < 6; i++) { await app.ensureVersion(v1.id); await settle(2); }
    const reads = app.store.calls.filter(c => c.name === 'getVersionBlocks' && c.args[1] === v1.id).length;
    assert.ok(reads <= 1, 'a missing payload was re-fetched ' + reads + ' times — every one is billed');
  });

  it('is asked for again once it really exists', async () => {
    const app = await twoVersions();
    const v1 = app.state.pages.p1.versions[0];
    delete app._vb[v1.id];
    const real = app.store.vdata.p1[v1.id];
    delete app.store.vdata.p1[v1.id];
    await app.ensureVersion(v1.id);
    await settle();
    assert.notOk(app.vsnap(v1.id));
    /* the payload lands on this device by some other route */
    app.cacheVersion('p1', v1.id, real);
    assert.ok(app.vsnap(v1.id), 'a miss must not be remembered as permanent');
  });

  it('the change markers do not re-fetch a missing baseline forever', async () => {
    const app = await twoVersions();
    app.setState(s => ({ prefs: Object.assign({}, s.prefs, { showChanges: true }) }));
    const last = app.state.pages.p1.versions[1];
    delete app._vb[last.id];
    delete app.store.vdata.p1[last.id];
    for (let i = 0; i < 6; i++) { app.changedIds(); await settle(2); }
    const reads = app.store.calls.filter(c => c.name === 'getVersionBlocks' && c.args[1] === last.id).length;
    assert.ok(reads <= 1, 'changedIds runs on every render — it billed ' + reads + ' reads');
  });
});
