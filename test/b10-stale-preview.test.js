/* B10 — nothing cleared `roVersion` when the version being previewed stopped
   existing (deleted on another device, or a history that arrived shorter than
   the id in state). activeBlocks() then fell through to the LIVE page while
   the banner still read "Read-only preview of an old version" and isReadOnly()
   still refused every edit: live content, an old label, and no way to type. */
const { makeApp, settle } = require('./harness');
const { page, block, version } = require('./fixtures');

async function previewing() {
  const app = makeApp({ pages: { p1: page('p1', { blocks: [block('b1', 'v1') ] }) }, pageId: 'p1' });
  app.store._vmetaSeen.p1 = true;
  app.createVersion('v1');
  await settle();
  app.state.pages.p1 = Object.assign({}, app.state.pages.p1, { blocks: [block('b1', 'today')] });
  const vid = app.state.pages.p1.versions[0].id;
  app.restore(vid, 'ro');
  await settle();
  assert.eq(app.state.roVersion, vid);
  return { app, vid };
}

describe('B10 — a preview whose version is gone', () => {
  it('is left, not silently mislabelled', async () => {
    const { app } = await previewing();
    /* the other device deleted it; the delta lands as a shorter list */
    app.setState(s => ({ pages: { ...s.pages, p1: { ...s.pages.p1, versions: [] } } }));
    app.checkRoVersion();
    assert.eq(app.state.roVersion, null);
    assert.notOk(app.isReadOnly(), 'and the page becomes editable again');
    assert.includes(app.toasts.join(' | '), 'no longer');
  });

  it('syncVersionMeta notices it on any path a page becomes current', async () => {
    const { app } = await previewing();
    app.setState(s => ({ pages: { ...s.pages, p1: { ...s.pages.p1, versions: [] } } }));
    app.syncVersionMeta();
    await settle();
    assert.eq(app.state.roVersion, null);
  });

  it('a preview of a version that still exists is left alone', async () => {
    const { app, vid } = await previewing();
    app.checkRoVersion();
    assert.eq(app.state.roVersion, vid);
    assert.eq(app.activeBlocks()[0].text, 'v1');
  });

  it('navigating away already clears it', async () => {
    const { app } = await previewing();
    app.state.pages.p2 = page('p2');
    app.openPage('p2');
    await settle();
    assert.eq(app.state.roVersion, null);
  });
});
