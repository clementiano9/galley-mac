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

## Reporting something

Useful: what you did, what happened, what you expected, your macOS version
(`sw_vers -productVersion`), and a screenshot.
