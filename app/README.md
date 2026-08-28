# app/ — the frontend

The entire Galley UI: pure vanilla HTML/CSS/JS, no framework, no build step, zero
runtime dependencies. It is the WebKit frontend for the native macOS shell in
[`../tauri-app/`](../tauri-app/), and the same files also run standalone in a browser.

For what Galley is, how to build and install it, and the test commands, see the
[root README](../README.md). This file covers the frontend's internals.

> **Everything in this folder ships.** `tauri.conf.json` sets
> `frontendDist: "../../app"`, so Tauri embeds this directory into the release binary.
> Only files the running app needs belong here — process artifacts (QA reports,
> UX-pipeline steps, feature-gap specs, the design bundle) live in
> [`../.claude/docs/`](../.claude/docs/).

## Run it in a browser

Must be served over HTTP — the File System Access API and script loading don't work
from `file://`:

```bash
cd app && python3 -m http.server 8777   # → http://localhost:8777/index.html
```

File open/save/watch route through Tauri when running inside the app
(`window.TVNative`), and fall back to the File System Access API / downloads in a
plain browser.

## Architecture

`js/tv-app.js` is the shell. It owns the single source of truth — `TV.state` (tabs,
`activeId`, mode, theme, accent) — and the only render loop, `TV.render()`. Every
other module is self-contained and talks **only** through the `window.TV` controller
API and the agreed DOM classes; nothing reaches across module boundaries. The binding
version of that rule is [`CONTRACT.md`](CONTRACT.md) — read it before editing.

Overlays (palette, search, files, edit, live) register a small `open()` / `close()` /
`isOpen()` interface on `window` and are invoked by the shell's keyboard router.

Scripts load in dependency order; see the `<script>` list in `index.html`.

```
index.html              entry — loads everything, theme/accent pill
css/tv-tokens.css       semantic colour tokens (2 themes × 3 accents) + 8px grid
css/tv-app.css          window chrome + markdown typography + component styles
css/tv-tauri.css        native-window-only chrome (traffic lights, titlebar inset)
css/tv-print.css        print / PDF export stylesheet
js/tv-icons.js          inline SVG icon set
js/tv-docs.js           seed documents + live-stream text
js/tv-markdown.js       markdown → HTML renderer + async diagram resolver
js/tv-imgfix.js         relative-image path resolution (native + browser modes)
js/tv-tree.js           sidebar folder-tree model (nesting, reveal, roots)
js/tv-edit.js           edit-mode source view + real editing
js/tv-palette.js        ⌘K command palette
js/tv-search.js         ⌘⇧F cross-tab search
js/tv-files.js          drag-drop + ⌘O open + save (File System Access API)
js/tv-live.js           live-watch streaming + status bar
js/tv-app.js            the spine: state, render loop, chrome, tabs, keyboard
js/tv-native.js         Tauri bridge (window.TVNative)
js/*.test.js            plain-Node test scripts — `node app/js/<name>.test.js`
js/vendor/              vendored mermaid.min.js (no network at runtime)
sample-docs/            example .md files to open
MERMAID-SPEC.md         diagram subset the renderer supports
```

## Invariants worth knowing

- **`TV.activateTab()`** saves the outgoing tab's `.tv-scroll` scrollTop and restores
  the incoming one (DR-03). The live-watch re-render path must capture and restore
  scrollTop too, or it scrolljacks (DR-10).
- **`index.html` has an inline `<style>` block that loads after `css/tv-app.css`** and
  silently wins specificity ties. If a `tv-app.css` change has no visible effect, grep
  `index.html` for an overriding rule — this caused ISS-002.
- **`!important` on color/background is intentional**, carried over from the design
  bundle to win the cascade. Don't strip it.
- **Under the Tauri CSP, inline `style="left/top"` HTML attributes are dropped.** Set
  positions via CSSOM (`el.style.left = ...`), not the attribute.

Design fidelity is pixel-matched to the bundle in
[`../.claude/docs/design-bundle/`](../.claude/docs/design-bundle/).
