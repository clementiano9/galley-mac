# Galley — Implementation Contract (read before coding)

We are building a **real, working single-window** markdown viewer web app that
recreates the original Galley design **pixel-perfectly** and makes it
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
| `js/tv-tree.js` | **shell** | Pure folder-tree logic (order, counts, default expansion, reveal lookup) |
| `js/tv-swipe.js` | **shell** | UXF-05/09: two-finger swipe state machine + one `wheel` listener (`TVSwipe.install`); `TVSwipe.touch(m)` takes the native `swipe-touch` finger phases |
| `js/tv-motion.js` | **shell** | UXF-08: `TVMotion` — reads the motion tokens, `play()` / `enter()` (null under Reduce Motion), `cancelAll()` |
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
//   isNew: boolean,        // F-23: created by New File, never saved (no copy on disk)
//   suggestedDir: string|null, // F-23: where the Save panel opens for an isNew tab
// }
```

## `window.TV` controller API (shell implements; everyone else calls)
```js
TV.state                         // the object above
TV.render()                      // full repaint of current state into #tv-root; preserves scroll
                                 // for the scrollers it destroys: the content pane (DR-03), the
                                 // sidebar list (JANK-01; UXF-03 removed the capped folder
                                 // bodies), the tab strip's horizontal offset (C-04) and each
                                 // wide table's own box (UXF-01, DR-10). The strip may
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
TV.newFile() -> id               // F-23: in-memory blank "Untitled.md", opened in edit mode.
                                 // Writes NOTHING (DR-06): Save (⌘S) then opens the native
                                 // Save panel, even while empty. Bound to ⌘N / File ▸ New File.
TV.refreshFolderFor(filePath)    // F-23: re-scan the open folder containing filePath
TV.previewAppearance({theme?,accent?,fontSize?}) / TV.endAppearancePreview()   // F-24: paint a look WITHOUT persisting, notifying native or rendering; end = back to state
TV.appearanceState() / TV.openPath(absPath) / TV.loadRecentEntries()   // F-24: palette readers/openers
TV.getActiveTab() -> Tab|null
TV.setMode('reading'|'edit')     // edit toggle
TV.setTheme(t) / TV.setAccent(a) // re-skin (class swap on .tv root, persist)
TV.toggleSidebar({seedCursor?})  // UXF-05: pointer routes (button, swipe) pass seedCursor:false
TV.revealInSidebar(tabId?) -> Promise<bool>  // UXF-06: open sidebar, expand ancestors, centre +
                                 // ring the file row (⇧⌘J, palette, tab menu, View menu)
TV.refreshFolder(rootPath, {silent?}) -> Promise<bool>  // UXF-02: re-scan in place, keeps expansions
TV.collapseAllFolders()          // UXF-03: palette "Collapse All Folders"
TV.isSwipeEnabled() / TV.toggleSwipe()  // UXF-05: escape hatch, localStorage tv-swipe-sidebar = "0"
TV.tableSizingPasses() -> n      // UXF-01 diagnostic: table sizing passes run so far (observer settles)
// UXF-07: state.agentFolders (localStorage tv-agent-folders, "Always Show" names) and
// state.sessionVisibleFolders (folders Reveal showed) feed TVTree's folder display policy.
// UXF-08: toggleSidebar(opts) slides (220ms) unless opts.animate === false; every motion
// uses the tokens in tv-tokens.css and goes through TVMotion.
TV.scrollToHeading(tabId, headingText)  // open tab + scroll its rendered heading into view
TV.markDirty(id, isDirty)
TV.on(event, fn)                 // tiny emitter; events: 'render', 'tabchange', 'modechange'
TV.emit(event, payload)
TV.el()                          // -> the live .tv root element (current theme/accent classes)
```
Overlays/panels register themselves and are invoked by shell's keyboard router:
```js
window.TVPalette = { open({query?}), close(), isOpen(), openOutline() }   // builds its own overlay into TV.el(); ⌘⌥O = open({query:'#'})   (F-24)
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
- Sidebar: `aside#tv-sidebar.tv-sidebar` > `.tv-side-scroll` (the ONLY sidebar scroller,
  UXF-03) > `section.tv-folder-section[role=group]` per open root (sticky `.tv-folder-head`
  + `.tv-folder-body`), `.tv-tree-row.folder/.subfolder/.file[.active] .ic .tname
  .tv-tree-count .mini-bolt`, `.tv-tree-more` (per-folder "Show N more files" and
  `[data-tree-toggle-empty]`), `.tv-tree-row.tv-reveal` (UXF-06 ring), `.tv-side-divider`,
  `.tv-side-label`, `.tv-search`>.tv-search-box. The one show/hide button is
  `.tv-tabbar > .tv-side-toggle[data-sidebar-toggle][aria-expanded]` (UXF-05).
- Tables: `.md > .tbl-wrap > table` (top level). JS (`sizeTables`, UXF-01 policy v2) writes
  `--tv-tbl-w` on the wrapper and adds `.tbl-wide` (needs more than the pane: own scroll box)
  and `data-edge="start|mid|end"` (edge fade).
- Tree: `.tv-tree-row.is-extra` = a folder shown only because "Show N more folders" is on (UXF-07).
- Motion: `.tv-body.tv-animating` and `.tv-sidebar-ghost` exist only during the sidebar slide (UXF-08).
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
- Keyboard: ⌘K palette · ⌘⇧F search · ⌘B sidebar · ⇧⌘J reveal in sidebar · ⌘O open · ⌘N new file ·
  ⌘E/dbl-click edit · ⌘S save · ⌘W close tab · ⌘1–9 nth tab · Esc closes overlay/exits edit.
