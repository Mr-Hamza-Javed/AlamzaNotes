/* the harness itself, and the one invariant lib/parts.js exists to protect */
const { makeApp, newContext, settle } = require('./harness');

const page = (id, over) => Object.assign({
  id, parentId: null, title: 'Page ' + id, icon: '', order: 0,
  favorite: false, trashed: false, createdAt: 1, updatedAt: 1,
  versions: [], blocks: [{ id: 'b_' + id, type: 'p', text: 'hello', indent: 0 }]
}, over || {});

describe('harness', () => {
  it('assembles the app prototype from every part file', () => {
    const app = makeApp();
    ['createVersion', 'restore', 'buildSnapshot', 'vsnap', 'ensureVersion',
     'openPage', 'trashPage', 'undo', 'mutate'].forEach(m =>
      assert.eq(typeof app[m], 'function', m + ' should be on the prototype'));
  });

  it('no two parts claim the same method name', () => {
    const { sandbox } = newContext();
    /* applyTo is what records ownership, so give it a target */
    sandbox.AlamzaParts.applyTo({});
    const owners = sandbox.AlamzaParts.owners();
    assert.ok(Object.keys(owners).length > 100, 'expected the whole prototype');
  });

  it('setState commits synchronously and runs the callback', () => {
    const app = makeApp({ pages: { p1: page('p1') }, pageId: 'p1' });
    let ran = false;
    app.setState({ toast: 'x' }, () => { ran = true; });
    assert.eq(app.state.toast, 'x');
    assert.ok(ran);
    assert.eq(app.page().id, 'p1');
  });

  it('the store stub serves bodies on demand', async () => {
    const app = makeApp({ pages: { p1: page('p1', { blocks: null, blockCount: 1 }) }, pageId: 'p1' });
    app.store.bodies.p1 = [{ id: 'b1', type: 'p', text: 'from the server', indent: 0 }];
    assert.notOk(app.bodyReady('p1'));
    await app.ensureBody('p1');
    await settle();
    assert.eq(app.state.pages.p1.blocks[0].text, 'from the server');
  });
});

module.exports = { page };
