/* Alamza Notes — part registry.
 *
 * The app is ONE class. Its methods live in lib/part-*.js so each area can be
 * read and edited on its own; this file is what puts them back together.
 *
 * A part is written as an anonymous class purely so the method syntax inside
 * it is IDENTICAL to the main class body — a part can be moved in or out with
 * a straight copy/paste, no commas to add, nothing to re-indent.
 *
 *   AlamzaParts.register(class {
 *     myMethod() { ... }        // `this` is the live app instance
 *   });
 *
 * index.dc.html calls AlamzaParts.applyTo(Component.prototype) once the class
 * exists. Parts that load later attach immediately and repaint, so load order
 * never matters — PROVIDED no two parts claim the same method name. When two
 * do, the winner is decided by load order and the loser vanishes without a
 * word, which is how a helper added to the database part quietly replaced the
 * editor's `editText` and stopped typing in a block working at all. There is
 * no cheap way to make that safe, so it is made LOUD: `claimed` remembers
 * which part took each name and the second claim says so.
 */
window.AlamzaParts = (function () {
  var queue = [], target = null, claimed = {}, seq = 0;
  function nameOf(Part) {
    return Part.__part || (Part.__part = 'part#' + (++seq));
  }
  function apply(Part) {
    var proto = Part.prototype;
    var who = nameOf(Part);
    Object.getOwnPropertyNames(proto).forEach(function (k) {
      if (k === 'constructor') return;
      if (claimed[k] && claimed[k] !== who && typeof console !== 'undefined' && console.warn) {
        console.warn('[AlamzaParts] "' + k + '" is defined twice — ' + claimed[k] +
          ' then ' + who + '. The later one wins and the earlier one is gone; rename one of them.');
      }
      claimed[k] = who;
      /* descriptor copy, so getters stay getters */
      Object.defineProperty(target, k, Object.getOwnPropertyDescriptor(proto, k));
    });
  }
  return {
    /* `label` is optional and only ever used in the warning above */
    register: function (Part, label) {
      if (label) Part.__part = label;
      if (!target) { queue.push(Part); return; }
      apply(Part);
      if (window.__alamza) window.__alamza.forceUpdate();
    },
    applyTo: function (proto) {
      target = proto;
      queue.forEach(apply);
      queue = [];
      return proto;
    },
    /* which part owns a method — the test suite asserts there are no clashes */
    owners: function () { return claimed; }
  };
})();
