# Testing Galley

Galley is a native macOS markdown viewer. It is not signed with an Apple Developer ID
yet, so a downloaded build would be blocked by Gatekeeper. **You build it yourself
instead** — an app you compile on your own Mac is never quarantined, so it just runs.

Budget about ten minutes the first time, most of which is the Rust compile.

## Before you start

| You need | Check it | If missing |
|---|---|---|
| macOS on Apple silicon (M1 or later) | `uname -m` prints `arm64` | Intel Macs need a universal build — tell Clement |
| Xcode Command Line Tools | `xcode-select -p` prints a path | `xcode-select --install` |
| Rust | `rustc --version` | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh`, then restart the terminal |
| Bun | `bun --version` | `curl -fsSL https://bun.sh/install \| bash` |

Rust installs to `~/.cargo/bin`. If `cargo` is not found afterwards, add it for the
session with `export PATH="$HOME/.cargo/bin:$PATH"`.

## Build it

```bash
git clone <repo-url> galley
cd galley/tauri-app
bun install          # a couple of seconds, one dependency
bun run tauri build  # a few minutes the first time, under a minute after that
```

The build ends by printing two paths. The one you want:

```
tauri-app/src-tauri/target/release/bundle/macos/Galley.app
```

Drag that into `/Applications`, or just double-click it where it is. There is no
security prompt, because you compiled it.

The build also writes `bundle/dmg/Galley_0.1.0_aarch64.dmg`. Ignore it — a `.dmg` you
send to someone else *does* get quarantined and blocked. Building is the point.

## Getting a newer build later

```bash
cd galley && git pull
cd tauri-app && bun run tauri build
```

Quit Galley before rebuilding, then replace your copy in `/Applications`.

## What is worth poking at

This build is the end of a polish pass, so the interesting parts are the ones that
changed. Rough tour:

- **Tabs.** Open a dozen files. Scroll the tab strip sideways, then click a tab that is
  already visible: nothing should move. Selecting a tab that is off-screen should
  scroll it into view. The ⌄ button beside `+` lists every open file and each row
  closes with its ✕.
- **⌘K** for the command palette — it is fuzzy, so `shma` should find `schema.md`.
  **⌘⇧F** searches across every open tab; clicking a hit should land on it and
  highlight it. **⌘F** finds within the document.
- **Editing.** Double-click any paragraph, or ⌘E. **Esc discards your edits** and
  toasts that ⌘Z restores them; ⌘S saves; ⌘E leaves edit mode keeping them.
- **Quitting with unsaved work.** Edit something, do not save, press ⌘Q. You should
  get a Save All / Discard / Cancel sheet rather than losing the edit.
- **Menus.** Window, File ▸ Open Recent, File ▸ Print, Edit ▸ Find ▸ Find Next.
- **Dark mode**, the ⌘⇧O folder sidebar, drag-and-drop onto the window, and a document
  containing a `----` rule, a table, images and a mermaid diagram.

## Reporting something

Useful: what you did, what happened, what you expected, your macOS version
(`sw_vers -productVersion`), and a screenshot. If the app hangs, `Activity Monitor →
Galley → Sample Process` captures what it was doing and is worth attaching.

Known and already on the list: marking a file unsaved nudges the tabs to its right by
a hair, and the ⌄ button can flicker while you resize the window through one narrow
width. No need to report those two.
