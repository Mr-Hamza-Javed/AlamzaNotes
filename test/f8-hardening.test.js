/* The weak areas from the audit. None of these had broken anything yet; every
 * one of them is a way this system would break the first time it was pushed a
 * little harder than it has been so far.
 */
const { makeDataContext, loadRealStore } = require('./harness');
const { makeFakeFirestore } = require('./fake-firestore');

describe('hardening — opening the connection', () => {
  it('two things asking for the backend at once open it once', async () => {
    /* `loadPublic` opens the port when nobody is signed in, and `init` opens it
       for the workspace. Nothing sequences them. Two opens means two auth
       observers, and two auth observers means two full sets of listeners on
       every token refresh — the exact multiplier this store was rebuilt to
       remove. */
    let opens = 0, authConnects = 0;
    const h = loadRealStore({
      config: { backend: 'slow', auth: 'slow', backends: {}, tuning: { strictContract: false } },
      register: (D) => {
        const f = () => { opens++; return D.defineBackend({
          name: 'slow',
          caps: { realtime: false, atomicCommit: true, paged: true, publicRead: true },
          connect: () => new Promise(r => setTimeout(r, 25)),
          read: () => Promise.resolve(null), readPage: () => Promise.resolve({}),
          write: () => Promise.resolve(), commit: () => Promise.resolve(),
          watch: () => () => {}, close: () => Promise.resolve()
        }); };
        f.configured = () => true;
        D.registerBackend('slow', f);
        D.registerAuth('slow', () => ({
          name: 'slow', lastError: null,
          connect: () => { authConnects++; return new Promise(r => setTimeout(r, 25)); },
          signIn: () => Promise.resolve(null), signOut: () => Promise.resolve(),
          onChange: () => () => {}, token: () => null
        }));
      }
    });
    /* both entry points, at the same moment */
    await Promise.all([h.store.init(() => {}), h.store.loadPublic('some-slug')]);
    assert.eq(opens, 1, 'the backend was created ' + opens + ' times');
    assert.eq(authConnects, 1, 'the auth provider was connected ' + authConnects + ' times');
  });
});

describe('hardening — every read is counted', () => {
  it('the cost readout includes the reads the boot makes on its own behalf', async () => {
    /* `hasAnyChild` and the layout check are real network reads. Leaving them
       out of the meter makes Settings under-report, which is the one number a
       user has to decide whether this app is expensive. */
    const h = loadRealStore({
      config: { backend: 'metered', auth: 'instant', backends: {}, tuning: { strictContract: false } },
      register: (D) => {
        const f = () => D.defineBackend({
          name: 'metered',
          caps: { realtime: true, atomicCommit: true, paged: true, publicRead: true, legacyLayouts: false },
          connect: () => Promise.resolve(),
          read: (s, p) => Promise.resolve(p === 'layout' ? 4 : { some: 'value', that: 'has bytes' }),
          readPage: () => Promise.resolve({ a: { t: 'A' } }),
          write: () => Promise.resolve(), commit: () => Promise.resolve(),
          watch: () => () => {}, close: () => Promise.resolve()
        });
        f.configured = () => true;
        D.registerBackend('metered', f);
        D.registerAuth('instant', () => ({
          name: 'instant', lastError: null,
          connect: () => Promise.resolve(),
          signIn: () => Promise.resolve(null), signOut: () => Promise.resolve(),
          onChange: (cb) => { setTimeout(() => cb({ uid: 'u1', name: 'T', email: 't@x.com' }), 0); return () => {}; },
          token: () => null
        }));
      }
    });
    await h.store.init(() => {});
    await new Promise(r => setTimeout(r, 150));
    assert.ok(h.store.stats.reads >= 2,
      'only ' + h.store.stats.reads + ' reads counted; the layout check and the index probe are reads too');
    assert.ok(h.store.stats.down > 0, 'bytes downloaded were not counted at all');
  });
});

describe('hardening — the local backend behaves like the others', () => {
  it('its watch replays asynchronously, the way every real one does', async () => {
    /* localStorage can answer instantly, so its replay ran INSIDE watch(). No
       network backend can do that, so a caller that happened to depend on the
       timing would work on the demo and fail on every real database. */
    const { D } = makeDataContext({});
    const b = D.createBackend('local', { namespace: 'timing' });
    await b.connect();
    await b.commit({ ws: 'u1' }, { 'idx/a': { t: 'A' } });

    const order = [];
    b.watch({ ws: 'u1' }, 'idx', { added: () => order.push('replay') });
    order.push('watch returned');
    await new Promise(r => setTimeout(r, 20));
    assert.deep(order, ['watch returned', 'replay'],
      'the replay arrived before watch() had returned, which no real backend can do');
  });

  it('and the replay still arrives', async () => {
    const { D } = makeDataContext({});
    const b = D.createBackend('local', { namespace: 'timing2' });
    await b.connect();
    await b.commit({ ws: 'u1' }, { 'idx/a': { t: 'A' }, 'idx/b': { t: 'B' } });
    const seen = [];
    b.watch({ ws: 'u1' }, 'idx', { added: (k) => seen.push(k) });
    await new Promise(r => setTimeout(r, 20));
    assert.deep(seen, ['a', 'b']);
  });

  it('unsubscribing before the replay lands cancels it', async () => {
    const { D } = makeDataContext({});
    const b = D.createBackend('local', { namespace: 'timing3' });
    await b.connect();
    await b.write({ ws: 'u1' }, 'idx/a', { t: 'A' });
    const seen = [];
    const off = b.watch({ ws: 'u1' }, 'idx', { added: (k) => seen.push(k) });
    off();
    await new Promise(r => setTimeout(r, 20));
    assert.deep(seen, [], 'a detached watch still delivered');
  });
});

