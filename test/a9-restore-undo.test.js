/* A9 — restore wrote straight to state, so ⌘Z filed the post-restore state as
   a new step and stepped back to the root page's old blocks ONLY. The nested
   pages and the tables stayed restored: a document that never existed. */
const { makeApp, settle } = require('./harness');
const { page, block, db, row } = require('./fixtures');

async function restored() {
  const app = makeApp({
    pages: {
      p1: page('p1', { blocks: [block('b1', 'root v1'), block('b2', '', { type: 'database', dbId: 'd1' })] }),
      p2: page('p2', { parentId: 'p1', blocks: [block('b3', 'child v1')] })
    },
    dbs: { d1: db('d1', [row('r1', 'cell v1')]) },
    pageId: 'p1'
  });
  app.store._vmetaSeen.p1 = true;
  app.createVersion('v1');
  await settle();
  const vid = app.state.pages.p1.versions[0].id;

  app.state.pages.p1 = Object.assign({}, app.state.pages.p1, { blocks: [block('b1', 'root today'), block('b2', '', { type: 'database', dbId: 'd1' })] });
  app.state.pages.p2 = Object.assign({}, app.state.pages.p2, { blocks: [block('b3', 'child today')] });
  app.state.dbs.d1 = Object.assign({}, app.state.dbs.d1, { rows: [row('r1', 'cell today')] });

  app.restore(vid, 'replace');
  await settle();
  return app;
}

describe('A9 — undoing a restore', () => {
  it('the restore itself lands', async () => {
    const app = await restored();
    assert.eq(app.state.pages.p1.blocks[0].text, 'root v1');
    assert.eq(app.state.pages.p2.blocks[0].text, 'child v1');
    assert.eq(app.state.dbs.d1.rows[0].cells.pr1, 'cell v1');
  });

  it('one undo puts the WHOLE subtree back, not just the root', async () => {
    const app = await restored();
    assert.ok(app.canUndo(), 'a restore must be undoable');
    app.undo();
    await settle();
    assert.eq(app.state.pages.p1.blocks[0].text, 'root today');
    assert.eq(app.state.pages.p2.blocks[0].text, 'child today',
      'the nested page was left at the restored state — a mixed document');
    assert.eq(app.state.dbs.d1.rows[0].cells.pr1, 'cell today');
  });

  it('redo re-applies the whole restore', async () => {
    const app = await restored();
    app.undo();
    await settle();
    app.redo();
    await settle();
    assert.eq(app.state.pages.p1.blocks[0].text, 'root v1');
    assert.eq(app.state.pages.p2.blocks[0].text, 'child v1');
  });

  it('an ordinary edit still files a plain single-page step', async () => {
    const app = makeApp({ pages: { p1: page('p1') }, pageId: 'p1' });
    app.mutate(bs => { bs[0].text = 'typed'; });
    await settle();
    const h = app.histFor();
    assert.ok(h.stack.length >= 2, 'mutate files both sides');
    assert.notOk(h.stack[h.stack.length - 1].x, 'a normal edit carries no subtree payload');
  });
});
