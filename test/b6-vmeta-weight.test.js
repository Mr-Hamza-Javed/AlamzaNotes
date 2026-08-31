/* B6 — `dbs` rode along in the version METADATA, which is the one node every
   page open downloads. A snapshot of a 400-row table was pulled down with the
   history list, on every device, every time. */
const { loadRealStore, makeApp, settle } = require('./harness');
const { page, block, version, db, row } = require('./fixtures');

describe('B6 — what the version list weighs', () => {
  it('the metadata written to the server carries no payload', async () => {
    const h = loadRealStore();
    const rows = Array.from({ length: 200 }, (_, i) => row('r' + i, 'row ' + i));
    h.inner.setPending({
      prefs: {}, workspace: null, invites: [], dbs: {},
      pages: {
        p1: Object.assign(page('p1'), {
          blockCount: 1,
          versions: [Object.assign(version('v1', 1), {
            blocks: { b: [block('b1', 'x')], d: {}, p: {} },
            dbs: { d1: db('d1', rows) }
          })]
        })
      }
    });
    h.store.push();
    await settle();
    const vm = (h.fb.updates[0] || {})['vmeta/p1'];
    assert.ok(vm, 'the metadata must still be written');
    assert.notOk(vm[0].blocks, 'blocks are payload');
    assert.notOk(vm[0].dbs, 'and so are tables');
    assert.ok(vm[0].stat && vm[0].scope, 'the cheap fields stay');
    const bytes = JSON.stringify(vm).length;
    assert.ok(bytes < 2000, 'the version list is ' + bytes + ' bytes — it is read on every page open');
  });

  it('the local mirror does not carry it either', async () => {
    const h = loadRealStore();
    const st = {
      prefs: {}, workspace: null, invites: [], dbs: {},
      pages: {
        p1: Object.assign(page('p1'), {
          versions: [Object.assign(version('v1', 1), { dbs: { d1: db('d1', [row('r1', 'x')]) } })]
        })
      }
    };
    h.store.mirrorNow(st);
    const mirrored = JSON.parse(h.mem()['alamza.idx.v4']);
    assert.notOk(mirrored.vmeta.p1[0].dbs, 'localStorage has a quota, and this is what spent it');
  });

  it('a preview still reads the snapshot’s tables, from the payload', async () => {
    const app = makeApp({
      pages: { p1: page('p1', { blocks: [block('b1', 'x'), block('b2', '', { type: 'database', dbId: 'd1' })] }) },
      dbs: { d1: db('d1', [row('r1', 'then')]) },
      pageId: 'p1'
    });
    app.store._vmetaSeen.p1 = true;
    app.createVersion('v1');
    await settle();
    const vid = app.state.pages.p1.versions[0].id;
    app.state.dbs.d1 = Object.assign({}, app.state.dbs.d1, { rows: [row('r1', 'now')] });
    app.setState({ roVersion: vid });
    assert.eq(app.dbFor('d1').rows[0].cells.pr1, 'then');
  });
});
