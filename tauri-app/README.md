# tauri-app — the native shell

This directory is the **macOS shell only**. It contains no UI code. The entire
interface lives one level up in [`../app/`](../app/), and `src-tauri/tauri.conf.json`
sets `frontendDist: "../../app"`, so the Rust binary serves that directory verbatim.
There is no copy step and no build step for the frontend — editing `../app/` changes
the running app on reload.

| Path | What it is |
|---|---|
| `src-tauri/src/lib.rs` | Every `#[tauri::command]`, the FSEvents file watcher, the native menu bar |
| `src-tauri/tauri.conf.json` | Window, CSP, bundle targets, `.md`/`.txt` file associations |
| `src-tauri/Info.plist` | macOS document types and app metadata |
| `src-tauri/icons/` | App icon set |
| `NATIVE-CONTRACT.md` | The binding JS ⇄ Rust interface — read before touching either side |
| `package.json` | One devDependency: the Tauri CLI. Nothing is bundled |

## Commands

`cargo` lives in `~/.cargo/bin` and is not on the non-interactive shell's PATH, so
prepend it or every `tauri` command fails with `cargo metadata ... No such file or directory`.

```bash
PATH="$HOME/.cargo/bin:$PATH" bun run tauri dev     # live dev window
PATH="$HOME/.cargo/bin:$PATH" bun run tauri build   # → src-tauri/target/release/bundle/macos/Galley.app
cd src-tauri && cargo build                         # type-check the Rust side only
```

To run the same UI in a plain browser instead, see [`../app/README.md`](../app/README.md).
