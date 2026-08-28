# Galley — Implementation Contract (read before coding)

We are building a **real, working single-window** markdown viewer web app that
recreates the `Galley Mockups.html` design **pixel-perfectly** and makes it
genuinely functional. Pure vanilla HTML/CSS/JS — **no build step, no framework**.
Opening `app/index.html` in a browser must "just work".

This contract is BINDING. Each module owns its own file(s). Talk to other modules
ONLY through the documented `window.TV` controller API and the agreed DOM classes
(already defined in `css/tv-app.css`). Do not edit files you don't own.

## Requirements this app must satisfy (traceable to DRs)
- DR-01 instant render · DR-02 tables/images/Mermaid · DR-03 **scroll position
  preserved per-tab across switches** · DR-05/DR-10 live watch without scrolljack ·
  DR-06 **open real .md files from disk, never write unrequested files** ·
  DR-07 chrome quiet at rest · DR-08 **double-click rendered content to edit** ·
  DR-09 10+ tabs, fast switch.

## File ownership
| File | Owner | Purpose |
|------|-------|---------|
| `index.html`, `js/tv-app.js` | **shell** | App spine: state, render loop, chrome, tabs, sidebar, keyboard router, theme/accent |
| `js/tv-edit.js` | **render** | Edit-mode source view + real editing back into the tab |
| `js/tv-markdown.js` | **render** | Markdown renderer (already copied — harden only) |
| `js/tv-palette.js` | **features** | ⌘K command palette (fuzzy file + heading jump) |
| `js/tv-search.js` | **features** | ⌘⇧F cross-tab search across open docs |
| `js/tv-files.js` | **features** | Drag-drop + ⌘O file open (File System Access API) |
| `js/tv-live.js` | **features** | Live-watch streaming + status bar |
| `css/tv-tokens.css`, `css/tv-app.css` | **style** | Tokens + chrome (copied — adapt to full-viewport single window, add new component styles, a11y) |

Shared (already created, do not edit): `js/tv-icons.js` (`window.TV_ICONS`),
`js/tv-docs.js` (`window.TV_SEED`, `window.TV_LIVE_DOC`, `window.TV_STREAM`).

## Global state — single source of truth (owned by shell, in tv-app.js)
```js
window.TV.state = {
  tabs: [ Tab ],          // ordered, left→right
  activeId: string|null,
  sidebarOpen: boolean,   // ⌘B
  mode: 'reading'|'edit',
  theme: 'light'|'dark',  // persisted to localStorage 'tv-theme'
  accent: 'blue'|'graphite'|'warm', // persisted 'tv-accent'
};
// Tab = {
//   id: string,            // unique, stable
//   name: string,          // 'schema.md'
//   path: string|null,     // display path for sidebar/palette, e.g. '/ai-projects'
//   source: string,        // raw markdown (mutable; edit + live watch update this)
//   scrollTop: number,     // DR-03 saved scroll offset of .tv-scroll
//   dirty: boolean,        // unsaved edits → tab shows ● dot
//   live: boolean,         // ⚡ live-watch indicator + status bar
//   fileHandle: object|null, // FileSystemFileHandle when opened from disk
// }
```

