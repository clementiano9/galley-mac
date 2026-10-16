/* ───────────────────────────────────────────────────────────
   Galley · path completion (UXF-10, Open Path ⌘L)
   window.TVPathFind = {
     isPathQuery(q), parse(q, env), resolve(parsed, lookup),
     matchKnown(parsed, paths), segScore(q, name), abbreviate(path, home),
     typed(path, home, style)
   }
   Pure functions: no DOM, no I/O. The palette owns the folder cache and
   passes `lookup(dir)` → { entries:[{name,dir}] } | null (not read yet) |
   { error }. A typed path is matched one folder at a time, each segment
   fuzzily, keeping the best few candidates per level (a beam), so
   `~/ai-proj/tiny/READ` reaches ~/ai-projects/tiny-viewer/README.md.
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var BEAM = 5;          // candidate folders kept per level
  var ROW_CAP = 60;      // rows returned

  function isPathQuery(q) {
    var s = String(q == null ? '' : q).trim();
    return s.charAt(0) === '/' || s.charAt(0) === '~' || s.indexOf('./') === 0 || s.indexOf('../') === 0;
  }

  function join(dir, name) { return dir === '/' ? '/' + name : dir + '/' + name; }
  function parent(dir) {
    var i = dir.lastIndexOf('/');
    return i <= 0 ? '/' : dir.slice(0, i);
  }

  // env = { home, cwd }. Returns { base, segs, last, style } or null.
  // style records how the user wrote the path, so completion keeps it.
  function parse(q, env) {
    var s = String(q == null ? '' : q).trim();
    if (!isPathQuery(s)) return null;
    env = env || {};
    var base, rest, style;
    if (s.charAt(0) === '~') {
      if (!env.home) return null;
      base = env.home; style = 'home';
      rest = s.length === 1 ? '/' : s.slice(1);
      if (rest.charAt(0) !== '/') return null;          // "~user" is not supported
    } else if (s.charAt(0) === '/') {
      base = '/'; style = 'abs'; rest = s;
    } else {
      if (!env.cwd) return null;
      base = env.cwd; style = 'rel'; rest = '/' + s;
    }
    var parts = rest.split('/');
    var last = parts.pop();
    var segs = parts.filter(function (p) { return p && p !== '.'; });
    if (last === '..') { segs.push('..'); last = ''; }
    return { base: base, segs: segs, last: last, style: style };
  }

  /* ── one segment against one name ────────────────────────
     Best first: exact · same letters, other case · prefix · word starts
     ("tv" → tiny-viewer, "proj" → ai-projects) · substring · ordered letters
     with small gaps · one or two typos against the name or its start. */
  function _words(s) {
    var out = [], re = /[A-Za-z0-9]+/g, m;
    while ((m = re.exec(s))) out.push({ w: m[0].toLowerCase(), i: m.index });
    return out;
  }
  function _range(a, n, out) { for (var i = 0; i < n; i++) out.push(a + i); return out; }

  // Optimal string alignment distance, stopped early above `max`.
  function _dist(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var prev2 = null, prev = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      var cur = [i], rowMin = i;
      for (j = 1; j <= b.length; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (prev2 && i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) {
          v = Math.min(v, prev2[j - 2] + 1);
        }
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      prev2 = prev; prev = cur;
    }
    return prev[b.length];
  }

  function segScore(q, name) {
    q = String(q); name = String(name);
    if (!q) return { score: 0, idx: [], exact: false };
    if (q === name) return { score: 1000, idx: _range(0, q.length, []), exact: true };
    var Q = q.toLowerCase(), N = name.toLowerCase();
    if (Q === N) return { score: 980, idx: _range(0, q.length, []), exact: false };
    if (N.indexOf(Q) === 0) return { score: 900 - Math.min(90, (N.length - Q.length) * 0.5), idx: _range(0, q.length, []), exact: false };

    var W = _words(name), i;
    // Every word of the query starts a word of the name, in order.
    var qw = Q.split(/[^a-z0-9]+/).filter(Boolean);
    if (qw.length) {
      var wi = 0, idx = [], ok = true;
      for (i = 0; i < qw.length && ok; i++) {
        while (wi < W.length && W[wi].w.indexOf(qw[i]) !== 0) wi++;
        if (wi >= W.length) ok = false; else { _range(W[wi].i, qw[i].length, idx); wi++; }
      }
      if (ok) return { score: 760 - W.length, idx: idx, exact: false };
    }
    // Initials: "tv" → tiny-viewer.
    var qn = Q.replace(/[^a-z0-9]/g, '');
    if (qn.length >= 2 && qn.length <= W.length) {
      var k = 0, ix = [];
      for (i = 0; i < W.length && k < qn.length; i++) {
        if (W[i].w.charAt(0) === qn.charAt(k)) { ix.push(W[i].i); k++; }
      }
      if (k === qn.length) return { score: 700, idx: ix, exact: false };
    }
    var p = N.indexOf(Q);
    if (Q.length >= 2 && p > 0) return { score: 560 - Math.min(60, p), idx: _range(p, Q.length, []), exact: false };

    // Ordered letters: first letter on the name's start or a word start, gaps ≤ 3 each.
    if (Q.length >= 3) {
      for (var s = 0; s < W.length; s++) {
        if (N.charAt(W[s].i) !== Q.charAt(0)) continue;
        var pos = W[s].i, sx = [pos], gaps = 0, fail = false;
        for (var j = 1; j < Q.length; j++) {
          var f = N.indexOf(Q.charAt(j), pos + 1);
          if (f < 0 || f - pos - 1 > 3) { fail = true; break; }
          gaps += f - pos - 1; sx.push(f); pos = f;
        }
        if (!fail) return { score: 400 - gaps * 10, idx: sx, exact: false };
      }
    }
    // Typos: against the whole name, or against its first |q| letters (the
    // user is still typing). One typo from 3 letters, two from 7.
    // The first letter, or the first two swapped, must agree: cheap, and a
    // typo in the very first letter is rare.
    var lead = Q.charAt(0) === N.charAt(0) || (Q.charAt(0) === N.charAt(1) && Q.charAt(1) === N.charAt(0));
    if (Q.length >= 3 && lead) {
      var max = Q.length >= 7 ? 2 : 1;
      var whole = _dist(Q, N, max);
      var d = Math.min(_dist(Q, N.slice(0, Q.length), max), _dist(Q, N.slice(0, Q.length + 1), max));
      if (Q.length - 1 <= N.length) d = Math.min(d, _dist(Q, N.slice(0, Q.length - 1), max));
      // A typo of the whole name beats a typo of the start of a longer one
      // (tiny-veiwer → tiny-viewer before tiny-viewer-old).
      if (whole <= max && whole <= d) return { score: 310 - whole * 60, idx: [], exact: false };
      if (d <= max) return { score: 300 - d * 60, idx: [], exact: false };
    }
    return null;
  }

  function _hidden(name, q) { return name.charAt(0) === '.' && String(q || '').charAt(0) !== '.'; }

  // → { rows:[{ path, name, dir, parent, score, idx }], pending:[dir], unreadable:[dir] }
  function resolve(parsed, lookup) {
    var out = { rows: [], pending: [], unreadable: [] };
    if (!parsed) return out;
    var seen = {};
    function read(dir) {
      var L = lookup(dir);
      if (L == null) { if (!seen['p' + dir]) { seen['p' + dir] = 1; out.pending.push(dir); } return null; }
      if (L.error) { if (!seen['u' + dir]) { seen['u' + dir] = 1; out.unreadable.push(dir); } return null; }
      return L.entries || [];
    }

    var cands = [{ dir: parsed.base, score: 0 }];
    for (var si = 0; si < parsed.segs.length && cands.length; si++) {
      var seg = parsed.segs[si], next = [];
      cands.forEach(function (c) {
        if (seg === '..') { next.push({ dir: parent(c.dir), score: c.score }); return; }
        var es = read(c.dir);
        if (!es) return;
        es.forEach(function (e) {
          if (!e.dir || _hidden(e.name, seg)) return;
          var m = segScore(seg, e.name);
          if (m) next.push({ dir: join(c.dir, e.name), score: c.score + m.score, seg: m.score });
        });
      });
      // A folder matched exactly (or by case only) wins outright: its fuzzy
      // neighbours are not carried into the next level.
      if (next.some(function (n) { return n.seg >= 980; })) next = next.filter(function (n) { return n.seg >= 980; });
      next.sort(function (a, b) { return b.score - a.score; });
      // A typo-level guess is not worth following when a far better folder matched.
      cands = next.filter(function (n) { return n.score >= next[0].score - 500; }).slice(0, BEAM);
    }

    var rows = [];
    cands.forEach(function (c, rank) {
      var es = read(c.dir);
      if (!es) return;
      es.forEach(function (e, order) {
        if (_hidden(e.name, parsed.last)) return;
        var m = parsed.last ? segScore(parsed.last, e.name) : { score: 0, idx: [] };
        if (!m) return;
        rows.push({ path: join(c.dir, e.name), name: e.name, dir: !!e.dir, parent: c.dir,
          score: c.score + m.score, idx: m.idx, _r: rank, _o: order });
      });
    });
    rows.sort(function (a, b) { return (b.score - a.score) || (a._r - b._r) || (a._o - b._o); });
    out.rows = rows.slice(0, ROW_CAP);
    return out;
  }

  /* ── fallback: known files (tabs, recents, open folders) ──
     The typed segments must match the path's segments in order; path
     segments may be skipped (−40 each), so `~/tiny/READ` still finds
     ~/ai-projects/tiny-viewer/README.md when that file is known. The last
     typed segment must match the file name. */
  function matchKnown(parsed, paths) {
    if (!parsed || !parsed.last) return [];
    var qsegs = parsed.segs.filter(function (s) { return s !== '..'; }).concat([parsed.last]);
    var baseDir = parsed.base === '/' ? '' : parsed.base;
    var out = [];
    (paths || []).forEach(function (p) {
      if (!p || (baseDir && p.indexOf(baseDir + '/') !== 0)) return;
      var ps = p.slice(baseDir.length).split('/').filter(Boolean);
      if (!ps.length) return;
      var name = ps[ps.length - 1];
      var lm = segScore(parsed.last, name);
      if (!lm) return;
      var score = lm.score, k = 0, skipped = 0;
      for (var i = 0; i < ps.length - 1 && k < qsegs.length - 1; i++) {
        var m = segScore(qsegs[k], ps[i]);
        if (m) { score += m.score; k++; } else skipped++;
      }
      if (k < qsegs.length - 1) return;
      skipped += ps.length - 1 - i;
      out.push({ path: p, name: name, dir: false, parent: parent(p), score: score - skipped * 40, idx: lm.idx });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, 20);
  }

  function abbreviate(path, home) {
    if (home && (path === home || path.indexOf(home + '/') === 0)) return '~' + path.slice(home.length);
    return path;
  }

  // The text to put back in the field for a completed path, in the user's style.
  function typed(path, home, style) {
    return style === 'abs' ? path : abbreviate(path, home);
  }

  window.TVPathFind = {
    isPathQuery: isPathQuery, parse: parse, resolve: resolve, matchKnown: matchKnown,
    segScore: segScore, abbreviate: abbreviate, typed: typed, _dist: _dist
  };
})();
