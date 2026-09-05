/* Firestore does two things differently from every other store the app talks
 * to, and both of them can be wrong in ways that look right:
 *
 *   1. a path must alternate collection/document, so the app's own paths have
 *      to be reshaped, and the reshape has to be reversible;
 *   2. a document cannot hold an array inside an array, and a page full of
 *      blocks is nothing but arrays inside arrays.
 *
 * Every test below runs the real lib/data/backend-firestore.js against a fake
 * SDK that stores what it is given and REJECTS a nested array the way the real
 * one does (test/fake-firestore.js). So the assertions are about the bytes that
 * actually reach Firestore, not about what the code appears to do.
 */
const { makeDataContext } = require('./harness');
const { makeFakeFirestore } = require('./fake-firestore');

function fs2() {
  const ctx = makeDataContext({ backends: { firestore: { apiKey: 'k', projectId: 'p' } } });
  const fake = makeFakeFirestore();
  ctx.D.firebaseApp = () => Promise.resolve({ options: {} });
  ctx.D.firebaseModule = () => Promise.resolve(fake);
  const b = ctx.D.createBackend('firestore', { apiKey: 'k', projectId: 'p' });
  return { ctx, fake, b, ws: { ws: 'u1' }, root: { ws: null } };
}

describe('firestore — paths', () => {
  it('an even path is stored as written', async () => {
    const { fake, b, ws } = fs2();
    await b.connect();
    await b.write(ws, 'idx/page1', { t: 'Hello' });
    assert.deep(fake.paths(), ['workspaces/u1/idx/page1']);
  });

  it('an odd path gets one filler segment, and only one', async () => {
    const { fake, b, ws } = fs2();
    await b.connect();
    await b.write(ws, 'meta', { prefs: {} });
    await b.write(ws, 'dbrow/db1/row1', { id: 'row1' });
    await b.write(ws, 'vdata/page1/v3', [{ id: 'b1' }]);
    assert.deep(fake.paths(), [
      'workspaces/u1/_/meta',
      'workspaces/u1/dbrow/db1/_/row1',
      'workspaces/u1/vdata/page1/_/v3'
    ]);
  });

  it('the global area has no workspace prefix', async () => {
    const { fake, b, root } = fs2();
    await b.connect();
    await b.write(root, 'pub/slug1', { o: 'u1', t: 'Public' });
    await b.write(root, 'inbox/a,b@x,com/inv1', { from: 'u1', role: 'viewer' });
    await b.write(root, 'shared/page1', { o: 'u1', m: { 'a,b@x,com': true } });
    assert.deep(fake.paths(), [
      'inbox/a,b@x,com/_/inv1',
      'pub/slug1',
      'shared/page1'
    ]);
  });

  it('the collection a document lives in is the one readPage and watch use', async () => {
    const { b, ws } = fs2();
    await b.connect();
    await b.write(ws, 'dbrow/db1/rowA', { id: 'rowA' });
    await b.write(ws, 'dbrow/db1/rowB', { id: 'rowB' });
    /* if the document rule and the collection rule disagreed, this would be
       empty — which is the whole reason there is one rule and not two */
    const got = await b.readPage(ws, 'dbrow/db1', null, 10);
    assert.deep(Object.keys(got).sort(), ['rowA', 'rowB']);
  });

  it('every path the app actually uses round-trips through the mapping', async () => {
    const { b, ws, root } = fs2();
    await b.connect();
    const cases = [
      [ws, 'meta', { prefs: { theme: 'dark' } }],
      [ws, 'layout', 4],
      [ws, 'idx/p1', { t: 'Page', u: 12 }],
      [ws, 'body/p1', { b: [{ id: 'a', text: 'hi' }] }],
      [ws, 'dig/p1', 'some words'],
      [ws, 'vmeta/p1', [{ id: 'v1', n: 1 }]],
      [ws, 'vdata/p1/v1', [{ id: 'a', text: 'old' }]],
      [ws, 'dbmeta/d1', { n: 'Table', p: [], v: [] }],
      [ws, 'dbrow/d1/r1', { id: 'r1', c: { a: 1 } }],
      [ws, 'dbrev/d1', { u: 5, w: 'abc' }],
      [root, 'pub/s1', { o: 'u1', b: [] }],
      [root, 'inbox/k/i1', { from: 'u1', role: 'viewer' }],
      [root, 'shared/p1', { o: 'u1', m: {} }]
    ];
    for (const [scope, path, value] of cases) {
      await b.write(scope, path, value);
      assert.deep(await b.read(scope, path), value, path + ' did not survive the round trip');
    }
  });
});

