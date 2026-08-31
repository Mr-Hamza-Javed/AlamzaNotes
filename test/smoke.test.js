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

  /* Every part is folded onto the SAME prototype, so two parts defining one
     name means the earlier one silently disappears — which is how a database
     helper once replaced the editor's editText and stopped typing working.
     lib/parts.js warns; this turns the warning into a failure. */
  it('no two parts claim the same method name', () => {
    const clashes = [];
    const { sandbox } = newContext({
      warn: (...a) => { if (String(a[0]).includes('defined twice')) clashes.push(a.join(' ')); }
    });
    sandbox.AlamzaParts.applyTo({});
    assert.eq(clashes.length, 0, clashes.join('\n      '));
    assert.ok(Object.keys(sandbox.AlamzaParts.owners()).length > 100, 'expected the whole prototype');
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
