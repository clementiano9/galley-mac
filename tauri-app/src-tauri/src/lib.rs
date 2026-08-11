use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::menu::{
    CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu,
};
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

// ── Shared state ────────────────────────────────────────────────────────────

/// Holds one watcher per watched path.
pub struct WatcherState(pub Mutex<HashMap<String, RecommendedWatcher>>);

/// Holds the three Appearance CheckMenuItems so on_menu_event can update
/// the checkmarks without a second menu lookup (U-02 / DR-14).
pub struct AppearanceMenuState {
    pub light: CheckMenuItem<tauri::Wry>,
    pub dark: CheckMenuItem<tauri::Wry>,
    pub system: CheckMenuItem<tauri::Wry>,
}

// ── Data shapes ─────────────────────────────────────────────────────────────

/// FileDoc — the canonical file representation shared between Rust and JS.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDoc {
    pub name: String,
    pub path: String,
    pub content: String,
    /// File mtime, epoch ms; None if unavailable.
    pub modified: Option<u64>,
}

/// A single file entry in the directory tree (name + absolute path, no content).
/// Used by DirTree so the JS layer can open files on demand via read_md_file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
}

/// A single immediate subdirectory that contains matching files.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubfolderEntry {
    pub name: String,
    pub files: Vec<DirEntry>,
}

/// Return shape for pick_folder (B1 · folder-nesting fix).
///
/// Carries BOTH the chosen directory `path` AND its top-level files, so the JS
/// layer can distinguish a user CANCEL (empty `path`) from a real-but-empty
/// folder (non-empty `path`, empty `files`) — the latter happens when every .md
/// lives in subfolders. Field name is the single word `path` on purpose: lib.rs
/// has no `rename_all`, so a multi-word field would serialize verbatim and break
/// JS access.
#[derive(Debug, Clone, Serialize)]
pub struct FolderPick {
    pub path: String,
    pub files: Vec<FileDoc>,
}

/// Return shape for read_dir_tree (F-19, DR-33–DR-41).
///
/// - `path`       — the absolute folder path that was scanned.
/// - `files`      — .md/.markdown/.txt files directly in the folder (depth 0).
/// - `subfolders` — immediate subdirectories (depth 1) that contain matching files,
///                  each with their direct matching children.
/// - `deep`       — matching files nested MORE than one level below (depth 2+),
///                  flattened; `from` is the relative sub-path prefix (e.g. "sub/deeper/")
///                  for tooltip display.
///
/// Caps: maximum 200 total entries visited, maximum 50 direct `files`, maximum
/// 10 subfolders (each capped at 50 files), maximum 50 deep entries.
/// Unreadable directory entries are skipped with an eprintln, matching pick_folder behaviour.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirTree {
    pub path: String,
    pub files: Vec<DirEntry>,
    pub subfolders: Vec<SubfolderEntry>,
    pub deep: Vec<DeepEntry>,
    /// B2: true when the scanner dropped any matching file/subfolder because a cap
    /// (MAX_TOTAL / MAX_DIRECT / MAX_SUBFOLDERS / MAX_SUB_FILES / MAX_DEEP) was hit.
    /// Drives the sidebar's "Some items not shown" footer row.
    pub truncated: bool,
}

/// A file nested more than one level below the scanned root.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeepEntry {
    pub name: String,
    pub path: String,
    /// Relative sub-path prefix from the scanned root, e.g. "sub/deeper/" — for tooltip.
    pub from: String,
}

/// Payload emitted on every file-changed event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChanged {
    pub path: String,
    pub content: String,
    /// File mtime at change time, epoch ms; None if metadata() fails.
    pub modified: Option<u64>,
}

/// Payload emitted when a watched file is removed from disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileRemoved {
    pub path: String,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn read_file_doc(path: &str) -> Result<FileDoc, String> {
    let pb = PathBuf::from(path);
    let name = pb
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());
    let content = std::fs::read_to_string(&pb)
        .map_err(|e| format!("read error for {}: {}", path, e))?;
    let modified = std::fs::metadata(&pb)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);
    Ok(FileDoc {
        name,
        path: path.to_string(),
        content,
        modified,
    })
}

// ── Commands ─────────────────────────────────────────────────────────────────

/// Open native NSOpenPanel and read every selected .md / .markdown / .txt file.
/// Uses the non-blocking callback API with a oneshot channel to avoid deadlocking
/// the main thread (E-01 fix). Per-file read errors are skipped with a stderr log
/// instead of failing the whole batch (E-07 fix).
#[tauri::command]
async fn pick_md_files(app: tauri::AppHandle) -> Result<Vec<FileDoc>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<Vec<tauri_plugin_dialog::FilePath>>>();

    app.dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown", "txt"])
        .pick_files(move |paths| {
            let _ = tx.send(paths);
        });

    let maybe_paths = rx.await.map_err(|e| format!("dialog channel error: {}", e))?;

    let paths = match maybe_paths {
        Some(p) => p,
        None => return Ok(vec![]), // user cancelled
    };

    // E-07: skip files that fail to read (non-UTF8, permission denied, etc.)
    // rather than aborting the entire batch.
    let mut docs = Vec::with_capacity(paths.len());
    for fp in paths {
        let path_str = fp.to_string();
        match read_file_doc(&path_str) {
            Ok(doc) => docs.push(doc),
            Err(e) => eprintln!("pick_md_files: skipping {}: {}", path_str, e),
        }
    }
    Ok(docs)
}

