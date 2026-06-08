/* ───────────────────────────────────────────────────────────
   tiny-viewer · command palette
   window.TVPalette = { open(), close(), isOpen() }

   Builds .tv-palette-scrim > .tv-palette into TV.el().
   Live results from window.TV.state.tabs.
   D-02: theme/accent switching available as Commands group.
   D-07: ARIA roles on input, listbox, and option rows.
   F-04: "Open File…" and "Open Folder…" commands.
   U-05: "Theme: System" command.
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  /* ── MRU list ─────────────────────────────────────────────
     Tracks tab IDs in most-recently-activated order.
     tv-app.js fires TV.on('tabchange') which we listen to.  */
  var _mru = [];          // [tabId, ...] newest first
  var _overlayEl = null;  // the .tv-palette-scrim element
  var _open = false;

  // We defer wiring the 'tabchange' listener until first open,
  // in case tv-app.js loads after us.
  var _listenerWired = false;

  function _wireMruListener() {
    if (_listenerWired) return;
    if (!window.TV || typeof window.TV.on !== 'function') return;
    window.TV.on('tabchange', function (payload) {
      var id = (payload && payload.id) ? payload.id : (window.TV.state && window.TV.state.activeId);
      if (!id) return;
      _mru = _mru.filter(function (x) { return x !== id; });
      _mru.unshift(id);
      // keep bounded
      if (_mru.length > 50) _mru.length = 50;
    });
    _listenerWired = true;
  }

  /* ── small helpers ────────────────────────────────────────*/
  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Highlight first occurrence of `term` in `text` (case-insensitive).
  // Returns safe HTML with matched segment wrapped in <span class="hl">.
  function _highlight(text, term) {
    var safe = _esc(text);
    if (!term) return safe;
    var idx = text.toLowerCase().indexOf(term.toLowerCase());
    if (idx === -1) return safe;
    var pre  = _esc(text.slice(0, idx));
    var mid  = _esc(text.slice(idx, idx + term.length));
    var post = _esc(text.slice(idx + term.length));
    return pre + '<span class="hl">' + mid + '</span>' + post;
  }

  // Substring match test (case-insensitive).
  function _matches(haystack, needle) {
    if (!needle) return true;
    return haystack.toLowerCase().indexOf(needle.toLowerCase()) !== -1;
  }

  // Extract headings from a markdown source string.
  // Returns [{level, text}, …]
  function _parseHeadings(source) {
    if (!source) return [];
    var out = [];
    var lines = source.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(/^(#{1,3})\s+(.+)/);
      if (m) out.push({ level: m[1].length, text: m[2].trim() });
    }
    return out;
  }

  // Relative time label (very rough, used for MRU sub-text).
  function _relTime(tab) {
    // We don't have a real timestamp per-tab in the contract, so we just
    // return the tab path/name as sub-text when no richer info available.
    return tab.path || tab.name || '';
  }

  /* ── D-02 + F-04 + U-05: command rows ─────────────────── */
  // Returns an array of command row objects matching query.
  function _buildCommandRows(query) {
    var commands = [
      { ic: 'sun',    main: 'Theme: Light',       action: 'theme',  value: 'light' },
      { ic: 'moon',   main: 'Theme: Dark',        action: 'theme',  value: 'dark' },
      { ic: 'circle', main: 'Theme: System',      action: 'theme',  value: 'system' },
      { ic: 'circle', main: 'Accent: Blue',       action: 'accent', value: 'blue' },
      { ic: 'circle', main: 'Accent: Graphite',   action: 'accent', value: 'graphite' },
      { ic: 'circle', main: 'Accent: Warm',       action: 'accent', value: 'warm' },
      // F-04: file/folder open commands
      { ic: 'doc',    main: 'Open File…',         action: 'openFile',   value: '' },
      { ic: 'folder', main: 'Open Folder…',       action: 'openFolder', value: '' },
    ];
    return commands.filter(function (c) { return _matches(c.main, query); });
  }

  /* ── build DOM string for the result list ─────────────────*/
  function _buildList(query, tabs, activeId) {
    var I = window.TV_ICONS || {};
    var groups = [];

    // ── Group 1: Jump to Heading ──────────────────────────
    var headingRows = [];
    for (var ti = 0; ti < tabs.length; ti++) {
      var tab = tabs[ti];
      var headings = _parseHeadings(tab.source);
      for (var hi = 0; hi < headings.length; hi++) {
        var h = headings[hi];
        if (query && !_matches(h.text, query)) continue;
        headingRows.push({
          ic: 'hash',
          main: h.text,
          mainHtml: _highlight(h.text, query),
          sub: _esc(tab.name),
          tabId: tab.id,
          action: 'heading',
          headingText: h.text,
        });
      }
    }
    // Limit heading rows to keep palette from getting huge
    if (headingRows.length > 8) headingRows = headingRows.slice(0, 8);
    if (headingRows.length) groups.push({ label: 'Jump to Heading', rows: headingRows });

    // ── Group 2: Open File ────────────────────────────────
    var fileRows = [];
    for (var fi = 0; fi < tabs.length; fi++) {
      var ftab = tabs[fi];
      if (query && !_matches(ftab.name, query)) continue;
      fileRows.push({
        ic: 'doc',
        main: ftab.name,
        mainHtml: _highlight(ftab.name, query),
        sub: _esc(ftab.path || ''),
        tabId: ftab.id,
        action: 'activate',
      });
    }
    if (fileRows.length > 6) fileRows = fileRows.slice(0, 6);
    if (fileRows.length) groups.push({ label: 'Open File', rows: fileRows });

    // ── Group 3: Recent ───────────────────────────────────
    // Build from MRU, skip tabs already shown in Open File if query is present
    var recentRows = [];
    var shownIds = {};
    for (var si = 0; si < fileRows.length; si++) shownIds[fileRows[si].tabId] = true;

    // Use MRU order; fall back to reversed tabs array if MRU is empty
    var orderedIds = _mru.length ? _mru : tabs.map(function (t) { return t.id; }).reverse();

    for (var ri = 0; ri < orderedIds.length; ri++) {
      var rid = orderedIds[ri];
      if (shownIds[rid]) continue;
      var rtab = null;
      for (var rj = 0; rj < tabs.length; rj++) {
        if (tabs[rj].id === rid) { rtab = tabs[rj]; break; }
      }
      if (!rtab) continue;
      if (query && !_matches(rtab.name, query)) continue;
      recentRows.push({
        ic: 'clock',
        main: rtab.name,
        mainHtml: _highlight(rtab.name, query),
        sub: _relTime(rtab),
        tabId: rtab.id,
        action: 'activate',
      });
      if (recentRows.length >= 4) break;
    }
    if (recentRows.length) groups.push({ label: 'Recent', rows: recentRows });

    // ── Group 4: Commands (D-02: theme/accent + F-04: file/folder) ───
    var cmdRows = _buildCommandRows(query);
    if (cmdRows.length) {
      var builtCmdRows = cmdRows.map(function (c) {
        return {
          ic: c.ic,
          main: c.main,
          mainHtml: _highlight(c.main, query),
          sub: '',
          tabId: '',
          action: c.action,
          value: c.value,
        };
      });
      groups.push({ label: 'Commands', rows: builtCmdRows });
    }

    // ── Render HTML ───────────────────────────────────────
    if (!groups.length) {
      return '<div class="tv-pal-group" style="padding:18px 12px;text-align:center">No results</div>';
    }

    var html = '';
    var rowIndex = 0;
    for (var gi = 0; gi < groups.length; gi++) {
      if (gi) html += '<div class="tv-pal-divider" role="separator"></div>';
      html += '<div class="tv-pal-group">' + _esc(groups[gi].label) + '</div>';
      var rows = groups[gi].rows;
      for (var rri = 0; rri < rows.length; rri++) {
        var row = rows[rri];
        var isSel = (rowIndex === 0);
        // D-07: role="option" + aria-selected on each palette row
        html += '<div class="tv-pal-row' + (isSel ? ' sel' : '') + '"' +
          ' role="option"' +
          ' aria-selected="' + (isSel ? 'true' : 'false') + '"' +
          ' data-action="' + row.action + '"' +
          (row.tabId ? ' data-tab-id="' + _esc(row.tabId) + '"' : '') +
          (row.action === 'heading' ? ' data-heading="' + _esc(row.headingText) + '"' : '') +
          (row.value ? ' data-value="' + _esc(row.value) + '"' : '') +
          '>' +
          '<span class="ic">' + (I[row.ic] || '') + '</span>' +
          '<span>' + row.mainHtml + '</span>' +
          (row.sub ? '<span class="sub">' + row.sub + '</span>' : '') +
          '</div>';
        rowIndex++;
      }
    }
    return html;
  }

  /* ── build the full palette overlay HTML ──────────────────*/
  function _buildOverlayHtml(query, tabs, activeId) {
    var I = window.TV_ICONS || {};
    var list = _buildList(query, tabs, activeId);

    // D-07: aria-label on input, role="listbox" on list container
    return '<div class="tv-palette-scrim" id="tv-pal-scrim">' +
      '<div class="tv-palette" id="tv-pal-box">' +
        '<div class="tv-pal-input">' +
          '<span class="ic">' + (I.search || '') + '</span>' +
          '<input class="tv-pal-input-field" id="tv-pal-input-field" type="text" autocomplete="off" spellcheck="false"' +
            ' aria-label="Command palette"' +
            ' aria-autocomplete="list"' +
            ' aria-controls="tv-pal-list"' +
            ' placeholder="Search files, headings, and commands"' +
            ' value="' + _esc(query) + '">' +
        '</div>' +
        '<div class="tv-pal-list" id="tv-pal-list" role="listbox" aria-label="Results">' +
          list +
        '</div>' +
        '<div class="tv-pal-foot">' +
          '<span class="k">' + (I.updown || '') + ' navigate</span>' +
          '<span class="k">' + (I.ret || '') + ' open</span>' +
          '<span class="k"><span class="tv-kbd">esc</span> close</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ── update just the list (on input) ─────────────────────*/
  function _refreshList(query) {
    if (!_overlayEl) return;
    var listEl = _overlayEl.querySelector('#tv-pal-list');
    if (!listEl) return;
    var tabs = (window.TV && window.TV.state && window.TV.state.tabs) ? window.TV.state.tabs : [];
    var activeId = window.TV && window.TV.state ? window.TV.state.activeId : null;
    listEl.innerHTML = _buildList(query, tabs, activeId);
    _selIndex = 0;
  }

  /* ── selection management ─────────────────────────────────*/
  var _selIndex = 0;

  function _rows() {
    if (!_overlayEl) return [];
    return Array.prototype.slice.call(_overlayEl.querySelectorAll('.tv-pal-row'));
  }

  function _setSel(idx) {
    var rs = _rows();
    if (!rs.length) return;
    _selIndex = Math.max(0, Math.min(idx, rs.length - 1));
    for (var i = 0; i < rs.length; i++) {
      rs[i].classList.toggle('sel', i === _selIndex);
      // D-07: update aria-selected dynamically
      rs[i].setAttribute('aria-selected', i === _selIndex ? 'true' : 'false');
    }
    rs[_selIndex].scrollIntoView({ block: 'nearest' });
  }

  function _activateSel() {
    var rs = _rows();
    if (!rs.length) return;
    var row = rs[_selIndex] || rs[0];
    if (row) _activateRow(row);
  }

  function _activateRow(row) {
    var action  = row.getAttribute('data-action');
    var tabId   = row.getAttribute('data-tab-id');
    var heading = row.getAttribute('data-heading');
    var value   = row.getAttribute('data-value');

    if (!window.TV) { TVPalette.close(); return; }

    // D-02: handle theme/accent command actions
    if (action === 'theme' && value) {
      window.TV.setTheme(value);
      TVPalette.close();
      return;
    }
    if (action === 'accent' && value) {
      window.TV.setAccent(value);
      TVPalette.close();
      return;
    }

    // F-04: Open File action
    if (action === 'openFile') {
      TVPalette.close();
      if (window.TVFiles && typeof TVFiles.openPicker === 'function') {
        TVFiles.openPicker();
      }
      return;
    }

    // F-04: Open Folder action
    if (action === 'openFolder') {
      TVPalette.close();
      if (window.TVNative && typeof TVNative.openFolder === 'function') {
        TVNative.openFolder();
      } else if (window.TV && typeof window.TV.openFolder === 'function') {
        window.TV.openFolder();
      }
      return;
    }

    if (action === 'heading' && tabId && heading) {
      window.TV.scrollToHeading(tabId, heading);
    } else if (tabId) {
      window.TV.activateTab(tabId);
    }
    TVPalette.close();
  }

  /* ── keyboard handler (attached while open) ───────────────*/
  function _onKeyDown(e) {
    if (!_open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      TVPalette.close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _setSel(_selIndex + 1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      _setSel(_selIndex - 1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      _activateSel();
      return;
    }
  }

  /* ── public API ───────────────────────────────────────────*/
  var TVPalette = {
    open: function () {
      if (_open) {
        // re-focus the input if already open
        var inp = document.getElementById('tv-pal-input-field') ||
                  (_overlayEl && _overlayEl.querySelector('.tv-pal-input-field'));
        if (inp) inp.focus();
        return;
      }

      if (!window.TV) return;
      var root = window.TV.el();
      if (!root) return;

      _wireMruListener();

      // Prime MRU with current active tab if not yet tracked
      var state = window.TV.state;
      if (state && state.activeId && _mru.indexOf(state.activeId) === -1) {
        _mru.unshift(state.activeId);
      }

      var tabs     = (state && state.tabs) ? state.tabs : [];
      var activeId = state ? state.activeId : null;

      var html = _buildOverlayHtml('', tabs, activeId);
      var wrapper = document.createElement('div');
      wrapper.innerHTML = html;
      _overlayEl = wrapper.firstChild;

      root.appendChild(_overlayEl);
      _open = true;
      _selIndex = 0;

      // Autofocus the real input
      var inputEl = _overlayEl.querySelector('.tv-pal-input-field');
      if (inputEl) {
        inputEl.focus();

        // Live filtering on input
        inputEl.addEventListener('input', function () {
          _refreshList(inputEl.value);
          _selIndex = 0;
        });
      }

      // Click on scrim (outside palette) → close
      _overlayEl.addEventListener('click', function (e) {
        var box = document.getElementById('tv-pal-box');
        if (box && box.contains(e.target)) return;
        TVPalette.close();
      });

      // Click on row → activate
      _overlayEl.addEventListener('click', function (e) {
        var row = e.target.closest('.tv-pal-row');
        if (row) _activateRow(row);
      });

      // Hover → set selection
      _overlayEl.addEventListener('mousemove', function (e) {
        var row = e.target.closest('.tv-pal-row');
        if (!row) return;
        var rs = _rows();
        var idx = rs.indexOf(row);
        if (idx !== -1) _setSel(idx);
      });

      document.addEventListener('keydown', _onKeyDown, true);
    },

    close: function () {
      if (!_open) return;
      _open = false;
      document.removeEventListener('keydown', _onKeyDown, true);
      if (_overlayEl && _overlayEl.parentNode) {
        _overlayEl.parentNode.removeChild(_overlayEl);
      }
      _overlayEl = null;
      _selIndex = 0;
    },

    isOpen: function () {
      return _open;
    },
  };

  window.TVPalette = TVPalette;
})();
