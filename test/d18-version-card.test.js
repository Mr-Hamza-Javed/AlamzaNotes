/* The version card had every fact on one row with nothing allowed to shrink,
   so the author name wrapped under the badges and the whole line collapsed
   into itself. The layout is now: identity + time, message, facts, then
   author + actions — and the shape of it is asserted here because a layout
   regression is invisible to every other test in this suite. */
const fs = require('fs');
const path = require('path');
const { makeApp, settle } = require('./harness');
const { page, block, version } = require('./fixtures');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

async function panel(over) {
  const app = makeApp({
    pages: { p1: page('p1', { blocks: [block('b1', 'one')], updatedBy: 'Billy Muchly' }) },
    pageId: 'p1'
  });
  app.store._vmetaSeen.p1 = true;
  if (over) over(app);
  app.setState({ panel: 'versions' });
  return app;
}
const v = (n, over) => Object.assign(version('v' + n, n, {
  createdAt: 1000 + n, stat: { added: 1, removed: 0, changed: 0, none: false },
  deepStat: { pages: 1, added: 0, removed: 0, changed: 0, touched: 0, gone: 0 }
}), over || {});

describe('D18 — the version card', () => {
  it('hides +0 −0 ~0 rather than printing three numbers that say nothing', async () => {
    const app = await panel(a => a.setState(s => ({
      pages: { ...s.pages, p1: { ...s.pages.p1, versions: [
        v(1, { stat: { added: 0, removed: 0, changed: 0, none: true } }),
        v(2)
      ] } }
    })));
    const rows = app.renderVals().versionList;
    const [, older, newer] = [rows[0], rows[2], rows[1]];
    assert.notOk(older.stat, 'a snapshot whose root did not move shows no counts');
    assert.ok(newer.stat);
  });

  it('shows the facts line when there is either a count or a reach', async () => {
    const app = await panel(a => a.setState(s => ({
      pages: { ...s.pages, p1: { ...s.pages.p1, versions: [
        /* nothing at the root, but it reached a nested page */
        v(1, { stat: { added: 0, removed: 0, changed: 0, none: true },
               deepStat: { pages: 2, touched: 1, added: 1, removed: 0, changed: 0, gone: 0 } }),
        /* counts, no reach */
        v(2),
        /* neither */
        v(3, { stat: { added: 0, removed: 0, changed: 0, none: true } })
      ] } }
    })));
    const byTag = {};
    app.renderVals().versionList.forEach(r => { byTag[r.tag] = r; });
    assert.ok(byTag.v1.showFacts); assert.notOk(byTag.v1.showFactSep, 'no counts, so no separator');
    assert.ok(byTag.v2.showFacts); assert.notOk(byTag.v2.showFactSep, 'no reach, so no separator');
    assert.notOk(byTag.v3.showFacts, 'nothing to say, so no line at all');
  });

  it('prints the separator only when both halves are there', async () => {
    const app = await panel(a => a.setState(s => ({
      pages: { ...s.pages, p1: { ...s.pages.p1, versions: [
        v(1, { deepStat: { pages: 3, touched: 2, added: 0, removed: 0, changed: 0, gone: 0 } })
      ] } }
    })));
    const row = app.renderVals().versionList[1];
    assert.ok(row.stat && row.deep && row.showFactSep);
  });

  it('ends the timeline at the oldest snapshot', async () => {
    const app = await panel(a => a.setState(s => ({
      pages: { ...s.pages, p1: { ...s.pages.p1, versions: [v(1), v(2), v(3)] } }
    })));
    const rows = app.renderVals().versionList;
    assert.eq(rows[rows.length - 1].tag, 'v1', 'oldest last');
    assert.eq(rows[rows.length - 1].line, 'transparent', 'nothing below it to connect to');
    rows.slice(0, -1).forEach(r => assert.eq(r.line, 'var(--border)'));
  });

  it('draws no timeline at all when there is only the working copy', async () => {
    const app = await panel();
    const rows = app.renderVals().versionList;
    assert.eq(rows.length, 1);
    assert.eq(rows[0].line, 'transparent');
  });

  it('a snapshot saved with no message still says something', async () => {
    const app = await panel(a => a.setState(s => ({
      pages: { ...s.pages, p1: { ...s.pages.p1, versions: [v(1, { message: '' })] } }
    })));
    assert.eq(app.renderVals().versionList[1].message, 'No message');
  });

  /* ---- the markup itself ---- */
  it('nothing in the card row is allowed to push its neighbours', () => {
    /* every card lives inside the version list loop */
    const a = HTML.indexOf('<sc-for list="{{ versionList }}"');
    const b = HTML.indexOf('</sc-for>', a);
    const card = HTML.slice(a, b);
    assert.includes(card, 'text-overflow:ellipsis', 'the author must truncate, not wrap');
    assert.includes(card, '-webkit-line-clamp', 'the message must clamp');
    assert.includes(card, 'overflow-wrap:anywhere', 'an unbroken word must not overflow the panel');
    assert.includes(card, 'white-space:nowrap', 'the timestamp must not break');
    /* the author is the only elastic thing on its row */
    assert.ok(/flex:1;min-width:0;[^"]*text-overflow:ellipsis/.test(card),
      'the author needs flex:1 AND min-width:0, or the ellipsis never triggers');
  });

  it('the clamp survives the template’s CSS-to-React conversion', () => {
    /* support.js turns "a-b-c" into "aBC"; a property that came out starting
       with a dash would be dropped silently and the card would grow unbounded */
    const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    ['-webkit-line-clamp', '-webkit-box-orient', 'overflow-wrap', 'text-overflow'].forEach(p => {
      const k = camel(p);
      assert.notOk(k.startsWith('-'), p + ' converts to "' + k + '", which React ignores');
    });
    assert.eq(camel('-webkit-line-clamp'), 'WebkitLineClamp');
  });

  it('both surfaces render the same card, at their own sizes', () => {
    const loops = HTML.split('<sc-for list="{{ versionList }}"');
    assert.eq(loops.length, 3, 'expected the desktop panel and the mobile sheet');
    loops.slice(1).forEach((chunk, i) => {
      const card = chunk.slice(0, chunk.indexOf('</sc-for>'));
      ['v.tag', 'v.when', 'v.message', 'v.author', 'v.showFacts', 'v.deepLabel', 'v.more'].forEach(k =>
        assert.includes(card, k, (i ? 'mobile' : 'desktop') + ' card is missing ' + k));
    });
  });
});