/// Open native NSOpenPanel in directory-selection mode, then read all
/// .md / .markdown / .txt files directly inside that directory (non-recursive).
/// Uses the async callback + oneshot pattern to avoid deadlocking the main thread.
/// Per-file read errors are skipped, matching the pick_md_files behaviour.
/// (F-03)
#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Result<FolderPick, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<tauri_plugin_dialog::FilePath>>();

    app.dialog()
        .file()
        .pick_folder(move |dir_path| {
            let _ = tx.send(dir_path);
        });

    let maybe_path = rx.await.map_err(|e| format!("dialog channel error: {}", e))?;

    let fp = match maybe_path {
        Some(p) => p,
        // B1: user cancelled → EMPTY path signals cancel (the JS branch keys on
        // res.path being non-empty, NOT on files.length, so a real-but-empty
        // folder still opens its sidebar tree).
        None => {
            return Ok(FolderPick {
                path: String::new(),
                files: vec![],
            })
        }
    };

    let dir_str = fp.to_string();
    let dir_pb = PathBuf::from(&dir_str);

    // Read the directory entries — non-recursive, top-level only.
    let entries = std::fs::read_dir(&dir_pb)
        .map_err(|e| format!("read_dir error for {}: {}", dir_str, e))?;

    let mut docs = Vec::new();
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                eprintln!("pick_folder: skipping unreadable entry: {}", e);
                continue;
            }
        };

        let path = entry.path();

        // Only regular files (skip subdirectories and symlinks to dirs).
        if !path.is_file() {
            continue;
        }

        // Only .md, .markdown, .txt extensions.
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if ext != "md" && ext != "markdown" && ext != "txt" {
            continue;
        }

        let path_str = path.to_string_lossy().to_string();
        match read_file_doc(&path_str) {
            Ok(doc) => docs.push(doc),
            Err(e) => eprintln!("pick_folder: skipping {}: {}", path_str, e),
        }
    }

    // B1: return the chosen dir path + its top-level files. `files` may be empty
    // (all .md live in subfolders); the non-empty `path` tells JS this was a real
    // pick, so the sidebar tree still renders via readDirTree(res.path).
    Ok(FolderPick {
        path: dir_str,
        files: docs,
    })
}

/// Read a single file by absolute path (drag-drop, live re-read).
#[tauri::command]
fn read_md_file(path: String) -> Result<FileDoc, String> {
    read_file_doc(&path)
}


/// Overwrite an existing file (Save). Writes ONLY the file explicitly chosen.
#[tauri::command]
fn save_md_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| format!("write error for {}: {}", path, e))
}

/// Reveal a file in Finder, selecting it in its containing folder (F-10/F-16).
/// Uses macOS `open -R <path>` which highlights the item rather than opening it.
#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    std::process::Command::new("open")
        .arg("-R")
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("reveal error for {}: {}", path, e))
}

/// U-15: trigger the WebView's NATIVE print dialog. `window.print()` is a no-op in
/// WKWebView, so the ⌘P handler and the palette "Print / Export PDF…" command invoke
/// this instead. The native print renders the page with print media, so tv-print.css
/// (@media print: hide chrome, force light, unclip diagrams) still applies.
#[tauri::command]
fn print_page(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| format!("print error: {}", e))
}

/// Native save-as dialog; writes content; returns Some(FileDoc) or None if cancelled.
/// Uses the non-blocking callback API with a oneshot channel to avoid deadlocking
/// the main thread (E-01 fix).
#[tauri::command]
async fn save_md_file_as(
    app: tauri::AppHandle,
    content: String,
    suggested_name: String,
) -> Result<Option<FileDoc>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<tauri_plugin_dialog::FilePath>>();

    app.dialog()
        .file()
        .set_file_name(&suggested_name)
        .add_filter("Markdown", &["md", "markdown", "txt"])
        .save_file(move |path| {
            let _ = tx.send(path);
        });

    let maybe_path = rx.await.map_err(|e| format!("dialog channel error: {}", e))?;

    let fp = match maybe_path {
        Some(p) => p,
        None => return Ok(None), // user cancelled
    };

    let path_str = fp.to_string();
    std::fs::write(&path_str, &content)
        .map_err(|e| format!("write error for {}: {}", path_str, e))?;

    Ok(Some(read_file_doc(&path_str)?))
}

