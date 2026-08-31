/* B1 — "Show changes since last version" handed ADiff the version ROW's
   `blocks` field. That field is the deep payload object `{b,d,p}` in session
   and gone entirely after a reload, so the diff ran against a non-array and
   marked EVERY block on the page as new, every time. */
const { makeApp, settle } = require('./harness');
const { page, block, version } = require('./fixtures');

async function marked(over) {
  const app = makeApp({
    pages: {
      p1: page('p1', {
        blocks: [
          block('b1', 'untouched'),
          block('b2', 'also untouched'),
          block('t1', 'Section', { type: 'toggle', children: [block('c1', 'nested untouched')] })
        ]
      })
    },
    pageId: 'p1',
    prefs: { theme: 'light', showChanges: true }
  });
  app.store._vmetaSeen.p1 = true;
  app.createVersion('v1');
  await settle();
  if (over) over(app);
  return app;
}

describe('B1 — change markers in the gutter', () => {
  it('an unchanged page is not marked from end to end', async () => {
    const app = await marked();
    assert.deep(app.changedIds(), {}, 'every block was being flagged as new');
  });

  it('only the edited block is marked', async () => {
    const app = await marked(a => {
      a.state.pages.p1 = Object.assign({}, a.state.pages.p1, {
        blocks: [block('b1', 'untouched'), block('b2', 'REWRITTEN'),
                 block('t1', 'Section', { type: 'toggle', children: [block('c1', 'nested untouched')] })],
        updatedAt: 99
      });
    });
    assert.deep(app.changedIds(), { b2: 'edit' });
  });

  it('a block added inside a toggle is marked at the child', async () => {
    const app = await marked(a => {
      a.state.pages.p1 = Object.assign({}, a.state.pages.p1, {
        blocks: [block('b1', 'untouched'), block('b2', 'also untouched'),
                 block('t1', 'Section', { type: 'toggle', children: [block('c1', 'nested untouched'), block('c2', 'brand new')] })],
        updatedAt: 99
      });
    });
    assert.deep(app.changedIds(), { c2: 'new' }, 'the marker belongs on the child, not the toggle');
  });

  it('a baseline still loading marks nothing rather than everything', async () => {
    const app = await marked();
    const vid = app.state.pages.p1.versions[0].id;
    delete app._vb[vid];
    app.state.pages.p1 = Object.assign({}, app.state.pages.p1, { updatedAt: 100 });
    assert.deep(app.changedIds(), {},
      'an unloaded snapshot is UNKNOWN, and unknown must not read as "all new"');
  });

  it('the marks refresh when a new snapshot is taken', async () => {
    const app = await marked(a => {
      a.state.pages.p1 = Object.assign({}, a.state.pages.p1, {
        blocks: [block('b1', 'untouched'), block('b2', 'REWRITTEN'),
                 block('t1', 'Section', { type: 'toggle', children: [block('c1', 'nested untouched')] })],
        updatedAt: 99
      });
    });
    assert.deep(app.changedIds(), { b2: 'edit' });
    app.createVersion('v2');
    await settle();
    assert.deep(app.changedIds(), {}, 'the new snapshot is the new baseline');
  });

  it('the page renders no marks with the preference off', async () => {
    const app = await marked(a => a.setState(s => ({ prefs: Object.assign({}, s.prefs, { showChanges: false }) })));
    assert.deep(app.changedIds(), {});
  });
});
