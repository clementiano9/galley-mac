/* ───────────────────────────────────────────────────────────
   tiny-viewer · app spine
   window.TV — state, render loop, chrome, tabs, sidebar,
               keyboard router, theme/accent.
   Owns: index.html + js/tv-app.js  (contract §file-ownership)
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  /* ── tiny id generator ────────────────────────────────────── */
  var _idSeq = 0;
  function uid() { return 'tv-' + (++_idSeq) + '-' + Date.now(); }

  /* ── icon helper (shorthand) ──────────────────────────────── */
  function ic(name) {
    var icons = window.TV_ICONS || {};
    return '<span class="ic">' + (icons[name] || '') + '</span>';
  }

  /* ── HTML escape ──────────────────────────────────────────── */
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ── tiny event emitter ───────────────────────────────────── */
  var _listeners = {};
  function tvOn(event, fn) {
    (_listeners[event] = _listeners[event] || []).push(fn);
  }
  function tvEmit(event, payload) {
    (_listeners[event] || []).forEach(function (fn) {
      try { fn(payload); } catch (e) { /* isolate listener errors */ }
    });
  }

  /* ── state ────────────────────────────────────────────────── */
  var state = {
    tabs: [],
    activeId: null,
    sidebarOpen: true,
    mode: 'reading',       // 'reading' | 'edit'
    theme: localStorage.getItem('tv-theme') || 'light',
    accent: localStorage.getItem('tv-accent') || 'blue',
  };

  /* ── Tab constructor ──────────────────────────────────────── */
  function makeTab(opts) {
    return {
      id: opts.id || uid(),
      name: opts.name || 'untitled.md',
      path: opts.path || null,
      source: opts.source || '',
      scrollTop: 0,
      dirty: false,
      live: !!opts.live,
      fileHandle: opts.fileHandle || null,
    };
  }

  /* ── deduplication key ────────────────────────────────────── */
  function tabKey(opts) {
    return opts.path ? opts.path + '/' + opts.name : opts.name;
  }

  /* ────────────────────────────────────────────────────────────
     BUILD HELPERS — produce HTML strings
   ──────────────────────────────────────────────────────────── */

  function buildTitlebar() {
    var tab = getActiveTab();
    var title = tab ? tab.name : 'tiny-viewer';
    if (state.mode === 'edit' && tab) title = tab.name + ' — editing';
    var icons = window.TV_ICONS || {};
    return (
      '<div class="tv-titlebar">' +
        '<div class="tv-traffic">' +
          '<span class="tv-light c"></span>' +
          '<span class="tv-light m"></span>' +
          '<span class="tv-light x"></span>' +
        '</div>' +
        '<div class="tv-wintitle">' +
          '<span class="tv-doc-ic">' + (icons.doc || '') + '</span>' +
          esc(title) +
        '</div>' +
      '</div>'
    );
  }

  function buildTabbar() {
    var icons = window.TV_ICONS || {};
    var tabs = state.tabs.map(function (t) {
      var lead = '';
      if (t.live) {
        lead = '<span class="tv-bolt">' + (icons.bolt || '') + '</span>';
      } else if (t.dirty) {
        lead = '<span class="tv-dot"></span>';
      }
      var cls = 'tv-tab' + (t.id === state.activeId ? ' active' : '');
      return (
        '<div class="' + cls + '" data-tab-id="' + esc(t.id) + '">' +
          lead +
          '<span class="name">' + esc(t.name) + '</span>' +
          '<span class="tv-close" data-close-tab="' + esc(t.id) + '" title="Close">' +
            (icons.close || '') +
          '</span>' +
        '</div>'
      );
    }).join('');

    return (
      '<div class="tv-tabbar">' +
        tabs +
        '<div class="tv-newtab" data-newtab title="New tab (⌘O)">' +
          (icons.plus || '') +
        '</div>' +
      '</div>'
    );
  }

  function buildSidebar() {
    var icons = window.TV_ICONS || {};
    var collapsed = !state.sidebarOpen;

    // Group tabs by path
    var groups = {};
    var ungrouped = [];
    state.tabs.forEach(function (t) {
      if (t.path) {
        (groups[t.path] = groups[t.path] || []).push(t);
      } else {
        ungrouped.push(t);
      }
    });

    var rows = '';

    // Grouped entries
    Object.keys(groups).forEach(function (path) {
      rows += (
        '<div class="tv-tree-row folder">' +
          ic('folder') +
          '<span>' + esc(path) + '</span>' +
        '</div>'
      );
      groups[path].forEach(function (t) {
        var cls = 'tv-tree-row file' + (t.id === state.activeId ? ' active' : '');
        rows += (
          '<div class="' + cls + '" data-sidebar-tab="' + esc(t.id) + '">' +
            ic('doc') +
            '<span>' + esc(t.name) + '</span>' +
            (t.live ? '<span class="mini-bolt">' + (icons.bolt || '') + '</span>' : '') +
          '</div>'
        );
      });
    });

    // Ungrouped entries shown under a "Recent" section
    if (ungrouped.length) {
      if (Object.keys(groups).length) {
        rows += '<div class="tv-side-divider"></div>';
      }
      rows += '<div class="tv-side-label">Recent</div>';
      ungrouped.forEach(function (t) {
        var cls = 'tv-tree-row file' + (t.id === state.activeId ? ' active' : '');
        rows += (
          '<div class="' + cls + '" data-sidebar-tab="' + esc(t.id) + '">' +
            ic('doc') +
            '<span>' + esc(t.name) + '</span>' +
            (t.live ? '<span class="mini-bolt">' + (icons.bolt || '') + '</span>' : '') +
          '</div>'
        );
      });
    }

    var sidebarCls = 'tv-sidebar' + (collapsed ? ' collapsed' : '');
    return (
      '<aside class="' + sidebarCls + '">' +
        '<div class="tv-side-scroll">' + rows + '</div>' +
        '<div class="tv-search">' +
          '<div class="tv-search-box" data-open-search>' +
            ic('search') +
            '<span>Search…</span>' +
            '<span class="kbd">⌘F</span>' +
          '</div>' +
        '</div>' +
      '</aside>'
    );
  }

  function buildViewer() {
    var tab = getActiveTab();
    if (!tab) {
      return (
        '<div class="tv-viewer">' +
          '<div class="tv-empty">' +
            '<div class="tv-dropzone">' +
              '<span class="dz-ic">' + ((window.TV_ICONS || {}).tray || '') + '</span>' +
              '<span class="dz-title">Drop .md files here</span>' +
              '<span class="dz-or">— or —</span>' +
              '<span class="dz-cmd"><span class="kbd">⌘O</span> to open files</span>' +
            '</div>' +
          '</div>' +
          '<div class="tv-empty-hint">No file open · nothing is imported, nothing is synced</div>' +
        '</div>'
      );
    }

    // Edit mode
    if (state.mode === 'edit') {
      var wordCount = 0;
      if (window.TVEdit && typeof TVEdit.wordCount === 'function') {
        wordCount = TVEdit.wordCount(tab.source);
      }
      var editContent = '';
      if (window.TVEdit && typeof TVEdit.renderSource === 'function') {
        editContent = TVEdit.renderSource(tab);
      } else {
        // Fallback: plain textarea-style view
        editContent = '<div class="tv-source">' +
          tab.source.split('\n').map(function (ln, k) {
            return (
              '<div class="tv-srcline">' +
                '<span class="tv-gutter">' + (k + 1) + '</span>' +
                '<span class="tv-srctext">' + esc(ln || ' ') + '</span>' +
              '</div>'
            );
          }).join('') +
        '</div>';
      }
      var toolbar = (
        '<div class="tv-edit-toolbar">' +
          '<span class="tv-edit-btn" data-edit-esc><span class="kbd">esc</span> Reading</span>' +
          '<span class="tv-edit-btn primary" data-edit-save><span class="kbd">⌘S</span> Save</span>' +
          '<span class="tv-edit-meta">' + wordCount + ' words</span>' +
        '</div>'
      );
      return (
        '<div class="tv-viewer">' +
          toolbar +
          '<div class="tv-scroll" data-scroll>' +
            '<div class="tv-content">' +
              editContent +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }

    // Reading mode
    var mdHtml = '';
    if (window.tvRenderMarkdown) {
      mdHtml = window.tvRenderMarkdown(tab.source);
    }
    return (
      '<div class="tv-viewer">' +
        '<div class="tv-scroll" data-scroll>' +
          '<div class="tv-content">' +
            '<div class="md" data-md>' + mdHtml + '</div>' +
          '</div>' +
          '<div class="tv-overlay-fade"></div>' +
        '</div>' +
      '</div>'
    );
  }

  function buildEmpty() {
    var icons = window.TV_ICONS || {};
    return (
      '<div class="tv-titlebar">' +
        '<div class="tv-traffic">' +
          '<span class="tv-light c"></span>' +
          '<span class="tv-light m"></span>' +
          '<span class="tv-light x"></span>' +
        '</div>' +
        '<div class="tv-wintitle">' +
          '<span class="tv-doc-ic">' + (icons.doc || '') + '</span>' +
          'tiny-viewer' +
        '</div>' +
      '</div>' +
      '<div class="tv-tabbar">' +
        '<div class="tv-newtab" data-newtab title="Open file (⌘O)">' +
          (icons.plus || '') +
        '</div>' +
      '</div>' +
      '<div class="tv-body">' +
        '<div class="tv-viewer">' +
          '<div class="tv-empty">' +
            '<div class="tv-dropzone">' +
              '<span class="dz-ic">' + (icons.tray || '') + '</span>' +
              '<span class="dz-title">Drop .md files here</span>' +
              '<span class="dz-or">— or —</span>' +
              '<span class="dz-cmd"><span class="kbd">⌘O</span> to open files</span>' +
            '</div>' +
          '</div>' +
          '<div class="tv-empty-hint">No file open · nothing is imported, nothing is synced</div>' +
        '</div>' +
      '</div>'
    );
  }

  /* ────────────────────────────────────────────────────────────
     RENDER — full repaint with scroll preservation (DR-03)
   ──────────────────────────────────────────────────────────── */
  function render() {
    var root = document.getElementById('tv-root');
    if (!root) return;

    // Save current scroll before painting
    var prevScroll = root.querySelector('[data-scroll]');
    var activeTab = getActiveTab();
    if (prevScroll && activeTab) {
      activeTab.scrollTop = prevScroll.scrollTop;
    }

    // Build root class
    var rootCls = 'tv tv--' + state.theme + ' tv--accent-' + state.accent;

    var html = '';
    if (!state.tabs.length) {
      html = buildEmpty();
    } else {
      html = buildTitlebar() + buildTabbar() +
        '<div class="tv-body">' + buildSidebar() + buildViewer() + '</div>';
    }

    root.innerHTML = '<div class="' + rootCls + '">' + html + '</div>';

    // Restore scroll position (DR-03)
    var newScroll = root.querySelector('[data-scroll]');
    if (newScroll && activeTab) {
      newScroll.scrollTop = activeTab.scrollTop || 0;
    }

    // Wire live scroll listener for continuous preservation
    if (newScroll && activeTab) {
      (function (scrollEl, tab) {
        scrollEl.addEventListener('scroll', function () {
          tab.scrollTop = scrollEl.scrollTop;
        }, { passive: true });
      })(newScroll, activeTab);
    }

    // Resolve diagrams after paint (DR-02)
    if (state.mode === 'reading' && window.tvResolveDiagrams) {
      var mdEl = root.querySelector('.md');
      if (mdEl) {
        window.tvResolveDiagrams(root.querySelector('.tv'), 600);
      }
    }

    // Wire TVEdit if in edit mode
    if (state.mode === 'edit' && window.TVEdit && typeof TVEdit.wire === 'function' && activeTab) {
      var tvRoot = root.querySelector('.tv');
      if (tvRoot) {
        TVEdit.wire(tvRoot, activeTab);
      }
    }

    // Wire event delegation
    wireEvents(root.querySelector('.tv'));

    tvEmit('render', { state: state });
  }

  /* ────────────────────────────────────────────────────────────
     EVENT DELEGATION
   ──────────────────────────────────────────────────────────── */
  function wireEvents(tvEl) {
    if (!tvEl) return;

    tvEl.addEventListener('click', function (e) {
      // Tab close button
      var closeBtn = e.target.closest('[data-close-tab]');
      if (closeBtn) {
        e.stopPropagation();
        closeTab(closeBtn.getAttribute('data-close-tab'));
        return;
      }

      // Tab activation
      var tabEl = e.target.closest('[data-tab-id]');
      if (tabEl && !e.target.closest('[data-close-tab]')) {
        activateTab(tabEl.getAttribute('data-tab-id'));
        return;
      }

      // Sidebar row click
      var sidebarRow = e.target.closest('[data-sidebar-tab]');
      if (sidebarRow) {
        activateTab(sidebarRow.getAttribute('data-sidebar-tab'));
        return;
      }

      // New tab button
      if (e.target.closest('[data-newtab]')) {
        if (window.TVFiles && typeof TVFiles.openPicker === 'function') {
          TVFiles.openPicker();
        } else if (window.TVPalette && typeof TVPalette.open === 'function') {
          TVPalette.open();
        }
        return;
      }

      // Sidebar search box → open cross-tab search
      if (e.target.closest('[data-open-search]')) {
        if (window.TVSearch && typeof TVSearch.open === 'function') {
          TVSearch.open();
        }
        return;
      }

      // Edit toolbar: exit edit
      if (e.target.closest('[data-edit-esc]')) {
        setMode('reading');
        return;
      }

      // Edit toolbar: save
      if (e.target.closest('[data-edit-save]')) {
        handleSave();
        return;
      }
    });

    // Double-click rendered content → enter edit mode (DR-08)
    tvEl.addEventListener('dblclick', function (e) {
      if (state.mode !== 'reading') return;
      if (!e.target.closest('.tv-content')) return;
      setMode('edit');
    });
  }

  /* ────────────────────────────────────────────────────────────
     CONTROLLER API
   ──────────────────────────────────────────────────────────── */

  function getActiveTab() {
    if (!state.activeId) return null;
    for (var i = 0; i < state.tabs.length; i++) {
      if (state.tabs[i].id === state.activeId) return state.tabs[i];
    }
    return null;
  }

  function openDoc(opts) {
    if (!opts || !opts.name) return null;

    // Deduplicate: if a tab with same key already exists, just activate it
    var key = tabKey(opts);
    for (var i = 0; i < state.tabs.length; i++) {
      if (tabKey(state.tabs[i]) === key) {
        activateTab(state.tabs[i].id);
        return state.tabs[i].id;
      }
    }

    var tab = makeTab(opts);
    state.tabs.push(tab);
    activateTab(tab.id);
    return tab.id;
  }

  function activateTab(id) {
    if (!id) return;

    // Save outgoing tab's scroll
    var scrollEl = document.querySelector('[data-scroll]');
    var outgoing = getActiveTab();
    if (scrollEl && outgoing) {
      outgoing.scrollTop = scrollEl.scrollTop;
    }

    state.activeId = id;
    state.mode = 'reading';
    render();

    // Restore incoming scroll
    var newScrollEl = document.querySelector('[data-scroll]');
    var incoming = getActiveTab();
    if (newScrollEl && incoming) {
      newScrollEl.scrollTop = incoming.scrollTop || 0;
    }

    tvEmit('tabchange', { id: id, tab: getActiveTab() });
  }

  function closeTab(id) {
    var idx = state.tabs.findIndex(function (t) { return t.id === id; });
    if (idx === -1) return;

    // Stop live watch if running
    if (window.TVLive && typeof TVLive.stop === 'function') {
      TVLive.stop(id);
    }

    state.tabs.splice(idx, 1);

    // If we closed the active tab, pick a neighbor
    if (state.activeId === id) {
      if (state.tabs.length) {
        var next = state.tabs[Math.min(idx, state.tabs.length - 1)];
        state.activeId = next.id;
      } else {
        state.activeId = null;
      }
    }

    state.mode = 'reading';
    render();
  }

  function setMode(m) {
    if (m !== 'reading' && m !== 'edit') return;
    state.mode = m;
    render();
    tvEmit('modechange', { mode: m });
  }

  function setTheme(t) {
    if (t !== 'light' && t !== 'dark') return;
    state.theme = t;
    localStorage.setItem('tv-theme', t);
    render();
  }

  function setAccent(a) {
    if (a !== 'blue' && a !== 'graphite' && a !== 'warm') return;
    state.accent = a;
    localStorage.setItem('tv-accent', a);
    render();
  }

  function toggleSidebar() {
    state.sidebarOpen = !state.sidebarOpen;
    render();
  }

  function scrollToHeading(tabId, headingText) {
    if (!tabId || !headingText) return;
    activateTab(tabId);

    // After render, find heading by text and scroll it into view
    requestAnimationFrame(function () {
      var tvRoot = document.querySelector('.tv');
      if (!tvRoot) return;
      var headings = tvRoot.querySelectorAll('.md h1, .md h2, .md h3');
      var target = null;
      var needle = headingText.toLowerCase().trim();
      for (var i = 0; i < headings.length; i++) {
        if (headings[i].textContent.toLowerCase().trim().indexOf(needle) !== -1) {
          target = headings[i];
          break;
        }
      }
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Also update scrollTop on the tab
        var scrollEl = document.querySelector('[data-scroll]');
        var tab = getActiveTab();
        if (scrollEl && tab) {
          tab.scrollTop = scrollEl.scrollTop;
        }
      }
    });
  }

  function markDirty(id, isDirty) {
    for (var i = 0; i < state.tabs.length; i++) {
      if (state.tabs[i].id === id) {
        state.tabs[i].dirty = !!isDirty;
        // Re-render tabbar only via full render (cheap enough)
        render();
        return;
      }
    }
  }

  function tvEl() {
    return document.querySelector('.tv');
  }

  /* ── Save action ──────────────────────────────────────────── */
  function handleSave() {
    var tab = getActiveTab();
    if (!tab) return;

    // Collect the edited source from TVEdit if available
    if (window.TVEdit && typeof TVEdit.getSource === 'function') {
      var newSource = TVEdit.getSource(tab);
      if (newSource !== undefined) {
        tab.source = newSource;
      }
    }

    // If there's a file handle, write to disk (DR-06: explicit user save only)
    if (tab.fileHandle) {
      tab.fileHandle.createWritable().then(function (w) {
        return w.write(tab.source).then(function () { return w.close(); });
      }).then(function () {
        tab.dirty = false;
        setMode('reading');
      }).catch(function (err) {
        console.warn('[tiny-viewer] save failed:', err);
        tab.dirty = false;
        setMode('reading');
      });
    } else {
      tab.dirty = false;
      setMode('reading');
    }
  }

  /* ────────────────────────────────────────────────────────────
     KEYBOARD ROUTER
   ──────────────────────────────────────────────────────────── */
  document.addEventListener('keydown', function (e) {
    var meta = e.metaKey || e.ctrlKey;
    var k = e.key;

    // Esc — close overlay or exit edit
    if (k === 'Escape') {
      if (window.TVPalette && TVPalette.isOpen && TVPalette.isOpen()) {
        TVPalette.close(); e.preventDefault(); return;
      }
      if (window.TVSearch && TVSearch.isOpen && TVSearch.isOpen()) {
        TVSearch.close(); e.preventDefault(); return;
      }
      if (state.mode === 'edit') {
        setMode('reading'); e.preventDefault(); return;
      }
      return;
    }

    if (!meta) return;

    // ⌘K — command palette toggle
    if (k === 'k' || k === 'K') {
      e.preventDefault();
      if (window.TVPalette) {
        TVPalette.isOpen && TVPalette.isOpen() ? TVPalette.close() : TVPalette.open();
      }
      return;
    }

    // ⌘⇧F — cross-tab search toggle
    if ((k === 'f' || k === 'F') && e.shiftKey) {
      e.preventDefault();
      if (window.TVSearch) {
        TVSearch.isOpen && TVSearch.isOpen() ? TVSearch.close() : TVSearch.open();
      }
      return;
    }

    // ⌘B — toggle sidebar
    if (k === 'b' || k === 'B') {
      e.preventDefault();
      toggleSidebar();
      return;
    }

    // ⌘O — open file picker
    if (k === 'o' || k === 'O') {
      e.preventDefault();
      if (window.TVFiles && typeof TVFiles.openPicker === 'function') {
        TVFiles.openPicker();
      }
      return;
    }

    // ⌘E — toggle edit mode
    if (k === 'e' || k === 'E') {
      e.preventDefault();
      if (state.tabs.length) {
        setMode(state.mode === 'edit' ? 'reading' : 'edit');
      }
      return;
    }

    // ⌘S — save (only meaningful in edit mode)
    if (k === 's' || k === 'S') {
      if (state.mode === 'edit') {
        e.preventDefault();
        handleSave();
      }
      return;
    }

    // ⌘W — close active tab
    if (k === 'w' || k === 'W') {
      e.preventDefault();
      if (state.activeId) closeTab(state.activeId);
      return;
    }

    // ⌘1–9 — activate nth tab
    if (k >= '1' && k <= '9') {
      var n = parseInt(k, 10) - 1;
      if (n < state.tabs.length) {
        e.preventDefault();
        activateTab(state.tabs[n].id);
      }
      return;
    }
  });

  /* ────────────────────────────────────────────────────────────
     INIT — build initial state and first render
   ──────────────────────────────────────────────────────────── */
  function init() {
    var seeds = window.TV_SEED || [];
    var liveDoc = window.TV_LIVE_DOC || null;

    // Open all seed docs as tabs
    var firstId = null;
    seeds.forEach(function (doc, i) {
      var id = openDoc({
        name: doc.name,
        source: doc.source,
        path: doc.path || null,
        live: !!doc.live,
      });
      if (i === 0) firstId = id;
    });

    // Optionally open the live doc tab
    if (liveDoc) {
      openDoc({
        name: liveDoc.name,
        source: liveDoc.source,
        path: liveDoc.path || null,
        live: true,
      });
    }

    // Activate the first tab (welcome.md)
    if (firstId) {
      state.activeId = firstId;
    } else if (state.tabs.length) {
      state.activeId = state.tabs[0].id;
    }

    render();

    // Init file feature (drag-drop)
    if (window.TVFiles && typeof TVFiles.init === 'function') {
      TVFiles.init();
    }

    // Start live watch on any seed tab marked live
    if (window.TVLive && typeof TVLive.start === 'function') {
      state.tabs.forEach(function (t) {
        if (t.live) TVLive.start(t.id);
      });
    }
  }

  /* ────────────────────────────────────────────────────────────
     PUBLIC API
   ──────────────────────────────────────────────────────────── */
  window.TV = {
    state: state,
    render: render,
    openDoc: openDoc,
    activateTab: activateTab,
    closeTab: closeTab,
    getActiveTab: getActiveTab,
    setMode: setMode,
    setTheme: setTheme,
    setAccent: setAccent,
    toggleSidebar: toggleSidebar,
    scrollToHeading: scrollToHeading,
    markDirty: markDirty,
    on: tvOn,
    emit: tvEmit,
    el: tvEl,
  };

  /* ── Boot when DOM is ready ───────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
