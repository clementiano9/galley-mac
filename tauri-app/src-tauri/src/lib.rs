use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{
    CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu,
};
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult};

// ── Shared state ────────────────────────────────────────────────────────────

/// Holds one watcher per watched path.
pub struct WatcherState(pub Mutex<HashMap<String, RecommendedWatcher>>);

/// U-18 (cold-start fix): files macOS asked us to open before the frontend was
/// listening.
///
/// `RunEvent::Opened` arrives during launch — for a double-click or "Open With"
/// on a *cold* app that is well before index.html has run tv-native.js and
/// registered its `open-files` listener. `Emitter::emit` does not buffer, so the
/// event went nowhere and the app came up showing only its restored session,
/// silently ignoring the file the user actually double-clicked. (Opening a file
/// while the app was already running always worked — the listener existed by
/// then.)
///
/// So: buffer until the frontend says it is ready, then hand the paths over on
/// request. `ready` flips on the first `take_pending_opens` call, after which
/// `RunEvent::Opened` emits live instead of buffering — which is why the same
/// path never arrives twice.
pub struct PendingOpens {
    pub paths: Mutex<Vec<String>>,
    pub ready: std::sync::atomic::AtomicBool,
}

/// Holds the three Appearance CheckMenuItems so on_menu_event can update
/// the checkmarks without a second menu lookup (U-02 / DR-14).
pub struct AppearanceMenuState {
    pub light: CheckMenuItem<tauri::Wry>,
    pub dark: CheckMenuItem<tauri::Wry>,
    pub system: CheckMenuItem<tauri::Wry>,
}

/// C-02: the quit / close-window guard.
///
/// `CloseRequested` is intercepted so unsaved edits are never discarded
/// silently — the frontend is asked first (see the `tv-close-requested` event).
/// `confirmed` flips only when JS calls `confirm_close`, i.e. the user has
/// answered the sheet, at which point the close is allowed through.
pub struct CloseGuard {
    pub confirmed: AtomicBool,
}

/// C-36: the File ▸ Open Recent submenu plus the paths its items map to.
///
/// The MRU lives in the frontend's localStorage, so Rust cannot build this at
/// startup — JS pushes the list in via `set_recent_files` and the submenu is
/// rebuilt in place. `paths[i]` is the file behind menu id `menu:recent-<i>`.
pub struct RecentMenuState {
    pub submenu: Submenu<tauri::Wry>,
    pub paths: Mutex<Vec<String>>,
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

/// UXF-02: return shape for read_dir_tree — a real recursive tree.
///
/// `truncated` is true when any node is `scanned: false` or has `files_hidden > 0`.
/// `unreadable` counts folders the scan could not open (the root excepted: that
/// is an error).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirTree {
    pub path: String,
    pub root: DirNode,
    pub truncated: bool,
    pub unreadable: u32,
}

/// UXF-02: one folder of the tree. Names and paths only — no content (DR-06).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirNode {
    pub name: String,
    pub path: String,
    /// Direct markdown files, natural-sorted, at most FILE_CAP.
    pub files: Vec<DirEntry>,
    /// Direct markdown files beyond FILE_CAP.
    pub files_hidden: u32,
    /// Direct subfolders, natural-sorted; includes folders with md_count == 0.
    pub folders: Vec<DirNode>,
    /// Markdown files in this subtree the scan saw (files_hidden included).
    pub md_count: u32,
    /// false = the budget or depth limit ran out before this folder was read.
    pub scanned: bool,
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

// ── UXF-09: trackpad finger phases → `swipe-touch` ─────────────────────────────

/// Payload of the `swipe-touch` event (camelCase on the wire). Finger events
/// only — momentum and phase-less mouse wheels are never sent. `t` is the
/// NSEvent timestamp in ms (native clock); `dx`/`dy` are scrollingDeltaX/Y,
/// `inverted` is isDirectionInvertedFromDevice; `x`/`y` are the pointer in
/// window points (top-left origin, = CSS px at zoom 1); `mods` = ⇧⌃⌥⌘ held.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SwipeTouch {
    pub phase: &'static str,
    pub t: f64,
    pub dx: f64,
    pub dy: f64,
    pub precise: bool,
    pub inverted: bool,
    pub x: f64,
    pub y: f64,
    pub mods: bool,
}

/// NSEventPhase / momentumPhase bits → the `swipe-touch` phase, or None when
/// the event must not be forwarded (momentum, stationary, or a mouse wheel,
/// which has no phase). May-begin (fingers down, not moved yet) counts as began.
pub fn swipe_phase(phase: u64, momentum: u64) -> Option<&'static str> {
    if momentum != 0 {
        return None;
    }
    match phase {
        1 | 32 => Some("began"),
        4 => Some("changed"),
        8 => Some("ended"),
        16 => Some("cancelled"),
        _ => None,
    }
}

/// Forwarding policy, pure so it is unit-tested: per touch, `changed` deltas
/// are coalesced to at most one message per SWIPE_COALESCE_MS and only during
/// the first SWIPE_FORWARD_MS (a swipe decides in ~60 ms; a long reading
/// scroll must not stream IPC). `began`/`ended` always go through, and a
/// pending delta is flushed before `ended`.
pub const SWIPE_COALESCE_MS: f64 = 16.0;
pub const SWIPE_FORWARD_MS: f64 = 1000.0;

#[derive(Debug, Default)]
pub struct SwipeForwarder {
    touch_t0: Option<f64>,
    last_emit: f64,
    pend_dx: f64,
    pend_dy: f64,
}

impl SwipeForwarder {
    pub fn push(&mut self, ev: SwipeTouch) -> Vec<SwipeTouch> {
        let mut out = Vec::new();
        match ev.phase {
            "began" => {
                self.touch_t0 = Some(ev.t);
                self.pend_dx = 0.0;
                self.pend_dy = 0.0;
                self.last_emit = f64::NEG_INFINITY;
                out.push(ev);
            }
            "changed" => {
                let t0 = *self.touch_t0.get_or_insert(ev.t);
                if ev.t - t0 > SWIPE_FORWARD_MS {
                    return out;
                }
                self.pend_dx += ev.dx;
                self.pend_dy += ev.dy;
                if ev.t - self.last_emit >= SWIPE_COALESCE_MS {
                    self.last_emit = ev.t;
                    out.push(SwipeTouch { dx: self.pend_dx, dy: self.pend_dy, ..ev });
                    self.pend_dx = 0.0;
                    self.pend_dy = 0.0;
                }
            }
            _ => {
                if self.pend_dx != 0.0 || self.pend_dy != 0.0 {
                    out.push(SwipeTouch { phase: "changed", dx: self.pend_dx, dy: self.pend_dy, ..ev.clone() });
                }
                self.pend_dx = 0.0;
                self.pend_dy = 0.0;
                self.touch_t0 = None;
                out.push(ev);
            }
        }
        out
    }
}

/// Install the scroll-wheel local monitor for the app's life. It only READS
/// each event and returns it unchanged (never nil), so WKWebView scrolls
/// exactly as before. AppKit calls the handler on the main thread.
#[cfg(target_os = "macos")]
fn install_swipe_monitor(app: tauri::AppHandle) {
    use block2::RcBlock;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags};
    use std::cell::RefCell;
    use std::ptr::NonNull;

    let fwd = RefCell::new(SwipeForwarder::default());
    let handler = RcBlock::new(move |ev: NonNull<NSEvent>| -> *mut NSEvent {
        // SAFETY: AppKit hands the monitor a valid event for the call's duration.
        let e: &NSEvent = unsafe { ev.as_ref() };
        let phase = swipe_phase(e.phase().0 as u64, e.momentumPhase().0 as u64);
        if let (Some(phase), Some(mtm)) = (phase, MainThreadMarker::new()) {
            if let Some(win) = e.window(mtm) {
                let loc = e.locationInWindow();
                let h = win.contentView().map(|v| v.frame().size.height).unwrap_or(0.0);
                let m = e.modifierFlags();
                let held = NSEventModifierFlags::Shift | NSEventModifierFlags::Control
                    | NSEventModifierFlags::Option | NSEventModifierFlags::Command;
                let msg = SwipeTouch {
                    phase,
                    t: e.timestamp() * 1000.0,
                    dx: e.scrollingDeltaX(),
                    dy: e.scrollingDeltaY(),
                    precise: e.hasPreciseScrollingDeltas(),
                    inverted: e.isDirectionInvertedFromDevice(),
                    x: loc.x,
                    y: h - loc.y,
                    mods: m.intersects(held),
                };
                let out = fwd.borrow_mut().push(msg);
                for m in out {
                    if let Err(err) = app.emit("swipe-touch", m) {
                        eprintln!("swipe-touch emit error: {}", err);
                    }
                }
            }
        }
        ev.as_ptr()
    });
    // SAFETY: the block returns the event it was given, a valid pointer.
    let monitor = unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::ScrollWheel, &handler)
    };
    // The monitor lives as long as the app; keep it (and the block) alive.
    std::mem::forget(monitor);
    std::mem::forget(handler);
}

// ── DOC-MENU: the document's right-click menu ───────────────────────────────
//
// The standard macOS pattern for WKWebView apps: let WebKit build its native
// context menu (Look Up, Translate, Search with Google, Copy, Share, Speech…)
// and edit it in NSView's willOpenMenu:withEvent: just before it shows.
// Items that would navigate or download in the app shell are dropped; Galley
// items are added and report back to the page as the `doc-menu` event with
// their id. The page decides what each id does (tv-app.js).

const WK_ID: &str = "WKMenuItemIdentifier";

