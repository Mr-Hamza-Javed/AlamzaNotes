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

describe('harness — the stub cannot drift from the real store', () => {
  const fs = require('fs');
  const path = require('path');
  const { makeStore, loadRealStore } = require('./harness');

  it('the store stub answers every field the app reads off AStore', () => {
    /* The gap this closes cost a browser-only crash: the stub had no
       `hasConfig`, so every test took the "nothing is configured" branch of the
       sign-in screen and a ReferenceError in the other branch went unseen
       through 246 green tests.

       So the app is asked what it actually reads, rather than a list being
       kept by hand. */
    const wanted = new Set();
    fs.readdirSync(path.join(__dirname, '..', 'lib'))
      .filter(f => /^part-.*\.js$/.test(f))
      .forEach(f => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'lib', f), 'utf8');
        let m; const re = /\bAStore\.([A-Za-z_$][\w$]*)/g;
        while ((m = re.exec(src))) wanted.add(m[1]);
      });

    const stub = makeStore();
    const missing = [...wanted].filter(k => !(k in stub));
    assert.eq(missing.length, 0,
      'the app reads these off AStore and the stub does not have them: ' + missing.join(', '));
  });

  it('and every field it claims is one the real store really has', () => {
    /* the other direction: a stub field the real store dropped is a test
       passing against an API that no longer exists */
    const { store } = loadRealStore();
    const stub = makeStore();
    const invented = ['calls', 'log', 'vdata', 'vmetaStore', 'bodies', 'rows', 'inboxes',
                      'sharedDocs', 'published', '_vmetaSeen', 'markVersionMeta'];
    const strays = Object.keys(stub)
      .filter(k => invented.indexOf(k) < 0 && !(k in store));
    assert.eq(strays.length, 0,
      'the stub has fields the real store does not: ' + strays.join(', '));
  });
});