/// Start an FSEvents watch on the parent directory, filtering to `path`.
/// On modify/create, re-reads the file and emits `file-changed`.
/// On remove, emits `file-removed` with `{ path }` (E-08 fix).
/// Returns a clear Err when parent() is None or the watch fails (E-15 fix).
///
/// N-08 NOTE: The watcher HashMap is keyed by file path. If multiple tabs
/// are open from the same directory, each creates its own FSEventStream for that
/// directory, filtered to its target file. Correctness is preserved, but resource
/// usage is proportional to the number of tabs in the same directory.
/// TODO (N-08): key by directory path and maintain a per-directory set of
/// interested file paths to reduce to one FSEventStream per directory.
#[tauri::command]
fn watch_file(
    app: tauri::AppHandle,
    path: String,
    state: tauri::State<WatcherState>,
) -> Result<(), String> {
    // Don't start a second watcher for the same path.
    {
        let map = state.0.lock().map_err(|e| e.to_string())?;
        if map.contains_key(&path) {
            return Ok(());
        }
    }

    let target_path = PathBuf::from(&path);

    // E-15: surface a clear error when parent() returns None (e.g. root path like "/").
    let watch_dir = target_path
        .parent()
        .ok_or_else(|| {
            format!(
                "watch_file: cannot determine parent directory for '{}' \
                 (the path may be a filesystem root — watch is not supported for root paths)",
                path
            )
        })?
        .to_path_buf();

    let app_handle = app.clone();
    let target_clone = target_path.clone();
    let path_clone = path.clone();

    // Track the last content we emitted so we don't fire on no-op writes.
    let last_content: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

    let watcher_result = RecommendedWatcher::new(
        move |res: notify::Result<notify::Event>| {
            let event = match res {
                Ok(e) => e,
                Err(e) => {
                    eprintln!("watch_file watcher error for {}: {}", path_clone, e);
                    return;
                }
            };

            // Filter: event must involve our target file.
            let touches_target = event.paths.iter().any(|p| p == &target_clone);
            if !touches_target {
                return;
            }

            match event.kind {
                // E-08: handle file deletion — emit file-removed so the frontend
                // can show a toast or badge rather than silently staying active.
                EventKind::Remove(_) => {
                    let _ = app_handle.emit(
                        "file-removed",
                        FileRemoved {
                            path: path_clone.clone(),
                        },
                    );
                }

                // React to actual content changes.
                EventKind::Modify(_) | EventKind::Create(_) => {
                    // Re-read the file.
                    let new_content = match std::fs::read_to_string(&target_clone) {
                        Ok(c) => c,
                        Err(e) => {
                            eprintln!(
                                "watch_file: failed to re-read {}: {}",
                                target_clone.display(),
                                e
                            );
                            return;
                        }
                    };

                    // Simple debounce: skip if content hasn't changed.
                    {
                        let mut last = last_content.lock().unwrap();
                        if last.as_deref() == Some(&new_content) {
                            return;
                        }
                        *last = Some(new_content.clone());
                    }

                    let modified = std::fs::metadata(&target_clone)
                        .and_then(|m| m.modified())
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64);

                    let _ = app_handle.emit(
                        "file-changed",
                        FileChanged {
                            path: path_clone.clone(),
                            content: new_content,
                            modified,
                        },
                    );
                }

                // Ignore all other event kinds (access, metadata, etc.).
                _ => {}
            }
        },
        Config::default(),
    );

    let mut watcher =
        watcher_result.map_err(|e| format!("watch_file: failed to create watcher: {}", e))?;

    watcher
        .watch(&watch_dir, RecursiveMode::NonRecursive)
        .map_err(|e| {
            format!(
                "watch_file: failed to watch directory '{}': {}",
                watch_dir.display(),
                e
            )
        })?;

    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(path, watcher);

    Ok(())
}

/// Stop watching a path — drop the watcher.
#[tauri::command]
fn unwatch_file(
    path: String,
    state: tauri::State<WatcherState>,
) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&path);
    Ok(())
}