/// One row of the rebuilt menu: a WebKit item kept (index into the original
/// menu), a Galley item (id, title), or a separator.
#[derive(Debug, Clone, PartialEq)]
pub enum MenuEntry {
    Keep(usize),
    Item(&'static str, &'static str),
    Sep,
}

/// WebKit items that leave or replace the app shell: page navigation, "open
/// in new window" and downloads (DR-06: nothing writes to disk without Save).
fn wk_item_dropped(id: &str) -> bool {
    match id.strip_prefix(WK_ID) {
        Some(name) => {
            matches!(name, "GoBack" | "GoForward" | "Reload" | "Stop" | "OpenLink")
                || name.contains("NewWindow")
                || name.contains("Download")
        }
        None => false,
    }
}

/// Pure plan of the rebuilt menu (unit-tested). `items` is (identifier,
/// is_separator) per original item. Editable text (the source editor) keeps
/// WebKit's own menu apart from the dropped items.
pub fn plan_doc_menu(items: &[(Option<String>, bool)]) -> Vec<MenuEntry> {
    let has = |name: &str| {
        let want = format!("{}{}", WK_ID, name);
        items.iter().any(|(id, _)| id.as_deref() == Some(want.as_str()))
    };
    let editable = has("Paste") || has("Cut");
    let selection = has("Copy");
    let mut out = Vec::new();
    for (i, (id, sep)) in items.iter().enumerate() {
        if *sep {
            out.push(MenuEntry::Sep);
            continue;
        }
        let id = id.as_deref().unwrap_or("");
        if wk_item_dropped(id) {
            continue;
        }
        if !editable && id == format!("{}CopyLink", WK_ID) {
            out.push(MenuEntry::Item("open-link", "Open Link"));
        }
        out.push(MenuEntry::Keep(i));
        if !editable && selection && id == format!("{}Copy", WK_ID) {
            out.push(MenuEntry::Item("copy-markdown", "Copy as Markdown"));
        }
    }
    if !editable {
        let inspect = format!("{}InspectElement", WK_ID);
        let blank = out.iter().all(|e| match e {
            MenuEntry::Keep(i) => items[*i].0.as_deref() == Some(inspect.as_str()),
            _ => true,
        });
        let extra: Vec<MenuEntry> = if blank {
            vec![
                MenuEntry::Item("select-all", "Select All"),
                MenuEntry::Item("find", "Find\u{2026}"),
                MenuEntry::Item("edit", "Edit Source"),
                MenuEntry::Sep,
                MenuEntry::Item("print", "Print\u{2026}"),
            ]
        } else if selection {
            vec![
                MenuEntry::Item("find-selection", "Find in Document"),
                MenuEntry::Item("find-in-files", "Find in Files"),
            ]
        } else {
            Vec::new()
        };
        if !extra.is_empty() {
            // Galley items sit above Inspect Element (debug builds only).
            let at = out
                .iter()
                .position(|e| matches!(e, MenuEntry::Keep(i) if items[*i].0.as_deref() == Some(inspect.as_str())))
                .unwrap_or(out.len());
            let mut block = vec![MenuEntry::Sep];
            block.extend(extra);
            block.push(MenuEntry::Sep);
            out.splice(at..at, block);
        }
    }
    // No leading, trailing or doubled separators.
    let mut tidy: Vec<MenuEntry> = Vec::new();
    for e in out {
        if e == MenuEntry::Sep && matches!(tidy.last(), None | Some(MenuEntry::Sep)) {
            continue;
        }
        tidy.push(e);
    }
    while tidy.last() == Some(&MenuEntry::Sep) {
        tidy.pop();
    }
    tidy
}

#[cfg(target_os = "macos")]
mod doc_menu {
    use super::{plan_doc_menu, MenuEntry};
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
    use objc2::{msg_send, sel, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{NSEvent, NSMenu, NSMenuItem, NSUserInterfaceItemIdentification};
    use objc2_foundation::NSString;
    use std::sync::OnceLock;
    use tauri::Emitter;

    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
    const PREFIX: &str = "galley:";

    /// Adds willOpenMenu:withEvent: and galleyMenuItem: to wry's WKWebView
    /// subclass, which defines neither. Called on every page load; installs
    /// once, from the live webview (wry registers its class lazily, so it
    /// does not exist yet at setup).
    pub fn ensure_installed(webview: &tauri::Webview) {
        use tauri::Manager;
        static INSTALLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
        if INSTALLED.swap(true, std::sync::atomic::Ordering::SeqCst) {
            return;
        }
        let _ = APP.set(webview.app_handle().clone());
        let res = webview.with_webview(|pw| {
            let ptr = pw.inner() as *const AnyObject;
            // SAFETY: wry hands over its live WKWebView; read on the main thread.
            let Some(obj) = (unsafe { ptr.as_ref() }) else { return };
            // wry's class name carries its version (e.g. "…WryWebView0.55.1"),
            // so take the instance's class, stepping past a KVO subclass.
            let mut cls = obj.class();
            if cls.name().to_string_lossy().starts_with("NSKVONotifying_") {
                cls = cls.superclass().unwrap_or(cls);
            }
            let cls = cls as *const AnyClass as *mut AnyClass;
            // SAFETY: the IMPs match the type encodings (v@:@@ and v@:@).
            unsafe {
                let will: unsafe extern "C-unwind" fn(&AnyObject, Sel, *mut NSMenu, *mut NSEvent) = will_open_menu;
                let pick: unsafe extern "C-unwind" fn(&AnyObject, Sel, *mut NSMenuItem) = menu_item_picked;
                let ok1 = objc2::ffi::class_addMethod(cls, sel!(willOpenMenu:withEvent:), std::mem::transmute::<_, Imp>(will), c"v@:@@".as_ptr());
                let ok2 = objc2::ffi::class_addMethod(cls, sel!(galleyMenuItem:), std::mem::transmute::<_, Imp>(pick), c"v@:@".as_ptr());
                if !ok1.as_bool() || !ok2.as_bool() {
                    eprintln!("doc menu: class_addMethod failed on {} ({:?}, {:?})", (*cls).name().to_string_lossy(), ok1, ok2);
                }
            }
        });
        if let Err(e) = res {
            eprintln!("doc menu: with_webview failed: {}", e);
        }
    }

    unsafe extern "C-unwind" fn will_open_menu(this: &AnyObject, _cmd: Sel, menu: *mut NSMenu, event: *mut NSEvent) {
        if let Some(sup) = AnyClass::get(c"WKWebView") {
            let _: () = msg_send![super(this, sup), willOpenMenu: menu, withEvent: event];
        }
        let (Some(menu), Some(mtm)) = (menu.as_ref(), MainThreadMarker::new()) else {
            return;
        };
        let originals = menu.itemArray();
        let items: Vec<(Option<String>, bool)> = (0..originals.count())
            .map(|i| {
                let it = originals.objectAtIndex(i);
                (it.identifier().map(|s| s.to_string()), it.isSeparatorItem())
            })
            .collect();
        let plan = plan_doc_menu(&items);
        menu.removeAllItems();
        for entry in plan {
            match entry {
                MenuEntry::Keep(i) => menu.addItem(&originals.objectAtIndex(i)),
                MenuEntry::Sep => menu.addItem(&NSMenuItem::separatorItem(mtm)),
                MenuEntry::Item(id, title) => {
                    let item: Retained<NSMenuItem> = NSMenuItem::initWithTitle_action_keyEquivalent(
                        NSMenuItem::alloc(mtm),
                        &NSString::from_str(title),
                        Some(sel!(galleyMenuItem:)),
                        &NSString::from_str(""),
                    );
                    item.setTarget(Some(this));
                    item.setIdentifier(Some(&NSString::from_str(&format!("{}{}", PREFIX, id))));
                    menu.addItem(&item);
                }
            }
        }
    }

    unsafe extern "C-unwind" fn menu_item_picked(_this: &AnyObject, _cmd: Sel, sender: *mut NSMenuItem) {
        let Some(item) = sender.as_ref() else { return };
        let Some(id) = item.identifier().map(|s| s.to_string()) else { return };
        if let (Some(app), Some(id)) = (APP.get(), id.strip_prefix(PREFIX)) {
            if let Err(e) = app.emit("doc-menu", id.to_string()) {
                eprintln!("doc-menu emit error: {}", e);
            }
        }
    }
}

/// DOC-MENU: put plain text on the general pasteboard. The page cannot do it
/// reliably from a native menu action (WebKit wants a user gesture).
#[tauri::command]
fn write_clipboard(app: tauri::AppHandle, text: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        app.run_on_main_thread(move || {
            use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
            use objc2_foundation::NSString;
            let pb = NSPasteboard::generalPasteboard();
            pb.clearContents();
            // SAFETY: NSPasteboardTypeString is an AppKit constant.
            let ok = pb.setString_forType(&NSString::from_str(&text), unsafe { NSPasteboardTypeString });
            if !ok {
                eprintln!("write_clipboard: pasteboard refused the string");
            }
        })
        .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, text);
        Err("clipboard is macOS-only".into())
    }
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
        .add_filter("Markdown", &["md", "markdown", "mdc", "txt"])
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

        // Only viewable files (UXF-07: .mdc and the agent rule files too).
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if !is_md_name(&name) {
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

/// U-18 (cold-start fix): hand the frontend any files macOS asked us to open
/// before it was listening, and mark it ready so later opens emit live.
///
/// Called once from tv-native.js during init. Draining and flagging in the same
/// call is deliberate — it closes the window in which a `RunEvent::Opened`
/// could be buffered *and* emitted, which would open the file twice.
#[tauri::command]
fn take_pending_opens(state: tauri::State<PendingOpens>) -> Vec<String> {
    state.ready.store(true, Ordering::SeqCst);
    let mut paths = state.paths.lock().unwrap();
    std::mem::take(&mut *paths)
}

/// C-02: the frontend has decided it is safe to quit. Flip the guard so the
/// close is not intercepted a second time, then exit.
///
/// Called after the user answered the unsaved-changes sheet (or immediately,
/// when no tab was dirty). Exiting rather than closing the window keeps one
/// code path for the red close button, ⇧⌘W and ⌘Q, which on a single-window
/// document app all mean the same thing.
#[tauri::command]
fn confirm_close(app: tauri::AppHandle, state: tauri::State<CloseGuard>) -> Result<(), String> {
    state.confirmed.store(true, Ordering::SeqCst);
    app.exit(0);
    Ok(())
}

/// C-02: ask the user what to do about unsaved edits before quitting.
///
/// Returns "save" | "discard" | "cancel". Uses the NON-blocking callback API
/// with a oneshot channel, matching pick_md_files / save_md_file_as — a
/// blocking dialog here would stall the main thread (E-01).
#[tauri::command]
async fn confirm_quit_dialog(app: tauri::AppHandle, count: u32) -> Result<String, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<MessageDialogResult>();

    let noun = if count == 1 { "document" } else { "documents" };
    let message = format!(
        "Save changes to {} {} before quitting? Your edits will be lost if you do not save them.",
        count, noun
    );

    app.dialog()
        .message(message)
        .title("Unsaved changes")
        .kind(MessageDialogKind::Warning)
        // macOS orders these right to left: Save All is the default button.
        .buttons(MessageDialogButtons::YesNoCancelCustom(
            "Save All".to_string(),
            "Discard".to_string(),
            "Cancel".to_string(),
        ))
        .show_with_result(move |result| {
            let _ = tx.send(result);
        });

    let result = rx.await.map_err(|e| format!("dialog channel error: {}", e))?;

    Ok(match result {
        MessageDialogResult::Custom(label) => match label.as_str() {
            "Save All" => "save",
            "Discard" => "discard",
            _ => "cancel",
        },
        MessageDialogResult::Yes | MessageDialogResult::Ok => "save",
        MessageDialogResult::No => "discard",
        MessageDialogResult::Cancel => "cancel",
    }
    .to_string())
}

