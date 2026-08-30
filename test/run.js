/* Alamza Notes — test runner.  `node test/run.js [name-filter]` */
const fs = require('fs');
const path = require('path');

const only = process.argv[2] || '';
const suites = [];
let current = null;

global.describe = (name, fn) => { current = { name, tests: [] }; suites.push(current); fn(); current = null; };
global.it = (name, fn) => { (current ? current.tests : []).push({ name, fn }); };

function fail(msg, extra) {
  const e = new Error(msg + (extra ? '\n      ' + extra : ''));
  e.assertion = true;
  throw e;
}
const show = (v) => { try { return JSON.stringify(v); } catch (e) { return String(v); } };

global.assert = {
  ok(v, msg) { if (!v) fail(msg || 'expected truthy, got ' + show(v)); },
  notOk(v, msg) { if (v) fail(msg || 'expected falsy, got ' + show(v)); },
  eq(a, b, msg) { if (a !== b) fail(msg || 'not equal', 'actual:   ' + show(a) + '\n      expected: ' + show(b)); },
  deep(a, b, msg) {
    if (JSON.stringify(a) !== JSON.stringify(b)) fail(msg || 'not deep-equal', 'actual:   ' + show(a) + '\n      expected: ' + show(b));
  },
  includes(hay, needle, msg) {
    if (String(hay).indexOf(needle) < 0) fail(msg || 'missing substring', 'actual: ' + show(hay) + '\n      wanted: ' + show(needle));
  },
  throws(fn, msg) { try { fn(); } catch (e) { return; } fail(msg || 'expected a throw'); }
};

/* An unhandled rejection is a finding, not a crash: a promise nobody awaited
   is exactly the shape of the push() bug. Collect them and fail at the end. */
const unhandled = [];
process.on('unhandledRejection', (e) => unhandled.push((e && e.message) || String(e)));

fs.readdirSync(__dirname).filter(f => /\.test\.js$/.test(f)).sort()
  .forEach(f => require(path.join(__dirname, f)));

(async () => {
  let pass = 0, failed = 0, skipped = 0;
  const problems = [];
  for (const s of suites) {
    const picked = s.tests.filter(t => !only || (s.name + ' ' + t.name).toLowerCase().includes(only.toLowerCase()));
    skipped += s.tests.length - picked.length;
    if (!picked.length) continue;
    console.log('\n\x1b[1m' + s.name + '\x1b[0m');
    for (const t of picked) {
      try {
        await t.fn();
        pass++;
        console.log('  \x1b[32m✓\x1b[0m ' + t.name);
      } catch (e) {
        failed++;
        console.log('  \x1b[31m✗\x1b[0m ' + t.name);
        console.log('    \x1b[31m' + (e.assertion ? e.message : (e && e.stack) || e) + '\x1b[0m');
        problems.push(s.name + ' › ' + t.name);
      }
    }
  }
  await new Promise(r => setTimeout(r, 20));   // let any stray rejection land
  if (unhandled.length) {
    failed += unhandled.length;
    console.log('\n\x1b[31mUnhandled promise rejections (' + unhandled.length + '):\x1b[0m');
    unhandled.forEach(m => { console.log('  \x1b[31m✗\x1b[0m ' + m); problems.push('unhandled rejection: ' + m); });
  }
  console.log('\n' + (failed ? '\x1b[31m' : '\x1b[32m') +
    pass + ' passed, ' + failed + ' failed' + (skipped ? ', ' + skipped + ' filtered out' : '') + '\x1b[0m');
  if (failed) console.log('\nFailing:\n  ' + problems.join('\n  '));
  /* The store arms a backoff timer after a failed write, by design — it must
     not be what decides when this process ends. */
  process.exit(failed ? 1 : 0);
})();