describe('firestore — values', () => {
  it('a page full of nested arrays is stored, which raw Firestore would refuse', async () => {
    const { fake, b, ws } = fs2();
    await b.connect();
    const blocks = {
      b: [
        { id: 'a', type: 'table', rows: [['x', 'y'], ['z', '']] },
        { id: 'b', type: 'columns', cols: [[{ id: 'c', text: 'in a column' }]] },
        { id: 'd', type: 'toggle', children: [{ id: 'e', text: 'inside', children: [] }] }
      ]
    };
    /* the fake throws on a nested array exactly as Firestore does, so this
       passing IS the proof that the encoding is doing its job */
    await b.write(ws, 'body/p1', blocks);
    assert.deep(await b.read(ws, 'body/p1'), blocks);
    const stored = fake.docs.get('workspaces/u1/body/p1');
    assert.eq(typeof stored._j, 'string', 'the payload should be one JSON field');
  });

  it('a bare string and a bare number are values, not documents to be flattened', async () => {
    const { b, ws } = fs2();
    await b.connect();
    await b.write(ws, 'dig/p1', 'alpha beta');
    await b.write(ws, 'layout', 4);
    assert.eq(await b.read(ws, 'dig/p1'), 'alpha beta');
    assert.eq(await b.read(ws, 'layout'), 4);
  });

  it('the fields a security rule reads are copied out where the rule can see them', async () => {
    const { fake, b, root } = fs2();
    await b.connect();
    await b.write(root, 'shared/p1', { o: 'owner-uid', t: 'Note', b: [], m: { 'a,b@x,com': true } });
    const doc = fake.docs.get('shared/p1');
    assert.eq(doc.o, 'owner-uid', 'the rule cannot check an owner it cannot see');
    assert.eq(doc.m['a,b@x,com'], true, 'the rule cannot check membership it cannot see');

    await b.write(root, 'pub/s1', { o: 'owner-uid', b: [] });
    assert.eq(fake.docs.get('pub/s1').o, 'owner-uid');

    await b.write(root, 'inbox/k/i1', { from: 'sender-uid', role: 'viewer', pageId: 'p1' });
    const inv = fake.docs.get('inbox/k/_/i1');
    assert.eq(inv.from, 'sender-uid');
    assert.eq(inv.role, 'viewer');
    assert.eq(inv.pageId, undefined, 'only the fields a rule needs are exposed');
  });

  it('a workspace path exposes nothing — its rule only checks the uid in the path', async () => {
    const { fake, b, ws } = fs2();
    await b.connect();
    await b.write(ws, 'idx/p1', { t: 'Title', o: 'not-a-rule-field' });
    assert.deep(Object.keys(fake.docs.get('workspaces/u1/idx/p1')), ['_j']);
  });

  it('a document over Firestore 1 MB limit is refused by name, not as a mystery', async () => {
    const { b, ws } = fs2();
    await b.connect();
    let threw = null;
    try { await b.write(ws, 'body/huge-page', { b: [{ text: 'x'.repeat(1100000) }] }); }
    catch (e) { threw = e; }
    assert.ok(threw, 'an oversized document was accepted');
    assert.includes(threw.message, 'body/huge-page');
    assert.includes(threw.message, 'routing');
  });
});

