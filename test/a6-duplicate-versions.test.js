/* A6/A7 — duplicating a page copied its version list with fresh ids but left
   the PAYLOADS pointing at the original: `snap.p` keyed by the original child
   page ids and `snap.d` by the original table ids. Restoring one of those on
   the COPY therefore wrote over the original's children and tables. And a
   snapshot whose payload was not in hand was copied as a row with no payload
   at all. */
const { makeApp, settle } = require('./harness');
const { page, block, version, db, row } = require('./fixtures');

/* p1 -> child p2, p1 embeds table d1 whose row opens as page pr */
function tree() {
  const app = makeApp({
    pages: {
      p1: page('p1', { blocks: [block('b1', 'root'), block('b2', '', { type: 'subpage', pageId: 'p2' }), block('b3', '', { type: 'database', dbId: 'd1' })] }),
      p2: page('p2', { parentId: 'p1', blocks: [block('b4', 'child original')] }),
      pr: page('pr', { parentId: 'p1', hidden: true, dbRef: { dbId: 'd1', rowId: 'r1' }, blocks: [block('b5', 'row note original')] })
    },
    dbs: { d1: db('d1', [row('r1', 'cell original', { pageId: 'pr' })]) },
    pageId: 'p1'
  });
  app.store._vmetaSeen.p1 = true;
  return app;
}

async function duplicated() {
  const app = tree();
  app.createVersion('v1');
  await settle();
  const copyId = app.deepDuplicatePage('p1');
  await settle(20);
  return { app, copyId: copyId || Object.keys(app.state.pages).find(k => /copy$/.test(app.state.pages[k].title || '')) };
}

describe('A6/A7 — duplicating a page with history', () => {
  it('the copy gets its own payload, keyed by ITS pages and tables', async () => {
    const { app, copyId } = await duplicated();
    const copy = app.state.pages[copyId];
    assert.eq(copy.versions.length, 1, 'the history comes along');
    const snap = app.store.vdata[copyId][copy.versions[0].id];
    assert.ok(snap, 'the payload must be written under the copy');
    Object.keys(snap.p).forEach(pid => {
      assert.notOk(pid === 'p2' || pid === 'pr',
        'payload still names the ORIGINAL page ' + pid + ' — restoring would overwrite it');
    });
    Object.keys(snap.d || {}).forEach(dbId => {
      assert.notOk(dbId === 'd1', 'payload still names the original table');
    });
  });

  it('restoring on the copy leaves the original untouched', async () => {
    const { app, copyId } = await duplicated();
    /* both trees move on */
    ['p2', 'pr'].forEach(id => { app.state.pages[id] = Object.assign({}, app.state.pages[id], { blocks: [block('x', 'original today')] }); });
    app.state.dbs.d1 = Object.assign({}, app.state.dbs.d1, { rows: [row('r1', 'original cell today', { pageId: 'pr' })] });

    app.setState({ pageId: copyId });
    app.restore(app.state.pages[copyId].versions[0].id, 'replace');
    await settle(20);

    assert.eq(app.state.pages.p2.blocks[0].text, 'original today',
      "the copy's restore reached into the original's child page");
    assert.eq(app.state.pages.pr.blocks[0].text, 'original today');
    assert.eq(app.state.dbs.d1.rows[0].cells.pr1, 'original cell today',
      "the copy's restore reverted the original's table");
  });

  it('the copy really restores its own subtree', async () => {
    const { app, copyId } = await duplicated();
    const copy = app.state.pages[copyId];
    const childIds = Object.keys(app.state.pages).filter(k => app.state.pages[k].parentId === copyId);
    assert.ok(childIds.length >= 2, 'the copy has its own children');
    childIds.forEach(k => { app.state.pages[k] = Object.assign({}, app.state.pages[k], { blocks: [block('y', 'copy today')] }); });
    app.setState({ pageId: copyId });
    app.restore(copy.versions[0].id, 'replace');
    await settle(20);
    childIds.forEach(k => {
      assert.notOk(app.state.pages[k].blocks[0].text === 'copy today',
        'the copy of ' + k + ' should have gone back to the snapshot');
    });
  });

  it('a snapshot whose payload is cold is fetched, not copied empty', async () => {
    const app = tree();
    app.createVersion('v1');
    await settle();
    const vid = app.state.pages.p1.versions[0].id;
    /* force it cold: the payload is only on the "server" now */
    delete app._vb[vid];
    delete app.state.pages.p1.versions[0].blocks;

    const copyId = app.deepDuplicatePage('p1');
    await settle(24);
    const realCopy = copyId || Object.keys(app.state.pages).find(k => /copy$/.test(app.state.pages[k].title || ''));
    const nv = app.state.pages[realCopy].versions[0];
    const snap = app.store.vdata[realCopy] && app.store.vdata[realCopy][nv.id];
    assert.ok(snap, 'a cold snapshot must be fetched before the copy is made, not dropped');
    assert.ok((snap.b || []).length, 'and it must carry real content');
  });

  it('a payload the server does not hold is dropped, not looped over', async () => {
    const app = tree();
    app.createVersion('v1');
    await settle();
    const vid = app.state.pages.p1.versions[0].id;
    /* cold AND unreachable — the shape that used to sit in a fetch loop */
    delete app._vb[vid];
    delete app.store.vdata.p1[vid];

    app.deepDuplicatePage('p1');
    await settle(30);
    const reads = app.store.calls.filter(c => c.name === 'getVersionBlocks').length;
    assert.ok(reads <= 3, 'expected at most one retry, got ' + reads + ' reads');
    const copyId = Object.keys(app.state.pages).find(k => /copy$/.test(app.state.pages[k].title || ''));
    assert.ok(copyId, 'the duplicate must still be made');
    assert.deep(app.state.pages[copyId].versions, [],
      'a snapshot with no payload is a row that opens on nothing');
    assert.includes(app.toasts.join(' | '), 'could not be copied');
  });

  it('an unreachable page body stops the duplicate rather than looping', async () => {
    const app = tree();
    app.state.pages.p2 = Object.assign({}, app.state.pages.p2, { blocks: null, blockCount: 3 });
    /* nothing on the server for p2 */
    app.deepDuplicatePage('p1');
    await settle(30);
    const reads = app.store.calls.filter(c => c.name === 'loadBody').length;
    assert.ok(reads <= 3, 'expected at most one retry, got ' + reads + ' reads');
    assert.includes(app.toasts.join(' | '), 'nothing was duplicated');
  });
});