/// Scan a directory and return a DirTree describing its .md/.markdown/.txt contents
/// at three depth tiers (F-19, DR-33–DR-41).
///
/// Depth 0  → `files`      (direct children of `path`)
/// Depth 1  → `subfolders` (immediate subdirectories with matching files)
/// Depth 2+ → `deep`       (matching files nested deeper, flattened with `from` prefix)
///
/// Caps (all entry-counts, not file-counts only):
///   - Total entries visited across all depths: 200 (prevents runaway scans).
///   - `files`: 50 direct entries.
///   - `subfolders`: 10 subdirectories, each capped at 50 matching files.
///   - `deep`: 50 flattened entries.
///
/// Unreadable entries are skipped with eprintln, matching pick_folder behaviour.
/// Non-directory, non-matching-extension entries are silently skipped.
#[tauri::command]
fn read_dir_tree(path: String) -> Result<DirTree, String> {
    const MAX_TOTAL: usize = 200;
    const MAX_DIRECT: usize = 50;
    const MAX_SUBFOLDERS: usize = 10;
    const MAX_SUB_FILES: usize = 50;
    const MAX_DEEP: usize = 50;
    // QA D5: how many levels BELOW a subfolder the deep walk descends. 1 was the
    // old hardcoded behavior (and could not represent the design's depth-4 case);
    // 6 covers real note trees while still bounding a pathological hierarchy.
    const MAX_DEPTH: usize = 6;

    let root = PathBuf::from(&path);

    // Helper: is this path a matching extension?
    fn is_matching(p: &std::path::Path) -> bool {
        let ext = p
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        ext == "md" || ext == "markdown" || ext == "txt"
    }

    // Helper: build a DirEntry from a PathBuf.
    fn make_entry(p: &std::path::Path) -> DirEntry {
        DirEntry {
            name: p
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            path: p.to_string_lossy().to_string(),
        }
    }

    // SBH-01 (QA D5): recursively collect matching files below a subfolder into
    // the flat `deep` list, tagging each with its FULL relative prefix
    // ("research/sources/inner/"). The old code walked exactly one level below a
    // subfolder and pushed only `is_file()` entries, so a directory at depth 3
    // was never opened and never counted — files below it vanished from the UI
    // with `truncated` still false, i.e. silently. The JS side already splits an
    // arbitrary-depth `from` prefix, so nesting renders at any depth.
    //
    // Bounded three ways: MAX_DEPTH levels, the shared MAX_TOTAL visit budget,
    // and MAX_DEEP collected entries. Hitting ANY of them sets `truncated`, so
    // the sidebar's "Some items not shown" footer tells the truth.
    #[allow(clippy::too_many_arguments)]
    fn collect_deep(
        dir: &std::path::Path,
        prefix: &str,
        depth: usize,
        max_depth: usize,
        max_total: usize,
        max_deep: usize,
        deep: &mut Vec<DeepEntry>,
        total_visited: &mut usize,
        truncated: &mut bool,
    ) {
        if depth > max_depth {
            *truncated = true;
            return;
        }
        let entries = match std::fs::read_dir(dir) {
            Ok(iter) => iter,
            Err(e) => {
                eprintln!(
                    "read_dir_tree: skipping unreadable deep dir '{}': {}",
                    dir.display(),
                    e
                );
                return;
            }
        };
        for result in entries {
            if *total_visited >= max_total || deep.len() >= max_deep {
                *truncated = true;
                return;
            }
            let entry = match result {
                Ok(e) => e,
                Err(e) => {
                    eprintln!("read_dir_tree: skipping unreadable deep entry: {}", e);
                    continue;
                }
            };
            *total_visited += 1;

            let p = entry.path();
            if p.is_file() {
                if is_matching(&p) {
                    deep.push(DeepEntry {
                        name: p
                            .file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_default(),
                        path: p.to_string_lossy().to_string(),
                        from: prefix.to_string(),
                    });
                }
            } else if p.is_dir() {
                let name = p
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                let child_prefix = format!("{}{}/", prefix, name);
                collect_deep(
                    &p,
                    &child_prefix,
                    depth + 1,
                    max_depth,
                    max_total,
                    max_deep,
                    deep,
                    total_visited,
                    truncated,
                );
            }
        }
    }

    let mut files: Vec<DirEntry> = Vec::new();
    let mut subfolders: Vec<SubfolderEntry> = Vec::new();
    let mut deep: Vec<DeepEntry> = Vec::new();
    let mut total_visited: usize = 0;
    // B2: flips to true at EVERY cap-drop site (the three MAX_TOTAL breaks, the
    // MAX_SUBFOLDERS continue, and the two silent push-guards MAX_DIRECT /
    // MAX_SUB_FILES / MAX_DEEP). Surfaced on DirTree.truncated → sidebar footer.
    let mut truncated = false;

    // Read the root directory entries.
    let root_entries = std::fs::read_dir(&root)
        .map_err(|e| format!("read_dir_tree: cannot read '{}': {}", path, e))?;

    for entry_result in root_entries {
        if total_visited >= MAX_TOTAL {
            eprintln!(
                "read_dir_tree: hit entry cap ({}) scanning '{}'",
                MAX_TOTAL, path
            );
            truncated = true; // B2 cap-site 1/6 (root MAX_TOTAL)
            break;
        }
        let entry = match entry_result {
            Ok(e) => e,
            Err(e) => {
                eprintln!("read_dir_tree: skipping unreadable entry in '{}': {}", path, e);
                continue;
            }
        };
        total_visited += 1;

        let entry_path = entry.path();

        if entry_path.is_file() {
            // Depth-0 matching file.
            if is_matching(&entry_path) {
                if files.len() < MAX_DIRECT {
                    files.push(make_entry(&entry_path));
                } else {
                    truncated = true; // B2 cap-site 2/6 (MAX_DIRECT push-guard)
                }
            }
        } else if entry_path.is_dir() {
            // Depth-1 subdirectory: collect its matching files and recurse deeper.
            if subfolders.len() >= MAX_SUBFOLDERS {
                eprintln!(
                    "read_dir_tree: subfolder cap ({}) reached in '{}'",
                    MAX_SUBFOLDERS, path
                );
                truncated = true; // B2 cap-site 3/6 (MAX_SUBFOLDERS continue)
                continue;
            }

            let sub_name = entry_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            let mut sub_files: Vec<DirEntry> = Vec::new();

            // Read depth-1 subdirectory.
            let sub_entries = match std::fs::read_dir(&entry_path) {
                Ok(iter) => iter,
                Err(e) => {
                    eprintln!(
                        "read_dir_tree: skipping unreadable subdir '{}': {}",
                        entry_path.display(),
                        e
                    );
                    continue;
                }
            };

            for sub_result in sub_entries {
                if total_visited >= MAX_TOTAL {
                    truncated = true; // B2 cap-site 4/6 (sub-loop MAX_TOTAL)
                    break;
                }
                let sub_entry = match sub_result {
                    Ok(e) => e,
                    Err(e) => {
                        eprintln!(
                            "read_dir_tree: skipping unreadable entry in '{}': {}",
                            entry_path.display(),
                            e
                        );
                        continue;
                    }
                };
                total_visited += 1;

                let sub_path = sub_entry.path();

                if sub_path.is_file() {
                    // Depth-1 matching file → belongs to this subfolder.
                    if is_matching(&sub_path) {
                        if sub_files.len() < MAX_SUB_FILES {
                            sub_files.push(make_entry(&sub_path));
                        } else {
                            truncated = true; // B2 cap-site 5/6 (MAX_SUB_FILES push-guard)
                        }
                    }
                } else if sub_path.is_dir() {
                    // Depth-2+ — recurse to collect deep entries (flat list).
                    // QA D5: this now descends to MAX_DEPTH levels instead of
                    // exactly one, and flags `truncated` when it stops early.
                    let deeper_name = sub_path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default();
                    let deep_prefix = format!("{}/{}/", sub_name, deeper_name);
                    collect_deep(
                        &sub_path,
                        &deep_prefix,
                        1,
                        MAX_DEPTH,
                        MAX_TOTAL,
                        MAX_DEEP,
                        &mut deep,
                        &mut total_visited,
                        &mut truncated,
                    );
                }
            }

            // Only include this subfolder entry if it has matching direct files.
            if !sub_files.is_empty() {
                subfolders.push(SubfolderEntry {
                    name: sub_name,
                    files: sub_files,
                });
            }
        }
    }

    Ok(DirTree {
        path,
        files,
        subfolders,
        deep,
        truncated, // B2: any cap-drop above flipped this
    })
}

