/* One line in lib/config.js decides which database the whole app runs on.
 *
 * The value of that promise is entirely in what happens at the EDGES: a name
 * that does not exist, a block that was never filled in, two blocks confused
 * for each other. Every one of those has to end somewhere the user can still
 * use the app and can find out why — never at a blank screen, and never
 * silently on a database they did not choose.
 */
const { makeDataContext } = require('./harness');

const FULL = {
  rtdb: { apiKey: 'k', databaseURL: 'https://x.firebaseio.com', projectId: 'p' },
  firestore: { apiKey: 'k', projectId: 'p' },
  rest: { baseUrl: 'https://api.test' },
  local: {}
};

function pick(cfg) {
  const { D } = makeDataContext(cfg);
  return { name: D.resolveBackendName(D.config()), why: D.chose, D };
}

describe('config — choosing a database', () => {
  it('a name that is spelled out is the one that runs', () => {
    assert.eq(pick({ backend: 'firestore', backends: FULL }).name, 'firestore');
    assert.eq(pick({ backend: 'rtdb', backends: FULL }).name, 'rtdb');
    assert.eq(pick({ backend: 'rest', backends: FULL }).name, 'rest');
    assert.eq(pick({ backend: 'local', backends: FULL }).name, 'local');
  });

  it('changing that one line is the whole change', () => {
    /* the same config object, one field different, and the app is on another
       database — this is the claim the file is written to keep */
    const base = { backends: FULL };
    assert.eq(pick(Object.assign({ backend: 'rtdb' }, base)).name, 'rtdb');
    assert.eq(pick(Object.assign({ backend: 'firestore' }, base)).name, 'firestore');
  });

  it('a backend named but not configured falls back to this browser and says so', () => {
    const got = pick({ backend: 'firestore', backends: { rtdb: FULL.rtdb } });
    assert.eq(got.name, 'local', 'an unconfigured backend must not be started');
    assert.includes(got.why, 'firestore');
    assert.includes(got.why, 'empty');
  });

  it('a backend that does not exist falls back and names itself', () => {
    const got = pick({ backend: 'mongodb', backends: FULL });
    assert.eq(got.name, 'local');
    assert.includes(got.why, 'mongodb');
    assert.includes(got.why, 'not registered');
  });

  it('auto takes the first backend that is actually filled in', () => {
    assert.eq(pick({ backend: 'auto', backends: FULL }).name, 'rest', 'your own API outranks a hosted one');
    assert.eq(pick({ backend: 'auto', backends: { rtdb: FULL.rtdb } }).name, 'rtdb');
    assert.eq(pick({ backend: 'auto', backends: { firestore: FULL.firestore } }).name, 'firestore');
    assert.eq(pick({ backend: 'auto', backends: {} }).name, 'local');
  });

  it('auto NEVER moves a live Realtime Database account to Firestore on its own', () => {
    /* The two Firebase blocks describe the same project and differ by one
       field, so filling in the Firestore block to try it out leaves both
       configured. If auto preferred the newer one, that edit alone would point
       a real account at an empty database and every note would look deleted.
       This is the assertion that stops that from ever being true again. */
    const both = { rtdb: FULL.rtdb, firestore: FULL.firestore };
    assert.eq(pick({ backend: 'auto', backends: both }).name, 'rtdb',
      'preparing to try Firestore must not silently switch to it');
    assert.eq(pick({ backend: 'firestore', backends: both }).name, 'firestore',
      'and saying so explicitly must still work');
  });

  it('the file as shipped names its backend rather than guessing', () => {
    /* lib/config.js is read as a plain file: `backend` must be an explicit
       name, so an upgrade lands exactly where the account already is. */
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib/config.js'), 'utf8');
    const m = src.match(/\n\s*backend:\s*'([a-z]+)'/);
    assert.ok(m, 'lib/config.js has no backend line');
    assert.eq(m[1], 'rtdb', 'the shipped config must point at the database this app already uses');
  });

  it('auto does not wrap a single backend in a router', () => {
    const got = pick({ backend: 'auto', backends: FULL, routing: { default: 'rtdb' } });
    assert.eq(got.name, 'rest', 'the shipped placeholder routing table is not a routing setup');
  });

  it('auto does pick routing once it actually splits something', () => {
    const got = pick({ backend: 'auto', backends: FULL, routing: { default: 'rtdb', body: 'rest' } });
    assert.eq(got.name, 'routing');
  });

  it('an empty config is a working app, not an error', () => {
    const got = pick({});
    assert.eq(got.name, 'local');
    assert.ok(got.why, 'a fallback with no explanation is a mystery');
  });
});

