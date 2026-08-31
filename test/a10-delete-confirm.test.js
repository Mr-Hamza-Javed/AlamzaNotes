/* A10 — deleting a snapshot is irreversible and had neither a confirmation
   nor an undo. It now goes through the same confirm modal every other
   irreversible action uses, and takes its payload with it. */
const { makeApp } = require('./harness');
const { page, version } = require('./fixtures');

function app3() {
  const app = makeApp({
    pages: { p1: page('p1', { versions: [version('a', 1), version('b', 2), version('c', 3)] }) },
    pageId: 'p1'
  });
  ['a', 'b', 'c'].forEach(id => { (app.store.vdata.p1 = app.store.vdata.p1 || {})[id] = { b: [], d: {}, p: {} }; });
  app.store._vmetaSeen.p1 = true;
  return app;
}

describe('A10 — deleting a snapshot', () => {
  it('the menu asks first instead of deleting on the click', () => {
    const app = app3();
    app.setState({ menu: { kind: 'version', id: 'b', x: 0, y: 0 } });
    const item = app.extraVals().menuItems.find(i => i.label === 'Delete this snapshot');
    assert.ok(item, 'the item must still exist');
    item.run();
    assert.eq(app.state.pages.p1.versions.length, 3, 'nothing may be deleted before the confirm');
    assert.eq(app.state.modal.kind, 'confirm');
    assert.eq(app.state.modal.act, 'deleteVersion');
    assert.includes(app.state.modal.title, 'v2');
    assert.includes(app.state.modal.body, 'cannot be undone');
  });

  it('confirming removes the row, the payload and nothing else', () => {
    const app = app3();
    app.setState({ modal: { kind: 'confirm', act: 'deleteVersion', vid: 'b' } });
    app.extraVals().runConfirm();
    assert.deep(app.state.pages.p1.versions.map(v => v.id), ['a', 'c']);
    assert.notOk(app.store.vdata.p1.b, 'the payload node must go with the row');
    assert.ok(app.store.vdata.p1.a && app.store.vdata.p1.c, 'the other payloads must survive');
    assert.eq(app.state.modal, null);
  });

  it('cancelling changes nothing', () => {
    const app = app3();
    app.setState({ modal: { kind: 'confirm', act: 'deleteVersion', vid: 'b' } });
    app.extraVals().closeModal();
    assert.eq(app.state.pages.p1.versions.length, 3);
    assert.ok(app.store.vdata.p1.b);
  });

  it('deleting the snapshot being previewed leaves the preview', () => {
    const app = app3();
    app.setState({ roVersion: 'b' });
    app.deleteVersion('b');
    assert.eq(app.state.roVersion, null, 'the banner would otherwise label live content as an old version');
  });
});