## `window.TV` controller API (shell implements; everyone else calls)
```js
TV.state                         // the object above
TV.render()                      // full repaint of current state into #tv-root; preserves scroll
                                 // for all THREE scrollers it destroys: the content pane
                                 // (DR-03), the sidebar list + capped folder bodies (JANK-01),
                                 // and the tab strip's horizontal offset (C-04). The strip may
                                 // move on exactly one occasion: activating a tab whose pill is
                                 // off screen. None of the three is persisted to disk (DR-06).
TV.batch(fn) -> fn's return      // JANK-02: coalesce renders. Any number of render() calls
                                 // inside fn produce ONE repaint, emitted synchronously
                                 // before batch() returns — so reading the DOM after
                                 // batch() is safe, reading it BETWEEN two render() calls
                                 // inside fn is not (it is still the pre-render DOM).
                                 // Nesting is counted. Wrap any multi-mutation sequence.
TV.openDoc({name, source, path?, fileHandle?, live?}) -> id   // add tab (dedupe by path/name) & activate
TV.activateTab(id)               // switch active tab (saves outgoing scrollTop, restores incoming)
TV.closeTab(id)
TV.getActiveTab() -> Tab|null
TV.setMode('reading'|'edit')     // edit toggle
TV.setTheme(t) / TV.setAccent(a) // re-skin (class swap on .tv root, persist)
TV.toggleSidebar()
TV.scrollToHeading(tabId, headingText)  // open tab + scroll its rendered heading into view
TV.markDirty(id, isDirty)
TV.on(event, fn)                 // tiny emitter; events: 'render', 'tabchange', 'modechange'
TV.emit(event, payload)
TV.el()                          // -> the live .tv root element (current theme/accent classes)
```
Overlays/panels register themselves and are invoked by shell's keyboard router:
```js
window.TVPalette = { open(), close(), isOpen() }   // builds its own overlay into TV.el()
window.TVSearch  = { open(), close(), isOpen() }
window.TVFiles   = { init(), openPicker() }        // init() wires drag-drop + exposes ⌘O
window.TVEdit    = { renderSource(tab) -> htmlString, wire(rootEl, tab), wordCount(src) -> n }
window.TVLive    = { start(tabId), stop(tabId), stopAll() }
```

## DOM contract (classes already styled in tv-app.css — reuse exactly)
- Root: `<div class="tv tv--{theme} tv--accent-{accent}">` inside `#tv-root`.
- Chrome: `.tv-titlebar`(.tv-traffic .tv-light c|m|x, .tv-wintitle) · `.tv-tabbar`
  (.tv-tab[.active] > .tv-bolt|.tv-dot, .name, .tv-close ; .tv-newtab) ·
  `.tv-body` > `.tv-sidebar[.collapsed]` + `.tv-viewer`.
- Sidebar: `.tv-side-scroll`(.tv-tree-row.folder/.file[.active] .ic .mini-bolt),
  `.tv-side-divider`, `.tv-side-label`, `.tv-search`>.tv-search-box.
- Content: `.tv-viewer` > `.tv-scroll` > `.tv-content` > `.md` (rendered) — the
  scroll container is `.tv-scroll` (read/write `scrollTop` here for DR-03).
- Palette: `.tv-palette-scrim`>`.tv-palette`(.tv-pal-input, .tv-pal-list >
  .tv-pal-group/.tv-pal-row[.sel] .ic .hl .sub, .tv-pal-divider, .tv-pal-foot).
- Search: `.tv-searchbar`(.field, .scope) + `.tv-search-results`
  (.tv-sr-count, .tv-sr-file>.tv-sr-filehead .cnt, .tv-sr-row[.sel] .ln .snip mark).
- Edit: `.tv-edit-toolbar`(.tv-edit-btn[.primary] .kbd, .tv-edit-meta) +
  `.tv-source`(.tv-srcline[.cursor-line] .tv-gutter .tv-srctext .tv-srccaret).
- Live: `.tv-status`(.live-pill .blip, .sep, [data-elapsed], .spacer, .tv-pin[.on]),
  `.tv-writing-line`[data-stream] > .streamed + .tv-caret.
- Empty: `.tv-empty`>.tv-dropzone(.dz-ic .dz-title .dz-or .dz-cmd) + .tv-empty-hint.

## Rendering
`window.tvRenderMarkdown(src) -> htmlString` and `window.tvResolveDiagrams(rootEl, delay)`
already exist (tv-markdown.js). After injecting `.md` HTML, call `tvResolveDiagrams`
to swap Mermaid placeholders for drawn flows.

## Hard rules
- No external network deps at runtime (icons are inline SVG; no React in the real app).
- `!important` on colour/background declarations is intentional (kept from design) — keep it.
- Respect `prefers-reduced-motion` for ⚡ pulse / blip / shimmer / caret (style owner).
- Never write to disk except via an explicit user Save action (DR-06).
- Keyboard: ⌘K palette · ⌘⇧F search · ⌘B sidebar · ⌘O open · ⌘E/dbl-click edit ·
  ⌘S save · ⌘W close tab · ⌘1–9 nth tab · Esc closes overlay/exits edit.
