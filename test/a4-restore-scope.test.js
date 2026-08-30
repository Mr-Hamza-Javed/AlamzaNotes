/* A4 — "Replace the current page" rewrites the whole subtree AND every table
   the snapshot captured, including tables used on pages outside it. The dialog
   said only "The working copy is overwritten with this version." */
const { makeApp, settle } = require('./harness');
const { page, block, version, db, row } = require('./fixtures');

/* root p1 -> child p2; p1 embeds table d1, which page p9 (outside) also embeds */
function shared() {
  const app = makeApp({
    pages: {
      p1: page('p1', { blocks: [block('b1', 'root now'), block('b2', '', { type: 'database', dbId: 'd1' })] }),
      p2: page('p2', { parentId: 'p1', blocks: [block('b3', 'child now')] }),
      p9: page('p9', { blocks: [block('b9', '', { type: 'database', dbId: 'd1' })] })
    },
    dbs: { d1: db('d1', [row('r1', 'today')]) },
    pageId: 'p1'
  });
  app.store._vmetaSeen.p1 = true;
  return app;
}

async function withSnapshot() {
  const app = shared();
  app.createVersion('v1');
  await settle();
  /* everything moves on after the snapshot */
  app.state.pages.p1.blocks = [block('b1', 'root today'), block('b2', '', { type: 'database', dbId: 'd1' })];
  app.state.pages.p2.blocks = [block('b3', 'child today')];
  app.state.dbs.d1.rows = [row('r1', 'changed today')];
  return app;
}

describe('A4 — restore tells you what it will touch', () => {
  it('restoreScope names the nested pages and the tables', async () => {
    const app = await withSnapshot();
    const vid = app.state.pages.p1.versions[0].id;
    const sc = app.restoreScope(vid);
    assert.ok(sc, 'restoreScope must answer for a loaded snapshot');
    assert.deep(sc.nested.map(x => x.id), ['p2']);
    assert.deep(sc.dbs.map(x => x.id), ['d1']);
  });

  it('a table used outside the subtree is called out separately', async () => {
    const app = await withSnapshot();
    const vid = app.state.pages.p1.versions[0].id;
    const sc = app.restoreScope(vid);
    assert.deep(sc.sharedDbs.map(x => x.id), ['d1'],
      'd1 is also embedded on p9, so restoring it reaches outside this page');
    assert.includes(sc.sharedDbs[0].where.join(','), 'p9');
  });

  it('the restore dialog states the reach instead of implying one page', async () => {
    const app = await withSnapshot();
    const vid = app.state.pages.p1.versions[0].id;
    app.setState({ modal: { kind: 'restore', vid } });
    const v = app.extraVals();
    const replace = v.restoreOpts.find(o => o.name === 'Replace the current page');
    assert.includes(replace.desc.toLowerCase(), 'sub-page');
    assert.ok(v.restoreWarn, 'a shared table must raise a visible warning');
    assert.includes(v.restoreWarnText, 'p9');
  });

  it('a snapshot that reaches nothing else says nothing extra', async () => {
    const app = makeApp({ pages: { p1: page('p1') }, pageId: 'p1' });
    app.store._vmetaSeen.p1 = true;
    app.createVersion('only me');
    await settle();
    const vid = app.state.pages.p1.versions[0].id;
    app.setState({ modal: { kind: 'restore', vid } });
    const v = app.extraVals();
    assert.notOk(v.restoreWarn);
    assert.eq(v.restoreOpts.find(o => o.name === 'Replace the current page').desc.indexOf('sub-page'), -1);
  });
});
