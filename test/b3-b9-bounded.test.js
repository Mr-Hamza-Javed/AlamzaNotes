/* B3, B8, B9 — guards for behaviour the section-A work already established, so
   the loops and the silent failures cannot come back:
   B3 no version path may re-enter itself without a bound;
   B8 a restore holds a lock, so a double click cannot run it twice;
   B9 a cold restore that cannot be loaded says so instead of doing nothing. */
const { makeApp, settle } = require('./harness');
const { page, block, version, db, row } = require('./fixtures');

function withV() {
  const app = makeApp({
    pages: { p1: page('p1', { blocks: [block('b1', 'one')] }) },
    pageId: 'p1'
  });
  app.store._vmetaSeen.p1 = true;
  return app;
}

describe('B3 — nothing re-enters itself without a bound', () => {
  it('a body the server does not hold stops the capture', async () => {
    const app = withV();
    app.state.pages.p2 = page('p2', { parentId: 'p1', blocks: null, blockCount: 4 });
    app.createVersion('x');
    await settle(30);
    const reads = app.store.calls.filter(c => c.name === 'loadBody').length;
    assert.ok(reads <= 4, 'loadBody was called ' + reads + ' times — every one is billed');
    assert.eq(app.state.pages.p1.versions.length, 0);
    assert.includes(app.toasts.join(' | '), 'Could not load');
    assert.notOk(app._verLock, 'and the button must not be left dead');
  });

  it('a table whose rows never arrive stops the capture', async () => {
    const app = withV();
    app.state.dbs = { d1: Object.assign(db('d1'), { rows: null, rowCount: 5 }) };
    app.state.pages.p1 = Object.assign({}, app.state.pages.p1, {
      blocks: [block('b1', 'one'), block('b2', '', { type: 'database', dbId: 'd1' })]
    });
    app.createVersion('x');
    await settle(30);
    const reads = app.store.calls.filter(c => c.name === 'loadRows').length;
    assert.ok(reads <= 4, 'loadRows was called ' + reads + ' times');
    assert.eq(app.state.pages.p1.versions.length, 0);
    assert.notOk(app._verLock);
  });

  it('a baseline payload that does not exist stops the capture', async () => {
    const app = withV();
    app.createVersion('one');
    await settle();
    const v1 = app.state.pages.p1.versions[0];
    delete app._vb[v1.id];
    delete app.store.vdata.p1[v1.id];
    app.state.pages.p1 = Object.assign({}, app.state.pages.p1, { blocks: [block('b1', 'two')] });
    app.createVersion('two');
    await settle(30);
    const reads = app.store.calls.filter(c => c.name === 'getVersionBlocks').length;
    assert.ok(reads <= 3, 'getVersionBlocks was called ' + reads + ' times');
    assert.eq(app.state.pages.p1.versions.length, 1, 'no snapshot may be authored against no baseline');
    assert.notOk(app._verLock);
  });
});

describe('B8 — a restore runs once', () => {
  it('a double click does not produce two safety snapshots', async () => {
    const app = withV();
    app.createVersion('one');
    await settle();
    const vid = app.state.pages.p1.versions[0].id;
    app.state.pages.p1 = Object.assign({}, app.state.pages.p1, { blocks: [block('b1', 'two')] });
    app.restore(vid, 'new');
    app.restore(vid, 'new');
    app.restore(vid, 'new');
    await settle(30);
    const safety = app.state.pages.p1.versions.filter(v => /before restoring/i.test(v.message));
    assert.eq(safety.length, 1, 'got ' + safety.length + ' safety snapshots');
  });

  it('the lock is released so the next restore works', async () => {
    const app = withV();
    app.createVersion('one');
    await settle();
    const vid = app.state.pages.p1.versions[0].id;
    app.state.pages.p1 = Object.assign({}, app.state.pages.p1, { blocks: [block('b1', 'two')] });
    app.restore(vid, 'replace');
    await settle(20);
    assert.notOk(app._verLock);
    assert.eq(app.state.pages.p1.blocks[0].text, 'one');
  });
});

describe('B9 — a restore that cannot load says so', () => {
  it('a write mode reports it instead of doing nothing', async () => {
    const app = withV();
    app.createVersion('one');
    await settle();
    const vid = app.state.pages.p1.versions[0].id;
    delete app._vb[vid];
    delete app.store.vdata.p1[vid];
    app.restore(vid, 'replace');
    await settle(20);
    assert.includes(app.toasts.join(' | '), 'Could not load that snapshot');
    assert.notOk(app.state.restoring, 'the busy state must clear');
  });

  it('a read-only preview does not strand the reader on a skeleton', async () => {
    const app = withV();
    app.createVersion('one');
    await settle();
    const vid = app.state.pages.p1.versions[0].id;
    delete app._vb[vid];
    delete app.store.vdata.p1[vid];
    app.restore(vid, 'ro');
    await settle(20);
    assert.eq(app.state.roVersion, null, 'a preview that can never render must not stay open');
    assert.includes(app.toasts.join(' | '), 'Could not load that snapshot');
  });
});
