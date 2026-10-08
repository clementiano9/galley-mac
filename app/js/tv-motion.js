/* ───────────────────────────────────────────────────────────
   Galley · motion helpers  (UXF-08)
   window.TVMotion = { reduced(), dur(name), ease(name), play(), enter(),
                       cancelAll(group) }

   Every JS-driven animation goes through here so it reads the shared tokens
   (css/tv-tokens.css: --tv-dur-*, --tv-ease-*) and honours Reduce Motion in
   one place: play() returns null under prefers-reduced-motion, so callers
   never move anything then. Transform and opacity only (compositor).
   ─────────────────────────────────────────────────────────── */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TVMotion = api;
}(typeof window !== 'undefined' ? window : this, function (root) {
  'use strict';

  // Fallbacks match the tokens, for when the stylesheet is not readable.
  var DEFAULTS = {
    fast: 100, base: 160, slow: 220, exit: 120, highlight: 1200, 'fade-reduced': 80,
    'ease-enter': 'cubic-bezier(.2, .7, .2, 1)',
    'ease-exit': 'cubic-bezier(.4, 0, 1, 1)',
    'ease-move': 'cubic-bezier(.32, .72, 0, 1)'
  };
  var _groups = {};

  function reduced() {
    try {
      return !!(root && root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  function token(name) {
    try {
      var doc = root && root.document;
      var v = doc && root.getComputedStyle ? root.getComputedStyle(doc.documentElement).getPropertyValue('--tv-' + name) : '';
      return String(v || '').trim();
    } catch (e) { return ''; }
  }

  // Duration in ms of --tv-dur-<name> ('fast' | 'base' | 'slow' | 'exit' | 'highlight').
  function dur(name) {
    var v = token(name === 'fade-reduced' ? 'fade-reduced' : 'dur-' + name);
    var n = parseFloat(v);
    if (isNaN(n)) return DEFAULTS[name] || 0;
    return /ms$/.test(v) ? n : (/s$/.test(v) ? n * 1000 : n);
  }

  // Easing string of --tv-ease-<name> ('enter' | 'exit' | 'move').
  function ease(name) {
    return token('ease-' + name) || DEFAULTS['ease-' + name] || 'ease';
  }

  // Animate `el` through `keyframes`. opts: { dur: token name or ms, ease:
  // token name or CSS easing, fill, group }. Returns the Animation, or null
  // under Reduce Motion / without the Web Animations API.
  function play(el, keyframes, opts) {
    opts = opts || {};
    if (!el || typeof el.animate !== 'function' || reduced()) return null;
    var ms = typeof opts.dur === 'number' ? opts.dur : dur(opts.dur || 'fast');
    var easing = opts.ease && /^(enter|exit|move)$/.test(opts.ease) ? ease(opts.ease) : (opts.ease || ease('enter'));
    var anim = el.animate(keyframes, { duration: ms, easing: easing, fill: opts.fill || 'none' });
    if (opts.group) {
      var list = _groups[opts.group] = _groups[opts.group] || [];
      list.push(anim);
      var drop = function () {
        var i = list.indexOf(anim);
        if (i !== -1) list.splice(i, 1);
      };
      anim.addEventListener('finish', drop);
      anim.addEventListener('cancel', drop);
    }
    return anim;
  }

  // An element that appears: opacity 0 → 1 with an optional rise of `y` px.
  // Under Reduce Motion: nothing, or (opts.reducedFade) an opacity-only fade of
  // at most --tv-fade-reduced (80 ms) for overlays that would otherwise pop.
  function enter(el, opts) {
    opts = opts || {};
    if (!el || typeof el.animate !== 'function') return null;
    if (reduced()) {
      if (!opts.reducedFade) return null;
      return el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: Math.min(80, dur('fade-reduced')), easing: 'linear' });
    }
    var from = { opacity: typeof opts.from === 'number' ? opts.from : 0 };
    var to = { opacity: 1 };
    if (opts.y) { from.transform = 'translateY(' + opts.y + 'px)'; to.transform = 'none'; }
    return play(el, [from, to], { dur: opts.dur || 'fast', ease: 'enter', group: opts.group });
  }

  function cancelAll(group) {
    var list = (_groups[group] || []).slice();
    list.forEach(function (a) { try { a.cancel(); } catch (e) { /* already gone */ } });
    _groups[group] = [];
  }

  function finishAll(group) {
    var list = (_groups[group] || []).slice();
    list.forEach(function (a) { try { a.finish(); } catch (e) { /* already gone */ } });
  }

  return { reduced: reduced, dur: dur, ease: ease, play: play, enter: enter, cancelAll: cancelAll, finishAll: finishAll };
}));
