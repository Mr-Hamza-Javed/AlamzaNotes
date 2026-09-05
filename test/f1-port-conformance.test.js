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
    /* the replay is asynchronous on every backend, including this one — see
       'its watch replays asynchronously' in the hardening suite */
    await new Promise(r => setTimeout(r, 10));
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
    await new Promise(r => setTimeout(r, 10));      // let the replay land first
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

describe('the port — the contract check must be safe to run on a real database', () => {
  const fs = require('fs');
  const path = require('path');

  it('it probes a scope the security rules actually permit', async () => {
    /* The check used to write to workspaces/conformance-probe, which no rule
       allows: every real user got a console warning saying their backend "does
       not keep the contract", which was a lie, plus a denied request on every
       load. It has to probe the signed-in account's OWN workspace, because that
       is the only place the app is allowed to write. */
    const { D } = makeDataContext({});
    const seen = [];
    const b = D.defineBackend({
      name: 'watcher',
      caps: { realtime: false, atomicCommit: true, paged: true, publicRead: true },
      connect: () => Promise.resolve(),
      read: (s, p) => { seen.push([s.ws, p]); return Promise.resolve(null); },
      readPage: (s, p) => { seen.push([s.ws, p]); return Promise.resolve({}); },
      write: (s, p) => { seen.push([s.ws, p]); return Promise.resolve(); },
      commit: (s, patch) => { Object.keys(patch).forEach(p => seen.push([s.ws, p])); return Promise.resolve(); },
      watch: () => () => {},
      close: () => Promise.resolve()
    });
    await D.conformance(b, { ws: 'the-signed-in-user' });
    const wrongScope = seen.filter(x => x[0] !== 'the-signed-in-user');
    assert.deep(wrongScope, [], 'the probe wrote outside the scope it was given');
  });

  it('it never touches a path the app itself stores anything at', async () => {
    /* A probe document under idx/ would arrive through the app's own index
       watch and appear in the sidebar as a phantom page. */
    const { D } = makeDataContext({});
    const seen = [];
    const b = D.defineBackend({
      name: 'watcher2',
      caps: { realtime: true, atomicCommit: true, paged: true, publicRead: true },
      connect: () => Promise.resolve(),
      read: (s, p) => { seen.push(p); return Promise.resolve(null); },
      readPage: (s, p) => { seen.push(p); return Promise.resolve({}); },
      write: (s, p) => { seen.push(p); return Promise.resolve(); },
      commit: (s, patch) => { Object.keys(patch).forEach(p => seen.push(p)); return Promise.resolve(); },
      watch: (s, c) => { seen.push(c); return () => {}; },
      close: () => Promise.resolve()
    });
    await D.conformance(b, { ws: 'u1' });
    const appKinds = Object.keys(D.KINDS).concat(['meta', 'layout']);
    const collisions = [...new Set(seen)].filter(p => appKinds.indexOf(p.split('/')[0]) >= 0);
    assert.deep(collisions, [], 'the probe used a path the app stores real data at');
  });

  it('the shipped config leaves the check off — it is a tool for writing a backend', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib/config.js'), 'utf8');
    const m = src.match(/strictContract:\s*(true|false)/);
    assert.ok(m, 'lib/config.js has no strictContract line');
    assert.eq(m[1], 'false', 'a probe that writes to a real workspace must not be on by default');
  });
});

describe('the port — what a limit of 0 means', () => {
  it('every backend reads 0 as "no limit", not as "no rows"', async () => {
    /* lib/store.js calls readPage(..., 0) whenever it wants everything — the
       inbox, and the whole index on a backend that cannot stream. The port
       never said what 0 meant, so it was a sentinel waiting to be taken
       literally by the next backend somebody writes. */
    const { D } = makeDataContext({});
    const b = D.createBackend('local', {});
    await b.connect();
    await b.commit({ ws: 'u1' }, { 'idx/a': { t: 'A' }, 'idx/b': { t: 'B' }, 'idx/c': { t: 'C' } });
    assert.eq(Object.keys(await b.readPage({ ws: 'u1' }, 'idx', null, 0)).length, 3, '0 must mean everything');
    assert.eq(Object.keys(await b.readPage({ ws: 'u1' }, 'idx', null)).length, 3, 'omitted must mean everything');
    assert.eq(Object.keys(await b.readPage({ ws: 'u1' }, 'idx', null, 2)).length, 2, 'a real limit must still apply');
  });

  it('the port says so where readPage is defined, not somewhere else', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'lib/data/port.js'), 'utf8');
    /* `maxCommit` also documents a 0, so the check has to look inside the
       readPage paragraph rather than anywhere in the file */
    const from = src.indexOf('readPage(scope, col,');
    const to = src.indexOf('write(scope, path, v)');
    assert.ok(from > 0 && to > from, 'could not find the readPage contract');
    const para = src.slice(from, to);
    assert.ok(/\b0\b/.test(para) && /no limit|everything|unlimited/i.test(para),
      'readPage does not say what a limit of 0 means');
  });

  it('the REST backend never puts limit=0 in a URL', async () => {
    /* a server that honours `limit` literally would return nothing, so the
       inbox would always be empty and nobody would know why */
    const ctx = makeDataContext({ backends: { rest: { baseUrl: 'https://api.test' } } });
    const urls = [];
    ctx.sandbox.fetch = (u) => {
      urls.push(u);
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{"items":{}}') });
    };
    const b = ctx.D.createBackend('rest', { baseUrl: 'https://api.test' });
    await b.connect();
    await b.readPage({ ws: 'u1' }, 'idx', null, 0);
    await b.readPage({ ws: null }, 'inbox/a,b@x,com', null, 0);
    await b.readPage({ ws: 'u1' }, 'idx', null, 20);
    assert.deep(urls.filter(u => /limit=0/.test(u)), [], 'limit=0 reached the server');
    assert.ok(/limit=20/.test(urls[2]), 'a real limit must still be sent');
  });
});
