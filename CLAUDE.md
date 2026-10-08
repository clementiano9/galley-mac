# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Galley is a **native macOS markdown viewer** for AI power users. The shipped
product is a Tauri v2 app (Rust shell + system WKWebView) — **not Electron, not a
browser**. Hard platform constraints drive the architecture: idle RAM < 80 MB
(measured ~34 MB), FSEvents live-watch, native NSOpenPanel file access. The UI is
**pure vanilla HTML/CSS/JS with no framework and no build step**.

## Two-tree layout (the big picture)

The repo root holds exactly two code trees. They are not duplicates — one is the UI,
the other is the macOS shell that hosts it, and neither contains any of the other's
files.

- **`app/`** — the entire UI, and the source of truth for it. Vanilla files loaded
  directly by a `<script>`/`<link>` list in `index.html`; no bundler, no transpile.
  The same files run standalone in a browser for quick iteration.
- **`tauri-app/`** — the native shell, and **no UI code at all**. `src-tauri/src/lib.rs`
  is the Rust side (commands, FSEvents watcher, menu bar); `src-tauri/tauri.conf.json`
  sets `frontendDist: "../../app"`, so the Rust app serves `app/` verbatim — there is
  **no copy step**. Editing `app/` changes the running native app on reload.

**`frontendDist` has a sharp edge:** every file under `app/` is embedded into the
shipped binary. Only things the running app needs belong there. Process artifacts —
UX-pipeline steps, QA reports, feature-gap specs, screenshots — live in
**`.claude/docs/`** instead; see `.claude/docs/README.md` for the map. The
root is otherwise just `README.md` (product overview, build/install, dev + test
commands) and `CLAUDE.md`. README images go in `.github/media/`, never in `app/`.

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
`tv-live` (live-watch + status bar) → `tv-tree` (sidebar folder tree) → `tv-swipe`
(two-finger swipe toggles the sidebar) → `tv-motion` (motion tokens + Reduce Motion) →
`tv-app` (the spine) → `tv-native` (Tauri bridge).

Overlays (palette, search, files, edit, live) register a small interface
(`open()/close()/isOpen()`, etc.) on `window` and are invoked by the shell's keyboard
router. Key invariant: `TV.activateTab()` saves the outgoing tab's `.tv-scroll`
scrollTop and restores the incoming one (DR-03 per-tab scroll preservation); the
live-watch re-render path must capture/restore scrollTop too (DR-10 no scrolljack).

## Native bridge: `tv-native.js` ⇄ Rust

`window.TVNative` wraps `window.__TAURI__.invoke`. The commands registered in
`src-tauri/src/lib.rs` (`generate_handler!`) are tabulated in `NATIVE-CONTRACT.md` —
add new ones there too. They cover file/folder pick, read/save/save-as, `read_dir_tree`,
`watch_file`/`unwatch_file`, reveal/print, the quit guard (`confirm_close`,
`confirm_quit_dialog`), files opened before the frontend was ready
(`take_pending_opens`), and menu state (`set_appearance_check`, `set_recent_files`).
The watcher (notify crate) emits a `file-changed` event `{ path, content }` back to JS;
native drag-drop arrives as Tauri's `tauri://drag-drop` window event. `lib.rs` also
builds the native macOS menu bar (appearance checkmarks, Open Recent). Quit is
guarded: the frontend must call `confirm_close` after resolving dirty tabs, or the app
will not exit. `tab.nativePath` (absolute fs path) is set
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
non-zero on failure. Run one at a time, or all of them with the loop:

```bash
node app/js/tv-edit.test.js                # edit-mode invariants
node app/js/tv-search.test.js              # ⌘F find-bar layout guards
node app/js/tv-round5.test.js              # cross-cutting regression suite
node app/js/tv-live.runtime.test.js        # live-watch — loads & EXECUTES tv-live.js
node app/js/tv-markdown.diagrams.test.js   # diagram render-cache (LRU) behavior

for t in app/js/*.test.js; do node "$t" >/dev/null && echo "PASS $t" || echo "FAIL $t"; done
```

