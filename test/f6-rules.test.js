/* The security rules are the half of sharing that the app cannot enforce, and
 * they are the one part of this system that no test can execute — there is no
 * rules engine here. So they are read as text and held to the mistakes that are
 * actually made in them, each of which was found by reading lib/firestore.rules
 * against lib/database.rules.json and asking what the two say differently.
 */
const fs = require('fs');
const path = require('path');
const RULES = fs.readFileSync(path.join(__dirname, '..', 'lib/firestore.rules'), 'utf8');
const RTDB = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'lib/database.rules.json'), 'utf8'));

/* every `allow ...:` clause, with its verbs and its condition */
function clauses() {
  const out = [];
  const re = /allow\s+([a-z,\s]+?):\s*if([\s\S]*?);/g;
  let m;
  while ((m = re.exec(RULES))) {
    out.push({
      verbs: m[1].split(',').map(s => s.trim()).filter(Boolean),
      cond: m[2].replace(/\s+/g, ' ').trim(),
      at: RULES.slice(0, m.index).split('\n').length
    });
  }
  return out;
}

describe('firestore rules — the delete trap', () => {
  it('no rule that grants delete reads request.resource', () => {
    /* On a DELETE, Firestore's `request.resource` is null. A condition that
       reads `request.resource.data.…` therefore fails for every delete, which
       is how "unpublish" and "remove this person's access" turn into buttons
       that report success and change nothing — the worst kind of failure,
       because the page stays public and the guest keeps reading. */
    const bad = clauses()
      .filter(c => c.verbs.indexOf('delete') >= 0 && /request\.resource/.test(c.cond))
      .map(c => 'line ' + c.at + ': allow ' + c.verbs.join(', '));
    assert.deep(bad, [], 'a delete can never satisfy a request.resource condition');
  });

  it('delete is granted somewhere for every node the app deletes', () => {
    /* unpublishPage, dropShared and dropInvite all issue deletes */
    ['pub', 'shared', 'inbox'].forEach(node => {
      const block = RULES.slice(RULES.indexOf('match /' + node + '/'));
      const upto = block.slice(0, block.indexOf('\n    match /', 1) + 1 || block.length);
      assert.ok(/allow[^;]*\bdelete\b/.test(upto), node + ' has no delete rule, so the app cannot clean it up');
    });
  });
});

describe('firestore rules — parity with the Realtime Database', () => {
  it('an invitation is validated the same way on both', () => {
    /* the RTDB rules pin the sender and the role; anything weaker on Firestore
       means the same app is safe on one database and not on the other */
    const inv = RTDB.rules.inbox.$emailKey.$inviteId['.validate'];
    assert.includes(inv, "newData.child('from').val() === auth.uid");
    assert.includes(inv, "newData.child('role').val() === 'viewer'");

    const block = RULES.slice(RULES.indexOf('match /inbox/'), RULES.indexOf('match /shared/'));
    assert.includes(block, 'request.resource.data.from == request.auth.uid');
    assert.includes(block, "request.resource.data.role == 'viewer'");
  });

  it('an invitation cannot carry fields the app never writes', () => {
    /* the RTDB rules end with `"$other": { ".validate": false }`. Without the
       same on Firestore, anyone who can send an invitation can also store
       whatever else they like in someone else's inbox. */
    assert.eq(RTDB.rules.inbox.$emailKey.$inviteId.$other['.validate'], false);
    const block = RULES.slice(RULES.indexOf('match /inbox/'), RULES.indexOf('match /shared/'));
    assert.includes(block, 'hasOnly', 'Firestore accepts any extra field an RTDB rule would reject');
  });

  it('a published page and a shared page name their owner on both', () => {
    ['pub', 'shared'].forEach(node => {
      const r = RTDB.rules[node];
      const key = Object.keys(r)[0];
      assert.includes(r[key]['.write'], 'auth.uid');
    });
    assert.includes(RULES, 'match /pub/{slug}');
    assert.includes(RULES, 'match /shared/{pageId}');
  });

  it('the two backends key an email address identically', () => {
    /* an invitation written by one and read by the other has to land on the
       same key, or moving database silently loses every pending invitation */
    assert.includes(RTDB.rules.inbox.$emailKey['.read'], "toLowerCase().replace('.', ',')");
    assert.includes(RULES, "lower().replace('\\\\.', ',')");
  });
});

describe('firestore rules — the rules and the backend agree on the document shape', () => {
  const { makeDataContext } = require('./harness');
  const { makeFakeFirestore } = require('./fake-firestore');

  /* `hasOnly` in the rules names the exact fields the backend writes. Those two
     lists live in different files and in different languages, so nothing but a
     test can keep them together: tighten the rule and every write starts
     failing; add a field to the backend and every write starts failing. */
  function allowedKeys(node) {
    const block = RULES.slice(RULES.indexOf('match /' + node + '/'));
    const m = block.match(/hasOnly\(\[([^\]]*)\]\)/);
    return m ? m[1].split(',').map(s => s.trim().replace(/'/g, '')) : null;
  }

  async function writtenKeys(path, value) {
    const ctx = makeDataContext({ backends: { firestore: { apiKey: 'k', projectId: 'p' } } });
    const fake = makeFakeFirestore();
    ctx.D.firebaseApp = () => Promise.resolve({ options: {} });
    ctx.D.firebaseModule = () => Promise.resolve(fake);
    const b = ctx.D.createBackend('firestore', { apiKey: 'k', projectId: 'p' });
    await b.connect();
    await b.write({ ws: null }, path, value);
    return Object.keys(fake.docs.get(Array.from(fake.docs.keys())[0])).sort();
  }

  it('a published page writes exactly the fields the rule permits', async () => {
    const keys = await writtenKeys('pub/s1', { o: 'u1', u: 1, t: 'T', b: [] });
    assert.deep(keys, (allowedKeys('pub') || []).sort(), 'pub/ document keys and its hasOnly() disagree');
  });

  it('an invitation writes exactly the fields the rule permits', async () => {
    const keys = await writtenKeys('inbox/a,b@x,com/i1',
      { id: 'i1', from: 'u1', pageId: 'p1', role: 'viewer', at: 1 });
    assert.deep(keys, (allowedKeys('inbox') || []).sort(), 'inbox/ document keys and its hasOnly() disagree');
  });

  it('a shared page writes no more than the rule permits', async () => {
    const keys = await writtenKeys('shared/p1', { o: 'u1', u: 1, t: 'T', b: [], m: { 'a,b@x,com': true } });
    const allowed = (allowedKeys('shared') || []).sort();
    const extra = keys.filter(k => allowed.indexOf(k) < 0);
    assert.deep(extra, [], 'shared/ writes fields its hasOnly() would reject');
    assert.ok(keys.indexOf('_j') >= 0 && keys.indexOf('o') >= 0, 'the required fields must be written');
  });
});
