/* ───────────────────────────────────────────────────────────
   Galley · file open / drag-drop / save
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
  var _lastDragCount = 0; // C-41: dataTransfer.items.length from the last dragenter, when known
  var _dragCardEl = null; // C-41: the labelled drop-target card

  // C-41: "Drop to open N files", pluralised when a count is known; an
  // invariant fallback otherwise (no dashes per the app's copy rules).
  // C-41 (round 2): the card carries a hierarchy now — a headline the user
  // reads first, then the quiet detail line. The count belongs in the detail,
  // so the headline never changes shape as files are dragged in and out.
  function _dragCardMessage(count) {
    if (count > 0) {
      return count === 1 ? 'Opens 1 file' : 'Opens ' + count + ' files';
    }
    return 'Markdown, .markdown or .txt';
  }

  // Named a public function (not a closure) so it can be called from any
  // code path that toggles .tv-drag-over — currently only this module's own
  // dragenter/dragleave/drop handlers below. tv-native.js maintains its OWN
  // separate .tv-drag-over toggle for Tauri's tauri://drag-* events (browser
  // dragenter never fires for Finder drags in a WKWebView); it does not yet
  // call into this, so the labelled card is a browser-path improvement today
  // — see plan/requests-modules.md for the native-side hookup this enables.
  function showDragCard(count) {
    var root = getTVRoot();
    if (!root) return;
    // The empty state's own .tv-dropzone already carries explanatory copy —
    // don't stack a second card on top of it.
    if (root.querySelector('.tv-dropzone')) return;
    if (_dragCardEl) return; // already shown
    var I = window.TV_ICONS || {};
    var card = document.createElement('div');
    card.className = 'tv-drag-card';
    card.setAttribute('aria-hidden', 'true'); // decorative — drag-and-drop is not AT-operable
    card.innerHTML =
      '<span class="tv-drag-card-ring"><span class="ic">' + (I.doc || '') + '</span></span>' +
      '<span class="tv-drag-card-title">Drop it like it&#39;s hot</span>' +
      '<span class="tv-drag-card-msg">' + _dragCardMessage(count || 0) + '</span>';
    root.appendChild(card);
    _dragCardEl = card;
  }

  function hideDragCard() {
    if (_dragCardEl && _dragCardEl.parentNode) _dragCardEl.parentNode.removeChild(_dragCardEl);
    _dragCardEl = null;
  }

  function setDragHint(on) {
    var root = getTVRoot();
    if (!root) return;
    if (on) {
      root.classList.add('tv-drag-over');
      // C-41: a labelled card instead of an unlabelled tint.
      showDragCard(_lastDragCount);
    } else {
      root.classList.remove('tv-drag-over');
      hideDragCard();
      _lastDragCount = 0;
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
        // C-41: capture the item count while we still have a real dataTransfer
        // (native Tauri drops never reach this handler at all, so the card
        // falls back to the invariant message there — see showDragCard).
        _lastDragCount = (e.dataTransfer && e.dataTransfer.items) ? e.dataTransfer.items.length : 0;
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
        // requests-shell.md #2: rethrow (was resolving on failure/cancel,
        // making a failed or cancelled save indistinguishable from a real
        // one at the call site — C-03 needs writeFile's promise to be the
        // witness). Keep AbortError silent in the console; it still rejects
        // so the shell can tell "cancelled" from "disk error".
        if (!(err && err.name === 'AbortError')) {
          console.error('[TVFiles] writeFile (handle) error', err);
        }
        throw err;
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
        // requests-shell.md #2: same rethrow as path A, same reasoning.
        if (!(err && err.name === 'AbortError')) {
          console.error('[TVFiles] writeFile (save picker) error', err);
        }
        throw err;
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
        if (tv) tv.markDirty(tab.id, false);
        // requests-shell.md #3: resolve right away — markDirty(false) has
        // already run, so making the caller wait out a 10s cleanup timer
        // before acknowledging the save left the UI in edit mode that long.
        resolve();
        setTimeout(function () {
          URL.revokeObjectURL(url);
          if (a.parentNode) a.parentNode.removeChild(a);
        }, 10000);
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
    // C-41: exposed so another drag-over toggle path (e.g. a future
    // tv-native.js hookup for the Tauri tauri://drag-* events) can show the
    // same labelled card instead of maintaining its own copy.
    showDragCard: showDragCard,
    hideDragCard: hideDragCard,
  };
})();
