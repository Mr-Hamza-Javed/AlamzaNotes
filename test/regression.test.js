/* Guards for behaviour the section-A fixes moved but must not have changed. */
const { makeApp, settle } = require('./harness');
const { page, block, version, db, row } = require('./fixtures');

function tree() {
  const app = makeApp({
    pages: {
      p1: page('p1', { blocks: [block('b1', 'root v1'), block('b2', '', { type: 'database', dbId: 'd1' })] }),
      p2: page('p2', { parentId: 'p1', blocks: [block('b3', 'child v1')] })
    },
    dbs: { d1: db('d1', [row('r1', 'cell v1')]) },
    pageId: 'p1'
  });
  app.store._vmetaSeen.p1 = true;
  return app;
}

describe('regression — snapshot payload vs metadata', () => {
  it('the version row carries no payload, so the list stays small', async () => {
    const app = tree();
    app.createVersion('v1');
    await settle();
    const v = app.state.pages.p1.versions[0];
    assert.notOk(v.blocks, 'blocks belong in vdata');
    assert.notOk(v.dbs, 'tables belong in vdata — they used to ride along on every page open');
    assert.ok(v.stat && v.deepStat && v.scope, 'the cheap metadata is still there');
  });

  it('a read-only preview still shows the snapshot’s tables, not the live ones', async () => {
    const app = tree();
    app.createVersion('v1');
    await settle();
    const vid = app.state.pages.p1.versions[0].id;
    app.state.dbs.d1 = Object.assign({}, app.state.dbs.d1, { rows: [row('r1', 'cell today')] });
    app.setState({ roVersion: vid });
    assert.eq(app.dbFor('d1').rows[0].cells.pr1, 'cell v1');
    app.setState({ roVersion: null });
    assert.eq(app.dbFor('d1').rows[0].cells.pr1, 'cell today');
  });

  it('a read-only preview is still not writable', async () => {
    const app = tree();
    app.createVersion('v1');
    await settle();
    const vid = app.state.pages.p1.versions[0].id;
    app.state.pages.p1 = Object.assign({}, app.state.pages.p1, { blocks: [block('b1', 'root today'), block('b2', '', { type: 'database', dbId: 'd1' })] });
    app.setState({ roVersion: vid });
    assert.ok(app.isReadOnly());
    app.mutate(bs => { bs[0].text = 'typed through the preview'; });
    assert.eq(app.state.pages.p1.blocks[0].text, 'root today', 'a preview must never write to the live note');
  });

  it('an identical capture is still refused', async () => {
    const app = tree();
    app.createVersion('v1');
    await settle();
    app.createVersion('again');
    await settle();
    assert.eq(app.state.pages.p1.versions.length, 1);
    assert.includes(app.toasts.join(' | '), 'Nothing has changed since v1');
  });

  it('version numbers stay identities after a delete', async () => {
    const app = tree();
    app.createVersion('one');
    await settle();
    app.state.pages.p1 = Object.assign({}, app.state.pages.p1, { blocks: [block('b1', 'two')] });
    app.createVersion('two');
    await settle();
    app.state.pages.p1 = Object.assign({}, app.state.pages.p1, { blocks: [block('b1', 'three')] });
    app.createVersion('three');
    await settle();
    assert.deep(app.state.pages.p1.versions.map(v => v.n), [1, 2, 3]);
    app.deleteVersion(app.state.pages.p1.versions[1].id);
    app.state.pages.p1 = Object.assign({}, app.state.pages.p1, { blocks: [block('b1', 'four')] });
    app.createVersion('four');
    await settle();
    assert.deep(app.state.pages.p1.versions.map(v => v.n), [1, 3, 4], 'a number is never reused');
  });

  it('the auto message still names nested changes', async () => {
    const app = tree();
    app.createVersion('v1');
    await settle();
    app.state.pages.p2 = Object.assign({}, app.state.pages.p2, { blocks: [block('b3', 'child moved on')] });
    app.createVersion('');
    await settle();
    const v = app.state.pages.p1.versions[1];
    assert.includes(v.message, 'nested page');
    assert.eq(v.deepStat.touched, 1);
  });

  it('the diff still scopes to the subtree and reads both sides', async () => {
    const app = tree();
    app.createVersion('v1');
    await settle();
    const vid = app.state.pages.p1.versions[0].id;
    app.state.pages.p2 = Object.assign({}, app.state.pages.p2, { blocks: [block('b3', 'child today')] });
    app.openDiff(vid, 'current');
    await settle();
    const scope = app.diffScope(vid, 'current');
    const child = scope.find(x => x.id === 'p2');
    assert.ok(child, 'the nested page must be in the rail');
    assert.ok(child.touched, 'and must report that it moved');
    assert.notOk(child.pending);
    assert.deep(app.blocksOf(vid, 'p2').map(b => b.text), ['child v1']);
  });

  it('a snapshot taken on a trashed or view-only page is still offered honestly', async () => {
    const app = tree();
    /* nothing here asserts a permission model — only that the paths do not
       throw when the page is read-only, which the version UI can reach */
    app.state.pages.p1 = Object.assign({}, app.state.pages.p1, { trashed: true });
    assert.ok(app.isReadOnly());
    app.setState({ panel: 'versions' });
    app.renderVals();
  });

  it('trashing and restoring a page still works with row backups', async () => {
    const app = makeApp({
      pages: {
        p1: page('p1', { blocks: [block('b1', 'host'), block('b2', '', { type: 'database', dbId: 'd1' })] }),
        pr: page('pr', { parentId: 'p1', hidden: true, dbRef: { dbId: 'd1', rowId: 'r1' }, blocks: [block('b3', 'row note')] })
      },
      dbs: { d1: db('d1', [row('r1', 'a row', { pageId: 'pr' })]) },
      pageId: 'p1'
    });
    app.trashPage('pr');
    await settle();
    assert.eq(app.state.dbs.d1.rows.length, 0, 'the row leaves the table');
    app.restorePage('pr');
    await settle();
    assert.eq(app.state.dbs.d1.rows.length, 1, 'and comes back');
  });
});