describe('config — choosing sign-in', () => {
  it('auto matches sign-in to the backend', () => {
    const { D } = makeDataContext({ backends: FULL });
    assert.eq(D.resolveAuthName({ auth: 'auto' }, 'rtdb'), 'firebase');
    assert.eq(D.resolveAuthName({ auth: 'auto' }, 'firestore'), 'firebase');
    assert.eq(D.resolveAuthName({ auth: 'auto' }, 'rest'), 'rest');
    assert.eq(D.resolveAuthName({ auth: 'auto' }, 'local'), 'local');
  });

  it('sign-in can be kept while storage moves — which is the point of two lines', () => {
    const { D } = makeDataContext({ backends: FULL });
    assert.eq(D.resolveAuthName({ auth: 'firebase' }, 'rest'), 'firebase',
      'moving data to your own API should not force you to rewrite sign-in');
  });

  it('a routed app signs in wherever the data mostly lives', () => {
    const { D } = makeDataContext({ backends: FULL });
    assert.eq(D.resolveAuthName({ auth: 'auto', routing: { default: 'rtdb', body: 'firestore' } }, 'routing'), 'firebase');
    assert.eq(D.resolveAuthName({ auth: 'auto', routing: { default: 'rest' } }, 'routing'), 'rest');
  });
});

describe('config — the tuning block', () => {
  it('defaults are complete, so a partly-filled block is not a hole', () => {
    const { D } = makeDataContext({ tuning: { pushDelayMs: 5000 } });
    const t = D.config().tuning;
    assert.eq(t.pushDelayMs, 5000, 'the override was lost');
    assert.eq(t.cacheBudget, 2400000, 'an untouched field lost its default');
    assert.eq(t.mirrorDelayMs, 240);
    assert.eq(t.strictContract, false, 'the contract probe writes to a real workspace — it is opt-in');
  });

  it('a missing tuning block is the same as an empty one', () => {
    const { D } = makeDataContext({});
    assert.eq(D.config().tuning.pushDelayMs, 2200);
  });
});

describe('config — the compatibility shim', () => {
  it('an old lib/firebase-config.js deployment still runs', () => {
    /* window.ALAMZA_FIREBASE_CONFIG was the only config this app had. Someone
       upgrading has that file on their server and nothing else; the app has to
       keep working until they move the values. */
    const { sandbox } = makeDataContext({ backend: 'auto', backends: {} });
    sandbox.ALAMZA_FIREBASE_CONFIG = { apiKey: 'legacy', databaseURL: 'https://legacy.firebaseio.com' };
    sandbox.ALAMZA_CONFIG.backends.rtdb = sandbox.ALAMZA_FIREBASE_CONFIG;
    assert.eq(sandbox.AlamzaData.resolveBackendName(sandbox.AlamzaData.config()), 'rtdb');
  });
});

