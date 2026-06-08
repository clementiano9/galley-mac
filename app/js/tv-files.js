/* ───────────────────────────────────────────────────────────
   tiny-viewer · file open / drag-drop / save
   window.TVFiles = { init(), openPicker(), writeFile(tab) }

   DR-06: open real .md files from disk; never write anything
          except on an explicit user Save action.
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  /* ── helpers ─────────────────────────────────────────────── */

  // Accepted MIME / extension combos
  var MD_EXTS = ['.md', '.markdown', '.txt'];
  var MD_ACCEPT = { 'text/markdown': ['.md', '.markdown'], 'text/plain': ['.txt'] };

  function isMdFile(file) {
    var name = (file.name || '').toLowerCase();
    return MD_EXTS.some(function (ext) { return name.endsWith(ext); });
  }

  function getTV() {
    if (!window.TV) { console.warn('[TVFiles] window.TV not ready'); return null; }
    return window.TV;
  }

  function getTVRoot() {
    if (window.TV && typeof window.TV.el === 'function') return window.TV.el();
    return document.querySelector('.tv') || document.body;
  }

  /* ── drag-over visual hint ───────────────────────────────── */
  // Style owner: add .tv-drag-over { border: 2px dashed var(--tv-accent) !important; }
  //              and .tv-drag-over .tv-dropzone { border-color: var(--tv-accent) !important; }

  var _dragCounter = 0; // use a counter so child-leave doesn't flicker

  function setDragHint(on) {
    var root = getTVRoot();
    if (!root) return;
    if (on) {
      root.classList.add('tv-drag-over');
    } else {
      root.classList.remove('tv-drag-over');
    }
  }

  function hasMdItems(dt) {
    if (!dt || !dt.items) return false;
    for (var i = 0; i < dt.items.length; i++) {
      var item = dt.items[i];
      if (item.kind === 'file') {
        var type = item.type || '';
        if (
          type === 'text/markdown' ||
          type === 'text/plain' ||
          type === '' // file kind but type unknown — allow, we check name on drop
        ) return true;
      }
    }
    return false;
  }

  /* ── read a File object via FileReader → promise<string> ─── */
  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsText(file, 'utf-8');
    });
  }

  /* ── process a list of File objects (drop or input fallback) */
  // E-12: path is null for browser-opened files (no real directory available).
  // These land under the "Open" section in the sidebar instead of a fake folder.
  function openFiles(files) {
    var tv = getTV();
    if (!tv) return Promise.resolve();

    var promise = Promise.resolve();
    files.forEach(function (file) {
      if (!isMdFile(file)) return;
      promise = promise.then(function () {
        return readFileAsText(file).then(function (text) {
          tv.openDoc({
            name: file.name,
            source: text,
            path: null, // E-12: no real path in browser drop — use null, not 'opened'
            // fileHandle intentionally omitted — came via FileReader (drop or <input>)
          });
        }).catch(function (err) {
          console.error('[TVFiles] error reading file', file.name, err);
        });
      });
    });
    return promise;
  }

  /* ── init: wire drag-and-drop globally + on the dropzone ─── */
  function init() {
    // Prevent the browser from navigating when a file is dropped anywhere
    document.addEventListener('dragover', function (e) {
      e.preventDefault();
    });

    document.addEventListener('dragenter', function (e) {
      e.preventDefault();
      if (hasMdItems(e.dataTransfer)) {
        _dragCounter++;
        if (_dragCounter === 1) setDragHint(true);
      }
    });

    document.addEventListener('dragleave', function (e) {
      if (_dragCounter > 0) {
        _dragCounter--;
        if (_dragCounter === 0) setDragHint(false);
      }
    });

    document.addEventListener('drop', function (e) {
      e.preventDefault();
      _dragCounter = 0;
      setDragHint(false);

      var dt = e.dataTransfer;
      if (!dt || !dt.files || dt.files.length === 0) return;
      openFiles(Array.from(dt.files));
    });

    // Also make the .tv-dropzone a comfortable drop target
    // (events bubble up to document handlers above, but we add
    //  explicit listeners so the empty state dropzone stays
    //  visually responsive even before dragging reaches document.)
    var root = getTVRoot();
    if (root) {
      root.addEventListener('dragenter', function (e) {
        var dz = e.target && e.target.closest
          ? e.target.closest('.tv-dropzone')
          : null;
        if (dz) {
          e.preventDefault();
          e.stopPropagation();
        }
      });
    }

    // Re-wire dropzone if TV re-renders (TV.on may or may not exist yet)
    if (window.TV && typeof window.TV.on === 'function') {
      window.TV.on('render', function () {
        // Nothing extra needed — the document-level drop handler covers it.
        // The drag-over class is on the .tv root so it survives renders.
      });
    }
  }

  /* ── openPicker: prefer File System Access API ───────────── */
  function openPicker() {
    var tv = getTV();
    if (!tv) return Promise.resolve();

    // ── path 0: Tauri native NSOpenPanel (highest priority) ──
    if (window.TVNative && TVNative.available) {
      return TVNative.openPicker();
    }

    // ── path A: File System Access API (Chrome/Edge/Arc) ──────
    if (typeof window.showOpenFilePicker === 'function') {
      return window.showOpenFilePicker({
        multiple: true,
        types: [
          {
            description: 'Markdown files',
            accept: MD_ACCEPT,
          },
        ],
        excludeAcceptAllOption: false,
      }).then(function (handles) {
        var p = Promise.resolve();
        handles.forEach(function (handle) {
          p = p.then(function () {
            return handle.getFile().then(function (file) {
              return file.text().then(function (text) {
                // E-12: path null — no real directory known in browser FSAPI
                tv.openDoc({
                  name: file.name,
                  source: text,
                  fileHandle: handle,
                  path: null,
                });
              });
            });
          }).catch(function (err) {
            if (err && err.name === 'AbortError') return;
            console.error('[TVFiles] error reading handle', err);
          });
        });
        return p;
      }).catch(function (err) {
        if (err && err.name === 'AbortError') return; // user cancelled — silent
        console.error('[TVFiles] showOpenFilePicker error', err);
      });
    }

    // ── path B: <input type="file"> fallback (Safari / Firefox) ─
    return new Promise(function (resolve) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.md,.markdown,.txt';
      input.multiple = true;
      input.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none';

      input.addEventListener('change', function () {
        var files = Array.from(input.files || []);
        openFiles(files).then(resolve);
        // Clean up the element
        if (input.parentNode) input.parentNode.removeChild(input);
      });

      // Required: must be in DOM for Safari to fire the change event
      document.body.appendChild(input);
      input.click();

      // If the user dismisses without selecting, clean up after a short wait
      // (no cancel event exists on <input>)
      setTimeout(function () {
        if (input.parentNode) input.parentNode.removeChild(input);
        resolve();
      }, 60000);
    });
  }

  /* ── writeFile: explicit Save — never writes unrequested ──── */
  // Takes a Tab object as its single argument.
  // E-05: consistent single signature writeFile(tab) — no (handle, source) overload.
  function writeFile(tab) {
    if (!tab) return Promise.resolve();
    var tv = getTV();

    // ── path 0: Tauri native save (highest priority) ──────────
    if (window.TVNative && TVNative.available) {
      return TVNative.saveTab(tab);
    }

    var content = tab.source || '';

    // ── path A: existing handle from File System Access API ───
    if (tab.fileHandle && typeof tab.fileHandle.createWritable === 'function') {
      return tab.fileHandle.createWritable().then(function (writable) {
        return writable.write(content).then(function () {
          return writable.close();
        });
      }).then(function () {
        if (tv) tv.markDirty(tab.id, false);
      }).catch(function (err) {
        if (err && err.name === 'AbortError') return;
        console.error('[TVFiles] writeFile (handle) error', err);
      });
    }

    // ── path B: showSaveFilePicker (no handle yet) ─────────────
    if (typeof window.showSaveFilePicker === 'function') {
      return window.showSaveFilePicker({
        suggestedName: tab.name || 'document.md',
        types: [
          {
            description: 'Markdown file',
            accept: MD_ACCEPT,
          },
        ],
      }).then(function (handle) {
        return handle.createWritable().then(function (writable) {
          return writable.write(content).then(function () {
            return writable.close();
          });
        }).then(function () {
          // Persist handle on the tab so future saves skip the picker
          tab.fileHandle = handle;
          tab.name = handle.name || tab.name;
          if (tv) {
            tv.markDirty(tab.id, false);
            // Re-render to show updated tab name / clear dirty dot
            if (typeof tv.render === 'function') tv.render();
          }
        });
      }).catch(function (err) {
        if (err && err.name === 'AbortError') return;
        console.error('[TVFiles] writeFile (save picker) error', err);
      });
    }

    // ── path C: download fallback (all browsers) ──────────────
    return new Promise(function (resolve) {
      try {
        var blob = new Blob([content], { type: 'text/markdown' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = tab.name || 'document.md';
        a.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          URL.revokeObjectURL(url);
          if (a.parentNode) a.parentNode.removeChild(a);
          resolve();
        }, 10000);
        if (tv) tv.markDirty(tab.id, false);
      } catch (err) {
        console.error('[TVFiles] writeFile (download) error', err);
        resolve();
      }
    });
  }

  /* ── public API ──────────────────────────────────────────── */
  window.TVFiles = {
    init: init,
    openPicker: openPicker,
    writeFile: writeFile,
  };
})();