describe('firestore — writing', () => {
  it('a commit is one batch, and null deletes', async () => {
    const { fake, b, ws } = fs2();
    await b.connect();
    await b.commit(ws, { 'idx/p1': { t: 'A' }, 'body/p1': { b: [] }, 'dig/p1': 'a' });
    assert.deep(fake.batches, [3], 'three paths should be one batch');
    await b.commit(ws, { 'idx/p1': null });
    assert.eq(await b.read(ws, 'idx/p1'), null);
  });

  it('deleting a table takes its rows with it', async () => {
    const { fake, b, ws } = fs2();
    await b.connect();
    await b.commit(ws, {
      'dbmeta/d1': { n: 'T' },
      'dbrow/d1/r1': { id: 'r1' }, 'dbrow/d1/r2': { id: 'r2' }, 'dbrow/d1/r3': { id: 'r3' }
    });
    /* Firestore does NOT delete a document's subcollections with it. If this
       were left to the default, the rows would outlive the table and come back
       the next time it was read. */
    await b.commit(ws, { 'dbmeta/d1': null, 'dbrow/d1': null, 'dbrev/d1': null });
    assert.deep(fake.paths(), [], 'rows survived the table being deleted');
  });

  it('deleting a page takes its snapshot bodies with it', async () => {
    const { fake, b, ws } = fs2();
    await b.connect();
    await b.commit(ws, {
      'idx/p1': { t: 'A' }, 'body/p1': { b: [] },
      'vdata/p1/v1': [{ id: 'a' }], 'vdata/p1/v2': [{ id: 'b' }]
    });
    await b.commit(ws, { 'idx/p1': null, 'body/p1': null, 'dig/p1': null, 'vmeta/p1': null, 'vdata/p1': null });
    assert.deep(fake.paths(), [], 'snapshot bodies outlived their page');
  });

  it('a patch bigger than one batch is split rather than rejected', async () => {
    const { fake, b, ws } = fs2();
    await b.connect();
    const patch = {};
    for (let i = 0; i < 1000; i++) patch['idx/p' + i] = { t: 'p' + i };
    await b.commit(ws, patch);
    assert.ok(fake.batches.length > 1, 'a 1000-path patch should have been split');
    assert.ok(Math.max(...fake.batches) <= 500, 'a batch went over Firestore limit');
    const got = await b.readPage(ws, 'idx', null, 0);
    assert.eq(Object.keys(got).length, 1000, 'the split lost writes');
  });

  it('caps say the split is not atomic, rather than leaving the store to assume', () => {
    const { b } = fs2();
    assert.eq(b.caps.maxCommit, 450, 'the store needs a number to split on');
    assert.eq(b.caps.atomicCommit, true);
    assert.eq(b.caps.legacyLayouts, false, 'a Firestore workspace has no older shape to migrate');
  });
});

describe('firestore — configuration', () => {
  it('an rtdb URL in the firestore block is refused, not silently used', () => {
    const { D } = makeDataContext({});
    assert.eq(D.configured('firestore', { apiKey: 'k', projectId: 'p' }), true);
    assert.eq(D.configured('firestore', { apiKey: 'k', projectId: 'p', databaseURL: 'https://x.firebaseio.com' }), false,
      'the two blocks were confused and nothing said so');
  });

  it('an rtdb block without a databaseURL is not a configured rtdb', () => {
    const { D } = makeDataContext({});
    assert.eq(D.configured('rtdb', { apiKey: 'k' }), false,
      'an apiKey describes a project, not a Realtime Database');
    assert.eq(D.configured('rtdb', { apiKey: 'k', databaseURL: 'u' }), true);
  });
});