// ── Menu builder ─────────────────────────────────────────────────────────────

/// Build the native macOS menu bar (U-01 / F-08).
///
/// Menu structure:
///   App (tiny-viewer)  — About, separator, Services, separator, Hide, Hide Others,
///                        Show All, separator, Quit
///   File               — Open File… ⌘O, Open Folder… ⌘⇧O, separator,
///                        Save ⌘S, separator, Close Tab ⌘W
///   Edit               — Undo, Redo, separator, Cut, Copy, Paste, Select All,
///                        separator, Find ⌘F, Find in Files ⌘⇧F
///   View               — Command Palette ⌘K, Toggle Sidebar ⌘B, separator,
///                        Appearance ▶ Light / Dark / System (U-02, DR-11–14),
///                        separator, Toggle Dark Mode (legacy toggle kept for now),
///                        separator, Zoom In ⌘+, Zoom Out ⌘-, Actual Size ⌘0
///   Go                 — Previous Tab ⌘[, Next Tab ⌘]
///
/// Custom items emit Tauri app-level events that the frontend listens for.
/// Predefined Edit items (Undo/Redo/Cut/Copy/Paste/SelectAll) are left native
/// so that the edit textarea gets correct system behaviour (no custom event).
///
/// Security (N-03): The menu does NOT add any navigation that could reach
/// file:// origins. External links from rendered markdown are handled by
/// tauri-plugin-opener in the frontend (tv-app.js), not by WebView navigation.
/// The CSP in tauri.conf.json uses default-src 'self' which prevents the
/// WebView frame from navigating to file: or external origins.
///
/// Returns the Menu AND the AppearanceMenuState so the caller can manage the
/// CheckMenuItem handles for checkmark toggling (DR-14).
fn build_menu(app: &tauri::AppHandle) -> tauri::Result<(Menu<tauri::Wry>, AppearanceMenuState)> {
    // ── App menu (macOS: first submenu is the app menu) ──────────────────
    let app_menu = Submenu::with_id(app, "app", "tiny-viewer", true)?;
    app_menu.append(&PredefinedMenuItem::about(app, None, None)?)?;
    app_menu.append(&PredefinedMenuItem::separator(app)?)?;
    app_menu.append(&PredefinedMenuItem::services(app, None)?)?;
    app_menu.append(&PredefinedMenuItem::separator(app)?)?;
    app_menu.append(&PredefinedMenuItem::hide(app, None)?)?;
    app_menu.append(&PredefinedMenuItem::hide_others(app, None)?)?;
    app_menu.append(&PredefinedMenuItem::show_all(app, None)?)?;
    app_menu.append(&PredefinedMenuItem::separator(app)?)?;
    app_menu.append(&PredefinedMenuItem::quit(app, None)?)?;

    // ── File menu ────────────────────────────────────────────────────────
    let file_menu = Submenu::with_id(app, "file", "File", true)?;
    file_menu.append(&MenuItem::with_id(
        app,
        "menu:open-file",
        "Open File\u{2026}",
        true,
        Some("CmdOrCtrl+O"),
    )?)?;
    file_menu.append(&MenuItem::with_id(
        app,
        "menu:open-folder",
        "Open Folder\u{2026}",
        true,
        Some("CmdOrCtrl+Shift+O"),
    )?)?;
    file_menu.append(&PredefinedMenuItem::separator(app)?)?;
    file_menu.append(&MenuItem::with_id(
        app,
        "menu:save",
        "Save",
        true,
        Some("CmdOrCtrl+S"),
    )?)?;
    file_menu.append(&PredefinedMenuItem::separator(app)?)?;
    file_menu.append(&MenuItem::with_id(
        app,
        "menu:close-tab",
        "Close Tab",
        true,
        Some("CmdOrCtrl+W"),
    )?)?;

    // ── Edit menu ────────────────────────────────────────────────────────
    // Undo/Redo/Cut/Copy/Paste/SelectAll are predefined so the WebView
    // textarea gets correct native behaviour. Find items are custom.
    let edit_menu = Submenu::with_id(app, "edit", "Edit", true)?;
    edit_menu.append(&PredefinedMenuItem::undo(app, None)?)?;
    edit_menu.append(&PredefinedMenuItem::redo(app, None)?)?;
    edit_menu.append(&PredefinedMenuItem::separator(app)?)?;
    edit_menu.append(&PredefinedMenuItem::cut(app, None)?)?;
    edit_menu.append(&PredefinedMenuItem::copy(app, None)?)?;
    edit_menu.append(&PredefinedMenuItem::paste(app, None)?)?;
    edit_menu.append(&PredefinedMenuItem::select_all(app, None)?)?;
    edit_menu.append(&PredefinedMenuItem::separator(app)?)?;
    edit_menu.append(&MenuItem::with_id(
        app,
        "menu:find",
        "Find",
        true,
        Some("CmdOrCtrl+F"),
    )?)?;
    edit_menu.append(&MenuItem::with_id(
        app,
        "menu:find-in-files",
        "Find in Files",
        true,
        Some("CmdOrCtrl+Shift+F"),
    )?)?;

    // ── View menu ────────────────────────────────────────────────────────
    let view_menu = Submenu::with_id(app, "view", "View", true)?;
    view_menu.append(&MenuItem::with_id(
        app,
        "menu:command-palette",
        "Command Palette",
        true,
        Some("CmdOrCtrl+K"),
    )?)?;
    view_menu.append(&MenuItem::with_id(
        app,
        "menu:toggle-sidebar",
        "Toggle Sidebar",
        true,
        Some("CmdOrCtrl+B"),
    )?)?;
    view_menu.append(&PredefinedMenuItem::separator(app)?)?;

    // ── Appearance submenu (U-02, DR-11–DR-14) ───────────────────────────
    // Three CheckMenuItems: Light, Dark, System. Default on launch: System (checked).
    // DR-14 (menu-driven checkmark): on_menu_event reads AppearanceMenuState to
    // uncheck the previous item and check the newly selected one.
    // Note: bidirectional sync (palette/titlebar toggle → native checkmark) is
    // NOT implemented to avoid over-engineering (DR-14 "Should/best-effort").
    let appear_light = CheckMenuItem::with_id(
        app,
        "menu:appearance-light",
        "Light",
        true,
        false, // not checked at launch
        None::<&str>,
    )?;
    let appear_dark = CheckMenuItem::with_id(
        app,
        "menu:appearance-dark",
        "Dark",
        true,
        false, // not checked at launch
        None::<&str>,
    )?;
    let appear_system = CheckMenuItem::with_id(
        app,
        "menu:appearance-system",
        "System",
        true,
        true, // checked by default (DR-14: default is System)
        None::<&str>,
    )?;
    let appearance_submenu = Submenu::with_id(app, "view:appearance", "Appearance", true)?;
    appearance_submenu.append(&appear_light)?;
    appearance_submenu.append(&appear_dark)?;
    appearance_submenu.append(&appear_system)?;
    view_menu.append(&appearance_submenu)?;

    view_menu.append(&PredefinedMenuItem::separator(app)?)?;
    // BUG-3 FIX: Replace two separate Light/Dark items with a single toggle.
    // Emits "menu:theme-toggle"; the JS listener in wireNativeMenuEvents flips
    // state.theme between 'light' and 'dark' via setTheme().
    view_menu.append(&MenuItem::with_id(
        app,
        "menu:theme-toggle",
        "Toggle Dark Mode",
        true,
        None::<&str>,
    )?)?;
    view_menu.append(&PredefinedMenuItem::separator(app)?)?;
    view_menu.append(&MenuItem::with_id(
        app,
        "menu:zoom-in",
        "Zoom In",
        true,
        Some("CmdOrCtrl+="),
    )?)?;
    view_menu.append(&MenuItem::with_id(
        app,
        "menu:zoom-out",
        "Zoom Out",
        true,
        Some("CmdOrCtrl+-"),
    )?)?;
    view_menu.append(&MenuItem::with_id(
        app,
        "menu:zoom-reset",
        "Actual Size",
        true,
        Some("CmdOrCtrl+0"),
    )?)?;

    // ── Go menu ──────────────────────────────────────────────────────────
    let go_menu = Submenu::with_id(app, "go", "Go", true)?;
    go_menu.append(&MenuItem::with_id(
        app,
        "menu:prev-tab",
        "Previous Tab",
        true,
        Some("CmdOrCtrl+["),
    )?)?;
    go_menu.append(&MenuItem::with_id(
        app,
        "menu:next-tab",
        "Next Tab",
        true,
        Some("CmdOrCtrl+]"),
    )?)?;

    // ── Help menu (F-22, DR-20) ──────────────────────────────────────────
    // DR-20: "Help > Keyboard Shortcuts" opens the identical overlay as `?`.
    // Emits "menu:keyboard-shortcuts"; tv-native.js listens and calls
    // window.TV.openShortcuts(). The HIG-mandated Help menu also provides
    // an anchor for future help content at zero incremental chrome cost.
    let help_menu = Submenu::with_id(app, "help", "Help", true)?;
    help_menu.append(&MenuItem::with_id(
        app,
        "menu:keyboard-shortcuts",
        "Keyboard Shortcuts",
        true,
        None::<&str>,
    )?)?;

    // ── Assemble the menu bar ────────────────────────────────────────────
    let menu = Menu::new(app)?;
    menu.append(&app_menu)?;
    menu.append(&file_menu)?;
    menu.append(&edit_menu)?;
    menu.append(&view_menu)?;
    menu.append(&go_menu)?;
    menu.append(&help_menu)?;

    let appearance_state = AppearanceMenuState {
        light: appear_light,
        dark: appear_dark,
        system: appear_system,
    };

    Ok((menu, appearance_state))
}

