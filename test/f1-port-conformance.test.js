/* Every backend behaves the same, or switching databases is not a one-line
 * change — it is a debugging session.
 *
 * lib/data/port.js states a contract and lib/data/port.js#conformance checks
 * it. This file runs that check against every backend a test can reach without
 * a network: `local` for real, and `firestore` against the fake SDK, which
 * exercises the actual backend file. A backend that passes here can be swapped
 * in by editing one line of lib/config.js, which is the whole claim.
 */
const { makeDataContext } = require('./harness');
const { makeFakeFirestore } = require('./fake-firestore');

function withFirestore() {
  const ctx = makeDataContext({
    backend: 'firestore',
    backends: { firestore: { apiKey: 'k', projectId: 'p' } }
  });
  const fake = makeFakeFirestore();
  ctx.D.firebaseApp = () => Promise.resolve({ options: {} });
  ctx.D.firebaseModule = (f) => {
    if (f === 'firebase-firestore.js') return Promise.resolve(fake);
    return Promise.reject(new Error('no ' + f + ' in tests'));
  };
  return { ctx, fake };
}

describe('the port — every backend keeps the same contract', () => {
  it('local passes conformance in full', async () => {
    const { D } = makeDataContext({});
    const b = D.createBackend('local', { namespace: 'test' });
    await b.connect();
    const bad = await D.conformance(b);
    assert.deep(bad, [], 'local broke the contract');
  });

  it('firestore passes conformance in full', async () => {
    const { ctx, fake } = withFirestore();
    const b = ctx.D.createBackend('firestore', { apiKey: 'k', projectId: 'p' });
    await b.connect();
    const bad = await ctx.D.conformance(b);
    assert.deep(bad, [], 'firestore broke the contract');
    void fake;
  });

  it('every registered backend declares the six methods and a full cap set', () => {
    const { D } = makeDataContext({
      backends: {
        rtdb: { apiKey: 'k', databaseURL: 'u' },
        firestore: { apiKey: 'k', projectId: 'p' },
        rest: { baseUrl: 'https://api.test' },
        local: {}
      },
      routing: { default: 'local', body: 'local' }
    });
    const conf = D.config();
    D.backendNames().forEach((name) => {
      const cfg = name === 'routing' ? conf : conf.backends[name];
      const b = D.createBackend(name, cfg || {});
      D.REQUIRED.forEach(m => assert.eq(typeof b[m], 'function', name + ' has no ' + m + '()'));
      Object.keys(D.CAPS).forEach(k =>
        assert.eq(typeof b.caps[k], typeof D.CAPS[k], name + '.caps.' + k + ' is the wrong type'));
    });
  });

  it('a backend missing a method is refused when it is defined, not when it is used', () => {
    const { D } = makeDataContext({});
    assert.throws(() => D.defineBackend({ name: 'broken', read: () => {} }),
      'a half-written backend was accepted');
    try { D.defineBackend({ name: 'broken', read: () => {} }); }
    catch (e) {
      assert.includes(e.message, 'connect');
      assert.includes(e.message, 'lib/data/port.js');
    }
  });

  it('caps left out default to the least capable thing that still works', () => {
    const { D } = makeDataContext({});
    const b = D.defineBackend({
      name: 'minimal', caps: { paged: true },
      connect: () => {}, read: () => {}, readPage: () => {}, write: () => {},
      commit: () => {}, watch: () => {}, close: () => {}
    });
    assert.eq(b.caps.realtime, false, 'realtime should default off');
    assert.eq(b.caps.atomicCommit, false, 'atomicCommit should default off');
    assert.eq(b.caps.paged, true, 'the declared cap was lost');
  });

  it('an absent path reads back as null, never as undefined', async () => {
    const { D } = makeDataContext({});
    const b = D.createBackend('local', {});
    await b.connect();
    const v = await b.read({ ws: 'u1' }, 'body/never-written');
    assert.eq(v, null, 'absent must be null — the app reads undefined as "not fetched yet"');
  });

  it('an empty value is NOT an absent one', async () => {
    const { D } = makeDataContext({});
    const b = D.createBackend('local', {});
    await b.connect();
    await b.write({ ws: 'u1' }, 'body/p1', { b: [] });
    assert.deep(await b.read({ ws: 'u1' }, 'body/p1'), { b: [] },
      'an empty body came back as absent — that is how a note gets erased');
  });
});

describe('the port — watching', () => {
  it('a watch replays what is already stored before it reports anything new', async () => {
    const { D } = makeDataContext({});
    const b = D.createBackend('local', {});
    await b.connect();
    await b.commit({ ws: 'u1' }, { 'idx/a': { t: 'A' }, 'idx/b': { t: 'B' } });

    const seen = [];
    const off = b.watch({ ws: 'u1' }, 'idx', { added: (k) => seen.push('+' + k) });
    assert.deep(seen, ['+a', '+b'], 'the sidebar is painted from this replay');

    await b.write({ ws: 'u1' }, 'idx/c', { t: 'C' });
    assert.includes(seen.join(','), '+c');
    off();
    await b.write({ ws: 'u1' }, 'idx/d', { t: 'D' });
    assert.eq(seen.indexOf('+d'), -1, 'unsubscribe did not detach');
  });

  it('changed and removed are told apart', async () => {
    const { D } = makeDataContext({});
    const b = D.createBackend('local', {});
    await b.connect();
    await b.write({ ws: 'u1' }, 'idx/a', { t: 'A' });
    const log = [];
    b.watch({ ws: 'u1' }, 'idx', {
      added: (k) => log.push('add ' + k),
      changed: (k) => log.push('chg ' + k),
      removed: (k) => log.push('del ' + k)
    });
    await b.write({ ws: 'u1' }, 'idx/a', { t: 'A2' });
    await b.write({ ws: 'u1' }, 'idx/a', null);
    assert.deep(log, ['add a', 'chg a', 'del a']);
  });

  it('one workspace never sees another workspace changes', async () => {
    const { D } = makeDataContext({});
    const b = D.createBackend('local', {});
    await b.connect();
    const seen = [];
    b.watch({ ws: 'mine' }, 'idx', { added: (k) => seen.push(k) });
    await b.write({ ws: 'someone-else' }, 'idx/secret', { t: 'theirs' });
    assert.deep(seen, [], 'a watch leaked across workspaces');
  });
});
