/* B2 — sig() was `type + level + text + checked`, so the diff was blind to
   almost everything else a block is. That is not only a display problem: the
   same stats() decides whether a snapshot is allowed at all, so an edit the
   diff could not see was an edit that could not be captured. */
const path = require('path');
const { newContext } = require('./harness');
const ADiff = newContext().sandbox.ADiff;

const b = (id, text, over) => Object.assign({ id, type: 'p', text, indent: 0 }, over || {});
const changed = (a, z) => !ADiff.stats(a, z).none;

describe('B2 — what the diff can see', () => {
  it('text inside a toggle', () => {
    assert.ok(changed(
      [b('t', 'Section', { type: 'toggle', children: [b('c', 'old')] })],
      [b('t', 'Section', { type: 'toggle', children: [b('c', 'new')] })]));
  });

  it('text inside a column', () => {
    assert.ok(changed(
      [b('x', '', { type: 'columns', cols: [[b('c', 'A')]] })],
      [b('x', '', { type: 'columns', cols: [[b('c', 'B')]] })]));
  });

  it('a block added inside a toggle', () => {
    const st = ADiff.stats(
      [b('t', 'S', { type: 'toggle', children: [b('c', 'one')] })],
      [b('t', 'S', { type: 'toggle', children: [b('c', 'one'), b('c2', 'two')] })]);
    assert.eq(st.added, 1);
  });

  it('indentation', () => {
    assert.ok(changed([b('p', 'x', { indent: 0 })], [b('p', 'x', { indent: 3 })]));
  });

  it('colour and background', () => {
    assert.ok(changed([b('p', 'x', { color: 'red' })], [b('p', 'x', { color: 'blue' })]));
    assert.ok(changed([b('p', 'x')], [b('p', 'x', { bg: 'yellow' })]));
  });

  it('a code block’s language', () => {
    assert.ok(changed(
      [b('c', 'print(1)', { type: 'code', lang: 'python' })],
      [b('c', 'print(1)', { type: 'code', lang: 'javascript' })]));
  });

  it('which table a database block embeds', () => {
    assert.ok(changed(
      [b('d', '', { type: 'database', dbId: 'db_1' })],
      [b('d', '', { type: 'database', dbId: 'db_2' })]));
  });

  it('which page a sub-page block points at', () => {
    assert.ok(changed(
      [b('s', '', { type: 'subpage', pageId: 'p_1' })],
      [b('s', '', { type: 'subpage', pageId: 'p_2' })]));
  });

  it('a cell in a plain table', () => {
    assert.ok(changed(
      [b('t', '', { type: 'table', rows: [['a', 'b'], ['1', '2']] })],
      [b('t', '', { type: 'table', rows: [['a', 'b'], ['9', '2']] })]));
  });

  it('a callout’s icon', () => {
    assert.ok(changed(
      [b('c', 'note', { type: 'callout', icon: '💡' })],
      [b('c', 'note', { type: 'callout', icon: '🔥' })]));
  });

  /* the other direction matters just as much — a diff that calls everything
     changed is as useless as one that calls nothing changed */
  it('key order is not a change', () => {
    assert.notOk(changed(
      [{ id: 'p', type: 'p', text: 'x', indent: 0, color: 'red' }],
      [{ color: 'red', indent: 0, text: 'x', type: 'p', id: 'p' }]));
  });

  it('collapsing a toggle is not a change', () => {
    assert.notOk(changed(
      [b('t', 'S', { type: 'toggle', collapsed: false, children: [b('c', 'x')] })],
      [b('t', 'S', { type: 'toggle', collapsed: true, children: [b('c', 'x')] })]));
  });

  it('a new block id for the same content is not a rewrite of everything', () => {
    const st = ADiff.stats([b('k1', 'same')], [b('k2', 'same')]);
    assert.ok(st.none, 'identity is not content');
  });

  it('nested rows are reported at their own depth', () => {
    const rows = ADiff.blocks(
      [b('t', 'S', { type: 'toggle', children: [b('c', 'old')] })],
      [b('t', 'S', { type: 'toggle', children: [b('c', 'new')] })]);
    const hit = rows.find(r => r.t === '~');
    assert.ok(hit, 'the changed child must be a row of its own');
    assert.eq(hit.now.id, 'c', 'and it must be the CHILD, not the toggle around it');
    assert.eq(hit.now.__depth, 1, 'so the viewer can indent it');
  });

  it('the summary names what moved', () => {
    const s = ADiff.summary(
      [b('t', 'S', { type: 'toggle', children: [b('c', 'old')] })],
      [b('t', 'S', { type: 'toggle', children: [b('c', 'new')] })]);
    assert.notOk(/no content changes/i.test(s), 'got: ' + s);
  });
});

describe('B2 — the diff stays fast', () => {
  it('a huge changed block does not hang the tab', () => {
    const big = Array.from({ length: 8000 }, (_, i) => 'token' + i).join(' ');
    const t0 = Date.now();
    const w = ADiff.words(big, big.replace('token10 ', 'token10x '));
    const ms = Date.now() - t0;
    assert.ok(ms < 1500, 'ADiff.words took ' + ms + 'ms — the diff view would freeze');
    assert.ok(w.left.length && w.right.length, 'it must still return something to render');
  });

  it('two long pages diff in reasonable time', () => {
    const A = Array.from({ length: 4000 }, (_, i) => b('b' + i, 'line ' + i));
    const B = A.map(x => Object.assign({}, x));
    B[2000] = b('b2000', 'changed');
    const t0 = Date.now();
    const st = ADiff.stats(A, B);
    const ms = Date.now() - t0;
    assert.ok(ms < 2000, 'ADiff.stats took ' + ms + 'ms');
    assert.ok(!st.none, 'and it must still find the change');
  });
});
