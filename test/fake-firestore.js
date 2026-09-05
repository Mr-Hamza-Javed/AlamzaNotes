/* A Firestore that lives in a Map.
 *
 * lib/data/backend-firestore.js is the only file in the app that has to turn
 * the app's own paths into Firestore's alternating collection/document form and
 * back, and to work around Firestore refusing an array inside an array. Both
 * are exactly the kind of thing that looks right and is not, and neither can be
 * checked by reading the code.
 *
 * So the SDK is faked rather than the backend. Every assertion below runs the
 * real backend file; what it writes lands in `docs`, keyed by the full
 * Firestore path, and a test can look at those keys directly. That is how
 * "dbrow/db1/row1 is stored at workspaces/u1/dbrow/db1/_/row1" becomes a fact
 * rather than a comment.
 *
 * It also enforces the one rule that matters: a nested array is REJECTED, the
 * way the real thing rejects it. Without that the encoding could quietly break
 * and every test would still pass.
 */
function makeFakeFirestore() {
  const docs = new Map();          // 'a/b/c/d' -> data object
  const watchers = [];
  let writes = 0, reads = 0;

  function nestedArray(v, inArray) {
    if (Array.isArray(v)) {
      if (inArray) return true;
      return v.some(x => nestedArray(x, true));
    }
    if (v && typeof v === 'object') return Object.keys(v).some(k => nestedArray(v[k], false));
    return false;
  }
  function guard(data) {
    if (nestedArray(data, false)) {
      throw new Error('Function setDoc() called with invalid data. Nested arrays are not supported');
    }
  }

  function childrenOf(colPath) {
    const head = colPath + '/';
    const out = [];
    for (const [p, d] of docs) {
      if (p.indexOf(head) !== 0) continue;
      const rest = p.slice(head.length);
      if (rest.indexOf('/') >= 0) continue;
      out.push({ id: rest, path: p, data: d });
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  function fire(path, type) {
    const cut = path.lastIndexOf('/');
    const col = path.slice(0, cut), id = path.slice(cut + 1);
    watchers.forEach(w => {
      if (w.col !== col) return;
      w.cb({ docChanges: () => [{ type, doc: snapOf(id, path) }] });
    });
  }
  function snapOf(id, path) {
    return { id, ref: { path }, exists: () => docs.has(path), data: () => docs.get(path) };
  }

  const m = {
    /* the SDK surface backend-firestore.js actually uses, and nothing else */
    getFirestore: (app, dbId) => ({ app, dbId: dbId || '(default)' }),
    doc: (db, ...segs) => {
      if (segs.length % 2 !== 0) throw new Error('doc() needs an even number of segments, got ' + segs.join('/'));
      return { path: segs.join('/'), __doc: true };
    },
    collection: (db, ...segs) => {
      if (segs.length % 2 !== 1) throw new Error('collection() needs an odd number of segments, got ' + segs.join('/'));
      return { path: segs.join('/'), __col: true };
    },
    getDoc: (ref) => { reads++; return Promise.resolve(snapOf(ref.path.split('/').pop(), ref.path)); },
    setDoc: (ref, data) => { guard(data); writes++; const had = docs.has(ref.path); docs.set(ref.path, data); fire(ref.path, had ? 'modified' : 'added'); return Promise.resolve(); },
    deleteDoc: (ref) => { writes++; const had = docs.has(ref.path); docs.delete(ref.path); if (had) fire(ref.path, 'removed'); return Promise.resolve(); },

    documentId: () => '__id__',
    orderBy: (f) => ({ k: 'orderBy', f }),
    startAfter: (v) => ({ k: 'startAfter', v }),
    limit: (n) => ({ k: 'limit', n }),
    query: (col, ...cons) => ({ col, cons, __q: true }),

    getDocs: (q) => {
      reads++;
      const col = q.__q ? q.col : q;
      let rows = childrenOf(col.path);
      (q.cons || []).forEach(c => {
        if (c.k === 'startAfter') rows = rows.filter(r => r.id > c.v);
        if (c.k === 'limit') rows = rows.slice(0, c.n);
      });
      const docsArr = rows.map(r => snapOf(r.id, r.path));
      return Promise.resolve({ docs: docsArr, forEach: (fn) => docsArr.forEach(fn) });
    },

    writeBatch: (db) => {
      const ops = [];
      return {
        set: (ref, data) => { guard(data); ops.push(['set', ref, data]); },
        delete: (ref) => { ops.push(['del', ref]); },
        commit: () => {
          if (ops.length > 500) return Promise.reject(new Error('Batch too large: ' + ops.length));
          ops.forEach(([kind, ref, data]) => {
            writes++;
            if (kind === 'set') { const had = docs.has(ref.path); docs.set(ref.path, data); fire(ref.path, had ? 'modified' : 'added'); }
            else { const had = docs.has(ref.path); docs.delete(ref.path); if (had) fire(ref.path, 'removed'); }
          });
          m.batches.push(ops.length);
          return Promise.resolve();
        }
      };
    },

    onSnapshot: (col, cb) => {
      const w = { col: col.path, cb };
      watchers.push(w);
      /* the real thing delivers everything already there as `added` first */
      const rows = childrenOf(col.path);
      Promise.resolve().then(() => {
        cb({ docChanges: () => rows.map(r => ({ type: 'added', doc: snapOf(r.id, r.path) })) });
      });
      return () => { const i = watchers.indexOf(w); if (i >= 0) watchers.splice(i, 1); };
    },

    /* test-side view */
    docs,
    batches: [],
    paths: () => Array.from(docs.keys()).sort(),
    counts: () => ({ reads, writes })
  };
  return m;
}

module.exports = { makeFakeFirestore };