// ── App entry point ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(WatcherState(Mutex::new(HashMap::new())))
        .invoke_handler(tauri::generate_handler![
            pick_md_files,
            pick_folder,
            read_md_file,
            read_dir_tree,
            save_md_file,
            save_md_file_as,
            reveal_in_finder,
            print_page,
            watch_file,
            unwatch_file,
        ])
        .setup(|app| {
            // Build and register the native macOS menu bar (U-01 / F-08).
            // build_menu returns (Menu, AppearanceMenuState) so we can manage
            // the CheckMenuItem handles for DR-14 checkmark toggling.
            let (menu, appearance_state) = build_menu(app.handle())?;
            app.set_menu(menu)?;
            app.manage(appearance_state);
            Ok(())
        })
        // Handle menu item events: emit app-level Tauri events so the frontend
        // (tv-native.js) can listen via window.__TAURI__.event.listen().
        // Predefined items (Undo/Redo/Cut/Copy/Paste/SelectAll/About/Quit etc.)
        // are handled natively by the OS — they do NOT appear here.
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            match id {
                // File menu
                "menu:open-file"
                | "menu:open-folder"
                | "menu:save"
                | "menu:close-tab"
                // Edit menu
                | "menu:find"
                | "menu:find-in-files"
                // View menu
                | "menu:command-palette"
                | "menu:toggle-sidebar"
                | "menu:theme-toggle"
                | "menu:zoom-in"
                | "menu:zoom-out"
                | "menu:zoom-reset"
                // Go menu
                | "menu:prev-tab"
                | "menu:next-tab"
                // Help menu (F-22, DR-20)
                | "menu:keyboard-shortcuts" => {
                    // Emit the id as the event name so the frontend can listen
                    // with: window.__TAURI__.event.listen("menu:open-file", ...)
                    if let Err(e) = app.emit(id, ()) {
                        eprintln!("menu event emit error for {}: {}", id, e);
                    }
                }

                // Appearance submenu (U-02, DR-11–DR-14) ─────────────────────
                // Emit the item id as the event name so tv-native.js can listen
                // with: listen("menu:appearance-light", ...) etc.
                // Then update the three CheckMenuItems: check the selected one,
                // uncheck the other two (DR-14 menu-driven checkmark).
                "menu:appearance-light"
                | "menu:appearance-dark"
                | "menu:appearance-system" => {
                    if let Err(e) = app.emit(id, ()) {
                        eprintln!("menu event emit error for {}: {}", id, e);
                    }
                    // DR-14: update checkmarks on the Appearance submenu items.
                    if let Some(state) = app.try_state::<AppearanceMenuState>() {
                        let light_checked = id == "menu:appearance-light";
                        let dark_checked = id == "menu:appearance-dark";
                        let system_checked = id == "menu:appearance-system";
                        if let Err(e) = state.light.set_checked(light_checked) {
                            eprintln!("appearance checkmark update failed (light): {}", e);
                        }
                        if let Err(e) = state.dark.set_checked(dark_checked) {
                            eprintln!("appearance checkmark update failed (dark): {}", e);
                        }
                        if let Err(e) = state.system.set_checked(system_checked) {
                            eprintln!("appearance checkmark update failed (system): {}", e);
                        }
                    }
                }

                _ => {} // predefined items handled by OS
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        // U-18: App::run() (on the App struct, not Builder) is the only place
        // that exposes a RunEvent callback. Builder::run() takes a Context and
        // returns Result<()> with no callback surface; Builder::build() → App,
        // then App::run(callback) handles RunEvent::Opened { urls } which macOS
        // sends when files are opened via Finder "Open With" or double-click
        // (both cold-start and already-running cases). We convert each file://
        // URL to an absolute path, filter to markdown extensions, and emit
        // "open-files" so tv-native.js can mirror the drag-drop open flow.
        .run(|app_handle, event| {
            if let tauri::RunEvent::Opened { urls } = event {
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|url| {
                        // Accept file:// URLs only; convert to a filesystem path.
                        if url.scheme() == "file" {
                            url.to_file_path().ok().map(|p| p.to_string_lossy().to_string())
                        } else {
                            None
                        }
                    })
                    .filter(|path| {
                        // Only forward extensions the app understands.
                        let lower = path.to_lowercase();
                        lower.ends_with(".md")
                            || lower.ends_with(".markdown")
                            || lower.ends_with(".txt")
                    })
                    .collect();

                if !paths.is_empty() {
                    if let Err(e) = app_handle.emit("open-files", &paths) {
                        eprintln!("RunEvent::Opened emit error: {}", e);
                    }
                }
            }
        });
}

