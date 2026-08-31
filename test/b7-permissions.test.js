/* B7 — createVersion, restore and delete-snapshot never asked whether this
   reader may write the page. A viewer could overwrite a page they only have
   view access to, and every one of those actions was offered on a page sitting
   in the Trash, directly under a banner saying editing was disabled. */
const { makeApp, settle } = require('./harness');
const { page, block, version } = require('./fixtures');

async function withHistory(over) {
  const app = makeApp({ pages: { p1: page('p1', { blocks: [block('b1', 'v1 text')] }) }, pageId: 'p1' });
  app.store._vmetaSeen.p1 = true;
  app.createVersion('v1');
  await settle();
  app.state.pages.p1 = Object.assign({}, app.state.pages.p1, { blocks: [block('b1', 'today')] });
  if (over) over(app);
  return app;
}
const viewer = (app) => app.setState({
  invites: [{ pageId: 'p1', role: 'viewer', status: 'accepted', to: 'hamzajaved1213@gmail.com' }],
  user: { uid: 'u1', name: 'Tester', email: 'hamzajaved1213@gmail.com' }
});

describe('B7 — who may write history', () => {
  it('a viewer cannot take a snapshot', async () => {
    const app = await withHistory(viewer);
    assert.notOk(app.canWriteHistory(), 'the guard itself must say no');
    const before = app.state.pages.p1.versions.length;
    app.createVersion('sneaky');
    await settle();
    assert.eq(app.state.pages.p1.versions.length, before);
  });

  it('a viewer cannot restore', async () => {
    const app = await withHistory(viewer);
    const vid = app.state.pages.p1.versions[0].id;
    app.restore(vid, 'replace');
    await settle();
    assert.eq(app.state.pages.p1.blocks[0].text, 'today', 'a view-only page was overwritten');
  });

  it('a viewer can still LOOK at a version', async () => {
    const app = await withHistory(viewer);
    const vid = app.state.pages.p1.versions[0].id;
    app.restore(vid, 'ro');
    await settle();
    assert.eq(app.state.roVersion, vid, 'read-only is reading, not writing');
  });

  it('a viewer cannot delete a snapshot', async () => {
    const app = await withHistory(viewer);
    const vid = app.state.pages.p1.versions[0].id;
    app.deleteVersion(vid);
    assert.eq(app.state.pages.p1.versions.length, 1);
    assert.ok(app.store.vdata.p1[vid], 'the payload must survive too');
  });

  it('a trashed page offers none of it', async () => {
    const app = await withHistory(a => {
      a.state.pages.p1 = Object.assign({}, a.state.pages.p1, { trashed: true });
    });
    assert.notOk(app.canWriteHistory());
    const vid = app.state.pages.p1.versions[0].id;
    app.createVersion('x');
    app.restore(vid, 'replace');
    await settle();
    assert.eq(app.state.pages.p1.versions.length, 1);
    assert.eq(app.state.pages.p1.blocks[0].text, 'today');
  });

  it('the UI does not offer what the guard will refuse', async () => {
    const app = await withHistory(viewer);
    app.setState({ panel: 'versions' });
    const v = app.renderVals();
    assert.ok(v.newVersionOff, 'the New version button must be off for a viewer');
    assert.notOk(v.versionList.some(x => x.canRestore), 'and no row may offer Restore');
    app.setState({ menu: { kind: 'version', id: app.state.pages.p1.versions[0].id, x: 0, y: 0 } });
    const labels = app.extraVals().menuItems.filter(i => i.isItem).map(i => i.label);
    assert.notOk(labels.includes('Delete this snapshot'), 'got: ' + labels.join(', '));
    assert.notOk(labels.includes('Restore…'));
    assert.ok(labels.includes('Open read-only'), 'reading stays available');
  });

  it('an owner is unaffected', async () => {
    const app = await withHistory();
    assert.ok(app.canWriteHistory());
    const vid = app.state.pages.p1.versions[0].id;
    app.restore(vid, 'replace');
    await settle();
    assert.eq(app.state.pages.p1.blocks[0].text, 'v1 text');
  });
});