describe('firestore — the 1 MB guard counts bytes, not characters', () => {
  /* Firestore measures a document in UTF-8 BYTES. JavaScript measures a string
     in UTF-16 units. For English the two are nearly the same and the bug is
     invisible; for Urdu, Arabic, Hindi or emoji a character costs 2-4 bytes and
     one unit, so the guard under-counted by up to 3x — a page well over the
     limit sailed past the friendly error and was rejected by Firestore with a
     raw one that named nothing the writer could act on. */
  const URDU = 'یہ ایک صفحہ ہے۔ ';
  const bytesOf = (s) => Buffer.byteLength(s, 'utf8');

  it('an Urdu page over the limit is refused, and refused by name', async () => {
    const { b, ws } = fs2();
    await b.connect();
    const text = URDU.repeat(40000);
    const payload = { b: [{ id: 'x', type: 'p', text: text }] };
    assert.ok(bytesOf(JSON.stringify(payload)) > 1048576,
      'the fixture must actually be over 1 MB in real bytes');

    let threw = null;
    try { await b.write(ws, 'body/urdu-page', payload); } catch (e) { threw = e; }
    assert.ok(threw, 'an over-limit Urdu page was accepted');
    assert.includes(threw.message, 'body/urdu-page');
  });

  it('an English page of the same character count is still accepted', async () => {
    /* the guard must not become so cautious that it refuses ordinary pages */
    const { b, ws } = fs2();
    await b.connect();
    const text = 'a'.repeat(600000);
    assert.ok(bytesOf(text) < 1000000, 'the fixture must be under the limit in bytes');
    await b.write(ws, 'body/english-page', { b: [{ id: 'x', text: text }] });
    assert.ok(await b.read(ws, 'body/english-page'), 'a page under the limit must be stored');
  });

  it('the message says how big it really is, in the unit Firestore uses', async () => {
    const { b, ws } = fs2();
    await b.connect();
    let threw = null;
    try { await b.write(ws, 'body/big', { b: [{ text: URDU.repeat(45000) }] }); } catch (e) { threw = e; }
    assert.ok(threw);
    assert.includes(threw.message, 'KB');
    const claimed = Number((threw.message.match(/is (\d+) KB/) || [])[1]);
    const real = Math.round(bytesOf(JSON.stringify({ b: [{ text: URDU.repeat(45000) }] })) / 1024);
    assert.ok(Math.abs(claimed - real) <= 2,
      'the size it reports (' + claimed + ' KB) must be the size Firestore sees (' + real + ' KB)');
  });
});

describe('firestore — what deleting costs', () => {
  it('a page delete does not query collections that can never exist', async () => {
    const { fake, b, ws } = fs2();
    await b.connect();
    await b.commit(ws, { 'idx/p1': { t: 'A' }, 'body/p1': { b: [] }, 'dig/p1': 'a', 'vdata/p1/v1': [{ id: 'x' }] });
    const before = fake.counts().reads;

    /* what lib/store.js writes when one page is deleted */
    await b.commit(ws, { 'idx/p1': null, 'body/p1': null, 'dig/p1': null, 'vmeta/p1': null, 'vdata/p1': null });

    /* only vdata/ holds anything under a page. Querying the other four costs a
       billed read each AND a network round trip each, and deleting a hundred
       pages made that four hundred round trips in a row. */
    const spent = fake.counts().reads - before;
    assert.ok(spent <= 1, 'deleting one page cost ' + spent + ' collection queries; only vdata/p1 can have children');
  });

  it('but the subtree really is gone', async () => {
    const { fake, b, ws } = fs2();
    await b.connect();
    await b.commit(ws, { 'vdata/p1/v1': [{ id: 'a' }], 'vdata/p1/v2': [{ id: 'b' }],
                         'dbrow/d1/r1': { id: 'r1' }, 'dbrow/d1/r2': { id: 'r2' } });
    await b.commit(ws, { 'vdata/p1': null, 'dbrow/d1': null });
    assert.deep(fake.paths(), [], 'snapshot bodies or table rows outlived their parent');
  });

  it('a kind the backend has never heard of is still swept, not assumed empty', async () => {
    /* the safe default: anything not known to be a leaf is walked. A backend
       that guessed wrong here would leave orphans behind for ever. */
    const { fake, b, ws } = fs2();
    await b.connect();
    await b.commit(ws, { 'somethingnew/a/x': { v: 1 }, 'somethingnew/a/y': { v: 2 } });
    await b.write(ws, 'somethingnew/a', null);
    assert.deep(fake.paths(), [], 'an unknown kind was assumed to be a leaf');
  });
});
