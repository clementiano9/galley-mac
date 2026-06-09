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
    fontSize: parseInt(localStorage.getItem('tv-font-size'), 10) || 16,
    // BUG-4: sidebar drag-resize width (clamp 160–480px). Persisted to localStorage.
    // dev2 reads --tv-sidebar-w on .tv-sidebar { width: var(--tv-sidebar-w, 224px) }.
    sidebarWidth: (function () {
      var stored = parseInt(localStorage.getItem('tv-sidebar-w'), 10);
      return (stored >= 160 && stored <= 480) ? stored : 224;
    }()),
  };

  // UX-10: JS keyboard cursor for sidebar navigation.
  // Tracks which sidebar option is highlighted via keyboard.
  // Uses ID (data-sidebar-tab value), NOT index, so it survives re-renders.
  // active=false means arrow keys scroll content normally; they never hijack.
  var sbKbd = { active: false, id: null };

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
      // nativePath: set by tv-native.js after openDoc() returns the tab id.
      // E-13: native tabs opened via Tauri NEVER have tab.fileHandle set;
      // they use tab.nativePath exclusively. These two fields are mutually
      // exclusive by design — the open paths (native vs browser) are disjoint.
    };
  }

  /* ── deduplication key ────────────────────────────────────── */
  // E-12: include nativePath in the key so two files with the same name
  // in different directories don't collide. For browser tabs without a real
  // path, use just the name so they can still be deduplicated by name.
  function tabKey(opts) {
    // If opts is a Tab object already in state, prefer nativePath
    if (opts.nativePath) return 'native:' + opts.nativePath;
    if (opts.path) return opts.path + '/' + opts.name;
    return opts.name;
  }

  /* ────────────────────────────────────────────────────────────
     RECENT FILES — localStorage persistence (E-02)
     Stores absolute native paths only; capped at 10 entries.
   ──────────────────────────────────────────────────────────── */
  var RECENT_KEY = 'tv-recent-files';
  var RECENT_MAX = 10;

  function loadRecentPaths() {
    try {
      var raw = localStorage.getItem(RECENT_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveRecentPath(absolutePath) {
    if (!absolutePath) return;
    var list = loadRecentPaths();
    // Dedupe: remove any existing entry for this path
    list = list.filter(function (p) { return p !== absolutePath; });
    // Prepend and cap
    list.unshift(absolutePath);
    if (list.length > RECENT_MAX) list.length = RECENT_MAX;
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    } catch (e) { /* storage full or private mode — ignore */ }
  }

  /* ────────────────────────────────────────────────────────────
     BUILD HELPERS — produce HTML strings
   ──────────────────────────────────────────────────────────── */

  function buildTitlebar() {
    var tab = getActiveTab();
    var title = tab ? tab.name : 'tiny-viewer';
    if (state.mode === 'edit' && tab) title = tab.name + ' — editing';
    var icons = window.TV_ICONS || {};

    // U-02: quiet theme toggle button (sun/moon) in titlebar right
    var moonSvg = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    var sunSvg  = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
    var themeSvg = state.theme === 'dark' ? sunSvg : moonSvg;
    var themeLabel = state.theme === 'dark' ? 'Switch to light' : 'Switch to dark';

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
        '<button class="tv-titlebtn tv-theme-toggle" data-theme-toggle title="' + themeLabel + '" aria-label="' + themeLabel + '">' +
          themeSvg +
        '</button>' +
      '</div>'
    );
  }

  // D-07: tabbar/tab ARIA roles
  function buildTabbar() {
    var icons = window.TV_ICONS || {};
    var tabs = state.tabs.map(function (t) {
      var lead = '';
      if (t.live && t.dirty) {
        // F-13: show both indicators when live+dirty
        lead = '<span class="tv-bolt">' + (icons.bolt || '') + '</span>' +
               '<span class="tv-dot"></span>';
      } else if (t.live) {
        lead = '<span class="tv-bolt">' + (icons.bolt || '') + '</span>';
      } else if (t.dirty) {
        lead = '<span class="tv-dot"></span>';
      }
      var isActive = t.id === state.activeId;
      var cls = 'tv-tab' + (isActive ? ' active' : '');
      return (
        '<div class="' + cls + '"' +
          ' role="tab"' +
          ' aria-selected="' + (isActive ? 'true' : 'false') + '"' +
          ' aria-controls="tv-viewer-panel"' +
          ' tabindex="' + (isActive ? '0' : '-1') + '"' +
          ' data-tab-id="' + esc(t.id) + '">' +
          lead +
          '<span class="name">' + esc(t.name) + '</span>' +
          '<span class="tv-close"' +
            ' role="button"' +
            ' aria-label="Close ' + esc(t.name) + '"' +
            ' data-close-tab="' + esc(t.id) + '"' +
            ' title="Close">' +
            (icons.close || '') +
          '</span>' +
        '</div>'
      );
    }).join('');

    // L-03: tabs live in a scrolling .tv-tab-strip; .tv-newtab is a SIBLING
    // (outside the strip) so the "+" stays opaque + clickable when tabs overflow.
    return (
      '<div class="tv-tabbar" role="tablist">' +
        '<div class="tv-tab-strip">' + tabs + '</div>' +
        '<button class="tv-newtab" data-newtab title="New tab (⌘O)" aria-label="Open new tab (⌘O)" type="button">' +
          (icons.plus || '') +
        '</button>' +
      '</div>'
    );
  }

  // D-05 + E-12: Group sidebar by real path; null-path files under "Open"
  // F-02: Also show a "Recent" section with closed files from localStorage
  function buildSidebar() {
    var icons = window.TV_ICONS || {};
    var collapsed = !state.sidebarOpen;

    // Group tabs by path (real directory) vs. ungrouped (no path)
    var groups = {};
    var ungrouped = [];
    state.tabs.forEach(function (t) {
      if (t.path) {
        (groups[t.path] = groups[t.path] || []).push(t);
      } else {
        ungrouped.push(t);
      }
    });

    // F-02: Recent section — closed files from localStorage not currently open
    var recentPaths = loadRecentPaths();
    // Build a set of open nativePaths for dedup
    var openNativePaths = {};
    state.tabs.forEach(function (t) {
      if (t.nativePath) openNativePaths[t.nativePath] = true;
    });
    var closedRecent = recentPaths.filter(function (p) {
      return !openNativePaths[p];
    }).slice(0, 10);

    // UX-10: Build rows with ARIA listbox/option roles.
    // File rows (open tabs) get role="option" with a stable id="sbopt-<tabId>".
    // No per-row roving tabindex — navigation is driven by the JS keyboard cursor
    // (sbKbd) + aria-activedescendant, independent of DOM focus (WebKit-safe).
    var rows = '';

    // Sanitize a tab id for use in an HTML id attribute (ids must not contain spaces
    // or characters invalid in selectors; TV ids are "tv-N-timestamp" which are safe,
    // but we replace any non-word chars defensively).
    function sbOptId(tabId) {
      return 'sbopt-' + String(tabId).replace(/[^\w-]/g, '_');
    }

    Object.keys(groups).forEach(function (path) {
      rows += (
        '<div class="tv-tree-row folder" role="group" aria-label="' + esc(path) + '">' +
          ic('folder') +
          '<span>' + esc(path) + '</span>' +
        '</div>'
      );
      groups[path].forEach(function (t) {
        var isActive = t.id === state.activeId;
        var cls = 'tv-tree-row file' + (isActive ? ' active' : '');
        rows += (
          '<div class="' + cls + '"' +
            ' id="' + sbOptId(t.id) + '"' +
            ' role="option"' +
            ' aria-selected="' + (isActive ? 'true' : 'false') + '"' +
            ' tabindex="-1"' +
            ' data-sidebar-tab="' + esc(t.id) + '">' +
            ic('doc') +
            '<span>' + esc(t.name) + '</span>' +
            (t.live ? '<span class="mini-bolt">' + (icons.bolt || '') + '</span>' : '') +
          '</div>'
        );
      });
    });

    if (ungrouped.length) {
      if (Object.keys(groups).length) {
        rows += '<div class="tv-side-divider"></div>';
      }
      rows += '<div class="tv-side-label">Open</div>';
      ungrouped.forEach(function (t) {
        var isActive = t.id === state.activeId;
        var cls = 'tv-tree-row file' + (isActive ? ' active' : '');
        rows += (
          '<div class="' + cls + '"' +
            ' id="' + sbOptId(t.id) + '"' +
            ' role="option"' +
            ' aria-selected="' + (isActive ? 'true' : 'false') + '"' +
            ' tabindex="-1"' +
            ' data-sidebar-tab="' + esc(t.id) + '">' +
            ic('doc') +
            '<span>' + esc(t.name) + '</span>' +
            (t.live ? '<span class="mini-bolt">' + (icons.bolt || '') + '</span>' : '') +
          '</div>'
        );
      });
    }

    if (closedRecent.length) {
      rows += '<div class="tv-side-divider"></div>';
      rows += '<div class="tv-side-label tv-side-recent-label">Recent</div>';
      closedRecent.forEach(function (p) {
        var name = p.split('/').pop() || p;
        rows += (
          '<div class="tv-tree-row file recent" data-recent-path="' + esc(p) + '">' +
            ic('clock') +
            '<span>' + esc(name) + '</span>' +
          '</div>'
        );
      });
    }

    var sidebarCls = 'tv-sidebar' + (collapsed ? ' collapsed' : '');
    return (
      '<aside class="' + sidebarCls + '">' +
        '<div class="tv-side-scroll"' +
          ' id="tv-sidebar-listbox"' +
          ' role="listbox"' +
          ' aria-label="Open files"' +
          ' aria-orientation="vertical"' +
          ' tabindex="-1">' + rows + '</div>' +
        '<div class="tv-search">' +
          '<div class="tv-search-box" data-open-find>' +
            ic('search') +
            '<span>Find in document</span>' +
            '<span class="kbd">⌘F</span>' +
          '</div>' +
        '</div>' +
        // BUG-4: drag handle on the sidebar's right edge.
        // dev2 styles this as a ~5px col-resize-cursor strip.
        // Pointer drag logic is wired in wireSidebarResize().
      '</aside>'
    );
  }

  function buildViewer() {
    var tab = getActiveTab();
    if (!tab) {
      // Build recent list for empty state (U-09)
      var recentPaths = loadRecentPaths();
      var recentHtml = '';
      if (recentPaths.length) {
        recentHtml = '<div class="tv-empty-recent">';
        recentPaths.slice(0, 8).forEach(function (p) {
          var name = p.split('/').pop() || p;
          recentHtml += (
            '<div class="tv-recent-row" data-recent-path="' + esc(p) + '"' +
              ' role="button" tabindex="0">' +
              '<span class="tv-recent-name">' + esc(name) + '</span>' +
              '<span class="tv-recent-path">' + esc(p) + '</span>' +
            '</div>'
          );
        });
        recentHtml += '</div>';
      }
      return (
        '<div class="tv-viewer" id="tv-viewer-panel" role="tabpanel">' +
          '<div class="tv-empty">' +
            '<div class="tv-dropzone">' +
              '<span class="dz-ic">' + ((window.TV_ICONS || {}).tray || '') + '</span>' +
              '<span class="dz-title">Drop .md files here</span>' +
              '<span class="dz-or">— or —</span>' +
              '<span class="dz-cmd"><span class="kbd">⌘O</span> to open files</span>' +
            '</div>' +
            recentHtml +
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
        // Fallback: plain source view
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
          '<button class="tv-edit-btn" type="button" data-edit-esc><span class="kbd">esc</span> Reading</button>' +
          '<button class="tv-edit-btn primary" type="button" data-edit-save><span class="kbd">⌘S</span> Save</button>' +
          '<span class="tv-edit-meta">' + wordCount + ' words</span>' +
        '</div>'
      );
      return (
        '<div class="tv-viewer" id="tv-viewer-panel" role="tabpanel">' +
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
    // UX-21: pencil hover button (top-right of .tv-content on hover)
    var pencilIc = (window.TV_ICONS && window.TV_ICONS.pencil) ? window.TV_ICONS.pencil : '';
    var pencilBtn = (
      '<button class="tv-edit-pencil" data-edit-pencil' +
        ' title="Edit (⌘E)" aria-label="Edit document (⌘E)" type="button">' +
        pencilIc +
      '</button>'
    );
    // UX-21: status bar hint — "⌘E to edit" shown in reading mode
    var editHint = '<div class="tv-edit-hint">⌘E to edit</div>';
    return (
      '<div class="tv-viewer" id="tv-viewer-panel" role="tabpanel">' +
        '<div class="tv-scroll" data-scroll>' +
          '<div class="tv-content tv-content--readable">' +
            pencilBtn +
            '<div class="md" data-md>' + mdHtml + '</div>' +
          '</div>' +
          '<div class="tv-overlay-fade"></div>' +
        '</div>' +
        editHint +
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
      '<div class="tv-tabbar" role="tablist">' +
        '<button class="tv-newtab" data-newtab title="Open file (⌘O)" aria-label="Open new tab (⌘O)" type="button">' +
          (icons.plus || '') +
        '</button>' +
      '</div>' +
      '<div class="tv-body">' +
        buildViewer() +
      '</div>'
    );
  }

  /* ────────────────────────────────────────────────────────────
     RENDER — full repaint with scroll preservation (DR-03)
     E-04: scroll is saved in activateTab (before activeId changes)
     and via the live scroll listener. render() does NOT save scroll
     to avoid overwriting the incoming tab's saved scrollTop.
     S-02/S-08: close overlays before replacing DOM so they reset
     their _open flag and remain functional after render.
   ──────────────────────────────────────────────────────────── */
  function render() {
    var root = document.getElementById('tv-root');
    if (!root) return;

    // S-02/S-08: reset overlay state before replacing DOM
    // (overlay elements are about to be detached; reset their _open flags
    //  so subsequent ⌘K / ⌘⇧F still work correctly)
    if (window.TVPalette && typeof TVPalette.close === 'function') {
      TVPalette.close();
    }
    if (window.TVSearch && typeof TVSearch.close === 'function') {
      TVSearch.close();
    }
    // UF-06: Preserve find state across non-destructive renders (theme, sidebar, etc.).
    // Capture the query and index so we can re-run the find after DOM replacement.
    // Tab switches still close the bar (content changes), handled via activateTab.
    var _savedFindQuery = _findOpen ? _findQuery : null;
    var _savedFindIndex = _findOpen ? _findIndex : 0;
    // F-07: close find bar to detach from old DOM (will re-open below if it was active)
    if (_findOpen) {
      _closeFindBar();
    }

    // E-04: Do NOT save scrollTop here — activateTab() does it before
    // state.activeId changes, and the scroll listener keeps it live.

    var activeTab = getActiveTab();

    // Build root class
    var rootCls = 'tv tv--' + state.theme + ' tv--accent-' + state.accent;

    var html = '';
    if (!state.tabs.length) {
      html = buildEmpty();
    } else {
      // UX-20: resizer is a sibling of the sidebar in .tv-body (not a child of .tv-sidebar)
      // so .tv-sidebar overflow:hidden does not clip its grab zone.
      var resizerHtml = state.sidebarOpen
        ? '<div class="tv-sidebar-resizer" data-sidebar-resize></div>'
        : '';
      html = buildTitlebar() + buildTabbar() +
        '<div class="tv-body">' + buildSidebar() + resizerHtml + buildViewer() + '</div>';
    }

    root.innerHTML = '<div class="' + rootCls + '" style="--tv-md-font:' + state.fontSize + 'px">' + html + '</div>';

    // BUG-4: Apply sidebar width CSS var to the .tv root so the sidebar can read it.
    // dev2's CSS: .tv-sidebar { width: var(--tv-sidebar-w, 224px) }
    var tvRootEl = root.querySelector('.tv');
    if (tvRootEl) {
      tvRootEl.style.setProperty('--tv-sidebar-w', state.sidebarWidth + 'px');
    }

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

    // UX-25: Set document language from YAML front-matter (lang:/language: key)
    // Minimal implementation: check front-matter at top of active doc source only.
    // Resets to "en" if no lang found or no active tab.
    (function () {
      var langTab = getActiveTab();
      var docLang = 'en';
      if (langTab && langTab.source) {
        var src = langTab.source;
        // Check for YAML front-matter block at start: ---\n...\n---
        var fmMatch = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (fmMatch) {
          var fm = fmMatch[1];
          // Look for lang: or language: key (case-insensitive)
          var langMatch = fm.match(/^(?:lang|language)\s*:\s*["']?([a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*)["']?\s*$/im);
          if (langMatch && langMatch[1]) {
            docLang = langMatch[1].trim();
          }
        }
      }
      document.documentElement.lang = docLang;
    }());

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

    // UF-06: Re-inject find bar after render if it was active before.
    // Only restore in reading mode (find bar searches rendered markdown DOM).
    if (_savedFindQuery !== null && state.mode === 'reading') {
      _openFindBar();
      if (_savedFindQuery) {
        _runFind(_savedFindQuery);
        // Restore match index (clamp to new match count)
        if (_findMatches.length > 0) {
          _findIndex = Math.min(_savedFindIndex, _findMatches.length - 1);
          _highlightFindMatch();
          var countEl = _findBarEl && _findBarEl.querySelector('.tv-find-count');
          if (countEl) {
            countEl.textContent = (_findIndex + 1) + ' / ' + _findMatches.length;
          }
        }
      }
      // Restore query text in input
      if (_findBarEl) {
        var inp = _findBarEl.querySelector('.tv-find-input');
        if (inp) inp.value = _savedFindQuery;
      }
    }

    tvEmit('render', { state: state });

    // UX-10: Reapply keyboard cursor highlight after every render (innerHTML rebuild
    // wipes class state). Only runs when sbKbd.active is true.
    renderSidebarCursor();
  }

  // UX-10: Renders the sidebar keyboard cursor highlight using .kbd-cursor class
  // and aria-activedescendant on the listbox. Uses sbKbd.id (tab id) NOT index,
  // so it survives re-renders correctly. No DOM focus() call — WebKit-safe.
  function renderSidebarCursor() {
    var listbox = document.getElementById('tv-sidebar-listbox');
    if (!listbox) return;

    // Clear all cursor highlights and aria-activedescendant
    var opts = Array.prototype.slice.call(
      listbox.querySelectorAll('[role="option"][data-sidebar-tab]')
    );
    opts.forEach(function (el) { el.classList.remove('kbd-cursor'); });
    listbox.removeAttribute('aria-activedescendant');

    if (!sbKbd.active || !sbKbd.id) return;

    // Find the option matching sbKbd.id
    var target = null;
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].getAttribute('data-sidebar-tab') === sbKbd.id) {
        target = opts[i]; break;
      }
    }

    // If the cursor id no longer exists (tab was closed), clamp to first option
    if (!target && opts.length) {
      target = opts[0];
      sbKbd.id = target.getAttribute('data-sidebar-tab');
    }

    if (target) {
      target.classList.add('kbd-cursor');
      listbox.setAttribute('aria-activedescendant', target.id);
      target.scrollIntoView({ block: 'nearest' });
    }
  }

  /* ────────────────────────────────────────────────────────────
     IN-DOCUMENT FIND BAR (F-07 / U-03)
     A lightweight find bar that highlights + navigates matches
     in the rendered .md element. Distinct from ⌘⇧F cross-tab search.
   ──────────────────────────────────────────────────────────── */
  var _findOpen = false;
  var _findMatches = [];
  var _findIndex = 0;
  var _findBarEl = null;
  var _findQuery = '';

  function _openFindBar() {
    if (_findOpen) {
      // Re-focus if already open
      if (_findBarEl) {
        var inp = _findBarEl.querySelector('.tv-find-input');
        if (inp) { inp.focus(); inp.select(); }
      }
      return;
    }

    var tvEl = document.querySelector('.tv');
    if (!tvEl) return;

    _findOpen = true;
    _findQuery = '';
    _findMatches = [];
    _findIndex = 0;

    // Build find bar
    _findBarEl = document.createElement('div');
    _findBarEl.className = 'tv-find';
    _findBarEl.setAttribute('role', 'search');
    _findBarEl.innerHTML =
      '<input class="tv-find-input" type="text" placeholder="Find in document…" autocomplete="off" spellcheck="false" aria-label="Find in document">' +
      '<span class="tv-find-count" aria-live="polite"></span>' +
      '<button class="tv-find-nav" data-find-prev aria-label="Previous match">&#8593;</button>' +
      '<button class="tv-find-nav" data-find-next aria-label="Next match">&#8595;</button>' +
      '<button class="tv-find-nav tv-find-close" data-find-close aria-label="Close find bar">&#10005;</button>';

    tvEl.appendChild(_findBarEl);

    var inputEl = _findBarEl.querySelector('.tv-find-input');
    if (inputEl) {
      inputEl.focus();
      inputEl.addEventListener('input', function () {
        _findQuery = inputEl.value;
        _runFind(_findQuery);
      });
      inputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (e.shiftKey) {
            _findStep(-1);
          } else {
            _findStep(1);
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          _closeFindBar();
        }
      });
    }

    _findBarEl.addEventListener('click', function (e) {
      if (e.target.closest('[data-find-prev]')) { _findStep(-1); return; }
      if (e.target.closest('[data-find-next]')) { _findStep(1); return; }
      if (e.target.closest('[data-find-close]')) { _closeFindBar(); return; }
    });
  }

  function _closeFindBar() {
    if (!_findOpen) return;
    _findOpen = false;
    _findQuery = '';
    // Remove marks from DOM
    _clearFindMarks();
    if (_findBarEl && _findBarEl.parentNode) {
      _findBarEl.parentNode.removeChild(_findBarEl);
    }
    _findBarEl = null;
    _findMatches = [];
    _findIndex = 0;
  }

  function _clearFindMarks() {
    var mdEl = document.querySelector('.md');
    if (!mdEl) return;
    // Unwrap all <mark data-find> spans
    var marks = mdEl.querySelectorAll('mark[data-find]');
    for (var i = marks.length - 1; i >= 0; i--) {
      var mark = marks[i];
      var parent = mark.parentNode;
      if (parent) {
        var text = document.createTextNode(mark.textContent);
        parent.replaceChild(text, mark);
        parent.normalize();
      }
    }
  }

  function _runFind(query) {
    _clearFindMarks();
    _findMatches = [];
    _findIndex = 0;

    var countEl = _findBarEl && _findBarEl.querySelector('.tv-find-count');

    if (!query) {
      if (countEl) countEl.textContent = '';
      return;
    }

    var mdEl = document.querySelector('.md');
    if (!mdEl) return;

    // Walk text nodes and insert <mark> elements
    var lq = query.toLowerCase();
    var walker = document.createTreeWalker(mdEl, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        // Skip script/style/mark nodes
        var pn = node.parentNode && node.parentNode.nodeName;
        if (pn === 'SCRIPT' || pn === 'STYLE' || pn === 'MARK') {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }, false);

    var textNodes = [];
    var node;
    while ((node = walker.nextNode())) {
      textNodes.push(node);
    }

    // Process in reverse to avoid invalidating ranges
    for (var i = textNodes.length - 1; i >= 0; i--) {
      var tn = textNodes[i];
      var text = tn.textContent;
      var lText = text.toLowerCase();
      var lastIdx = 0;
      var positions = [];
      var pos;
      while ((pos = lText.indexOf(lq, lastIdx)) !== -1) {
        positions.push(pos);
        lastIdx = pos + lq.length;
      }
      if (!positions.length) continue;

      // Build a fragment replacing matches with <mark>
      var frag = document.createDocumentFragment();
      var cur = 0;
      for (var pi = 0; pi < positions.length; pi++) {
        var p = positions[pi];
        if (p > cur) {
          frag.appendChild(document.createTextNode(text.slice(cur, p)));
        }
        var mark = document.createElement('mark');
        mark.setAttribute('data-find', '');
        mark.textContent = text.slice(p, p + query.length);
        frag.appendChild(mark);
        cur = p + query.length;
      }
      if (cur < text.length) {
        frag.appendChild(document.createTextNode(text.slice(cur)));
      }
      tn.parentNode.replaceChild(frag, tn);
    }

    // Collect all marks in DOM order
    _findMatches = Array.prototype.slice.call(
      document.querySelectorAll('.md mark[data-find]')
    );

    if (_findMatches.length) {
      _findIndex = 0;
      _highlightFindMatch();
    }

    if (countEl) {
      if (_findMatches.length) {
        countEl.textContent = (_findIndex + 1) + ' / ' + _findMatches.length;
      } else {
        countEl.textContent = 'No results';
      }
    }
  }

  function _findStep(dir) {
    if (!_findMatches.length) return;
    _findIndex = (_findIndex + dir + _findMatches.length) % _findMatches.length;
    _highlightFindMatch();
    var countEl = _findBarEl && _findBarEl.querySelector('.tv-find-count');
    if (countEl) countEl.textContent = (_findIndex + 1) + ' / ' + _findMatches.length;
  }

  function _highlightFindMatch() {
    _findMatches.forEach(function (m, i) {
      m.classList.toggle('current', i === _findIndex);
    });
    var cur = _findMatches[_findIndex];
    if (cur) {
      cur.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  /* ────────────────────────────────────────────────────────────
     EVENT DELEGATION
   ──────────────────────────────────────────────────────────── */
  /* ────────────────────────────────────────────────────────────
     BUG-4: SIDEBAR DRAG-RESIZE
     Pointer drag on .tv-sidebar-resizer adjusts --tv-sidebar-w on the .tv root.
     Clamped 160–480 px. Persisted to localStorage 'tv-sidebar-w'.
     Does NOT break ⌘B collapse (sidebarOpen is a separate boolean; the resizer
     only changes the width when the sidebar is open).
   ──────────────────────────────────────────────────────────── */
  function wireSidebarResize(tvEl) {
    if (!tvEl) return;
    var resizer = tvEl.querySelector('[data-sidebar-resize]');
    if (!resizer) return;

    var _dragging = false;
    var _startX = 0;
    var _startWidth = 0;

    resizer.addEventListener('pointerdown', function (e) {
      if (!state.sidebarOpen) return; // don't resize when sidebar is collapsed
      _dragging = true;
      _startX = e.clientX;
      _startWidth = state.sidebarWidth;
      resizer.setPointerCapture(e.pointerId);
      resizer.classList.add('dragging'); // UI-05: visual feedback during drag
      e.preventDefault();
    });

    resizer.addEventListener('pointermove', function (e) {
      if (!_dragging) return;
      var delta = e.clientX - _startX;
      var newWidth = Math.max(160, Math.min(480, _startWidth + delta));
      state.sidebarWidth = newWidth;
      // Apply directly to the .tv root without a full re-render
      tvEl.style.setProperty('--tv-sidebar-w', newWidth + 'px');
    });

    resizer.addEventListener('pointerup', function (e) {
      if (!_dragging) return;
      _dragging = false;
      resizer.classList.remove('dragging'); // UI-05: remove drag feedback
      resizer.releasePointerCapture(e.pointerId);
      // Persist to localStorage
      localStorage.setItem('tv-sidebar-w', String(state.sidebarWidth));
    });

    resizer.addEventListener('pointercancel', function (e) {
      if (!_dragging) return;
      _dragging = false;
      resizer.classList.remove('dragging'); // UI-05: remove drag feedback
      resizer.releasePointerCapture(e.pointerId);
    });
  }

  function wireEvents(tvEl) {
    if (!tvEl) return;

    // BUG-4: wire the sidebar drag-resize handle
    wireSidebarResize(tvEl);

    // UX-11: keyboard activation for .tv-recent-row (role="button")
    tvEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var recentRow = e.target.closest('[data-recent-path]');
      if (!recentRow) return;
      e.preventDefault();
      recentRow.click();
    });

    // UX-10: Deactivate sidebar keyboard cursor when user scrolls content.
    // Wheel on the content/viewer area means the user's attention is there.
    var scrollArea = tvEl.querySelector('.tv-scroll');
    if (scrollArea) {
      scrollArea.addEventListener('wheel', function () {
        if (sbKbd.active) {
          sbKbd.active = false;
          renderSidebarCursor();
        }
      }, { passive: true });
    }

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

      // Sidebar row click: activate tab and engage keyboard cursor mode.
      var sidebarRow = e.target.closest('[data-sidebar-tab]');
      if (sidebarRow) {
        var sidebarTabId = sidebarRow.getAttribute('data-sidebar-tab');
        activateTab(sidebarTabId);
        // UX-10: engage keyboard cursor on the clicked row so ArrowDown/Up work
        // immediately without any dependence on DOM focus (WebKit-safe).
        sbKbd.active = true;
        sbKbd.id = sidebarTabId;
        // renderSidebarCursor is already called inside render() via activateTab,
        // but sbKbd may have been set after that render; apply it now via rAF
        // so the new DOM is available.
        requestAnimationFrame(function () { renderSidebarCursor(); });
        return;
      }

      // UX-10: Clicking the content/viewer area deactivates sidebar keyboard mode
      // so arrow keys revert to scrolling content (normal browser behaviour).
      if (e.target.closest('.tv-scroll') || e.target.closest('.tv-content') ||
          e.target.closest('#tv-viewer-panel')) {
        if (sbKbd.active) {
          sbKbd.active = false;
          renderSidebarCursor();
        }
      }

      // F-02: sidebar recent row click → reopen closed file
      var recentRow = e.target.closest('[data-recent-path]');
      if (recentRow) {
        var rpath = recentRow.getAttribute('data-recent-path');
        if (rpath && window.TVNative && TVNative.available) {
          window.__TAURI__.core.invoke('read_md_file', { path: rpath })
            .then(function (doc) {
              if (window.TVNative && typeof TVNative.openInto === 'function') {
                TVNative.openInto(doc);
              } else if (doc && doc.name) {
                var pdir = rpath.replace(/\/[^/]+$/, '') || '/';
                var id = openDoc({ name: doc.name, source: doc.content, path: pdir });
                if (id) {
                  var tab = state.tabs.find(function (t) { return t.id === id; });
                  if (tab) tab.nativePath = doc.path || rpath;
                }
              }
            })
            .catch(function (err) {
              console.warn('[TV] recent file open failed', rpath, err);
            });
        }
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

      // Sidebar find → open in-doc find bar (F-07/F-14)
      if (e.target.closest('[data-open-find]')) {
        _openFindBar();
        return;
      }

      // UX-21: pencil hover button → enter edit mode
      if (e.target.closest('[data-edit-pencil]')) {
        if (state.tabs.length && state.mode === 'reading') {
          setMode('edit');
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

      // U-02: theme toggle button
      if (e.target.closest('[data-theme-toggle]')) {
        setTheme(state.theme === 'dark' ? 'light' : 'dark');
        return;
      }

      // U-04: copy code block button
      var copyBtn = e.target.closest('[data-copy]');
      if (copyBtn) {
        var pre = copyBtn.closest('pre');
        if (pre) {
          var code = pre.querySelector('code');
          var text = code ? code.textContent : pre.textContent;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
              var orig = copyBtn.textContent;
              copyBtn.textContent = 'Copied';
              setTimeout(function () { copyBtn.textContent = orig; }, 1500);
            }).catch(function () {});
          }
        }
        return;
      }

      // N-04: external link click handler
      var anchor = e.target.closest('.md a[href]');
      if (anchor) {
        var href = anchor.getAttribute('href');
        if (href && (href.indexOf('http://') === 0 || href.indexOf('https://') === 0)) {
          e.preventDefault();
          if (window.__TAURI__) {
            // Try opener plugin first, fall back to core invoke
            var opener = window.__TAURI__.opener;
            if (opener && typeof opener.openUrl === 'function') {
              opener.openUrl(href).catch(function () {});
            } else {
              window.__TAURI__.core.invoke('plugin:opener|open_url', { url: href }).catch(function () {});
            }
          } else {
            window.open(href, '_blank', 'noopener,noreferrer');
          }
          return;
        }
        // Internal #anchor links — scroll to heading
        if (href && href.charAt(0) === '#') {
          e.preventDefault();
          var headingText = href.slice(1).replace(/-/g, ' ');
          var activeTab = getActiveTab();
          if (activeTab) {
            scrollToHeading(activeTab.id, headingText);
          }
          return;
        }
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

  // E-04: Save outgoing tab's scroll BEFORE changing state.activeId,
  // then update activeId, render, and restore the incoming scroll.
  // E-06: Capture outgoing tab id before switch, include prevId in tabchange event.
  // UF-02/UF-04: Commit textarea value to tab.source before switching so no text is lost.
  function activateTab(id) {
    if (!id) return;

    // Capture outgoing tab id BEFORE changing state.activeId (E-06)
    var prevId = state.activeId;
    var outgoing = getActiveTab();

    // UF-02/UF-04: If switching away while in edit mode, commit the live textarea
    // value into tab.source so no typed text is lost, and keep dirty flag intact.
    // (onInput already keeps tab.source current on every keystroke, but an in-flight
    // composition event or a programmatic activateTab call before the first keystroke
    // could leave a gap — this is the canonical safety commit.)
    if (state.mode === 'edit' && outgoing) {
      var editTextarea = document.querySelector('[data-edit-area]');
      if (editTextarea && editTextarea.value !== outgoing.source) {
        outgoing.source = editTextarea.value;
        // Ensure dirty is set if the content has changed
        if (outgoing.source !== '') {
          outgoing.dirty = true;
        }
      }
    }

    // Save outgoing tab's current scroll (E-04: must happen before activeId changes)
    var scrollEl = document.querySelector('[data-scroll]');
    if (scrollEl && outgoing) {
      outgoing.scrollTop = scrollEl.scrollTop;
    }

    state.activeId = id;
    state.mode = 'reading';
    render();

    // Restore incoming tab's scroll after render
    var newScrollEl = document.querySelector('[data-scroll]');
    var incoming = getActiveTab();
    if (newScrollEl && incoming) {
      newScrollEl.scrollTop = incoming.scrollTop || 0;
    }

    // E-06: include prevId so tv-live.js can remove the outgoing tab's live UI
    tvEmit('tabchange', { id: id, prevId: prevId || null, tab: getActiveTab() });
  }

  // S-03: closeTab guard — confirm before closing dirty tabs
  function closeTab(id) {
    var idx = state.tabs.findIndex(function (t) { return t.id === id; });
    if (idx === -1) return;

    var tab = state.tabs[idx];

    // S-03: Guard against silent data loss
    if (tab.dirty) {
      var msg = 'Discard unsaved changes to "' + tab.name + '"?';
      // In Tauri, try native dialog; otherwise use window.confirm
      if (window.__TAURI__ && window.__TAURI__.dialog) {
        window.__TAURI__.dialog.ask(msg, { title: 'Unsaved Changes', kind: 'warning' })
          .then(function (confirmed) {
            if (confirmed) _doCloseTab(id, idx);
          })
          .catch(function () {
            // Fallback to confirm if dialog plugin not available
            if (window.confirm(msg)) _doCloseTab(id, idx);
          });
      } else {
        if (!window.confirm(msg)) return;
        _doCloseTab(id, idx);
      }
      return;
    }

    _doCloseTab(id, idx);
  }

  function _doCloseTab(id, idx) {
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
    if (t !== 'light' && t !== 'dark' && t !== 'system') return;
    if (t === 'system') {
      // F-05 / U-05: System theme — follow prefers-color-scheme
      var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      state.theme = prefersDark ? 'dark' : 'light';
      localStorage.setItem('tv-theme', 'system');
    } else {
      state.theme = t;
      localStorage.setItem('tv-theme', t);
    }
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

  // F-05/U-07: Font size control
  function setFontSize(px) {
    var clamped = Math.max(12, Math.min(24, px));
    state.fontSize = clamped;
    localStorage.setItem('tv-font-size', String(clamped));
    // Apply without full render — just update the CSS variable on the .tv root
    var tvRoot = document.querySelector('.tv');
    if (tvRoot) {
      tvRoot.style.setProperty('--tv-md-font', clamped + 'px');
    }
  }

  // S-11 fix: capture tab id before rAF to avoid scrolling wrong tab
  function scrollToHeading(tabId, headingText) {
    if (!tabId || !headingText) return;
    var targetTabId = tabId; // capture before rAF
    activateTab(tabId);

    // After render, find heading by text and scroll it into view
    requestAnimationFrame(function () {
      // S-11: verify the active tab hasn't changed since we queued the rAF
      if (window.TV && window.TV.state && window.TV.state.activeId !== targetTabId) return;

      var tvRoot = document.querySelector('.tv');
      if (!tvRoot) return;
      // UF-08: include h4-h6 so deep headings in technical docs are reachable
      var headings = tvRoot.querySelectorAll('.md h1,.md h2,.md h3,.md h4,.md h5,.md h6');
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

  // S-01: markDirty is render-FREE — only updates tab flag + dot in DOM
  function markDirty(id, isDirty) {
    for (var i = 0; i < state.tabs.length; i++) {
      if (state.tabs[i].id === id) {
        state.tabs[i].dirty = !!isDirty;
        // S-01: update ONLY the dot in the tab element, no full render
        _updateTabDot(id, !!isDirty);
        return;
      }
    }
  }

  // S-01 helper: find the tab element and toggle the dot without a full render
  function _updateTabDot(id, isDirty) {
    var tabEl = document.querySelector('[data-tab-id="' + id + '"]');
    if (!tabEl) return;

    var icons = window.TV_ICONS || {};
    var tab = null;
    for (var i = 0; i < state.tabs.length; i++) {
      if (state.tabs[i].id === id) { tab = state.tabs[i]; break; }
    }
    if (!tab) return;

    // Remove existing lead indicators
    var existingBolt = tabEl.querySelector('.tv-bolt');
    var existingDot  = tabEl.querySelector('.tv-dot');
    if (existingBolt) existingBolt.parentNode.removeChild(existingBolt);
    if (existingDot)  existingDot.parentNode.removeChild(existingDot);

    // Re-insert lead indicators based on current state
    var nameEl = tabEl.querySelector('.name');
    if (!nameEl) return;

    if (tab.live && isDirty) {
      var boltSpan = document.createElement('span');
      boltSpan.className = 'tv-bolt';
      boltSpan.innerHTML = icons.bolt || '';
      var dotSpan = document.createElement('span');
      dotSpan.className = 'tv-dot';
      tabEl.insertBefore(dotSpan, nameEl);
      tabEl.insertBefore(boltSpan, dotSpan);
    } else if (tab.live) {
      var boltSpan2 = document.createElement('span');
      boltSpan2.className = 'tv-bolt';
      boltSpan2.innerHTML = icons.bolt || '';
      tabEl.insertBefore(boltSpan2, nameEl);
    } else if (isDirty) {
      var dotSpan2 = document.createElement('span');
      dotSpan2.className = 'tv-dot';
      tabEl.insertBefore(dotSpan2, nameEl);
    }
  }

  function tvEl() {
    return document.querySelector('.tv');
  }

  /* ── Save action (E-03 + E-05) ───────────────────────────── */
  // Single canonical save pathway:
  //   1. If not dirty → just exit edit mode (nothing to write).
  //   2. Else delegate to TVNative.saveTab (Tauri) or TVFiles.writeFile (browser).
  //      tab.source is current at save time — TVEdit writes edits directly into
  //      tab.source live (renderer contract), so no getSource() call is needed.
  function handleSave() {
    var tab = getActiveTab();
    if (!tab) return;

    // Not dirty: just exit edit mode without writing anything (DR-06)
    if (!tab.dirty) {
      setMode('reading');
      return;
    }

    // E-03: Tauri native save — delegate to TVNative.saveTab which uses
    // save_md_file (existing nativePath) or save_md_file_as (new file).
    // tab.nativePath is set by tv-native.js after openDoc(); fileHandle
    // is NOT set for native tabs (E-13 invariant: these paths are exclusive).
    if (window.TVNative && TVNative.available) {
      TVNative.saveTab(tab).then(function () {
        setMode('reading');
      }).catch(function (err) {
        // N-06: surface save failure as toast, keep user in edit mode
        console.warn('[tiny-viewer] native save failed:', err);
        if (window.TVNative && typeof TVNative.showToast === 'function') {
          TVNative.showToast('Save failed: ' + (err || 'unknown error'));
        }
        // Do NOT call setMode('reading') — keep user in edit mode to retry
      });
      return;
    }

    // Browser: delegate to TVFiles.writeFile (handles fileHandle, showSaveFilePicker,
    // or download fallback). TVFiles.writeFile(tab) calls markDirty internally.
    if (window.TVFiles && typeof TVFiles.writeFile === 'function') {
      TVFiles.writeFile(tab).then(function () {
        setMode('reading');
      }).catch(function (err) {
        console.warn('[tiny-viewer] browser save failed:', err);
        setMode('reading');
      });
      return;
    }

    // Last resort: no save mechanism available — just clear dirty and exit
    tab.dirty = false;
    setMode('reading');
  }

  /* ── F-03: Open Folder ────────────────────────────────────── */
  function openFolder() {
    if (!window.__TAURI__) return;
    window.__TAURI__.core.invoke('pick_folder')
      .then(function (docs) {
        if (!docs || !docs.length) return;
        docs.forEach(function (doc) {
          if (window.TVNative && typeof TVNative.openInto === 'function') {
            TVNative.openInto(doc);
          } else if (doc && doc.name) {
            var pdir = doc.path ? doc.path.replace(/\/[^/]+$/, '') || '/' : null;
            var id = openDoc({ name: doc.name, source: doc.content, path: pdir });
            if (id) {
              var tab = state.tabs.find(function (t) { return t.id === id; });
              if (tab) tab.nativePath = doc.path;
            }
          }
        });
      })
      .catch(function (err) {
        // User cancelled or error
        if (err) console.warn('[TV] pick_folder failed', err);
      });
  }

  /* ────────────────────────────────────────────────────────────
     UX-10: SIDEBAR KEYBOARD CURSOR HANDLER (document-level)
     Replaces the old roving-tabindex approach which relied on
     el.focus() on non-form elements — a silent no-op on macOS
     when AppleKeyboardUIMode=0 (Full Keyboard Access is OFF).
     This handler is entirely focus-independent (WebKit-safe).
   ──────────────────────────────────────────────────────────── */
  document.addEventListener('keydown', function (e) {
    // Never hijack typing inside form controls or any overlay/editor.
    // Check for: inputs, textareas, contenteditable, find bar, palette, search, edit area.
    if (e.target.closest('input, textarea, [contenteditable]')) return;
    if (e.target.closest('.tv-find, .tv-palette-scrim, .tv-search-container, .tv-edit-area')) return;

    // Only handle navigation keys here; other keys fall through to the keyboard router below.
    var navKey = (e.key === 'ArrowDown' || e.key === 'ArrowUp' ||
                  e.key === 'Enter' || e.key === ' ' ||
                  e.key === 'Home' || e.key === 'End' ||
                  e.key === 'Escape');
    if (!navKey) return;

    // Escape: deactivate cursor if active. Both this handler and the main keyboard
    // router are separate document listeners so both always fire. The main router
    // handles Escape priority (find bar → palette → edit mode → sbKbd). This handler
    // just ensures sbKbd is cleared; the main router will also call renderSidebarCursor
    // via its own guard. No preventDefault here — the main router owns that.
    if (e.key === 'Escape') {
      if (sbKbd.active) {
        sbKbd.active = false;
        renderSidebarCursor();
      }
      return; // return so arrows/Enter/etc below don't run on Escape
    }

    // All remaining nav keys (arrows, Enter, Space, Home, End) only act when
    // the sidebar keyboard cursor is active. Otherwise let the browser handle
    // them (e.g. arrow keys scroll content normally).
    if (!sbKbd.active) return;

    var listbox = document.getElementById('tv-sidebar-listbox');
    if (!listbox) return;
    var opts = Array.prototype.slice.call(
      listbox.querySelectorAll('[role="option"][data-sidebar-tab]')
    );
    if (!opts.length) return;

    // Find current cursor index (fallback to 0)
    var curIdx = 0;
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].getAttribute('data-sidebar-tab') === sbKbd.id) {
        curIdx = i; break;
      }
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      var nextIdx = Math.min(curIdx + 1, opts.length - 1);
      sbKbd.id = opts[nextIdx].getAttribute('data-sidebar-tab');
      renderSidebarCursor();
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      var prevIdx = Math.max(curIdx - 1, 0);
      sbKbd.id = opts[prevIdx].getAttribute('data-sidebar-tab');
      renderSidebarCursor();
      return;
    }

    if (e.key === 'Home') {
      e.preventDefault();
      sbKbd.id = opts[0].getAttribute('data-sidebar-tab');
      renderSidebarCursor();
      return;
    }

    if (e.key === 'End') {
      e.preventDefault();
      sbKbd.id = opts[opts.length - 1].getAttribute('data-sidebar-tab');
      renderSidebarCursor();
      return;
    }

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (sbKbd.id) {
        activateTab(sbKbd.id);
        // activateTab → render → renderSidebarCursor (called inside render).
        // sbKbd.active stays true so arrows keep working post-Enter.
        // The cursor id stays on the just-opened row; reapply after rAF
        // to ensure the new DOM has the class.
        requestAnimationFrame(function () { renderSidebarCursor(); });
      }
      return;
    }
  });

  /* ────────────────────────────────────────────────────────────
     KEYBOARD ROUTER
   ──────────────────────────────────────────────────────────── */
  document.addEventListener('keydown', function (e) {
    var meta = e.metaKey || e.ctrlKey;
    var k = e.key;

    // Esc — close find bar first, then overlays, then exit edit, then sidebar cursor
    if (k === 'Escape') {
      if (_findOpen) {
        _closeFindBar(); e.preventDefault(); return;
      }
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
      // UX-10: opening an overlay deactivates sidebar keyboard cursor
      sbKbd.active = false;
      renderSidebarCursor();
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

    // F-07/U-03: ⌘F — in-document find (no shiftKey)
    // UI-04/UF-05: Only intercept in reading mode. In edit mode do NOT preventDefault
    // so the browser / OS can handle it (no silent key-swallow).
    if ((k === 'f' || k === 'F') && !e.shiftKey) {
      if (state.mode === 'reading') {
        e.preventDefault();
        // UI-06: don't open find bar when cross-tab search is already open
        if (state.tabs.length && !(window.TVSearch && TVSearch.isOpen && TVSearch.isOpen())) {
          _openFindBar();
        }
      }
      // edit mode: do NOT preventDefault — fall through to browser default
      return;
    }

    // ⌘B — toggle sidebar
    if (k === 'b' || k === 'B') {
      e.preventDefault();
      toggleSidebar();
      return;
    }

    // ⌘⇧O — open folder (F-03)
    if ((k === 'o' || k === 'O') && e.shiftKey) {
      e.preventDefault();
      openFolder();
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
        // UX-10: entering edit mode deactivates sidebar keyboard cursor
        if (state.mode !== 'edit') {
          sbKbd.active = false;
          renderSidebarCursor();
        }
        setMode(state.mode === 'edit' ? 'reading' : 'edit');
      }
      return;
    }

    // ⌘S — save (only meaningful in edit mode)
    // UI-07: always preventDefault to prevent browser Save As dialog in non-Tauri
    if (k === 's' || k === 'S') {
      e.preventDefault();
      if (state.mode === 'edit') {
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

    // F-01: ⌘[ — previous tab
    if (k === '[') {
      e.preventDefault();
      if (state.tabs.length > 1) {
        var curIdx = state.tabs.findIndex(function (t) { return t.id === state.activeId; });
        var prevIdx = (curIdx - 1 + state.tabs.length) % state.tabs.length;
        activateTab(state.tabs[prevIdx].id);
      }
      return;
    }

    // F-01: ⌘] — next tab
    if (k === ']') {
      e.preventDefault();
      if (state.tabs.length > 1) {
        var curIdx2 = state.tabs.findIndex(function (t) { return t.id === state.activeId; });
        var nextIdx = (curIdx2 + 1) % state.tabs.length;
        activateTab(state.tabs[nextIdx].id);
      }
      return;
    }

    // F-05/U-07: ⌘= / ⌘+ — increase font size
    if (k === '=' || k === '+') {
      e.preventDefault();
      setFontSize(state.fontSize + 2);
      return;
    }

    // F-05/U-07: ⌘- — decrease font size
    if (k === '-' || k === '_') {
      e.preventDefault();
      setFontSize(state.fontSize - 2);
      return;
    }

    // F-05/U-07: ⌘0 — reset font size
    if (k === '0') {
      e.preventDefault();
      setFontSize(16);
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
     beforeunload — warn if any tab is dirty
   ──────────────────────────────────────────────────────────── */
  window.addEventListener('beforeunload', function (e) {
    if (state.tabs.some(function (t) { return t.dirty; })) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  /* ────────────────────────────────────────────────────────────
     NATIVE MENU EVENT LISTENERS
     dev-rust emits these events; we route them to existing actions.
   ──────────────────────────────────────────────────────────── */
  function wireNativeMenuEvents() {
    if (!window.__TAURI__ || !window.__TAURI__.event) return;
    // Bind to preserve `this` — a bare `var listen = ...event.listen` loses the
    // method receiver and the listeners silently never fire (broke the menu bar).
    var listen = window.__TAURI__.event.listen.bind(window.__TAURI__.event);

    listen('menu:open-file', function () {
      if (window.TVFiles && typeof TVFiles.openPicker === 'function') TVFiles.openPicker();
    }).catch(function () {});

    listen('menu:open-folder', function () {
      openFolder();
    }).catch(function () {});

    listen('menu:save', function () {
      if (state.mode === 'edit') handleSave();
    }).catch(function () {});

    listen('menu:close-tab', function () {
      if (state.activeId) closeTab(state.activeId);
    }).catch(function () {});

    listen('menu:find', function () {
      // UF-05: only open find in reading mode; silently ignore in edit mode
      if (state.mode === 'reading' && state.tabs.length) _openFindBar();
    }).catch(function () {});

    listen('menu:find-in-files', function () {
      if (window.TVSearch) {
        TVSearch.isOpen && TVSearch.isOpen() ? TVSearch.close() : TVSearch.open();
      }
    }).catch(function () {});

    listen('menu:command-palette', function () {
      if (window.TVPalette) {
        TVPalette.isOpen && TVPalette.isOpen() ? TVPalette.close() : TVPalette.open();
      }
    }).catch(function () {});

    listen('menu:toggle-sidebar', function () {
      toggleSidebar();
    }).catch(function () {});

    // BUG-3 FIX: single toggle replaces the two separate Light/Dark items.
    // Flips between light and dark; matches the "menu:theme-toggle" event emitted
    // by lib.rs on_menu_event.
    listen('menu:theme-toggle', function () {
      setTheme(state.theme === 'dark' ? 'light' : 'dark');
    }).catch(function () {});

    listen('menu:next-tab', function () {
      if (state.tabs.length > 1) {
        var ci = state.tabs.findIndex(function (t) { return t.id === state.activeId; });
        activateTab(state.tabs[(ci + 1) % state.tabs.length].id);
      }
    }).catch(function () {});

    listen('menu:prev-tab', function () {
      if (state.tabs.length > 1) {
        var ci2 = state.tabs.findIndex(function (t) { return t.id === state.activeId; });
        activateTab(state.tabs[(ci2 - 1 + state.tabs.length) % state.tabs.length].id);
      }
    }).catch(function () {});

    // INT-02: View menu zoom items
    listen('menu:zoom-in', function () { setFontSize(state.fontSize + 2); }).catch(function () {});
    listen('menu:zoom-out', function () { setFontSize(state.fontSize - 2); }).catch(function () {});
    listen('menu:zoom-reset', function () { setFontSize(16); }).catch(function () {});
  }

  /* ────────────────────────────────────────────────────────────
     INIT — production boot sequence (E-02)
     S-05 fix: track first-opened (MRU index 0) tab and activate it last.
   ──────────────────────────────────────────────────────────── */
  function init() {
    // U-05: System theme auto-detection
    var savedTheme = localStorage.getItem('tv-theme');
    if (!savedTheme || savedTheme === 'system') {
      var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      state.theme = prefersDark ? 'dark' : 'light';
      // Listen for OS theme changes
      if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
          if (localStorage.getItem('tv-theme') === 'system' || !localStorage.getItem('tv-theme')) {
            state.theme = e.matches ? 'dark' : 'light';
            render();
          }
        });
      }
    }

    // Init file feature (drag-drop) first so drop works during async boot
    if (window.TVFiles && typeof TVFiles.init === 'function') {
      TVFiles.init();
    }

    // Wire native menu events (only effective under Tauri).
    // Run now if the DOM is already parsed (readyState 'interactive' or 'complete');
    // only defer when still 'loading'. The previous '=== complete' check could miss
    // the DOMContentLoaded that had already fired → menu bar never wired.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', wireNativeMenuEvents);
    } else {
      wireNativeMenuEvents();
    }

    // Demo mode: open seed docs if ?demo=1 (tv-docs.js already gates the data)
    var seeds = window.TV_SEED || [];
    var liveDoc = window.TV_LIVE_DOC || null;

    if (seeds.length || liveDoc) {
      // ?demo=1 path — open seed docs, start live watch
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

      if (liveDoc) {
        openDoc({
          name: liveDoc.name,
          source: liveDoc.source,
          path: liveDoc.path || null,
          live: true,
        });
      }

      if (firstId) {
        state.activeId = firstId;
      } else if (state.tabs.length) {
        state.activeId = state.tabs[0].id;
      }

      render();

      if (window.TVLive && typeof TVLive.start === 'function') {
        state.tabs.forEach(function (t) {
          if (t.live) TVLive.start(t.id);
        });
      }
      return;
    }

    // Production path: restore from recent files
    var recentPaths = loadRecentPaths();

    if (recentPaths.length && window.TVNative && TVNative.available) {
      // Tauri: try to read each recent file; skip missing ones
      // S-05 fix: batch-open all tabs without activating, then activate MRU (index 0) at end
      var pending = recentPaths.slice(); // copy — recents[0] is MOST RECENT
      var firstOpenedId = null;  // S-05: will hold the id for recents[0]
      var openedCount = 0;

      function readNext() {
        if (!pending.length) {
          // S-05: after all tabs are loaded, activate the MOST RECENTLY USED (recents[0])
          if (firstOpenedId) {
            // Directly set activeId and render once — no further activateTab calls
            state.activeId = firstOpenedId;
          }
          if (openedCount) {
            render(); // single render after all tabs are open
          } else {
            render(); // show empty dropzone
          }
          return;
        }
        var path = pending.shift();
        var isMostRecent = (pending.length === recentPaths.length - 1 - openedCount);
        window.__TAURI__.core.invoke('read_md_file', { path: path })
          .then(function (doc) {
            if (!doc || !doc.name) { readNext(); return; }
            // Extract parent directory for sidebar grouping (E-12)
            var parentDir = path.replace(/\/[^/]+$/, '') || '/';

            // S-05: Add tab to state WITHOUT calling activateTab (which would render)
            var key = 'native:' + (doc.path || path);
            var existingTab = null;
            for (var i = 0; i < state.tabs.length; i++) {
              if (state.tabs[i].nativePath === (doc.path || path)) {
                existingTab = state.tabs[i]; break;
              }
            }

            var tabId;
            if (existingTab) {
              tabId = existingTab.id;
            } else {
              var newTab = makeTab({
                name: doc.name,
                source: doc.content,
                path: parentDir,
              });
              newTab.nativePath = doc.path || path;
              state.tabs.push(newTab);
              tabId = newTab.id;
            }

            // S-05: the FIRST path processed (recentPaths[0]) is the MRU
            if (openedCount === 0) {
              firstOpenedId = tabId;
            }
            openedCount++;
            readNext();
          })
          .catch(function () {
            // File gone or unreadable — skip silently
            readNext();
          });
      }

      readNext();
    } else {
      // Plain browser (no Tauri) or no recents: just show empty dropzone
      render();
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
    setFontSize: setFontSize,
    toggleSidebar: toggleSidebar,
    scrollToHeading: scrollToHeading,
    markDirty: markDirty,
    saveRecentPath: saveRecentPath,  // exposed so tv-native.js can call it on open
    loadRecentPaths: loadRecentPaths,
    openFolder: openFolder,
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
