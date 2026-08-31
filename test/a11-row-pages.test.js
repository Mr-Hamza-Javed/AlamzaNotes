/* A11 — a database row and the page it opens as are two halves of one thing.
   The snapshot captured the row's CELLS (through the table) but not the row
   PAGE's body, so a restore put the cells back to v3 and left the note behind
   the row at today. */
const { makeApp, settle } = require('./harness');
const { page, block, db, row } = require('./fixtures');

function withRowPage() {
  const app = makeApp({
    pages: {
      p1: page('p1', { blocks: [block('b1', 'root'), block('b2', '', { type: 'database', dbId: 'd1' })] }),
      pr: page('pr', {
        parentId: 'p1', title: 'Row one', blocks: [block('b4', 'note as it was')],
        hidden: true, dbRef: { dbId: 'd1', rowId: 'r1' }
      })
    },
    dbs: { d1: db('d1', [row('r1', 'cell as it was', { pageId: 'pr' })]) },
    pageId: 'p1'
  });
  app.store._vmetaSeen.p1 = true;
  return app;
}

describe('A11 — row pages are part of the snapshot', () => {
  it('the payload carries the row page body', async () => {
    const app = withRowPage();
    app.createVersion('v1');
    await settle();
    const snap = app.vsnap(app.state.pages.p1.versions[0].id);
    assert.ok(snap.p.pr, 'the row page is missing from the snapshot');
    assert.eq(snap.p.pr.b[0].text, 'note as it was');
  });

  it('restore puts the row and its note back together', async () => {
    const app = withRowPage();
    app.createVersion('v1');
    await settle();
    const vid = app.state.pages.p1.versions[0].id;
    app.state.pages.pr = Object.assign({}, app.state.pages.pr, { blocks: [block('b4', 'note today')] });
    app.state.dbs.d1 = Object.assign({}, app.state.dbs.d1, { rows: [row('r1', 'cell today', { pageId: 'pr' })] });
    app.restore(vid, 'replace');
    await settle();
    assert.eq(app.state.dbs.d1.rows[0].cells.pr1, 'cell as it was');
    assert.eq(app.state.pages.pr.blocks[0].text, 'note as it was',
      'the cells went back to the snapshot and the note behind them did not');
  });

  it('subtreeIds still answers the sidebar question without row pages', () => {
    const app = withRowPage();
    assert.deep(app.subtreeIds('p1'), ['p1'], 'a row page is reached through its table, not the tree');
    assert.deep(app.snapshotIds('p1').sort(), ['p1', 'pr']);
  });

  it('a row page whose body is cold is fetched before the capture', async () => {
    const app = withRowPage();
    app.store.bodies.pr = [block('b4', 'note as it was')];
    app.state.pages.pr = Object.assign({}, app.state.pages.pr, { blocks: null, blockCount: 1 });
    app.createVersion('v1');
    await settle(24);
    const snap = app.vsnap(app.state.pages.p1.versions[0].id);
    assert.ok(snap && snap.p.pr, 'the capture must wait for it rather than skip it');
    assert.eq(snap.p.pr.b[0].text, 'note as it was');
  });
});
