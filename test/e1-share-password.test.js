/* A password does not hide a published page — it ENCRYPTS the copy on the
   server, and that happens when the copy is written. The re-send used to wait
   for the input to lose focus, so typing a password and closing the dialog
   with Escape left the page publicly readable under a switch that said
   "protected". */
const { makeApp, settle } = require('./harness');
const { page, block } = require('./fixtures');

async function published() {
  const app = makeApp({
    pages: { p1: page('p1', { title: 'Plans', blocks: [block('b1', 'secret plans')] }) },
    pageId: 'p1', user: { uid: 'u1', name: 'Hamza', email: 'hamza@example.com' }
  });
  app.setPublished('p1', true);
  await settle(20);
  return app;
}
const stored = (app) => app.store.published[app.state.pages.p1.share.slug];
const sealed = (app) => !!(stored(app) && stored(app).enc);

describe('E1 — the share password', () => {
  it('publishing without one stores a readable copy', async () => {
    const app = await published();
    assert.ok(stored(app), 'nothing was published');
    assert.notOk(sealed(app));
    assert.ok(app.publishInSync(app.state.pages.p1), 'the stored copy matches what the page asks for');
  });

  it('typing one seals the stored copy, without waiting for a click elsewhere', async () => {
    const app = await published();
    app.setState({ modal: { kind: 'share' } });
    app.extraVals().setPw({ target: { value: 'hunter2' } });
    await settle(4);
    assert.notOk(sealed(app), 'it should not re-send on every keystroke');
    app.flushPublish();                 // what the fuse does a moment later
    await settle(20);
    assert.ok(sealed(app), 'the copy on the web is still readable');
    assert.ok(app.publishInSync(app.state.pages.p1));
  });

  it('closing the dialog with Escape does not strand it', async () => {
    const app = await published();
    app.setState({ modal: { kind: 'share' } });
    app.extraVals().setPw({ target: { value: 'hunter2' } });
    await settle(2);
    app.escapeKey();                    // no blur — this is the case that leaked
    await settle(20);
    assert.ok(sealed(app), 'the dialog closed over a page anyone could still read');
  });

  it('closing it with the ✕ does not strand it either', async () => {
    const app = await published();
    app.setState({ modal: { kind: 'share' } });
    app.extraVals().setPw({ target: { value: 'hunter2' } });
    await settle(2);
    app.extraVals().closeModal();
    await settle(20);
    assert.ok(sealed(app));
  });

  it('until it has been sent, the dialog says so', async () => {
    const app = await published();
    app.setState({ modal: { kind: 'share' } });
    app.extraVals().setPw({ target: { value: 'hunter2' } });
    await settle(2);
    let v = app.extraVals();
    assert.notOk(v.pwSynced, 'the stored copy does not match the box yet');
    assert.includes(v.pwStatus, 'Not applied yet');
    assert.includes(v.pwStatus.toLowerCase(), 'readable');
    assert.eq(v.pwStatusColor, 'var(--del-fg)', 'and it must not be a quiet grey note');
    app.flushPublish();
    await settle(20);
    v = app.extraVals();
    assert.ok(v.pwSynced);
    assert.includes(v.pwStatus, 'encrypted with this password');
  });

  it('changing the password re-seals with the new one', async () => {
    const app = await published();
    app.setState({ modal: { kind: 'share' } });
    app.extraVals().setPw({ target: { value: 'first' } });
    app.flushPublish(); await settle(20);
    assert.includes(JSON.stringify(stored(app)), 'first');
    app.extraVals().setPw({ target: { value: 'second' } });
    assert.notOk(app.publishInSync(app.state.pages.p1), 'the old password is still the one stored');
    app.flushPublish(); await settle(20);
    assert.includes(JSON.stringify(stored(app)), 'second');
    assert.notOk(/"first"|sealed:first/.test(JSON.stringify(stored(app))));
  });

  it('clearing the password sends a readable copy back', async () => {
    const app = await published();
    app.setState({ modal: { kind: 'share' } });
    app.extraVals().setPw({ target: { value: 'hunter2' } });
    app.flushPublish(); await settle(20);
    assert.ok(sealed(app));
    app.extraVals().setPw({ target: { value: '' } });
    app.flushPublish(); await settle(20);
    assert.notOk(sealed(app), 'the page still claims to be protected');
    assert.ok(app.publishInSync(app.state.pages.p1));
  });

  it('the switch seals immediately', async () => {
    const app = await published();
    app.setState({ modal: { kind: 'share' } });
    app.extraVals().togglePw();
    await settle(20);
    assert.ok(sealed(app));
    assert.ok(app.publishInSync(app.state.pages.p1));
  });

  it('an unpublished page has nothing to be out of step with', async () => {
    const app = makeApp({ pages: { p1: page('p1') }, pageId: 'p1' });
    app.patchPage('p1', { share: { published: false, slug: 'p1', password: 'x', invites: [] } }, true);
    assert.ok(app.publishInSync(app.state.pages.p1), 'nothing is stored, so nothing can disagree');
    assert.notOk(app.extraVals().showPwStatus);
  });
});
