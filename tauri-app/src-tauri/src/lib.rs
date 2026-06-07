use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::Emitter;
use tauri_plugin_dialog::DialogExt;

// ── Shared state ────────────────────────────────────────────────────────────

/// Holds one watcher per watched path.
pub struct WatcherState(pub Mutex<HashMap<String, RecommendedWatcher>>);

// ── Data shapes ─────────────────────────────────────────────────────────────

/// FileDoc — the canonical file representation shared between Rust and JS.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDoc {
    pub name: String,
    pub path: String,
    pub content: String,
}

/// Payload emitted on every file-changed event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChanged {
    pub path: String,
    pub content: String,
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
    Ok(FileDoc {
        name,
        path: path.to_string(),
        content,
    })
}

// ── Commands ─────────────────────────────────────────────────────────────────

/// Open native NSOpenPanel and read every selected .md / .markdown / .txt file.
#[tauri::command]
fn pick_md_files(app: tauri::AppHandle) -> Result<Vec<FileDoc>, String> {
    let maybe_paths = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown", "txt"])
        .blocking_pick_files();

    let paths = match maybe_paths {
        Some(p) => p,
        None => return Ok(vec![]), // user cancelled
    };

    let mut docs = Vec::with_capacity(paths.len());
    for fp in paths {
        let path_str = fp.to_string();
        docs.push(read_file_doc(&path_str)?);
    }
    Ok(docs)
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

/// Native save-as dialog; writes content; returns Some(FileDoc) or None if cancelled.
#[tauri::command]
fn save_md_file_as(
    app: tauri::AppHandle,
    content: String,
    suggested_name: String,
) -> Result<Option<FileDoc>, String> {
    let maybe_path = app
        .dialog()
        .file()
        .set_file_name(&suggested_name)
        .add_filter("Markdown", &["md", "markdown", "txt"])
        .blocking_save_file();

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
    let watch_dir = target_path
        .parent()
        .ok_or_else(|| format!("cannot determine parent dir for {}", path))?
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
                Err(_) => return,
            };

            // Only react to actual content changes.
            let is_modify = matches!(
                event.kind,
                EventKind::Modify(_) | EventKind::Create(_)
            );
            if !is_modify {
                return;
            }

            // Filter: event must involve our target file.
            let touches_target = event.paths.iter().any(|p| p == &target_clone);
            if !touches_target {
                return;
            }

            // Re-read the file.
            let new_content = match std::fs::read_to_string(&target_clone) {
                Ok(c) => c,
                Err(_) => return,
            };

            // Simple debounce: skip if content hasn't changed.
            {
                let mut last = last_content.lock().unwrap();
                if last.as_deref() == Some(&new_content) {
                    return;
                }
                *last = Some(new_content.clone());
            }

            let _ = app_handle.emit(
                "file-changed",
                FileChanged {
                    path: path_clone.clone(),
                    content: new_content,
                },
            );
        },
        Config::default(),
    );

    let mut watcher =
        watcher_result.map_err(|e| format!("failed to create watcher: {}", e))?;

    watcher
        .watch(&watch_dir, RecursiveMode::NonRecursive)
        .map_err(|e| format!("failed to watch {}: {}", watch_dir.display(), e))?;

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

// ── App entry point ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(WatcherState(Mutex::new(HashMap::new())))
        .invoke_handler(tauri::generate_handler![
            pick_md_files,
            read_md_file,
            save_md_file,
            save_md_file_as,
            watch_file,
            unwatch_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