// ── Tests ──────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    // F-19 / DR-33, DR-37, DR-39: read_dir_tree lists depth-0 files, one level of
    // subfolders with their direct files, and flattens depth-2 files into `deep`
    // with a "sub/deeper/" prefix; non-md/markdown/txt files are excluded.
    #[test]
    fn read_dir_tree_structure() {
        let mut base = std::env::temp_dir();
        base.push(format!("tv_rdt_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("sub").join("deeper")).unwrap();
        fs::write(base.join("top.md"), "x").unwrap();
        fs::write(base.join("notes.txt"), "x").unwrap();
        fs::write(base.join("ignore.png"), "x").unwrap();
        fs::write(base.join("sub").join("a.md"), "x").unwrap();
        fs::write(base.join("sub").join("b.markdown"), "x").unwrap();
        fs::write(base.join("sub").join("deeper").join("d.md"), "x").unwrap();

        let tree = read_dir_tree(base.to_string_lossy().to_string()).expect("read_dir_tree ok");

        // DR-33: top-level md + txt listed, png excluded
        let names: Vec<&str> = tree.files.iter().map(|f| f.name.as_str()).collect();
        assert!(names.contains(&"top.md"), "top.md listed: {:?}", names);
        assert!(names.contains(&"notes.txt"), "notes.txt listed: {:?}", names);
        assert!(!names.iter().any(|n| n.ends_with(".png")), "png excluded: {:?}", names);
        assert!(tree.files.iter().all(|f| !f.path.is_empty()), "entries carry absolute path");

        // DR-37: exactly one subfolder ("sub") with its direct files
        assert_eq!(tree.subfolders.len(), 1, "one subfolder");
        assert_eq!(tree.subfolders[0].name, "sub");
        let sub: Vec<&str> = tree.subfolders[0].files.iter().map(|f| f.name.as_str()).collect();
        assert!(sub.contains(&"a.md") && sub.contains(&"b.markdown"), "sub files: {:?}", sub);

        // DR-37: depth-2 file flattened into `deep` with from="sub/deeper/"
        assert_eq!(tree.deep.len(), 1, "one deep file");
        assert_eq!(tree.deep[0].name, "d.md");
        assert_eq!(tree.deep[0].from, "sub/deeper/", "deep `from` prefix");

        // B2: a tiny tree well under every cap is NOT truncated.
        assert!(!tree.truncated, "small tree is not truncated");

        let _ = fs::remove_dir_all(&base);
    }

    // QA D5: the deep walk used to stop exactly one level below a subfolder, so
    // a directory at depth 3 was never opened — its files vanished from the UI
    // with `truncated` still false (a SILENT drop). It now recurses to
    // MAX_DEPTH, tagging each file with its full relative `from` prefix.
    #[test]
    fn read_dir_tree_recurses_past_depth_three() {
        let mut base = std::env::temp_dir();
        base.push(format!("tv_rdt_deep_{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        // research/sources/inner/  — the design's depth-4 case.
        let inner = base.join("research").join("sources").join("inner");
        fs::create_dir_all(&inner).unwrap();
        fs::write(base.join("charter.md"), "x").unwrap();
        fs::write(base.join("research").join("stream-1.md"), "x").unwrap();
        fs::write(base.join("research").join("sources").join("derived-wans.md"), "x").unwrap();
        fs::write(inner.join("refs.md"), "x").unwrap();
        // One level deeper still, to prove it is recursion and not a second
        // hardcoded level.
        let deeper_still = inner.join("evenmore");
        fs::create_dir_all(&deeper_still).unwrap();
        fs::write(deeper_still.join("way-down.md"), "x").unwrap();

        let tree = read_dir_tree(base.to_string_lossy().to_string()).expect("read_dir_tree ok");

        let find = |n: &str| tree.deep.iter().find(|d| d.name == n).cloned();

        let sources = find("derived-wans.md").expect("depth-3 file collected");
        assert_eq!(sources.from, "research/sources/", "depth-3 `from`");

        let refs = find("refs.md").expect("depth-4 file collected (was silently dropped)");
        assert_eq!(refs.from, "research/sources/inner/", "depth-4 `from`");

        let way_down = find("way-down.md").expect("depth-5 file collected");
        assert_eq!(
            way_down.from, "research/sources/inner/evenmore/",
            "depth-5 `from` keeps the full chain"
        );

        // Nothing here trips a cap, so the truncation footer must stay off.
        assert!(!tree.truncated, "well under every cap → not truncated");

        let _ = fs::remove_dir_all(&base);
    }

    // B2: the MAX_DIRECT push-guard is the trickiest cap to wire (a silent
    // `len() < CAP` guard, not a break). Writing >50 top-level .md files must
    // flip DirTree.truncated even though the loop never breaks.
    #[test]
    fn read_dir_tree_marks_truncated_over_max_direct() {
        let mut base = std::env::temp_dir();
        base.push(format!("tv_rdt_trunc_{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        // 60 matching top-level files > MAX_DIRECT (50) but < MAX_TOTAL (200),
        // so the only cap hit is the MAX_DIRECT push-guard.
        for i in 0..60 {
            fs::write(base.join(format!("f{:02}.md", i)), "x").unwrap();
        }

        let tree = read_dir_tree(base.to_string_lossy().to_string()).expect("read_dir_tree ok");

        assert_eq!(tree.files.len(), 50, "files capped at MAX_DIRECT");
        assert!(tree.truncated, "exceeding MAX_DIRECT flips truncated");

        let _ = fs::remove_dir_all(&base);
    }
}