/// C-36: keep View ▸ Appearance truthful.
///
/// DR-14 wants the active choice checked AT ALL TIMES, not only when the choice
/// was made from the menu. The frontend calls this whenever the theme changes by
/// any route (⌘K palette, the titlebar button, a system appearance switch), with
/// the USER'S choice — "light" | "dark" | "system" — not the resolved colour, so
/// "System" stays checked while the OS flips underneath it.
#[tauri::command]
fn set_appearance_check(app: tauri::AppHandle, choice: String) -> Result<(), String> {
    let state = app
        .try_state::<AppearanceMenuState>()
        .ok_or_else(|| "appearance menu not built yet".to_string())?;
    state
        .light
        .set_checked(choice == "light")
        .map_err(|e| e.to_string())?;
    state
        .dark
        .set_checked(choice == "dark")
        .map_err(|e| e.to_string())?;
    state
        .system
        .set_checked(choice == "system")
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// C-36: rebuild File ▸ Open Recent from the frontend's MRU.
///
/// The list lives in localStorage, so only JS can supply it; it re-sends on
/// every change. Items are capped at RECENT_MENU_MAX and identified by index
/// (`menu:recent-<i>`), with the path table kept alongside so on_menu_event can
/// resolve a click back to a file. An empty list leaves a single disabled row so
/// the submenu never looks broken.
#[tauri::command]
fn set_recent_files(app: tauri::AppHandle, paths: Vec<String>) -> Result<(), String> {
    const RECENT_MENU_MAX: usize = 10;

    let state = app
        .try_state::<RecentMenuState>()
        .ok_or_else(|| "recent menu not built yet".to_string())?;

    let kept: Vec<String> = paths.into_iter().take(RECENT_MENU_MAX).collect();

    // Clear the submenu. remove_at(0) returns Ok(None) once it is empty.
    loop {
        match state.submenu.remove_at(0) {
            Ok(Some(_)) => continue,
            Ok(None) => break,
            Err(e) => return Err(format!("open-recent clear failed: {}", e)),
        }
    }

    if kept.is_empty() {
        let empty = MenuItem::with_id(&app, "menu:recent-none", "No recent files", false, None::<&str>)
            .map_err(|e| e.to_string())?;
        state.submenu.append(&empty).map_err(|e| e.to_string())?;
    } else {
        for (i, path) in kept.iter().enumerate() {
            let label = std::path::Path::new(path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| path.clone());
            let item = MenuItem::with_id(
                &app,
                format!("menu:recent-{}", i),
                label,
                true,
                None::<&str>,
            )
            .map_err(|e| e.to_string())?;
            state.submenu.append(&item).map_err(|e| e.to_string())?;
        }
    }

    *state.paths.lock().map_err(|e| e.to_string())? = kept;
    Ok(())
}

/// Native save-as dialog; writes content; returns Some(FileDoc) or None if cancelled.
/// Uses the non-blocking callback API with a oneshot channel to avoid deadlocking
/// the main thread (E-01 fix).
///
/// JS passes `suggestedName` (Tauri 2 camelCases command arguments) and an optional
/// `directory` (F-23: where the panel opens for a New File). A directory that is
/// missing or no longer exists is ignored, so the panel falls back to macOS's own
/// last-used location rather than failing.
#[tauri::command]
async fn save_md_file_as(
    app: tauri::AppHandle,
    content: String,
    suggested_name: String,
    directory: Option<String>,
) -> Result<Option<FileDoc>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<tauri_plugin_dialog::FilePath>>();

    let mut dialog = app
        .dialog()
        .file()
        .set_file_name(&suggested_name)
        .add_filter("Markdown", &["md", "markdown", "mdc", "txt"]);
    if let Some(dir) = directory.filter(|d| std::path::Path::new(d).is_dir()) {
        dialog = dialog.set_directory(dir);
    }
    dialog.save_file(move |path| {
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

/// UXF-02: scan limits. `uncapped: true` (a "Show N more files" row, or loading
/// one unscanned folder) uses the wide set.
struct ScanLimits {
    /// Directory entries read across the whole walk.
    budget: usize,
    /// Markdown files listed per folder.
    file_cap: usize,
    /// Safety only; deeper folders come back `scanned: false`.
    max_depth: usize,
}

const SCAN_DEFAULT: ScanLimits = ScanLimits { budget: 20_000, file_cap: 500, max_depth: 40 };
const SCAN_WIDE: ScanLimits = ScanLimits { budget: 200_000, file_cap: 5_000, max_depth: 40 };

/// UXF-02: folder names never scanned, at any depth below the root the user
/// picked. Generated or vendored trees that would only burn the budget.
const SCAN_DENY: &[&str] = &[
    ".git", "node_modules", ".venv", "venv", "__pycache__", ".next", ".nuxt",
    "Pods", ".cache", ".tox", ".gradle", ".terraform",
];
/// Denied only when the parent folder holds one of the listed marker files.
const SCAN_DENY_IF_PARENT_HAS: &[(&str, &[&str])] = &[
    ("target", &["Cargo.toml"]),
    ("dist", &["package.json", "pyproject.toml"]),
    ("build", &["package.json", "pyproject.toml"]),
];
/// macOS package bundles: application internals, not documents.
const SCAN_PACKAGE_EXTS: &[&str] = &["app", "framework", "xcodeproj", "xcworkspace", "photoslibrary"];

/// UXF-07: extensionless agent rule files, viewable at any depth.
const AGENT_FILE_NAMES: &[&str] = &[
    ".cursorrules", ".windsurfrules", ".clinerules", ".roorules", ".goosehints", ".rules",
];

/// A file the app lists and opens: `md`, `markdown`, `mdc` (Cursor rules,
/// UXF-07), `txt`, or one of AGENT_FILE_NAMES. Nothing else (DR-39): `.env`,
/// `settings.json`, `config.toml` never appear.
fn is_md_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    if AGENT_FILE_NAMES.contains(&lower.as_str()) {
        return true;
    }
    let ext = std::path::Path::new(&lower)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_string();
    ext == "md" || ext == "markdown" || ext == "mdc" || ext == "txt"
}

fn is_package_name(name: &str) -> bool {
    match name.rsplit_once('.') {
        Some((_, ext)) => {
            let ext = ext.to_ascii_lowercase();
            SCAN_PACKAGE_EXTS.iter().any(|p| *p == ext)
        }
        None => false,
    }
}

/// UXF-02: natural, case-insensitive order — `a2` < `a10` < `B`. Digit runs
/// compare by value; names equal ignoring case fall back to a byte compare so
/// the order is total and deterministic.
pub fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let la: Vec<char> = a.chars().flat_map(|c| c.to_lowercase()).collect();
    let lb: Vec<char> = b.chars().flat_map(|c| c.to_lowercase()).collect();
    let (mut i, mut j) = (0usize, 0usize);
    while i < la.len() && j < lb.len() {
        let (ca, cb) = (la[i], lb[j]);
        if ca.is_ascii_digit() && cb.is_ascii_digit() {
            let si = i;
            while i < la.len() && la[i].is_ascii_digit() { i += 1; }
            let sj = j;
            while j < lb.len() && lb[j].is_ascii_digit() { j += 1; }
            let da: String = la[si..i].iter().collect::<String>().trim_start_matches('0').to_string();
            let db: String = lb[sj..j].iter().collect::<String>().trim_start_matches('0').to_string();
            let ord = da.len().cmp(&db.len()).then_with(|| da.cmp(&db));
            if ord != Ordering::Equal { return ord; }
        } else {
            if ca != cb { return ca.cmp(&cb); }
            i += 1;
            j += 1;
        }
    }
    (la.len() - i).cmp(&(lb.len() - j)).then_with(|| a.cmp(b))
}

/// Arena node used during the breadth-first walk; children are indices.
struct ScanNode {
    name: String,
    path: std::path::PathBuf,
    depth: usize,
    files: Vec<DirEntry>,
    files_hidden: u32,
    children: Vec<usize>,
    direct_md: u32,
    scanned: bool,
}

/// UXF-02: the pure scan behind read_dir_tree (unit-tested below).
///
/// Breadth-first with a FIFO queue so one deep subtree can never starve its
/// siblings; the budget is checked between folders, and a folder reached after
/// it ran out is returned `scanned: false` (shown with "…", loaded on expand)
/// instead of silently missing. Symlinked folders are not followed; symlinked
/// files are. No file content is read (DR-06).
fn scan_dir_tree(path: &str, wide: bool) -> Result<DirTree, String> {
    scan_dir_tree_with(path, if wide { &SCAN_WIDE } else { &SCAN_DEFAULT })
}

fn scan_dir_tree_with(path: &str, limits: &ScanLimits) -> Result<DirTree, String> {
    use std::collections::VecDeque;

    let root_path = PathBuf::from(path);
    let root_name = root_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());

    let mut arena: Vec<ScanNode> = vec![ScanNode {
        name: root_name,
        path: root_path,
        depth: 0,
        files: Vec::new(),
        files_hidden: 0,
        children: Vec::new(),
        direct_md: 0,
        scanned: false,
    }];
    let mut queue: VecDeque<usize> = VecDeque::new();
    queue.push_back(0);
    let mut visited: usize = 0;
    let mut unreadable: u32 = 0;

    while let Some(idx) = queue.pop_front() {
        if idx != 0 && (visited >= limits.budget || arena[idx].depth > limits.max_depth) {
            continue; // stays scanned: false
        }
        let dir = arena[idx].path.clone();
        let entries = match std::fs::read_dir(&dir) {
            Ok(it) => it,
            Err(e) => {
                if idx == 0 {
                    return Err(format!("read_dir_tree: cannot read '{}': {}", path, e));
                }
                eprintln!("read_dir_tree: unreadable folder '{}': {}", dir.display(), e);
                unreadable += 1;
                arena[idx].scanned = true;
                continue;
            }
        };

        let mut files: Vec<DirEntry> = Vec::new();
        let mut dirs: Vec<(String, PathBuf)> = Vec::new();
        let mut names: std::collections::HashSet<String> = std::collections::HashSet::new();

        for entry in entries {
            let entry = match entry {
                Ok(e) => e,
                Err(e) => {
                    eprintln!("read_dir_tree: skipping unreadable entry in '{}': {}", dir.display(), e);
                    continue;
                }
            };
            visited += 1;
            let name = entry.file_name().to_string_lossy().to_string();
            let p = entry.path();
            let ft = match entry.file_type() {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            let (is_dir, is_file) = if ft.is_symlink() {
                // Symlinked folders are never followed (loops); symlinked files are.
                match std::fs::metadata(&p) {
                    Ok(m) => (false, m.is_file()),
                    Err(_) => (false, false),
                }
            } else {
                (ft.is_dir(), ft.is_file())
            };
            if is_file {
                names.insert(name.clone());
                if is_md_name(&name) {
                    files.push(DirEntry { name, path: p.to_string_lossy().to_string() });
                }
            } else if is_dir {
                if SCAN_DENY.contains(&name.as_str()) || is_package_name(&name) {
                    continue;
                }
                dirs.push((name, p));
            }
        }

        dirs.retain(|(name, _)| {
            !SCAN_DENY_IF_PARENT_HAS.iter().any(|(denied, markers)| {
                name == denied && markers.iter().any(|m| names.contains(*m))
            })
        });
        files.sort_by(|a, b| natural_cmp(&a.name, &b.name));
        dirs.sort_by(|a, b| natural_cmp(&a.0, &b.0));

        let direct = files.len() as u32;
        let hidden = files.len().saturating_sub(limits.file_cap) as u32;
        files.truncate(limits.file_cap);

        let depth = arena[idx].depth;
        let mut children = Vec::with_capacity(dirs.len());
        for (name, p) in dirs {
            let child = arena.len();
            arena.push(ScanNode {
                name,
                path: p,
                depth: depth + 1,
                files: Vec::new(),
                files_hidden: 0,
                children: Vec::new(),
                direct_md: 0,
                scanned: false,
            });
            children.push(child);
            queue.push_back(child);
        }

        let node = &mut arena[idx];
        node.files = files;
        node.files_hidden = hidden;
        node.direct_md = direct;
        node.children = children;
        node.scanned = true;
    }

    // Children always sit at higher indices than their parent (BFS), so one
    // reverse pass fills every subtree count bottom-up.
    let mut counts: Vec<u32> = arena.iter().map(|n| n.direct_md).collect();
    for idx in (0..arena.len()).rev() {
        let sum: u32 = arena[idx].children.iter().map(|c| counts[*c]).sum();
        counts[idx] += sum;
    }

    let mut truncated = false;
    fn build(
        idx: usize,
        arena: &mut Vec<ScanNode>,
        counts: &[u32],
        truncated: &mut bool,
    ) -> DirNode {
        let children = std::mem::take(&mut arena[idx].children);
        let folders = children
            .into_iter()
            .map(|c| build(c, arena, counts, truncated))
            .collect();
        let n = &mut arena[idx];
        if !n.scanned || n.files_hidden > 0 {
            *truncated = true;
        }
        DirNode {
            name: std::mem::take(&mut n.name),
            path: n.path.to_string_lossy().to_string(),
            files: std::mem::take(&mut n.files),
            files_hidden: n.files_hidden,
            folders,
            md_count: counts[idx],
            scanned: n.scanned,
        }
    }
    let root = build(0, &mut arena, &counts, &mut truncated);

    Ok(DirTree {
        path: path.to_string(),
        root,
        truncated,
        unreadable,
    })
}

/// Scan a folder for the sidebar tree (F-19, UXF-02). Async + spawn_blocking so
/// a large scan never runs on the main thread (the UI and menu bar stay live).
#[tauri::command]
async fn read_dir_tree(path: String, uncapped: Option<bool>) -> Result<DirTree, String> {
    let wide = uncapped.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || scan_dir_tree(&path, wide))
        .await
        .map_err(|e| format!("read_dir_tree: scan task failed: {}", e))?
}

