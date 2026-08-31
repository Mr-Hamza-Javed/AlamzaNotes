/* A5 — "Restore as a new version" promises to snapshot what you have first.
   It did not wait for the subtree to load, so pages whose body was not in hand
   were left out of the safety snapshot and counted as DELETED in its stat —
   a number that can never be recomputed. */
const { makeApp, settle } = require('./harness');
const { page, block, version } = require('./fixtures');

function coldChild() {
  const app = makeApp({
    pages: {
      p1: page('p1', { blocks: [block('b1', 'root')] }),
      /* the child is real and has content, but its body has not been fetched */
      p2: page('p2', { parentId: 'p1', blocks: null, blockCount: 2 })
    },
    pageId: 'p1'
  });
  app.store._vmetaSeen.p1 = true;
  app.store.bodies.p2 = [block('b2', 'child line one'), block('b3', 'child line two')];
  return app;
}

describe('A5 — the safety snapshot', () => {
  it('waits for the subtree before capturing it', async () => {
    const app = coldChild();
    /* an existing snapshot, so restore has something to restore */
    await settle();
    app.createVersion('v1');
    await settle();
    const v1 = app.state.pages.p1.versions[0];

    app.state.pages.p1.blocks = [block('b1', 'root moved on')];
    app.state.pages.p2 = Object.assign({}, app.state.pages.p2, { blocks: null });

    app.restore(v1.id, 'new');
    await settle(24);

    const safety = app.state.pages.p1.versions.find(x => /before restoring/i.test(x.message));
    assert.ok(safety, 'a safety snapshot must exist');
    const snap = app.vsnap(safety.id);
    assert.ok(snap.p.p2, 'the nested page must be IN the safety snapshot');
    assert.eq(snap.p.p2.b.length, 2, 'and must carry its real body, not nothing');
  });

  it('does not record an unloaded page as a deletion', async () => {
    const app = coldChild();
    await settle();
    app.createVersion('v1');
    await settle();
    const v1 = app.state.pages.p1.versions[0];
    app.state.pages.p2 = Object.assign({}, app.state.pages.p2, { blocks: null });
    app.restore(v1.id, 'new');
    await settle(24);
    const safety = app.state.pages.p1.versions.find(x => /before restoring/i.test(x.message));
    assert.eq(safety.deepStat.gone, 0, 'a page that is merely unfetched has not been removed');
  });

  it('buildSnapshot never counts an unfetched page as gone', async () => {
    const app = coldChild();
    await settle();
    app.createVersion('v1');
    await settle();
    const prev = app.vsnap(app.state.pages.p1.versions[0].id);
    app.state.pages.p2 = Object.assign({}, app.state.pages.p2, { blocks: null });
    const built = app.buildSnapshot('p1', prev);
    assert.eq(built.deep.gone, 0);
    assert.ok(built.partial, 'and it must say the capture was incomplete');
  });

  it('a page really removed from the subtree still counts as gone', async () => {
    const app = coldChild();
    await settle();
    app.createVersion('v1');
    await settle();
    const prev = app.vsnap(app.state.pages.p1.versions[0].id);
    delete app.state.pages.p2;
    const built = app.buildSnapshot('p1', prev);
    assert.eq(built.deep.gone, 1);
    assert.notOk(built.partial);
  });
});
