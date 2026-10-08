/* ───────────────────────────────────────────────────────────
   CSS polish-pass regression tests  (run with: node app/js/tv-css-polish.test.js)

   Plain source-string/regex guards over app/css/*.css and index.html's
   inline <style> — mirrors the CSS_SRC pattern already used by
   tv-sidebar-hierarchy.test.js. These are the items owned by the
   css-polish engineer in the Galley production-polish pass (see
   plan/WORK-css-polish.md and review/review-data.json, cluster ids below).
   Each block guards one cluster's easily-assertable, hard-to-eyeball-regress
   invariant — not a full behavioural test (there is no visual assertion
   here; that is covered by the before/after screenshots in
   shots/impl-css-polish/).
   ─────────────────────────────────────────────────────────── */
'use strict';

var fs = require('fs');
var path = require('path');

var pass = 0;
var fail = 0;
function assert(label, condition, detail) {
  if (condition) {
    console.log('  PASS  ' + label);
    pass++;
  } else {
    console.error('  FAIL  ' + label + (detail ? ' — ' + detail : ''));
    fail++;
  }
}

var APP_CSS = fs.readFileSync(path.join(__dirname, '..', 'css', 'tv-app.css'), 'utf8');
var TOKENS_CSS = fs.readFileSync(path.join(__dirname, '..', 'css', 'tv-tokens.css'), 'utf8');
var TAURI_CSS = fs.readFileSync(path.join(__dirname, '..', 'css', 'tv-tauri.css'), 'utf8');
var PRINT_CSS = fs.readFileSync(path.join(__dirname, '..', 'css', 'tv-print.css'), 'utf8');
var INDEX_HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
// Comment-stripped view, for guards that must not false-positive on a code
// comment documenting an OLD value (e.g. "was #c0453a, now var(--tv-danger)").
var APP_CSS_NO_COMMENTS = APP_CSS.replace(/\/\*[\s\S]*?\*\//g, '');

console.log('\nC-04 — connected active tab + symmetric strip fades\n');
// P2-1: the old margin-bottom:-1px/padding-bottom:1px bleed on .tv-tab.active
// measured out to the right pixel but .tv-tab-strip's overflow-y:hidden
// clipped it a pixel short of .tv-tabbar's border, so it never actually
// rendered (confirmed live: the active tab kept a visible bottom edge).
// Fixed by giving the strip itself the extra pixel of clip room instead —
// every tab then naturally reaches .tv-tabbar's outer edge via
// align-items:stretch, and only the active tab's opaque background paints
// over that row.
assert('the strip gives overflow-y:hidden one extra pixel of clip room, '
     + 'past .tv-tabbar\'s own border, so a stretched active tab can paint over it',
  /\.tv-tab-strip\s*\{[^}]*height:\s*calc\(100% \+ 1px\)/.test(APP_CSS));
assert('active tab has no bottom edge (merges into content) — no leftover '
     + 'dead bleed hack that overflow-y:hidden always clipped',
  !/\.tv-tab\.active\s*\{[^}]*margin-bottom:\s*-1px/.test(APP_CSS));
assert('active tab rises above the strip fade',
  /\.tv-tab\.active\s*\{[^}]*z-index:\s*2/.test(APP_CSS));
assert('left fade mirrors the right fade, gated on data-scrolled',
  /\.tv-tab-strip\[data-scrolled="1"\]::before\s*\{\s*opacity:\s*1/.test(APP_CSS));
assert('right fade hides at data-scroll-end',
  /\.tv-tab-strip\[data-scroll-end="1"\]::after\s*\{\s*opacity:\s*0/.test(APP_CSS));

console.log('\nC-10 — palette/find/search focus ring geometry + list fade\n');
assert('borderless fields kill the global outline on focus',
  /\.tv-pal-input-field:focus-visible,\s*\n\s*\.tv-find-input:focus-visible/.test(APP_CSS));
// C-10 (round 3): the ring is GONE, at the user's explicit direction on the
// verification pass ("remove the focus outline entirely, i dont like it").
// The assertion is inverted rather than deleted, so a future pass that
// reinstates a ring here fails loudly instead of silently undoing the call.
assert('palette input container draws NO focus ring',
  /\.tv-pal-input:focus-within\s*\{\s*\n\s*box-shadow:\s*none/.test(APP_CSS) &&
  !/\.tv-pal-input:focus-within\s*\{\s*\n\s*box-shadow:\s*inset/.test(APP_CSS));
assert('overflowing palette list gets a bottom mask fade',
  /\.tv-pal-list\.is-overflowing\s*\{[\s\S]*?mask-image:\s*linear-gradient/.test(APP_CSS));
assert('palette scrollbar thumb is not hover-gated any more',
  !/\.tv-pal-list:hover,\s*\n\.tv-pal-list:focus-within \{/.test(APP_CSS));

console.log('\nC-13 — \u2318F current match actually looks different\n');
assert('current-match selector matches what the JS actually emits',
  /\.md mark\[data-find\]\.current\s*\{[^}]*background:\s*var\(--tv-accent\)\s*!important/.test(APP_CSS));
assert('current-match ink uses the shared on-accent token',
  /\.md mark\[data-find\]\.current\s*\{[\s\S]*?color:\s*var\(--tv-on-accent\)\s*!important/.test(APP_CSS));
assert('the dead mark.tv-find-hit/tv-find-current selectors are gone',
  !/mark\.tv-find-hit/.test(APP_CSS) && !/mark\.tv-find-current/.test(APP_CSS));
assert('index.html no longer ships a duplicate find-mark block',
  !/\.md mark\[data-find\]\s*\{/.test(INDEX_HTML));
assert('--tv-on-accent is defined once, theme-invariant',
  /--tv-on-accent:\s*#1d1d1f/.test(TOKENS_CSS));

console.log('\nC-20 / C-22 — heading ramp, em-based type scale\n');
assert('h1 is expressed in em of --tv-md-font',
  /\.md h1\s*\{\s*font-size:\s*1\.75em/.test(APP_CSS));
assert('h2 restored to 650 (was 700)',
  /\.md h2\s*\{\s*font-size:\s*1\.375em;\s*font-weight:\s*650/.test(APP_CSS));
assert('strong restored to 650 (was 700)',
  /\.md strong\s*\{\s*font-weight:\s*650/.test(APP_CSS));
assert('h3 uses 1.4 line-height, not the 1.72 body leading',
  /\.md h3\s*\{[^}]*line-height:\s*1\.4/.test(APP_CSS));
assert('h5 descends below h4 (secondary colour, not primary)',
  /\.md h5\s*\{[^}]*\n[^}]*color:\s*var\(--tv-text-secondary\)/.test(APP_CSS));
assert('h6 is uppercase and muted',
  /\.md h6\s*\{[^}]*text-transform:\s*uppercase[^}]*\n[^}]*color:\s*var\(--tv-text-muted\)/.test(APP_CSS));
assert('the dead .tv--zoom-sm/md/lg classes are gone as selectors',
  !/\.tv--zoom-sm \.md/.test(APP_CSS) && !/\.tv--zoom-lg \.md/.test(APP_CSS));
assert('--tv-edit-font drives both the textarea and its highlight mirror',
  /\.tv-edit-area\s*\{[^}]*font-size:\s*var\(--tv-edit-font/.test(APP_CSS) &&
  /\.tv-edit-mirror\s*\{[\s\S]{0,400}?font-size:\s*var\(--tv-edit-font/.test(APP_CSS));

console.log('\nC-21 — images render at natural size, not stretched to the column\n');
assert('block images are auto-width, capped by max-width, not width:100%',
  /\.md \.md-img > img\s*\{\s*\n\s*display:\s*block;\s*width:\s*auto;\s*max-width:\s*100%/.test(APP_CSS));

console.log('\nC-23 — links get a real underline cue, not hue alone\n');
assert('border-bottom fallback stays for engines without color-mix()',
  /\.md a {2}\{ color: var\(--tv-accent-text\) !important; text-decoration: none; border-bottom: 1px solid var\(--tv-accent-weak\); \}/.test(APP_CSS));
assert('@supports swaps in a real underline where color-mix() is available',
  /@supports \(text-decoration-color: color-mix\(in srgb, red 45%, transparent\)\) \{\s*\n\s*\.md a \{\s*\n\s*border-bottom:\s*0;\s*\n\s*text-decoration:\s*underline;/.test(APP_CSS));
assert('table/code/blockquote tokens are untouched (out of scope)',
  /\.md th \{/.test(APP_CSS) && /\.md blockquote \{/.test(APP_CSS));

console.log('\nC-24 — diagram cards: no reflow, centred SVG, chrome on demand\n');
assert('loading and resolved states share one padding (no reflow on resolve)',
  /\.tv-diagram\s*\{[^}]*padding:\s*var\(--tv-s6\) var\(--tv-s4\) var\(--tv-s4\);\s*position:\s*relative;\s*min-height:\s*132px/.test(APP_CSS));
assert('resolved diagrams no longer reset min-height to auto',
  !/min-height:\s*auto;\s*\n\s*\/\* UX-26-overlap/.test(APP_CSS));
assert('the SVG is centred inside the viewport',
  /\.tv-diagram-viewport > svg\s*\{[^}]*margin:\s*0 auto/.test(APP_CSS));
assert('zoom badge is invisible at rest',
  /\.tv-zoom-ctrl\s*\{[^}]*opacity:\s*0;/.test(APP_CSS));
assert('zoom badge reveals on hover/focus-within/non-1x zoom',
  /\.tv-diagram:hover \.tv-zoom-ctrl,\s*\n\s*\.tv-diagram:focus-within \.tv-zoom-ctrl,\s*\n\s*\.tv-diagram\[data-zoom\]:not\(\[data-zoom="1"\]\) \.tv-zoom-ctrl/.test(APP_CSS));

console.log('\nC-28 — sidebar rows share one 30px rhythm\n');
assert('folder head is 30px via min-height only',
  /\.tv-folder-head\s*\{[^}]*min-height:\s*30px/.test(APP_CSS));
assert('subfolder/file rows are 30px via min-height only',
  /\.tv-tree-row\.subfolder,\s*\n\.tv-tree-row\.file\s*\{[^}]*min-height:\s*30px/.test(APP_CSS));
assert('the 14px rail step is untouched',
  /repeating-linear-gradient\(\s*\n\s*to right,\s*\n\s*transparent 0 13px,\s*\n\s*var\(--tv-border\) 13px 14px/.test(APP_CSS));
assert('selection still uses background-color, never the shorthand (JANK guard)',
  /\.tv-tree-row\.active \{\s*\n\s*background-color:/.test(APP_CSS));

console.log('\nC-32 — a11y: hit targets, keycap contrast, one focus-ring token, motion, .tv-copy\n');
assert('tab close button is 24px (was 20px)',
  /\.tv-tab \.tv-close\s*\{\s*\n\s*width:\s*24px;\s*height:\s*24px/.test(APP_CSS));
// UXF-05: the .tv-side-collapse button is gone (one tab-bar toggle remains).
assert('find nav buttons are 24px (was 22px)',
  /\.tv-find-nav\s*\{[^}]*min-width:\s*24px;\s*min-height:\s*24px/.test(APP_CSS));
assert('sidebar row close is 24px (was 20px)',
  /\.tv-sb-close\s*\{[^}]*\n[\s\S]{0,200}?width:\s*24px/.test(APP_CSS));
assert('folder close is 24px and no longer permanently visible',
  /\.folder-x\s*\{\s*\n\s*width:\s*24px;\s*height:\s*24px[^}]*opacity:\s*0;/.test(APP_CSS));
assert('keycaps use text-secondary, not text-muted',
  /\.tv-kbd, \.kbd \{[^}]*color:\s*var\(--tv-text-secondary\)/.test(APP_CSS));
assert('--tv-focus-ring / --tv-focus-offset tokens exist',
  /--tv-focus-ring:\s*2px solid var\(--tv-accent\)/.test(TOKENS_CSS) &&
  /--tv-focus-offset:\s*2px/.test(TOKENS_CSS));
assert('the global focus-visible rule draws from the token, not a literal',
  /\[tabindex\]:focus-visible \{\s*\n\s*outline:\s*var\(--tv-focus-ring\);\s*\n\s*outline-offset:\s*var\(--tv-focus-offset\)/.test(APP_CSS));
assert('kbd-cursor keeps its own inset offset (deliberate exception)',
  /\.tv-folder-head\.kbd-cursor \{[\s\S]*?outline:\s*var\(--tv-focus-ring\);\s*\n\s*outline-offset:\s*-2px/.test(APP_CSS));
assert('no stray "2px solid var(--tv-accent)" literal survives the unification',
  !/outline:\s*2px solid var\(--tv-accent\)/.test(APP_CSS));
assert('a blanket reduced-motion rule covers every .tv element',
  /@media \(prefers-reduced-motion: reduce\) \{\s*\n\s*\.tv \*, \.tv \*::before, \.tv \*::after \{\s*\n\s*transition-duration:\s*\.01ms !important;\s*\n\s*animation-duration:\s*\.01ms !important;\s*\n\s*animation-iteration-count:\s*1 !important;\s*\n\s*scroll-behavior:\s*auto !important/.test(APP_CSS));
assert('the large-file banner auto-dismiss is still explicitly disabled (deliberate exception)',
  /\.tv-large-banner \{ animation:\s*none !important; \}/.test(APP_CSS));
assert('.tv-copy is no longer display:none at rest (was unreachable by keyboard)',
  /\.tv-copy \{\s*\n\s*position:\s*absolute;\s*top:\s*8px;\s*right:\s*8px;\s*\n\s*display:\s*inline-flex;/.test(APP_CSS));
assert('.tv-copy reveals on its own keyboard focus, not just pre:hover',
  /\.md pre:hover \.tv-copy,\s*\n\.md pre:focus-within \.tv-copy,\s*\n\.tv-copy:focus-visible \{/.test(APP_CSS));

console.log('\nC-37 — token hygiene\n');
assert('--tv-warn / --tv-warn-weak / --tv-warn-text / --tv-danger / --tv-danger-weak exist in both themes',
  (TOKENS_CSS.match(/--tv-warn-text:/g) || []).length === 2 &&
  (TOKENS_CSS.match(/--tv-danger:/g) || []).length === 2);
assert('no raw warn/danger hex literals remain in a live tv-app.css declaration',
  !/#d9920c|#e8b04a|#8a5d00|#fdf3dc|#f0d79a|#e8c884|#2e2614|#4a3c1c|#c0453a/.test(APP_CSS_NO_COMMENTS));
assert('--tv-radius-win is gone (was unused)',
  !/--tv-radius-win/.test(TOKENS_CSS));
assert('the invalid aria-hidden CSS declaration is gone from .tv-edit-mirror',
  !/aria-hidden:\s*true;/.test(APP_CSS));
assert('index.html no longer ships a duplicate .tv-titlebtn/.tv-theme-toggle block',
  !/\.tv-titlebtn \{\s*\n\s*background:\s*none;/.test(INDEX_HTML));
assert('tv-app.css documents the 40px tab bar as superseding the Visual Spec\'s 38px',
  /--tv-tabbar-h:\s*40px/.test(TOKENS_CSS) && /superseded/.test(TOKENS_CSS));

console.log('\nC-38 — Tauri title bar: absolute centring\n');
assert('the title is absolutely centred under html.tauri',
  /html\.tauri \.tv-wintitle \{\s*\n\s*position:\s*absolute;\s*\n\s*left:\s*50%; top:\s*50%;\s*\n\s*transform:\s*translate\(-50%, -50%\)/.test(TAURI_CSS));
assert('the titlebar is the positioning context',
  /html\.tauri \.tv-titlebar \{[^}]*position:\s*relative/.test(TAURI_CSS));
assert('the old margin-right:84px counterweight (L-14) is gone',
  !/margin-right:\s*84px;\s*\n\}/.test(TAURI_CSS));
assert('the drag-region attribute selector still targets the titlebar',
  /data-tauri-drag-region/.test(TAURI_CSS));

console.log('\nC-39 — error tab recovery button never goes neutral on hover\n');
assert('hover swaps to a solid accent fill, never a neutral surface',
  /\.tv-error-btn:hover \{\s*\n\s*background:\s*var\(--tv-accent\)\s*!important;\s*\n\s*color:\s*var\(--tv-on-accent\)\s*!important/.test(APP_CSS));

console.log('\nC-40 — print: page margins + forced colour-adjust\n');
assert('@page sets 18mm/16mm margins',
  /@page\s*\{\s*\n\s*margin:\s*18mm 16mm;/.test(PRINT_CSS));
assert('colour-adjust is forced on the ink-bearing surfaces',
  /-webkit-print-color-adjust:\s*exact;\s*\n\s*print-color-adjust:\s*exact;/.test(PRINT_CSS));
assert('DR-104 full-width layout is untouched',
  /\.tv,\s*\n\s*\.tv-body \{\s*\n\s*display:\s*block !important;\s*\n\s*width:\s*100% !important;/.test(PRINT_CSS));

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILURES') + ': ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail === 0 ? 0 : 1);