describe('hardening — your own API', () => {
  it('a request that never answers gives up instead of hanging for ever', async () => {
    const ctx = makeDataContext({ backends: { rest: { baseUrl: 'https://api.test', timeoutMs: 40 } } });
    ctx.sandbox.fetch = (u, opts) => new Promise((resolve, reject) => {
      if (opts && opts.signal) opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
    const b = ctx.D.createBackend('rest', { baseUrl: 'https://api.test', timeoutMs: 40 });
    await b.connect();
    let threw = null;
    try { await b.read({ ws: 'u1' }, 'idx/p1'); } catch (e) { threw = e; }
    assert.ok(threw, 'a request with no answer never returned');
    assert.includes(String(threw.message), 'timed out');
  });

  it('sign-in can carry a credential, rather than posting an empty object', () => {
    /* `signIn()` took no arguments and sent `{}`, so there was no way to pass a
       password or an authorization code — the provider could only ever work
       with a server that authenticated by some other means entirely. */
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'lib/data/auth.js'), 'utf8');
    const rest = src.slice(src.indexOf("D.registerAuth('rest'"));
    assert.ok(/signIn:\s*async function\s*\(\s*[a-z]/i.test(rest),
      'the rest provider\'s signIn still takes no argument');
  });

  it('a token that has been refreshed is the one that gets sent', async () => {
    /* a Firebase ID token expires every hour. The rest backend read it once,
       when the listener was opened, so a long session sent an expired token —
       the documented "keep Google sign-in, move the data to your API" pairing
       is exactly where this bites. */
    const ctx = makeDataContext({ backends: { rest: { baseUrl: 'https://api.test' } } });
    let token = 'first-token';
    ctx.D.authToken = () => token;
    const sent = [];
    ctx.sandbox.fetch = (u, opts) => {
      sent.push((opts.headers || {})['Authorization']);
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{"value":null}') });
    };
    const b = ctx.D.createBackend('rest', { baseUrl: 'https://api.test' });
    await b.connect();
    await b.read({ ws: 'u1' }, 'idx/p1');
    token = 'refreshed-token';
    await b.read({ ws: 'u1' }, 'idx/p2');
    assert.deep(sent, ['Bearer first-token', 'Bearer refreshed-token'],
      'the backend cached a token instead of asking for the current one');
  });
});

describe('hardening — a document id that looks like the filler', () => {
  it('a page whose id is the filler segment is not invisible', async () => {
    /* `_` is what the Firestore mapping inserts to keep collection/document
       alternating, and listings skipped it — so a document genuinely called `_`
       could be written and read directly but never appeared in the sidebar.
       Nothing generates such an id today; the moment a slug or an API-assigned
       id can, a page would silently vanish. */
    const ctx = makeDataContext({ backends: { firestore: { apiKey: 'k', projectId: 'p' } } });
    const fake = makeFakeFirestore();
    ctx.D.firebaseApp = () => Promise.resolve({ options: {} });
    ctx.D.firebaseModule = () => Promise.resolve(fake);
    const b = ctx.D.createBackend('firestore', { apiKey: 'k', projectId: 'p' });
    await b.connect();
    await b.write({ ws: 'u1' }, 'idx/_', { t: 'A page called underscore' });
    await b.write({ ws: 'u1' }, 'idx/normal', { t: 'Ordinary' });
    const listed = await b.readPage({ ws: 'u1' }, 'idx', null, 10);
    assert.deep(Object.keys(listed).sort(), ['_', 'normal'],
      'a document id equal to the filler disappeared from the listing');
  });
});

describe('hardening — one truth about whether there is a server', () => {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.join(__dirname, '..');

  it('mode and cloud can never disagree, because there is only one of them', () => {
    const { store } = loadRealStore();
    /* `mode` was a second copy of `cloud`, kept in step by hand at three call
       sites. A copy kept by hand is a copy that eventually is not. */
    assert.eq(store.mode, store.cloud ? 'firebase' : 'local');
    const before = store.mode;
    try { store.mode = 'something-else'; } catch (e) { /* a getter may refuse */ }
    assert.eq(store.mode, before, 'mode is writable, so it can be set to a lie');
  });

  it('the app asks whether there is a server, not whether it is Firebase', () => {
    /* The question every one of these sites is really asking is "is there a
       server?". Asking it by naming a vendor is how somebody running Firestore,
       or their own API, reads the code and concludes it cannot possibly work. */
    const offenders = [];
    ['index.html'].concat(
      fs.readdirSync(path.join(ROOT, 'lib')).filter(f => /^part-.*\.js$/.test(f)).map(f => 'lib/' + f)
    ).forEach(rel => {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      src.split('\n').forEach((line, i) => {
        if (/AStore\.mode\s*[!=]==?\s*['"]/.test(line)) offenders.push(rel + ':' + (i + 1));
      });
    });
    assert.deep(offenders, [],
      'these compare AStore.mode against a vendor name; AStore.cloud is the question they mean');
  });

  it('mode still answers, for anything outside this repo that reads it', () => {
    const { store } = loadRealStore();
    assert.ok(store.mode === 'firebase' || store.mode === 'local',
      'the compatibility alias must keep its two values');
  });
});
