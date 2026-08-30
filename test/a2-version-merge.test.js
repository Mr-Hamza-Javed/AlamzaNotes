/* A2 — two version lists are merged by IDENTITY, never by length. Comparing
   lengths lost a snapshot whenever two devices took one at the same time, and
   resurrected a snapshot the user had just deleted. */
const { makeApp, settle } = require('./harness');
const { page, block, version } = require('./fixtures');

const ids = (list) => (list || []).map(v => v.id);

describe('A2 — version list merge', () => {
  it('merges by id, so a same-length remote list is not ignored', () => {
    const app = makeApp();
    const mine = [version('a', 1), version('b', 2)];
    const theirs = [version('a', 1), version('c', 3)];
    assert.deep(ids(app.mergeVersions(mine, theirs)), ['a', 'b', 'c']);
  });

  it('keeps the order chronological regardless of which side supplied it', () => {
    const app = makeApp();
    const mine = [version('late', 3, { createdAt: 300 })];
    const theirs = [version('early', 1, { createdAt: 100 }), version('mid', 2, { createdAt: 200 })];
    assert.deep(ids(app.mergeVersions(mine, theirs)), ['early', 'mid', 'late']);
  });

  it('never resurrects a snapshot this session deleted', () => {
    const app = makeApp({ pages: { p1: page('p1', { versions: [version('a', 1), version('b', 2)] }) }, pageId: 'p1' });
    app.deleteVersion('b');
    assert.deep(ids(app.state.pages.p1.versions), ['a']);
    /* a delta carrying the pre-delete list must not put it back */
    assert.deep(ids(app.mergeVersions(app.state.pages.p1.versions, [version('a', 1), version('b', 2)])), ['a']);
  });

  it('ensureVersionMeta merges the fetched list instead of choosing one', async () => {
    const app = makeApp({ pages: { p1: page('p1', { versions: [version('local', 9, { createdAt: 900 })] }) }, pageId: 'p1' });
    app.store.vmetaStore.p1 = [version('remote1', 1, { createdAt: 100 }), version('remote2', 2, { createdAt: 200 })];
    await app.ensureVersionMeta('p1');
    await settle();
    assert.deep(ids(app.state.pages.p1.versions), ['remote1', 'remote2', 'local'],
      'a snapshot authored in this session and the stored ones must both survive');
  });

  it('two devices taking a snapshot at once keep both', async () => {
    const app = makeApp({ pages: { p1: page('p1') }, pageId: 'p1' });
    app.store.vmetaStore.p1 = [];
    await app.ensureVersionMeta('p1');
    app.state.pages.p1.blocks = [block('b1', 'my edit')];
    app.createVersion('mine');
    await settle();
    const mine = app.state.pages.p1.versions;
    assert.eq(mine.length, 1);
    /* the other device's snapshot arrives as a delta of the same length */
    const merged = app.mergeVersions(mine, [version('theirs', 1, { createdAt: mine[0].createdAt + 1 })]);
    assert.eq(merged.length, 2, 'equal lengths must not mean "nothing new"');
  });
});