/// UXF-10: one folder's entries for the Open Path completer. Names only (DR-06).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathListing {
    /// The folder read, with a leading `~` expanded.
    pub path: String,
    pub entries: Vec<PathEntry>,
    /// More than LIST_DIR_CAP entries: the rest were dropped.
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathEntry {
    pub name: String,
    pub dir: bool,
}

const LIST_DIR_CAP: usize = 5000;

/// `~` and `~/x` expand to the home folder; anything else is returned as is.
fn expand_home(path: &str) -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    if path == "~" {
        return home;
    }
    match path.strip_prefix("~/") {
        Some(rest) => format!("{}/{}", home.trim_end_matches('/'), rest),
        None => path.to_string(),
    }
}

/// Folders (package bundles excluded) and viewable files directly inside `path`,
/// natural-sorted. Hidden names are included; the completer decides when to show them.
fn list_path_entries(path: &str) -> Result<PathListing, String> {
    let full = expand_home(path);
    let rd = std::fs::read_dir(&full).map_err(|e| format!("cannot read {}: {}", full, e))?;
    let mut entries = Vec::new();
    let mut truncated = false;
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        // metadata() follows symlinks, so a link to a folder lists as a folder.
        let is_dir = match std::fs::metadata(entry.path()) {
            Ok(m) => m.is_dir(),
            Err(_) => continue,
        };
        if is_dir && is_package_name(&name) {
            continue;
        }
        if !is_dir && !is_md_name(&name) {
            continue;
        }
        if entries.len() >= LIST_DIR_CAP {
            truncated = true;
            break;
        }
        entries.push(PathEntry { name, dir: is_dir });
    }
    entries.sort_by(|a, b| natural_cmp(&a.name, &b.name));
    Ok(PathListing { path: full, entries, truncated })
}

#[tauri::command]
async fn list_dir(path: String) -> Result<PathListing, String> {
    tauri::async_runtime::spawn_blocking(move || list_path_entries(&path))
        .await
        .map_err(|e| format!("list_dir: task failed: {}", e))?
}

// ── Menu builder ─────────────────────────────────────────────────────────────

