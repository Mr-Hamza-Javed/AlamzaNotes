/* A3 — push() updated its "what the server has" bookkeeping BEFORE the write
   and never looked at the result. A rejected write therefore reported "saved",
   dropped the queued version payload and marked the metadata as sent, so the
   snapshot existed in the UI and nowhere else, with no retry. */
const { loadRealStore, settle } = require('./harness');
const { page, version } = require('./fixtures');

function stateWithSnapshot() {
  return {
    prefs: {}, workspace: null, invites: [], dbs: {},
    pages: {
      p1: Object.assign(page('p1'), {
        blockCount: 1,
        versions: [version('v1', 1)]
      })
    }
  };
}

/* one clean push, so `sent` holds a baseline the next push diffs against */
function primed() {
  const h = loadRealStore();
  h.inner.setPending(stateWithSnapshot());
  h.store.putVersionBlocks('p1', 'v1', { b: [], d: {}, p: {} });
  h.store.push();
  return h;
}

describe('A3 — a rejected write', () => {
  it('does not report the save as successful', async () => {
    const h = loadRealStore();
    const seen = [];
    h.store.onSave(s => seen.push(s));
    h.fb.behaviour = 'reject';
    h.inner.setPending(stateWithSnapshot());
    h.store.putVersionBlocks('p1', 'v1', { b: [], d: {}, p: {} });
    h.store.push();
    await settle();
    assert.notOk(seen.includes('saved'), 'reported "saved" for a write that failed: ' + seen.join(','));
    assert.ok(seen.includes('error'), 'expected an error state, got: ' + seen.join(','));
  });

  it('re-sends the version metadata on the next push', async () => {
    const h = loadRealStore();
    h.fb.behaviour = 'reject';
    h.inner.setPending(stateWithSnapshot());
    h.store.push();
    await settle();
    h.fb.behaviour = 'ok';
    h.fb.updates.length = 0;
    h.store.push();
    await settle();
    const patch = h.fb.updates[0] || {};
    assert.ok(patch['vmeta/p1'], 'the failed version metadata must be retried, keys: ' + Object.keys(patch));
  });

  it('re-queues the version payload rather than dropping it', async () => {
    const h = loadRealStore();
    h.fb.behaviour = 'reject';
    h.inner.setPending(stateWithSnapshot());
    h.store.putVersionBlocks('p1', 'v1', { b: [{ id: 'b1', type: 'p', text: 'kept' }], d: {}, p: {} });
    h.store.push();
    await settle();
    h.fb.behaviour = 'ok';
    h.fb.updates.length = 0;
    h.store.push();
    await settle();
    const patch = h.fb.updates[0] || {};
    assert.ok(patch['vdata/p1/v1'], 'the snapshot payload was lost, keys: ' + Object.keys(patch));
    assert.eq(patch['vdata/p1/v1'].b[0].text, 'kept');
  });

  it('treats a synchronous throw the same way', async () => {
    const h = loadRealStore();
    h.fb.behaviour = 'throw';
    h.inner.setPending(stateWithSnapshot());
    h.store.putVersionBlocks('p1', 'v1', { b: [], d: {}, p: {} });
    h.store.push();
    await settle();
    h.fb.behaviour = 'ok';
    h.fb.updates.length = 0;
    h.store.push();
    await settle();
    const patch = h.fb.updates[0] || {};
    assert.ok(patch['vmeta/p1'] && patch['vdata/p1/v1'], 'keys: ' + Object.keys(patch));
  });

  it('does not claim the metadata was confirmed', async () => {
    const h = loadRealStore();
    h.fb.behaviour = 'reject';
    h.inner.setPending(stateWithSnapshot());
    h.store.push();
    await settle();
    assert.notOk(h.store.vmetaKnown('p1'),
      'a failed write must not licence the empty-history guard to stand down');
  });

  it('retries on its own instead of waiting for the next edit', async () => {
    const h = loadRealStore();
    h.fb.behaviour = 'reject';
    h.inner.setPending(stateWithSnapshot());
    h.store.push();
    await settle();
    assert.ok(h.store.retryPending && h.store.retryPending(),
      'a failed write with nothing else coming would never be sent again');
  });

  it('a successful write still reports saved and clears the queue', async () => {
    const h = primed();
    await settle();
    assert.eq(Object.keys(h.inner.vqueue()).length, 0, 'a confirmed payload leaves the queue');
    h.fb.updates.length = 0;
    h.store.push();
    await settle();
    assert.eq(h.fb.updates.length, 0, 'nothing changed, so nothing should be re-sent');
  });
});
