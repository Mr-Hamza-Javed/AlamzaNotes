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
 * never matters.
 */
window.AlamzaParts = (function () {
  var queue = [], target = null;
  function apply(Part) {
    var proto = Part.prototype;
    Object.getOwnPropertyNames(proto).forEach(function (k) {
      if (k === 'constructor') return;
      /* descriptor copy, so getters stay getters */
      Object.defineProperty(target, k, Object.getOwnPropertyDescriptor(proto, k));
    });
  }
  return {
    register: function (Part) {
      if (!target) { queue.push(Part); return; }
      apply(Part);
      if (window.__alamza) window.__alamza.forceUpdate();
    },
    applyTo: function (proto) {
      target = proto;
      queue.forEach(apply);
      queue = [];
      return proto;
    }
  };
})();