/// Build the native macOS menu bar (U-01 / F-08).
///
/// Menu structure:
///   App (Galley)  — About, separator, Services, separator, Hide, Hide Others,
///                        Show All, separator, Quit
///   File               — Open File… ⌘O, Open Folder… ⌘⇧O, Open Recent ▶,
///                        separator, Save ⌘S, separator, Print… ⌘P,
///                        Reveal in Finder, separator, Close Tab ⌘W
///   Edit               — Undo, Redo, separator, Cut, Copy, Paste, Select All,
///                        separator, Find ▶ (Find… ⌘F, Find Next ⌘G,
///                        Find Previous ⇧⌘G, Find in Files ⌘⇧F)
///   View               — Command Palette ⌘K, Toggle Sidebar ⌘B, Reveal in Sidebar ⇧⌘J, separator,
///                        Appearance ▶ Light / Dark / System (U-02, DR-11–14),
///                        separator, Zoom In ⌘+, Zoom Out ⌘-, Actual Size ⌘0
///   Go                 — Previous Tab ⌘[, Next Tab ⌘]
///   Window             — Minimize ⌘M, Zoom, separator, Close Window ⇧⌘W,
///                        separator, Bring All to Front (C-36)
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
fn build_menu(
    app: &tauri::AppHandle,
) -> tauri::Result<(Menu<tauri::Wry>, AppearanceMenuState, RecentMenuState)> {
    // ── App menu (macOS: first submenu is the app menu) ──────────────────
    let app_menu = Submenu::with_id(app, "app", "Galley", true)?;
    app_menu.append(&PredefinedMenuItem::about(app, None, None)?)?;
    app_menu.append(&PredefinedMenuItem::separator(app)?)?;
    app_menu.append(&PredefinedMenuItem::services(app, None)?)?;
    app_menu.append(&PredefinedMenuItem::separator(app)?)?;
    app_menu.append(&PredefinedMenuItem::hide(app, None)?)?;
    app_menu.append(&PredefinedMenuItem::hide_others(app, None)?)?;
    app_menu.append(&PredefinedMenuItem::show_all(app, None)?)?;
    app_menu.append(&PredefinedMenuItem::separator(app)?)?;
    // C-02: NOT PredefinedMenuItem::quit — that exits immediately and takes any
    // unsaved edits with it. This item routes ⌘Q through the same
    // tv-close-requested handshake as the red close button and ⇧⌘W.
    app_menu.append(&MenuItem::with_id(
        app,
        "menu:quit",
        "Quit Galley",
        true,
        Some("CmdOrCtrl+Q"),
    )?)?;

    // ── File menu ────────────────────────────────────────────────────────
    let file_menu = Submenu::with_id(app, "file", "File", true)?;
    // F-23: an accelerator here means macOS consumes ⌘N before the WebView, so the
    // JS ⌘N handler (kept for the browser build) cannot double-fire.
    file_menu.append(&MenuItem::with_id(
        app,
        "menu:new-file",
        "New File",
        true,
        Some("CmdOrCtrl+N"),
    )?)?;
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
    // UXF-10: type a path, with fuzzy completion (opens ⌘K in path mode).
    file_menu.append(&MenuItem::with_id(
        app,
        "menu:open-path",
        "Open Path\u{2026}",
        true,
        Some("CmdOrCtrl+L"),
    )?)?;
    // C-36: Open Recent ▸ — filled in by the frontend via set_recent_files
    // (the 20-entry MRU lives in localStorage, so Rust cannot build it here).
    let recent_submenu = Submenu::with_id(app, "file:open-recent", "Open Recent", true)?;
    recent_submenu.append(&MenuItem::with_id(
        app,
        "menu:recent-none",
        "No recent files",
        false,
        None::<&str>,
    )?)?;
    file_menu.append(&recent_submenu)?;
    file_menu.append(&PredefinedMenuItem::separator(app)?)?;
    file_menu.append(&MenuItem::with_id(
        app,
        "menu:save",
        "Save",
        true,
        Some("CmdOrCtrl+S"),
    )?)?;
    file_menu.append(&PredefinedMenuItem::separator(app)?)?;
    // C-36: ⌘P was bound in JS and in the palette but in no menu. The
    // accelerator here means macOS consumes the key before the WebView sees it,
    // so the JS ⌘P handler cannot double-fire — both routes end at print_page.
    file_menu.append(&MenuItem::with_id(
        app,
        "menu:print",
        "Print\u{2026}",
        true,
        Some("CmdOrCtrl+P"),
    )?)?;
    file_menu.append(&MenuItem::with_id(
        app,
        "menu:reveal-in-finder",
        "Reveal in Finder",
        true,
        None::<&str>,
    )?)?;
    file_menu.append(&PredefinedMenuItem::separator(app)?)?;
    file_menu.append(&MenuItem::with_id(
        app,
        "menu:close-tab",
        "Close Tab",
        true,
        Some("CmdOrCtrl+W"),
    )?)?;
    // DOC-MENU audit: the tabbed-app standard; reopens the last closed file.
    file_menu.append(&MenuItem::with_id(
        app,
        "menu:reopen-closed-tab",
        "Reopen Closed Tab",
        true,
        Some("CmdOrCtrl+Shift+T"),
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
    // C-36: Find ▸ submenu. Find Next / Find Previous were missing entirely,
    // so ⌘G — the macOS-wide "again" key — did nothing.
    let find_submenu = Submenu::with_id(app, "edit:find", "Find", true)?;
    find_submenu.append(&MenuItem::with_id(
        app,
        "menu:find",
        "Find\u{2026}",
        true,
        Some("CmdOrCtrl+F"),
    )?)?;
    find_submenu.append(&MenuItem::with_id(
        app,
        "menu:find-next",
        "Find Next",
        true,
        Some("CmdOrCtrl+G"),
    )?)?;
    find_submenu.append(&MenuItem::with_id(
        app,
        "menu:find-prev",
        "Find Previous",
        true,
        Some("CmdOrCtrl+Shift+G"),
    )?)?;
    find_submenu.append(&PredefinedMenuItem::separator(app)?)?;
    find_submenu.append(&MenuItem::with_id(
        app,
        "menu:find-in-files",
        "Find in Files",
        true,
        Some("CmdOrCtrl+Shift+F"),
    )?)?;
    edit_menu.append(&find_submenu)?;

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
    // UXF-06: directly under Toggle Sidebar; tv-native.js routes it to
    // TV.revealInSidebar(). The accelerator means macOS takes ⇧⌘J first.
    view_menu.append(&MenuItem::with_id(
        app,
        "menu:reveal-in-sidebar",
        "Reveal in Sidebar",
        true,
        Some("CmdOrCtrl+Shift+J"),
    )?)?;
    view_menu.append(&PredefinedMenuItem::separator(app)?)?;

    // ── Appearance submenu (U-02, DR-11–DR-14) ───────────────────────────
    // Three CheckMenuItems: Light, Dark, System. Default on launch: System (checked).
    // DR-14 (menu-driven checkmark): on_menu_event reads AppearanceMenuState to
    // uncheck the previous item and check the newly selected one.
    // C-36: bidirectional sync IS implemented now — the frontend calls
    // set_appearance_check() on every theme change, whatever triggered it, so
    // the checkmark can no longer contradict the actual appearance (DR-14).
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

    // C-36: the old "Toggle Dark Mode" item is GONE. It competed with the
    // Appearance group above it and the two could disagree, because nothing kept
    // the checkmarks in sync. Appearance is now the single truthful control:
    // set_appearance_check() re-checks the right row whatever route the user
    // took (menu, ⌘K palette, titlebar button, OS appearance switch).
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

    // ── Window menu (C-36) ───────────────────────────────────────────────
    // The HIG requires a Window menu for a document app and App Store review
    // flags its absence; U-01 names ⌘M specifically. Close Window is ⇧⌘W, NOT
    // the predefined item, because that one claims ⌘W and would collide with
    // File ▸ Close Tab; it also has to run the C-02 unsaved-changes check.
    let window_menu = Submenu::with_id(app, "window", "Window", true)?;
    window_menu.append(&PredefinedMenuItem::minimize(app, None)?)?;
    window_menu.append(&PredefinedMenuItem::maximize(app, Some("Zoom"))?)?;
    window_menu.append(&PredefinedMenuItem::separator(app)?)?;
    window_menu.append(&MenuItem::with_id(
        app,
        "menu:close-window",
        "Close Window",
        true,
        Some("CmdOrCtrl+Shift+W"),
    )?)?;
    window_menu.append(&PredefinedMenuItem::separator(app)?)?;
    window_menu.append(&PredefinedMenuItem::bring_all_to_front(app, None)?)?;

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
    menu.append(&window_menu)?;
    menu.append(&help_menu)?;

    let appearance_state = AppearanceMenuState {
        light: appear_light,
        dark: appear_dark,
        system: appear_system,
    };

    let recent_state = RecentMenuState {
        submenu: recent_submenu,
        paths: Mutex::new(Vec::new()),
    };

    Ok((menu, appearance_state, recent_state))
}

// ── App entry point ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(WatcherState(Mutex::new(HashMap::new())))
        .manage(PendingOpens {
            paths: Mutex::new(Vec::new()),
            ready: AtomicBool::new(false),
        })
        .manage(CloseGuard {
            confirmed: AtomicBool::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            pick_md_files,
            pick_folder,
            read_md_file,
            read_dir_tree,
            list_dir,
            save_md_file,
            save_md_file_as,
            reveal_in_finder,
            print_page,
            take_pending_opens,
            watch_file,
            unwatch_file,
            confirm_close,
            confirm_quit_dialog,
            set_appearance_check,
            set_recent_files,
            write_clipboard,
        ])
        .setup(|app| {
            // Build and register the native macOS menu bar (U-01 / F-08).
            // build_menu returns (Menu, AppearanceMenuState, RecentMenuState) so
            // we can manage the CheckMenuItem handles for DR-14 checkmark
            // toggling and the Open Recent submenu handle for C-36.
            let (menu, appearance_state, recent_state) = build_menu(app.handle())?;
            app.set_menu(menu)?;
            app.manage(appearance_state);
            // C-36: the Open Recent submenu handle, so set_recent_files can
            // rebuild it once the frontend hands over its MRU.
            app.manage(recent_state);
            // Window size and position survive relaunch: AppKit's frame
            // autosave (user defaults, not a document write — DR-06).
            #[cfg(target_os = "macos")]
            if let Some(win) = app.get_webview_window("main") {
                match win.ns_window() {
                    Ok(ptr) => {
                        // SAFETY: Tauri's live NSWindow; setup runs on the main thread.
                        if let Some(w) = unsafe { (ptr as *const objc2::runtime::AnyObject).as_ref() } {
                            let name = objc2_foundation::NSString::from_str("GalleyMainWindow");
                            unsafe {
                                let _: objc2::runtime::Bool = objc2::msg_send![w, setFrameUsingName: &*name];
                                let _: objc2::runtime::Bool = objc2::msg_send![w, setFrameAutosaveName: &*name];
                            }
                        }
                    }
                    Err(e) => eprintln!("window frame autosave: {}", e),
                }
            }
            // UXF-09: forward trackpad finger phases (AppKit wants the main thread).
            #[cfg(target_os = "macos")]
            {
                let handle = app.handle().clone();
                let h2 = handle.clone();
                if let Err(e) = handle.run_on_main_thread(move || install_swipe_monitor(h2)) {
                    eprintln!("swipe monitor install failed: {}", e);
                }
            }
            Ok(())
        })
        // DOC-MENU: edit WebKit's context menu before it opens (lib.rs doc_menu).
        .on_page_load(|webview, _payload| {
            #[cfg(target_os = "macos")]
            doc_menu::ensure_installed(webview);
            #[cfg(not(target_os = "macos"))]
            let _ = webview;
        })
        // C-02: never let the window close on unsaved edits without asking.
        //
        // The frontend owns the dirty state, so Rust cannot answer the question
        // itself: prevent the close, hand it to JS, and wait for confirm_close.
        // Two escape hatches keep this from becoming an unquittable app:
        //   1. the guard only arms once the frontend has drained
        //      take_pending_opens, i.e. tv-native.js booted and its
        //      tv-close-requested listener is registered;
        //   2. tv-native.js closes anyway on any error in its own handler.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                if app.state::<CloseGuard>().confirmed.load(Ordering::SeqCst) {
                    return; // the user already answered — let it through
                }
                if !app
                    .state::<PendingOpens>()
                    .ready
                    .load(Ordering::SeqCst)
                {
                    return; // frontend never booted; do not trap the user
                }
                api.prevent_close();
                if let Err(e) = app.emit("tv-close-requested", ()) {
                    eprintln!("tv-close-requested emit error: {}", e);
                }
            }
        })
        // Handle menu item events: emit app-level Tauri events so the frontend
        // (tv-native.js) can listen via window.__TAURI__.event.listen().
        // Predefined items (Undo/Redo/Cut/Copy/Paste/SelectAll/About/Quit etc.)
        // are handled natively by the OS — they do NOT appear here.
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            match id {
                // File menu
                "menu:new-file"
                | "menu:open-file"
                | "menu:open-folder"
                | "menu:open-path"
                | "menu:save"
                | "menu:close-tab"
                | "menu:reopen-closed-tab"
                // Edit menu
                | "menu:find"
                | "menu:find-in-files"
                | "menu:find-next"
                | "menu:find-prev"
                // View menu
                | "menu:command-palette"
                | "menu:toggle-sidebar"
                | "menu:reveal-in-sidebar"
                | "menu:zoom-in"
                | "menu:zoom-out"
                | "menu:zoom-reset"
                // Go menu
                | "menu:prev-tab"
                | "menu:next-tab"
                // C-36: File ▸ Print… / Reveal in Finder
                | "menu:print"
                | "menu:reveal-in-finder"
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

                // C-02: ⌘Q and ⇧⌘W both go through the same unsaved-changes
                // handshake as the red close button. Neither exits directly.
                //
                // Same escape hatch as the CloseRequested guard: this is a
                // CUSTOM Quit item, so if the frontend never booted there would
                // be nothing listening and ⌘Q would do nothing at all. Exit
                // outright in that case — there can be no unsaved edits in a
                // frontend that never ran.
                "menu:quit" | "menu:close-window" => {
                    if !app.state::<PendingOpens>().ready.load(Ordering::SeqCst) {
                        app.exit(0);
                        return;
                    }
                    if let Err(e) = app.emit("tv-close-requested", ()) {
                        eprintln!("tv-close-requested emit error: {}", e);
                    }
                }

                // C-36: File ▸ Open Recent ▸ <file>. Resolve the index back to
                // its path and reuse the existing "open-files" handler in
                // tv-native.js, which already reads and opens a path list.
                other if other.starts_with("menu:recent-") => {
                    let idx = other
                        .trim_start_matches("menu:recent-")
                        .parse::<usize>()
                        .ok();
                    if let (Some(i), Some(state)) = (idx, app.try_state::<RecentMenuState>()) {
                        let path = state.paths.lock().ok().and_then(|p| p.get(i).cloned());
                        if let Some(path) = path {
                            if let Err(e) = app.emit("open-files", vec![path]) {
                                eprintln!("open-recent emit error: {}", e);
                            }
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
                        // Only forward files the app understands (UXF-07: .mdc too).
                        std::path::Path::new(path)
                            .file_name()
                            .map(|n| is_md_name(&n.to_string_lossy()))
                            .unwrap_or(false)
                    })
                    .collect();

                if !paths.is_empty() {
                    // U-18 (cold-start fix): on a double-click / "Open With" of a
                    // COLD app this fires long before tv-native.js has registered
                    // its listener, and emit() does not buffer — the file was
                    // silently dropped and only the restored session came up.
                    // Buffer until the frontend drains via take_pending_opens();
                    // once it has, emit live as before (the warm path, which
                    // always worked). ready is only ever set by that drain, so a
                    // path is never both buffered and emitted.
                    let pending = app_handle.state::<PendingOpens>();
                    if pending.ready.load(Ordering::SeqCst) {
                        if let Err(e) = app_handle.emit("open-files", &paths) {
                            eprintln!("RunEvent::Opened emit error: {}", e);
                        }
                    } else {
                        pending.paths.lock().unwrap().extend(paths);
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

    // ISS-006: the README's `.github/media/*.png` rendered as the broken-image
    // placeholder because Tauri builds the asset-protocol scope with
    // `require_literal_leading_dot: true` on unix by default (scope/fs.rs —
    // "dotfiles are not supposed to be exposed by default on unix"), so the glob
    // `**` never matches a path with a dot-leading component.
    //
    // The array form `"scope": ["**"]` CANNOT express the override: it
    // deserializes to `FsScope::AllowedPaths`, a variant with nowhere to carry the
    // flag. Only the struct form can — and omitting the flag there is equally
    // broken, because `None` falls through to the unix default. Both regressions
    // are silent at build time and only show up as a broken image at runtime,
    // which is why this asserts on the parsed config rather than on file text.
    #[test]
    fn asset_scope_serves_dot_leading_paths() {
        use tauri::utils::config::{Config, FsScope};

        let cfg: Config = serde_json::from_str(include_str!("../tauri.conf.json"))
            .expect("tauri.conf.json parses");

        match &cfg.app.security.asset_protocol.scope {
            FsScope::AllowedPaths(allow) => panic!(
                "ISS-006: the array scope form re-enables requireLiteralLeadingDot on unix, \
                 so images under .github/ (or any hidden dir) stop loading. Use the object \
                 form with requireLiteralLeadingDot: false. Got: {:?}",
                allow
            ),
            FsScope::Scope {
                require_literal_leading_dot,
                ..
            } => assert_eq!(
                *require_literal_leading_dot,
                Some(false),
                "ISS-006: requireLiteralLeadingDot must stay explicitly false — omitting it \
                 leaves None, which falls through to the unix default of true and silently \
                 breaks images in dot-leading directories"
            ),
        }
    }

    // ── UXF-02: read_dir_tree scan ──────────────────────────────────────

    fn tmp(tag: &str) -> PathBuf {
        let mut base = std::env::temp_dir();
        base.push(format!("tv_uxf02_{}_{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        base
    }

    fn scan(base: &std::path::Path) -> DirTree {
        scan_dir_tree(&base.to_string_lossy(), false).expect("scan ok")
    }

    fn child<'a>(n: &'a DirNode, name: &str) -> Option<&'a DirNode> {
        n.folders.iter().find(|f| f.name == name)
    }

    fn names(files: &[DirEntry]) -> Vec<&str> {
        files.iter().map(|f| f.name.as_str()).collect()
    }

    // Criterion 1 (S1/S3): 60 top-level folders, all present, each with its
    // count, in natural order — the old 10-subfolder cap and the 200-entry
    // budget would have shown a handful.
    #[test]
    fn scan_shows_every_folder_past_ten() {
        let base = tmp("sixty");
        for i in 1..=60 {
            let d = base.join(format!("f{}", i));
            fs::create_dir_all(&d).unwrap();
            for j in 0..3 {
                fs::write(d.join(format!("n{}.md", j)), "x").unwrap();
            }
        }
        let t = scan(&base);
        assert_eq!(t.root.folders.len(), 60);
        let order: Vec<&str> = t.root.folders.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(&order[..3], &["f1", "f2", "f3"], "natural order: {:?}", &order[..12]);
        assert_eq!(order[9], "f10");
        assert!(t.root.folders.iter().all(|f| f.md_count == 3 && f.scanned));
        assert_eq!(t.root.md_count, 180);
        assert!(!t.truncated);
        let _ = fs::remove_dir_all(&base);
    }

    // Criteria 2, 3, 13 (S2): deny-listed trees are never shown or counted;
    // hidden folders such as .claude are.
    #[test]
    fn scan_skips_deny_list_but_keeps_dot_folders() {
        let base = tmp("deny");
        for d in ["node_modules/pkg", ".git/refs", ".claude/docs", "docs", "app/target", "crate/target"] {
            fs::create_dir_all(base.join(d)).unwrap();
        }
        fs::write(base.join("node_modules/pkg/readme.md"), "x").unwrap();
        fs::write(base.join(".git/refs/HEAD.md"), "x").unwrap();
        fs::write(base.join(".claude/docs/a.md"), "x").unwrap();
        fs::write(base.join("docs/b.md"), "x").unwrap();
        // `target` is only denied next to a Cargo.toml.
        fs::write(base.join("crate/Cargo.toml"), "x").unwrap();
        fs::write(base.join("crate/target/gen.md"), "x").unwrap();
        fs::write(base.join("app/target/keep.md"), "x").unwrap();
        fs::write(base.join("README.md"), "x").unwrap();

        let t = scan(&base);
        assert!(child(&t.root, "node_modules").is_none(), "node_modules absent");
        assert!(child(&t.root, ".git").is_none(), ".git absent");
        assert_eq!(child(&t.root, ".claude").map(|n| n.md_count), Some(1), ".claude present");
        assert!(child(&t.root, "docs").is_some());
        let krate = child(&t.root, "crate").unwrap();
        assert!(child(krate, "target").is_none(), "Cargo target denied");
        assert_eq!(krate.md_count, 0);
        let app = child(&t.root, "app").unwrap();
        assert!(child(app, "target").is_some(), "target without Cargo.toml kept");
        assert_eq!(names(&t.root.files), vec!["README.md"]);
        assert_eq!(t.root.md_count, 4);

        // The deny-list never applies to the root the user picked.
        let nm = scan(&base.join("node_modules"));
        assert_eq!(nm.root.md_count, 1);
        let _ = fs::remove_dir_all(&base);
    }

    // Criterion 4: folders without direct markdown files are still present,
    // carrying the count of what lies below.
    #[test]
    fn scan_keeps_folders_whose_markdown_is_deep() {
        let base = tmp("deep");
        let mut d = base.clone();
        for i in 1..=8 {
            d = d.join(format!("l{}", i));
        }
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("bottom.md"), "x").unwrap();
        fs::create_dir_all(base.join("empty/inner")).unwrap();
        fs::write(base.join("empty/inner/image.png"), "x").unwrap();

        let t = scan(&base);
        let mut n = &t.root;
        for i in 1..=8 {
            n = child(n, &format!("l{}", i)).expect("ancestor present");
            assert_eq!(n.md_count, 1, "ancestor l{} counts 1", i);
            assert!(n.scanned);
        }
        assert_eq!(names(&n.files), vec!["bottom.md"]);
        let empty = child(&t.root, "empty").expect("folders without markdown are still returned");
        assert_eq!(empty.md_count, 0);
        let _ = fs::remove_dir_all(&base);
    }

    // Criterion 5: natural, case-insensitive order for files and folders.
    #[test]
    fn scan_sorts_naturally() {
        let base = tmp("sort");
        for f in ["a10.md", "c.md", "B.md", "a2.md", "skip.png"] {
            fs::write(base.join(f), "x").unwrap();
        }
        for d in ["Zeta", "alpha"] {
            fs::create_dir_all(base.join(d)).unwrap();
            fs::write(base.join(d).join("x.md"), "x").unwrap();
        }
        let t = scan(&base);
        assert_eq!(names(&t.root.files), vec!["a2.md", "a10.md", "B.md", "c.md"]);
        let folders: Vec<&str> = t.root.folders.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(folders, vec!["alpha", "Zeta"]);
        let _ = fs::remove_dir_all(&base);
    }

    // UXF-10: Open Path lists folders and viewable files only, naturally sorted.
    #[test]
    fn list_dir_lists_folders_and_viewable_files() {
        let base = tmp("listdir");
        for f in ["b10.md", "b2.md", "notes.txt", "img.png", "data.json", ".cursorrules"] {
            fs::write(base.join(f), "x").unwrap();
        }
        for d in ["sub", ".hidden", "Tool.app"] {
            fs::create_dir_all(base.join(d)).unwrap();
        }
        let l = list_path_entries(base.to_str().unwrap()).unwrap();
        let got: Vec<(String, bool)> = l.entries.iter().map(|e| (e.name.clone(), e.dir)).collect();
        assert_eq!(
            got,
            vec![
                (".cursorrules".into(), false),
                (".hidden".into(), true),
                ("b2.md".into(), false),
                ("b10.md".into(), false),
                ("notes.txt".into(), false),
                ("sub".into(), true),
            ]
        );
        assert!(!l.truncated);
        assert!(list_path_entries(base.join("missing").to_str().unwrap()).is_err());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn expand_home_handles_tilde_forms() {
        let home = std::env::var("HOME").unwrap();
        assert_eq!(expand_home("~"), home);
        assert_eq!(expand_home("~/a/b"), format!("{}/a/b", home.trim_end_matches('/')));
        assert_eq!(expand_home("/abs/~/x"), "/abs/~/x");
        assert_eq!(expand_home("~user/x"), "~user/x");
    }

    #[test]
    fn natural_cmp_orders_digit_runs_by_value() {
        use std::cmp::Ordering::*;
        assert_eq!(natural_cmp("a2", "a10"), Less);
        assert_eq!(natural_cmp("a10", "B"), Less);
        assert_eq!(natural_cmp("file007", "file7"), Less, "equal value falls back to bytes");
        assert_eq!(natural_cmp("Alpha", "alpha"), Less, "case-only twins are both kept, in a fixed order");
        assert_eq!(natural_cmp("x", "x"), Equal);
    }

    // Criterion 7 (S5): FILE_CAP per folder, the rest counted; uncapped lists all.
    #[test]
    fn scan_caps_files_per_folder() {
        let base = tmp("cap");
        for i in 0..520 {
            fs::write(base.join(format!("f{}.md", i)), "x").unwrap();
        }
        let t = scan(&base);
        assert_eq!(t.root.files.len(), 500);
        assert_eq!(t.root.files_hidden, 20);
        assert_eq!(t.root.md_count, 520, "hidden files still counted");
        assert!(t.truncated);
        let wide = scan_dir_tree(&base.to_string_lossy(), true).unwrap();
        assert_eq!(wide.root.files.len(), 520);
        assert!(!wide.truncated);
        let _ = fs::remove_dir_all(&base);
    }

    // Criterion 8: past the budget, folders come back unscanned — never missing.
    #[test]
    fn scan_marks_folders_past_budget_unscanned() {
        let base = tmp("budget");
        for d in ["a", "b", "c"] {
            fs::create_dir_all(base.join(d)).unwrap();
            for i in 0..5 {
                fs::write(base.join(d).join(format!("{}.md", i)), "x").unwrap();
            }
        }
        // Root has 3 entries, folder a has 5: budget 8 is spent after a.
        let limits = ScanLimits { budget: 8, file_cap: 500, max_depth: 40 };
        let t = scan_dir_tree_with(&base.to_string_lossy(), &limits).unwrap();
        assert_eq!(t.root.folders.len(), 3, "no folder is missing");
        assert!(child(&t.root, "a").unwrap().scanned);
        let b = child(&t.root, "b").unwrap();
        assert!(!b.scanned && b.files.is_empty() && b.md_count == 0);
        assert!(t.truncated);
        let _ = fs::remove_dir_all(&base);
    }

    // Criterion 10: a symlink loop is not followed; a symlinked file is listed.
    #[cfg(unix)]
    #[test]
    fn scan_does_not_follow_symlinked_folders() {
        let base = tmp("link");
        fs::create_dir_all(base.join("a")).unwrap();
        fs::write(base.join("a/real.md"), "x").unwrap();
        std::os::unix::fs::symlink(&base, base.join("a/loop")).unwrap();
        std::os::unix::fs::symlink(base.join("a/real.md"), base.join("alias.md")).unwrap();
        let t = scan(&base);
        let a = child(&t.root, "a").unwrap();
        assert!(child(a, "loop").is_none(), "symlinked folder not followed");
        assert_eq!(names(&t.root.files), vec!["alias.md"], "symlinked file listed");
        assert_eq!(t.root.md_count, 2);
        let _ = fs::remove_dir_all(&base);
    }

    // Criterion 16: an unreadable folder is counted; the rest of the tree is intact.
    #[cfg(unix)]
    #[test]
    fn scan_counts_unreadable_folders() {
        use std::os::unix::fs::PermissionsExt;
        let base = tmp("perm");
        fs::create_dir_all(base.join("locked")).unwrap();
        fs::create_dir_all(base.join("open")).unwrap();
        fs::write(base.join("open/a.md"), "x").unwrap();
        fs::set_permissions(base.join("locked"), fs::Permissions::from_mode(0o000)).unwrap();
        let readable_anyway = fs::read_dir(base.join("locked")).is_ok(); // running as root
        let t = scan(&base);
        fs::set_permissions(base.join("locked"), fs::Permissions::from_mode(0o755)).unwrap();
        if !readable_anyway {
            assert_eq!(t.unreadable, 1);
        }
        assert_eq!(child(&t.root, "open").unwrap().md_count, 1);
        let _ = fs::remove_dir_all(&base);
    }

    // UXF-07: Cursor's .mdc rules and the extensionless agent rule files are
    // viewable at any depth; secrets and config files never are.
    #[test]
    fn scan_lists_mdc_and_agent_rule_files() {
        let base = tmp("agent");
        fs::create_dir_all(base.join(".cursor/rules")).unwrap();
        fs::create_dir_all(base.join(".claude")).unwrap();
        fs::create_dir_all(base.join("pkg")).unwrap();
        fs::create_dir_all(base.join(".git")).unwrap();
        fs::write(base.join(".cursor/rules/style.mdc"), "x").unwrap();
        fs::write(base.join(".cursorrules"), "x").unwrap();
        fs::write(base.join("pkg/.clinerules"), "x").unwrap();
        fs::write(base.join(".aider.chat.history.md"), "x").unwrap();
        fs::write(base.join(".git/notes.md"), "x").unwrap();
        for secret in [".env", "id_rsa", "credentials.json", "settings.json", "config.toml"] {
            fs::write(base.join(".claude").join(secret), "x").unwrap();
            fs::write(base.join(secret), "x").unwrap();
        }
        let t = scan(&base);
        let root_names = names(&t.root.files);
        assert!(root_names.contains(&".cursorrules"), "{:?}", root_names);
        assert!(root_names.contains(&".aider.chat.history.md"), "{:?}", root_names);
        let cursor = child(child(&t.root, ".cursor").unwrap(), "rules").unwrap();
        assert_eq!(names(&cursor.files), vec!["style.mdc"]);
        assert_eq!(names(&child(&t.root, "pkg").unwrap().files), vec![".clinerules"]);
        assert!(child(&t.root, ".git").is_none(), "SCAN_DENY still applies");
        let claude = child(&t.root, ".claude").unwrap();
        assert!(claude.files.is_empty() && claude.md_count == 0, "no secret is ever listed");
        for n in [".env", "id_rsa", "credentials.json", "settings.json", "config.toml"] {
            assert!(!root_names.contains(&n), "{} listed", n);
        }
        assert!(is_md_name("Rule.MDC") && is_md_name(".WindsurfRules") && !is_md_name("rules"));
        let _ = fs::remove_dir_all(&base);
    }

    // UXF-09: finger phases only — momentum and phase-less mouse wheels are
    // never forwarded; may-begin counts as began.
    #[test]
    fn swipe_phase_maps_finger_phases_only() {
        assert_eq!(swipe_phase(1, 0), Some("began"));
        assert_eq!(swipe_phase(32, 0), Some("began"));
        assert_eq!(swipe_phase(4, 0), Some("changed"));
        assert_eq!(swipe_phase(8, 0), Some("ended"));
        assert_eq!(swipe_phase(16, 0), Some("cancelled"));
        assert_eq!(swipe_phase(2, 0), None, "stationary");
        assert_eq!(swipe_phase(0, 0), None, "mouse wheel");
        for mp in [1, 2, 4, 8] {
            assert_eq!(swipe_phase(0, mp), None, "momentum {}", mp);
        }
    }

    fn st(phase: &'static str, t: f64, dx: f64) -> SwipeTouch {
        SwipeTouch { phase, t, dx, dy: 0.0, precise: true, inverted: true, x: 10.0, y: 20.0, mods: false }
    }

    // UXF-09: IPC stays small — changed deltas coalesce to one message per
    // 16 ms (nothing lost: the sum is carried), only for the first second of a
    // touch, and a pending delta is flushed before `ended`.
    #[test]
    fn swipe_forwarder_coalesces_and_bounds_ipc() {
        let mut f = SwipeForwarder::default();
        let mut out = f.push(st("began", 0.0, 0.0));
        for i in 1..=10 {
            out.extend(f.push(st("changed", i as f64 * 4.0, 2.0)));
        }
        out.extend(f.push(st("ended", 44.0, 0.0)));
        let phases: Vec<&str> = out.iter().map(|m| m.phase).collect();
        assert_eq!(phases.first(), Some(&"began"));
        assert_eq!(phases.last(), Some(&"ended"));
        let moved: f64 = out.iter().filter(|m| m.phase == "changed").map(|m| m.dx).sum();
        assert_eq!(moved, 20.0, "every delta arrives, coalesced");
        assert!(out.iter().filter(|m| m.phase == "changed").count() <= 4, "{:?}", phases);

        let mut f = SwipeForwarder::default();
        f.push(st("began", 0.0, 0.0));
        let late = f.push(st("changed", 1500.0, 5.0));
        assert!(late.is_empty(), "no changed messages after the first second of a touch");
        assert_eq!(f.push(st("ended", 1600.0, 0.0)).last().map(|m| m.phase), Some("ended"));
    }

    // UXF-09: the wire names tv-swipe.js reads.
    #[test]
    fn swipe_touch_serializes_camel_case() {
        let v = serde_json::to_value(st("changed", 1.0, 2.0)).unwrap();
        for k in ["phase", "t", "dx", "dy", "precise", "inverted", "x", "y", "mods"] {
            assert!(v.get(k).is_some(), "SwipeTouch.{}", k);
        }
    }

    // Package bundles are skipped; the root itself must exist.
    #[test]
    fn scan_skips_packages_and_errors_on_missing_root() {
        let base = tmp("pkg");
        fs::create_dir_all(base.join("Thing.app/Contents")).unwrap();
        fs::write(base.join("Thing.app/Contents/notes.md"), "x").unwrap();
        let t = scan(&base);
        assert!(t.root.folders.is_empty());
        assert!(scan_dir_tree(&base.join("nope").to_string_lossy(), false).is_err());
        let _ = fs::remove_dir_all(&base);
    }

    // Criterion 18: the wire names JS reads. tv-native.runtime.test.js reads the
    // same names from this file's source; this pins the serialized form.
    #[test]
    fn dir_tree_serializes_camel_case() {
        let base = tmp("wire");
        fs::write(base.join("a.md"), "x").unwrap();
        let v = serde_json::to_value(scan(&base)).unwrap();
        for k in ["path", "root", "truncated", "unreadable"] {
            assert!(v.get(k).is_some(), "DirTree.{}", k);
        }
        for k in ["name", "path", "files", "filesHidden", "folders", "mdCount", "scanned"] {
            assert!(v["root"].get(k).is_some(), "DirNode.{}", k);
        }
        let _ = fs::remove_dir_all(&base);
    }

    // DOC-MENU: the WebKit context menu is edited, never left to navigate.
    fn wk(name: &str) -> (Option<String>, bool) {
        (Some(format!("WKMenuItemIdentifier{}", name)), false)
    }
    fn sep() -> (Option<String>, bool) {
        (None, true)
    }

    #[test]
    fn doc_menu_selection_keeps_system_items_and_adds_galley_ones() {
        let items = vec![wk("LookUp"), wk("Translate"), wk("SearchWeb"), sep(), wk("Copy"), sep(), wk("ShareMenu"), sep(), wk("SpeechMenu")];
        let plan = plan_doc_menu(&items);
        assert_eq!(plan, vec![
            MenuEntry::Keep(0), MenuEntry::Keep(1), MenuEntry::Keep(2), MenuEntry::Sep,
            MenuEntry::Keep(4), MenuEntry::Item("copy-markdown", "Copy as Markdown"), MenuEntry::Sep,
            MenuEntry::Keep(6), MenuEntry::Sep, MenuEntry::Keep(8), MenuEntry::Sep,
            MenuEntry::Item("find-selection", "Find in Document"), MenuEntry::Item("find-in-files", "Find in Files"),
        ]);
    }

    #[test]
    fn doc_menu_link_drops_navigation_and_downloads() {
        let items = vec![wk("OpenLink"), wk("OpenLinkInNewWindow"), wk("DownloadLinkedFile"), wk("CopyLink"), sep(), wk("ShareMenu")];
        let plan = plan_doc_menu(&items);
        assert_eq!(plan, vec![
            MenuEntry::Item("open-link", "Open Link"), MenuEntry::Keep(3), MenuEntry::Sep, MenuEntry::Keep(5),
        ]);
    }

    #[test]
    fn doc_menu_blank_area_gets_document_items_above_inspect() {
        let items = vec![wk("GoBack"), wk("GoForward"), wk("Reload"), sep(), wk("InspectElement")];
        let plan = plan_doc_menu(&items);
        assert_eq!(plan, vec![
            MenuEntry::Item("select-all", "Select All"), MenuEntry::Item("find", "Find\u{2026}"),
            MenuEntry::Item("edit", "Edit Source"), MenuEntry::Sep, MenuEntry::Item("print", "Print\u{2026}"),
            MenuEntry::Sep, MenuEntry::Keep(4),
        ]);
    }

    #[test]
    fn doc_menu_editable_text_is_left_alone() {
        let items = vec![wk("Cut"), wk("Copy"), wk("Paste"), sep(), wk("SpellingMenu"), (None, false)];
        let plan = plan_doc_menu(&items);
        assert_eq!(plan, vec![
            MenuEntry::Keep(0), MenuEntry::Keep(1), MenuEntry::Keep(2), MenuEntry::Sep, MenuEntry::Keep(4), MenuEntry::Keep(5),
        ]);
    }

    #[test]
    fn doc_menu_image_drops_open_and_download() {
        let items = vec![wk("OpenImageInNewWindow"), wk("DownloadImage"), wk("CopyImage"), sep(), wk("ShareMenu")];
        assert_eq!(plan_doc_menu(&items), vec![MenuEntry::Keep(2), MenuEntry::Sep, MenuEntry::Keep(4)]);
    }
}
