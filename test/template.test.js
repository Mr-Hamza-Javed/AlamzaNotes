/* The template is data-bound by name (support.js resolves `{{ foo }}` against
   the object renderVals() returns). A renamed or mistyped binding therefore
   fails silently — the node renders blank. This walks every binding in
   index.html and checks something actually produces it. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeApp } = require('./harness');
const { page, version, db, row, block } = require('./fixtures');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

/* the app shell lives in the trailing <script type="text/x-dc"> block */
function shellSource() {
  const m = HTML.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('could not find the app shell script block');
  return m[1];
}
function markup() {
  const m = HTML.match(/<x-dc>([\s\S]*)<\/x-dc>/);
  if (!m) throw new Error('could not find the <x-dc> markup');
  return m[1].replace(/<helmet>[\s\S]*?<\/helmet>/, '');
}

/* names bound by sc-for, which are scoped to their loop rather than to vals */
function loopLocals(src) {
  const set = new Set(['$index', 'true', 'false', 'null', 'undefined']);
  (src.match(/\bas="([^"]+)"/g) || []).forEach(a => set.add(a.slice(4, -1)));
  return set;
}
/* the head identifier of a bound expression, or null if it is a literal */
function head(expr) {
  let e = expr.trim().replace(/^!+/, '').trim();
  if (!e || /^["'`]/.test(e) || /^[-\d]/.test(e)) return null;
  const m = e.match(/^[A-Za-z_$][\w$]*/);
  return m ? m[0] : null;
}

/* a workspace rich enough that every branch of renderVals() has something */
function fullApp() {
  const app = makeApp({
    pages: {
      p1: page('p1', { versions: [version('v1', 1)], icon: '' }),
      p2: page('p2', { parentId: 'p1', blocks: [block('b_p2', 'child')] })
    },
    dbs: { d1: db('d1', [row('r1', 'Row one')]) },
    pageId: 'p1'
  });
  app.store._vmetaSeen.p1 = true;
  app.state.pages.p1.blocks = [
    block('b1', 'hello'),
    block('b2', 'toggle', { type: 'toggle', children: [block('b3', 'inside')] }),
    block('b4', '', { type: 'database', dbId: 'd1' }),
    block('b5', '', { type: 'subpage', pageId: 'p2' })
  ];
  return app;
}

describe('template', () => {
  it('the app shell parses', () => {
    new vm.Script(shellSource(), { filename: 'index.html <shell>' });
  });

  it('every binding in the markup is produced by renderVals()', () => {
    const src = markup();
    const locals = loopLocals(src);
    const app = fullApp();

    /* every screen the template can show, so no branch is left unbuilt */
    const screens = [
      {},
      { panel: 'versions' },
      { panel: 'comments', commentOn: 'b1' },
      { sheet: 'versions', isMobile: true },
      { sheet: 'more', isMobile: true },
      { modal: { kind: 'newVersion', msg: '' } },
      { modal: { kind: 'restore', vid: 'v1' } },
      { modal: { kind: 'confirm', act: 'deleteVersion', vid: 'v1' } },
      { modal: { kind: 'diff' }, diffA: 'v1', diffB: 'current' },
      { modal: { kind: 'share' } },
      { modal: { kind: 'emoji' } },
      { modal: { kind: 'search' } },
      { roVersion: 'v1' },
      { route: 'settings', setTab: 'versions' },
      { route: 'auth' },
      { menu: { kind: 'version', id: 'v1', x: 0, y: 0 } }
    ];
    const known = new Set();
    screens.forEach(patch => {
      const a = fullApp();
      Object.assign(a.state, patch);
      Object.keys(a.renderVals()).forEach(k => known.add(k));
    });

    const missing = new Map();
    const re = /\{\{([^}]*)\}\}/g;
    let m;
    while ((m = re.exec(src))) {
      const h = head(m[1]);
      if (!h || locals.has(h) || known.has(h)) continue;
      if (!missing.has(h)) missing.set(h, m[1].trim());
    }
    assert.eq(missing.size, 0,
      'bindings nothing produces: ' + [...missing.keys()].join(', '));
    void app;
  });

  it('every sc-if / sc-for opens and closes', () => {
    const src = markup();
    ['sc-if', 'sc-for'].forEach(tag => {
      const open = (src.match(new RegExp('<' + tag + '\\b', 'g')) || []).length;
      const close = (src.match(new RegExp('</' + tag + '>', 'g')) || []).length;
      assert.eq(open, close, tag + ': ' + open + ' opened, ' + close + ' closed');
    });
  });
});
