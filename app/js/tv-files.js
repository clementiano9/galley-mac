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
  const MD_EXTS = ['.md', '.markdown', '.txt'];
  const MD_ACCEPT = { 'text/markdown': ['.md', '.markdown'], 'text/plain': ['.txt'] };

  function isMdFile(file) {
    const name = (file.name || '').toLowerCase();
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

  let _dragCounter = 0; // use a counter so child-leave doesn't flicker

  function setDragHint(on) {
    const root = getTVRoot();
    if (!root) return;
    if (on) {
      root.classList.add('tv-drag-over');
    } else {
      root.classList.remove('tv-drag-over');
    }
  }

  function hasMdItems(dt) {
    if (!dt || !dt.items) return false;
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i];
      if (item.kind === 'file') {
        const type = item.type || '';
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
      const r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsText(file, 'utf-8');
    });
  }

  /* ── process a list of File objects (drop or input fallback) */
  async function openFiles(files) {
    const tv = getTV();
    if (!tv) return;
    for (const file of files) {
      if (!isMdFile(file)) continue;
      try {
        const text = await readFileAsText(file);
        tv.openDoc({
          name: file.name,
          source: text,
          path: 'opened',
          // no fileHandle — came via FileReader (drop or <input>)
        });
      } catch (err) {
        console.error('[TVFiles] error reading file', file.name, err);
      }
    }
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

      const dt = e.dataTransfer;
      if (!dt || !dt.files || dt.files.length === 0) return;
      openFiles(Array.from(dt.files));
    });

    // Also make the .tv-dropzone a comfortable drop target
    // (events bubble up to document handlers above, but we add
    //  explicit listeners so the empty state dropzone stays
    //  visually responsive even before dragging reaches document.)
    const root = getTVRoot();
    if (root) {
      root.addEventListener('dragenter', function (e) {
        const dz = e.target && e.target.closest
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
  async function openPicker() {
    const tv = getTV();
    if (!tv) return;

    // ── path 0: Tauri native NSOpenPanel (highest priority) ──
    if (window.TVNative && TVNative.available) {
      return TVNative.openPicker();
    }

    // ── path A: File System Access API (Chrome/Edge/Arc) ──────
    if (typeof window.showOpenFilePicker === 'function') {
      let handles;
      try {
        handles = await window.showOpenFilePicker({
          multiple: true,
          types: [
            {
              description: 'Markdown files',
              accept: MD_ACCEPT,
            },
          ],
          excludeAcceptAllOption: false,
        });
      } catch (err) {
        if (err && err.name === 'AbortError') return; // user cancelled — silent
        console.error('[TVFiles] showOpenFilePicker error', err);
        return;
      }

      for (const handle of handles) {
        try {
          const file = await handle.getFile();
          const text = await file.text();
          tv.openDoc({
            name: file.name,
            source: text,
            fileHandle: handle,
            path: 'opened',
          });
        } catch (err) {
          if (err && err.name === 'AbortError') return;
          console.error('[TVFiles] error reading handle', err);
        }
      }
      return;
    }

    // ── path B: <input type="file"> fallback (Safari / Firefox) ─
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.txt';
    input.multiple = true;
    input.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none';

    input.addEventListener('change', function () {
      const files = Array.from(input.files || []);
      openFiles(files);
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
    }, 60000);
  }

  /* ── writeFile: explicit Save — never writes unrequested ──── */
  async function writeFile(tab) {
    if (!tab) return;
    const tv = getTV();

    // ── path 0: Tauri native save (highest priority) ──────────
    if (window.TVNative && TVNative.available) {
      return TVNative.saveTab(tab);
    }

    const content = tab.source || '';

    // ── path A: existing handle from File System Access API ───
    if (tab.fileHandle && typeof tab.fileHandle.createWritable === 'function') {
      try {
        const writable = await tab.fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
        if (tv) tv.markDirty(tab.id, false);
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        console.error('[TVFiles] writeFile (handle) error', err);
      }
      return;
    }

    // ── path B: showSaveFilePicker (no handle yet) ─────────────
    if (typeof window.showSaveFilePicker === 'function') {
      let handle;
      try {
        handle = await window.showSaveFilePicker({
          suggestedName: tab.name || 'document.md',
          types: [
            {
              description: 'Markdown file',
              accept: MD_ACCEPT,
            },
          ],
        });
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        console.error('[TVFiles] showSaveFilePicker error', err);
        return;
      }
      try {
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        // Persist handle on the tab so future saves skip the picker
        tab.fileHandle = handle;
        tab.name = handle.name || tab.name;
        if (tv) {
          tv.markDirty(tab.id, false);
          // Re-render to show updated tab name / clear dirty dot
          if (typeof tv.render === 'function') tv.render();
        }
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        console.error('[TVFiles] writeFile (save picker) error', err);
      }
      return;
    }

    // ── path C: download fallback (all browsers) ──────────────
    try {
      const blob = new Blob([content], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = tab.name || 'document.md';
      a.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(url);
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 10000);
      if (tv) tv.markDirty(tab.id, false);
    } catch (err) {
      console.error('[TVFiles] writeFile (download) error', err);
    }
  }

  /* ── public API ──────────────────────────────────────────── */
  window.TVFiles = {
    init: init,
    openPicker: openPicker,
    writeFile: writeFile,
  };
})();
