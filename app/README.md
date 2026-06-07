# tiny-viewer (frontend)

This `app/` folder is the **UI layer** of tiny-viewer — pure vanilla HTML/CSS/JS,
no framework, no build step. It is the WebKit frontend for the **native macOS app**
(`../tauri-app/`, built with Tauri v2 — Rust shell + system WKWebView). The same
files also run standalone in a browser for quick iteration.

> **Platform:** the shipped product is a **native macOS .app** (Swift/Tauri class,
> *not* Electron, *not* a browser) — required by URD-02 / DR-04 (idle RAM < 80MB;
> measured **~34MB**), with FSEvents live-watch (DR-05/10) and NSOpenPanel file
> access (DR-06). See `../tauri-app/NATIVE-CONTRACT.md`.

## Run the native app (primary)

```bash
cd ../tauri-app
bun install            # first time only
bun run tauri dev      # live dev window
bun run tauri build    # produces src-tauri/target/release/bundle/macos/tiny-viewer.app
```

Requires the Rust toolchain (`rustup`) + Xcode. The bundled app launches at ~34MB.

## Run in a browser (dev fallback)

Served over HTTP (File System Access API + script loading don't work from `file://`):

```bash
cd app
python3 -m http.server 8777
# open http://localhost:8777/index.html
```

Native file open/save/watch route through Tauri when running in the app
(`window.TVNative`), and fall back to the browser File System Access API / download
when running in a plain browser.

## What works

| Feature | How | Requirement |
|--------|-----|-------------|
| Real markdown rendering | tables, fenced code w/ highlighting, blockquotes, task lists, images, Mermaid-style diagrams (async, non-blocking) | DR-01, DR-02 |
| Open real `.md` from disk | drag-drop, or `⌘O` (File System Access API, with `<input type=file>` fallback) | DR-06 |
| Save edits to disk | `⌘S` writes back via the file handle, or downloads — never writes unrequested files | DR-06 |
| Tabs | open / close (`⌘W`) / switch (click, `⌘1–9`) | DR-09 |
| **Scroll position preserved per-tab** | restored exactly on tab return | DR-03 |
| Command palette | `⌘K` — fuzzy jump to any file or heading across open tabs | URD-05 |
| Cross-tab search | `⌘⇧F` — live search across every open document with line snippets | URD-04 |
| Inline edit | **double-click** rendered content (or `⌘E`), live word count, `Esc`/`⌘S` to return | DR-08 |
| Live watch | streaming status bar + pin-scroll; watched files re-render on change without scrolljacking | DR-05, DR-10 |
| Sidebar | `⌘B` toggle; file tree + recent + search | DR-07 |
| Themes & accents | Light / Dark · Blue / Graphite / Warm (bottom-right pill, persisted) | brief |
| Accessibility | focus rings, `prefers-reduced-motion` honored, WCAG-AA token contrast | a11y |

## Keyboard

`⌘K` palette · `⌘⇧F` search · `⌘B` sidebar · `⌘O` open · `⌘S` save ·
`⌘E` / double-click edit · `⌘W` close tab · `⌘1–9` nth tab · `Esc` close/exit.

## Architecture

Single source of truth in `js/tv-app.js` (`window.TV`); feature modules are
self-contained and talk only through the `TV` API (see `CONTRACT.md`).

```
index.html              entry — loads everything, theme/accent pill
css/tv-tokens.css       semantic colour tokens (2 themes × 3 accents) + 8px grid
css/tv-app.css          window chrome + markdown typography + component styles
js/tv-icons.js          inline SVG icon set
js/tv-docs.js           seed documents + live-stream text
js/tv-markdown.js       markdown → HTML renderer + async diagram resolver
js/tv-app.js            app spine: state, render loop, chrome, tabs, keyboard
js/tv-edit.js           edit-mode source view + real editing
js/tv-palette.js        ⌘K command palette
js/tv-search.js         ⌘⇧F cross-tab search
js/tv-files.js          drag-drop + ⌘O open + save (File System Access API)
js/tv-live.js           live-watch streaming + status bar
sample-docs/            example .md files to open
```

Design fidelity is pixel-matched to the bundle in `../design-bundle/`.
