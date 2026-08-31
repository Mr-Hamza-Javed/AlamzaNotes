/* A8 — a snapshot captured only {title, icon, parent, order, blocks} for each
   child, so restoring rebuilt a deleted child with no cover, no icon type and
   no favourite — and a rebuilt database ROW page came back without its dbRef,
   i.e. as an orphan nothing could open. */
const { makeApp, settle } = require('./harness');
const { page, block, db, row } = require('./fixtures');

function tree() {
  const app = makeApp({
    pages: {
      p1: page('p1', { blocks: [block('b1', 'root'), block('b2', '', { type: 'database', dbId: 'd1' })] }),
      p2: page('p2', {
        parentId: 'p1', blocks: [block('b3', 'child')],
        cover: 'cover.png', icon: '🌱', iconType: 'emoji', favorite: true
      }),
      pr: page('pr', {
        parentId: 'p1', blocks: [block('b4', 'the row note')],
        hidden: true, dbRef: { dbId: 'd1', rowId: 'r1' }
      })
    },
    dbs: { d1: db('d1', [row('r1', 'Row one', { pageId: 'pr' })]) },
    pageId: 'p1'
  });
  app.store._vmetaSeen.p1 = true;
  return app;
}

describe('A8 — restore keeps what a page is', () => {
  it('a surviving child keeps its cover, icon type and favourite', async () => {
    const app = tree();
    app.createVersion('v1');
    await settle();
    const vid = app.state.pages.p1.versions[0].id;
    app.state.pages.p2 = Object.assign({}, app.state.pages.p2, { blocks: [block('b3', 'moved on')] });
    app.restore(vid, 'replace');
    await settle();
    const p2 = app.state.pages.p2;
    assert.eq(p2.blocks[0].text, 'child');
    assert.eq(p2.cover, 'cover.png');
    assert.eq(p2.iconType, 'emoji');
    assert.eq(p2.favorite, true);
  });

  it('a child deleted since the snapshot comes back whole', async () => {
    const app = tree();
    app.createVersion('v1');
    await settle();
    const vid = app.state.pages.p1.versions[0].id;
    delete app.state.pages.p2;
    app.restore(vid, 'replace');
    await settle();
    const p2 = app.state.pages.p2;
    assert.ok(p2, 'the child must be recreated');
    assert.eq(p2.cover, 'cover.png');
    assert.eq(p2.iconType, 'emoji');
    assert.eq(p2.favorite, true);
    assert.eq(p2.icon, '🌱');
  });

  it('a rebuilt row page comes back wired to its row, not as an orphan', async () => {
    const app = tree();
    app.createVersion('v1');
    await settle();
    const vid = app.state.pages.p1.versions[0].id;
    delete app.state.pages.pr;
    app.restore(vid, 'replace');
    await settle();
    const pr = app.state.pages.pr;
    assert.ok(pr, 'the row page must be recreated');
    assert.eq(pr.hidden, true, 'a row page is not a sidebar page');
    assert.deep(pr.dbRef, { dbId: 'd1', rowId: 'r1' }, 'without dbRef nothing can open it');
  });

  /* The restored parent's blocks link to this child, so it HAS to come back —
     leaving it trashed restores a page pointing at nothing. That is the
     documented behaviour; what was missing is any word of it to the reader. */
  it('a captured child is brought back out of the trash, and said so', async () => {
    const app = tree();
    app.createVersion('v1');
    await settle();
    const vid = app.state.pages.p1.versions[0].id;
    app.state.pages.p2 = Object.assign({}, app.state.pages.p2, { trashed: true, trashedAt: 5, trashRoot: true });
    app.restore(vid, 'replace');
    await settle();
    assert.eq(app.state.pages.p2.trashed, false);
    assert.includes(app.toasts.join(' | '), 'brought back from the trash');
  });

  it('a page created after the snapshot is left completely alone', async () => {
    const app = tree();
    app.createVersion('v1');
    await settle();
    const vid = app.state.pages.p1.versions[0].id;
    app.state.pages.pNew = page('pNew', { parentId: 'p1', blocks: [block('bn', 'written later')] });
    app.restore(vid, 'replace');
    await settle();
    assert.ok(app.state.pages.pNew, 'restore must not be destructive to pages it never captured');
    assert.eq(app.state.pages.pNew.blocks[0].text, 'written later');
  });
});