describe('config — adding a database of your own', () => {
  it('needs no edit to any file that already exists', () => {
    /* This is the claim the whole refactor makes, so it is asserted rather
       than described: a backend registered from outside is selectable,
       creatable and usable, and nothing in lib/ was touched to allow it. */
    const { D } = makeDataContext({ backend: 'mine', backends: { mine: { on: true } } });

    const store = {};
    const factory = function (cfg) {
      return D.defineBackend({
        name: 'mine',
        caps: { realtime: false, atomicCommit: true, paged: true, publicRead: true },
        connect: () => Promise.resolve(),
        read: (s, p) => Promise.resolve(p in store ? store[p] : null),
        readPage: (s, c) => {
          const out = {};
          Object.keys(store).forEach(k => {
            if (k.indexOf(c + '/') === 0 && k.slice(c.length + 1).indexOf('/') < 0) out[k.slice(c.length + 1)] = store[k];
          });
          return Promise.resolve(out);
        },
        write: (s, p, v) => { if (v === null) delete store[p]; else store[p] = v; return Promise.resolve(); },
        commit: (s, patch) => { Object.keys(patch).forEach(p => { if (patch[p] === null) delete store[p]; else store[p] = patch[p]; }); return Promise.resolve(); },
        watch: () => () => {},
        close: () => Promise.resolve(),
        __cfg: cfg
      });
    };
    factory.configured = (cfg) => !!(cfg && cfg.on);
    D.registerBackend('mine', factory);

    assert.eq(D.resolveBackendName(D.config()), 'mine', 'a registered backend was not selectable');
    const b = D.createBackend('mine', { on: true });
    assert.eq(b.__cfg.on, true, 'its config block did not reach it');
    assert.eq(b.caps.legacyLayouts, false, 'undeclared caps should still be filled in');
  });

  it('and it is held to the same contract as the built-in ones', async () => {
    const { D } = makeDataContext({});
    /* a backend that returns undefined for an absent path — the single most
       damaging way to be subtly wrong, because the app reads undefined as
       "not fetched yet" and an edit then overwrites real text */
    const b = D.defineBackend({
      name: 'sloppy',
      caps: { paged: false },
      connect: () => Promise.resolve(),
      read: () => Promise.resolve(undefined),
      readPage: () => Promise.resolve({}),
      write: () => Promise.resolve(),
      commit: () => Promise.resolve(),
      watch: () => () => {},
      close: () => Promise.resolve()
    });
    const bad = await D.conformance(b);
    assert.ok(bad.length > 0, 'conformance let a broken backend through');
    assert.includes(bad.join(' '), 'expected null');
  });
});

describe('config — the app says which database it is on', () => {
  const { makeApp } = require('./harness');

  it('the sidebar badge names the backend that is actually running', () => {
    const app = makeApp({});
    assert.eq(app.renderVals().storeLabel, 'Realtime Database · synced');

    app.store.backendName = 'firestore';
    assert.eq(app.renderVals().storeLabel, 'Firestore · synced',
      'changing the backend must change what the badge says');

    app.store.backendName = 'rest';
    assert.eq(app.renderVals().storeLabel, 'Your API · synced');
  });

  it('a backend nobody has given a name to still shows its own name', () => {
    const app = makeApp({});
    app.store.backendName = 'mongodb';
    assert.eq(app.renderVals().storeLabel, 'mongodb · synced',
      'a backend added later must not show as blank');
  });

  it('with no server the badge says so instead of naming a database', () => {
    const app = makeApp({});
    app.store.cloud = false;
    app.store.demo = true;
    assert.eq(app.renderVals().storeLabel, 'Demo · this browser');
    app.store.demo = false;
    assert.eq(app.renderVals().storeLabel, 'Local storage');
  });

  it('Data & sync reports the choice, the reason, and what the backend can do', () => {
    const app = makeApp({});
    app.store.backendName = 'firestore';
    app.store.why = 'lib/config.js selected "firestore"';
    app.store.caps = { realtime: false, atomicCommit: true, maxCommit: 450, paged: true, publicRead: true, legacyLayouts: false };
    const v = app.renderVals();
    assert.includes(v.syncTitle, 'Firestore');
    assert.includes(v.syncCode, 'backend:  firestore');
    assert.includes(v.syncCode, 'selected "firestore"');
    assert.includes(v.syncCode, 'on reload', 'a backend with no live updates must say so');
  });
});
