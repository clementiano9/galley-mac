# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Galley is a **native macOS markdown viewer** for AI power users. The shipped
product is a Tauri v2 app (Rust shell + system WKWebView) — **not Electron, not a
browser**. Hard platform constraints drive the architecture: idle RAM < 80 MB
(measured ~34 MB), FSEvents live-watch, native NSOpenPanel file access. The UI is
**pure vanilla HTML/CSS/JS with no framework and no build step**.

## Two-tree layout (the big picture)

- **`app/`** — the entire UI. Source of truth. Vanilla files loaded directly by a
  `<script>`/`<link>` list in `index.html`; no bundler, no transpile. The same files
  run standalone in a browser for quick iteration.
- **`tauri-app/`** — the native shell. `src-tauri/tauri.conf.json` sets
  `frontendDist: "../../app"`, so the Rust app serves `app/` verbatim — there is **no
  copy step**. Editing `app/` changes the running native app on reload.
- **`design-bundle/`** — the pixel-perfect design reference the UI is matched against.

The frontend detects its host at runtime: under Tauri `window.__TAURI__` exists
(`withGlobalTauri: true`, no imports), so native file open/save/watch route through
Rust; in a plain browser it falls back to the File System Access API / downloads.

## Frontend architecture: the `window.TV` spine

`js/tv-app.js` (the "shell") owns the single source of truth — `TV.state` (tabs,
activeId, mode, theme, accent) — and the only render loop, `TV.render()`. **Every
other module is self-contained and talks ONLY through the `window.TV` controller API
and the agreed DOM classes.** Do not reach across module boundaries. The full contract
lives in `app/CONTRACT.md` (web) and `tauri-app/NATIVE-CONTRACT.md` (native) — **read
the relevant one before editing**; they are binding and define file ownership.

Module map (scripts load in this dependency order — see `index.html`):
`tv-icons` (inline SVG) → `tv-docs` (seed/stream content) → `tv-markdown` (md→HTML +
async diagram resolver) → `tv-imgfix` → `tv-edit` (double-click/⌘E source editing) →
`tv-palette` (⌘K) → `tv-search` (⌘⇧F) → `tv-files` (drag-drop + ⌘O + save) →
`tv-live` (live-watch + status bar) → `tv-app` (the spine) → `tv-native` (Tauri bridge).

Overlays (palette, search, files, edit, live) register a small interface
(`open()/close()/isOpen()`, etc.) on `window` and are invoked by the shell's keyboard
router. Key invariant: `TV.activateTab()` saves the outgoing tab's `.tv-scroll`
scrollTop and restores the incoming one (DR-03 per-tab scroll preservation); the
live-watch re-render path must capture/restore scrollTop too (DR-10 no scrolljack).

## Native bridge: `tv-native.js` ⇄ Rust

`window.TVNative` wraps `window.__TAURI__.invoke`. Rust commands registered in
`src-tauri/src/lib.rs` (`generate_handler!`): `pick_md_files`, `pick_folder`,
`read_md_file`, `read_dir_tree`, `save_md_file`, `save_md_file_as`,
`reveal_in_finder`, `print_page`, `watch_file`, `unwatch_file`. The watcher (notify
crate) emits a `file-changed` event `{ path, content }` back to JS; native drag-drop
arrives as Tauri's `tauri://drag-drop` window event. `lib.rs` also builds the native
macOS menu bar with appearance checkmarks. `tab.nativePath` (absolute fs path) is set
by the bridge AFTER `TV.openDoc()` returns — the shell's `openDoc` signature must not
change.

## Commands

```bash
# Run the native app (primary). cargo must be on PATH:
cd tauri-app && PATH="$HOME/.cargo/bin:$PATH" bun run tauri dev      # live dev window
cd tauri-app && PATH="$HOME/.cargo/bin:$PATH" bun run tauri build    # → src-tauri/target/release/bundle/macos/Galley.app

# Run in a browser (dev fallback — must be over HTTP, not file://):
cd app && python3 -m http.server 8777   # open http://localhost:8777/index.html

# Verify just the Rust side compiles:
cd tauri-app/src-tauri && cargo build
```

`cargo`/`rustc` live in `~/.cargo/bin` and are **not on the non-interactive shell's
PATH** — prepend `PATH="$HOME/.cargo/bin:$PATH"` or every `tauri` command fails with
`cargo metadata ... No such file or directory`.

## Tests

There is **no test framework and no package.json in `app/`** (the app has zero runtime
deps). Tests are self-contained plain-Node scripts that print PASS/FAIL and exit
non-zero on failure. Run one at a time:

```bash
node app/js/tv-edit.test.js                # edit-mode invariants
node app/js/tv-search.test.js              # ⌘F find-bar layout guards
node app/js/tv-round5.test.js              # cross-cutting regression suite
node app/js/tv-live.runtime.test.js        # live-watch — loads & EXECUTES tv-live.js
node app/js/tv-markdown.diagrams.test.js   # diagram render-cache (LRU) behavior
```

The `*.runtime.test.js` / `*.diagrams.test.js` harnesses are notable: they load the
real module via `vm` into a hand-rolled minimal DOM + a fake clock, so they catch
runtime bugs that substring-matching tests cannot. Mirror that pattern for behavioral
tests.

## Conventions & gotchas

- **Requirement IDs are the spec.** `DR-##` (design requirements), `URD-##` (user
  requirements), `U-##`/`F-##` (feature gaps), `ISS-###` (filed issues). Trace changes
  to an ID and cite it in commits — the contracts and tests are keyed to them.
- **DR-06 is sacred:** never write to disk except on an explicit user Save action.
- **`!important` on color/background is intentional** — kept from the design bundle to
  win the cascade. Don't strip it.
- **`index.html` has an inline `<style>` block that loads AFTER `css/tv-app.css`** and
  silently wins specificity ties. If a `tv-app.css` change has no visible effect, grep
  `index.html` for an overriding inline rule (this caused ISS-002).
- **WKWebView/CSP positioning:** inline `style="left/top"` HTML attributes are dropped
  under the Tauri CSP — set positions via CSSOM (`el.style.left = ...`), not the
  attribute.
- **WKWebView caches JS aggressively** in the dev build — a hard reload or app restart
  may be needed to see frontend edits.
- No external network deps at runtime (icons are inline SVG; `mermaid.min.js` is
  vendored in `app/js/vendor/`). Respect `prefers-reduced-motion` for all animation.