There is no Rust test suite or lint step; `cargo build` is the only Rust check.

The `*.runtime.test.js` / `*.diagrams.test.js` harnesses are notable: they load the
real module via `vm` into a hand-rolled minimal DOM + a fake clock, so they catch
runtime bugs that substring-matching tests cannot. Mirror that pattern for behavioral
tests.

## Verification (always a subagent)

Verify every change with a subagent, not in the session that wrote it. This overrides the
global "don't use subagents to verify" rule for this repo. Spawn **one** `qa-dept` agent on
`sonnet`, give it the feature, the constraints and a per-check PASS/FAIL/NOT VERIFIED report
format, and tell it not to edit source. Passing node tests and `cargo build` are the
author's own checks and do not count as verification.

- **Web layer:** drive `app/` in headless Chrome (playwright-core, `channel: 'chrome'`) with a
  fake `window.__TAURI__` when the change touches the bridge. Nothing opens on screen.
- **Native paths** (NSSavePanel, menu bar, FSEvents): launch `target/debug/tauri-app`, never
  the installed `/Applications/Galley.app` (daily-use copy; never touch or send it input).
  Clear only `~/Library/{Caches,WebKit}/tauri-app` first (stale-JS cache). Send keys to the
  test PID with `CGEventPostToPid` so nothing leaks into the terminal, and check every
  screenshot shows the test window.

## Conventions & gotchas

- **Requirement IDs are the spec.** `DR-##` (design requirements), `URD-##` (user
  requirements), `U-##`/`F-##` (feature gaps), `ISS-###` (filed issues). Trace changes
  to an ID and cite it in commits — the contracts and tests are keyed to them.
- **DR-06 is sacred:** never write to disk except on an explicit user Save action.
- **`!important` on color/background is intentional** — it wins the cascade. Don't strip it.
- **`index.html` has an inline `<style>` block that loads AFTER `css/tv-app.css`** and
  silently wins specificity ties. If a `tv-app.css` change has no visible effect, grep
  `index.html` for an overriding inline rule (this caused ISS-002).
- **WKWebView/CSP positioning:** inline `style="left/top"` HTML attributes are dropped
  under the Tauri CSP — set positions via CSSOM (`el.style.left = ...`), not the
  attribute.
- **WKWebView caches JS aggressively** in the dev build — a hard reload or app restart
  may be needed to see frontend edits.
- **Tauri 2 camelCases command arguments.** Rust `suggested_name` is `suggestedName` from
  JS; the snake_case key is rejected ("missing required key"). This silently broke native
  Save As for a path-less tab until F-23. `tv-native.runtime.test.js` reads the
  `save_md_file_as` signature from `lib.rs` and fails on drift; do the same for new
  multi-word parameters.
- **The shell's key router treats Ctrl as ⌘** (`e.metaKey || e.ctrlKey`). Any overlay that binds a Ctrl key (the palette's ⌃N/⌃P) must `stopPropagation`, or ⌃N creates a file and ⌃P prints.
- **The palette is one smart list** (F-24, `.claude/docs/feature-gaps/specs/F-24-palette-smart-list.md`): builders in `tv-palette.js` take a context object and are tested through `TVPalette._internals`; Appearance previews use `TV.previewAppearance` and must never persist.
- **A new file is an in-memory tab (`tab.isNew`), not a file** (F-23, `.claude/docs/feature-gaps/specs/F-23-new-file.md`).
  Only Save writes it, via the Save panel. `tab.untitled` is a different thing: the ⌘T launcher page.
- **Local images load via the Tauri asset protocol** (`tauri.conf.json` →
  `assetProtocol`). Its `**` scope never matches dot-leading directories (e.g.
  `.github/media/`) unless `requireLiteralLeadingDot` is `false` (ISS-006), and it
  denies `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/Library/Keychains`. Keep those deny entries
  when editing the scope. Relative image paths are normalized in `tv-imgfix.js` (ISS-007).
- No external network deps at runtime (icons are inline SVG; `mermaid.min.js` is
  vendored in `app/js/vendor/`). Respect `prefers-reduced-motion` for all animation.
