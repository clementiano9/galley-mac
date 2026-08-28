/* ───────────────────────────────────────────────────────────
   Galley · command palette
   window.TVPalette = { open(), close(), isOpen(), openOutline() }

   Builds .tv-palette-scrim > .tv-palette into TV.el().
   Live results from window.TV.state.tabs.
   D-02: theme/accent switching available as Commands group.
   D-07: ARIA roles on input, listbox, and option rows.
   F-04: "Open File…" and "Open Folder…" commands.
   U-05: "Theme: System" command.
   C-08: fuzzy (subsequence + typo-tolerant) matching, shared with the
         ⌘T launcher via TV.fuzzyScore / TV.highlightIndices.
   C-09: full command coverage, right-aligned accelerator chips,
         50-file / 100-heading-per-tab caps, memoised heading parsing.
   C-10: .is-overflowing on .tv-pal-list drives the CSS bottom fade.
   C-32: role="dialog" aria-modal + Tab trap + focus restore.
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
    // P2-4: closeTab() does not go through activateTab (no 'tabchange' when
    // a background tab closes, or even the active one — it sets
    // state.activeId directly), but it always calls render(). Prune there.
    window.TV.on('render', _pruneHeadCache);
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

  /* ── C-08: fuzzy matching ─────────────────────────────────
     The real scorer lives in tv-app.js (it powers the ⌘T launcher) and is
     exported as TV.fuzzyScore / TV.highlightIndices. We prefer those so the
     two file-open surfaces rank identically; the small local versions below
     are only a load-order safety net (tv-app.js may not have booted yet).  */

  function _isBoundaryChar(ch) {
    return ch === '/' || ch === '.' || ch === '-' || ch === '_' || ch === ' ' || ch === '\\';
  }

  // Minimal greedy subsequence scorer — mirrors tv-app.js fuzzyScore().
  function _localFuzzyScore(query, text) {
    if (!query) return { score: 0, indices: [] };
    var q = String(query).toLowerCase();
    var t = String(text);
    var tl = t.toLowerCase();
    var indices = [];
    var score = 0;
    var ti = 0;
    var prevMatch = -2;
    for (var qi = 0; qi < q.length; qi++) {
      var qc = q.charAt(qi);
      var found = -1;
      for (; ti < tl.length; ti++) {
        if (tl.charAt(ti) === qc) { found = ti; break; }
      }
      if (found === -1) return null;
      indices.push(found);
      score += 10;
      if (found === prevMatch + 1) {
        score += 15;
      } else if (prevMatch >= 0) {
        score -= Math.min(found - prevMatch - 1, 8) * 2;
      }
      if (found === 0 || _isBoundaryChar(t.charAt(found - 1))) score += 12;
      prevMatch = found;
      ti = found + 1;
    }
    score += Math.round((q.length / Math.max(t.length, 1)) * 8);
    return { score: score, indices: indices };
  }

  function _baseScore(query, text) {
    var fn = (window.TV && typeof window.TV.fuzzyScore === 'function')
      ? window.TV.fuzzyScore
      : _localFuzzyScore;
    try {
      return fn(query, text);
    } catch (e) {
      return _localFuzzyScore(query, text);
    }
  }

  // Score `query` against `text`, tolerating one adjacent transposition
  // ("shcema" → schema.md) and stray spaces ("new tab" → NewTab). Returns
  // { score, indices } (indices are positions in `text`) or null.
  // Penalties keep an exact subsequence ranked above a repaired one.
  function _scoreText(query, text) {
    var q = String(query == null ? '' : query);
    if (!q) return { score: 0, indices: [] };

    var direct = _baseScore(q, text);
    if (direct) return direct;

    // Tier 2: ignore whitespace in the query.
    var qns = q.replace(/\s+/g, '');
    if (qns && qns !== q) {
      var noSpace = _baseScore(qns, text);
      if (noSpace) return { score: noSpace.score - 6, indices: noSpace.indices };
    }

    // Tier 3: single adjacent transposition (the classic typo).
    var variants = [q];
    if (qns && qns !== q) variants.push(qns);
    for (var v = 0; v < variants.length; v++) {
      var s = variants[v];
      for (var i = 0; i + 1 < s.length; i++) {
        var swapped = s.slice(0, i) + s.charAt(i + 1) + s.charAt(i) + s.slice(i + 2);
        var r = _baseScore(swapped, text);
        if (r) return { score: r.score - 30, indices: r.indices };
      }
    }
    return null;
  }

  // Build ESCAPED HTML with matched characters wrapped in <span class="hl">.
  function _localHighlight(text, indices) {
    var s = String(text);
    if (!indices || !indices.length) return _esc(s);
    var mark = {};
    indices.forEach(function (i) { mark[i] = true; });
    var out = '';
    var run = '';
    var inHl = false;
    for (var i = 0; i < s.length; i++) {
      var hit = !!mark[i];
      if (hit !== inHl) {
        if (run) out += inHl ? '<span class="hl">' + _esc(run) + '</span>' : _esc(run);
        run = '';
        inHl = hit;
      }
      run += s.charAt(i);
    }
    if (run) out += inHl ? '<span class="hl">' + _esc(run) + '</span>' : _esc(run);
    return out;
  }

  function _hl(text, indices) {
    if (window.TV && typeof window.TV.highlightIndices === 'function') {
      try { return window.TV.highlightIndices(text, indices); } catch (e) { /* fall through */ }
    }
    return _localHighlight(text, indices);
  }

  // Sort rows best-first. Array.prototype.sort is stable, so equal scores
  // keep the order the rows were produced in (tab order / command order).
  function _rankRows(rows) {
    return rows.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
  }

  // Extract headings from a markdown source string.
  // Returns [{level, text}, …]
  // UF-08: include h4-h6 (was #{1,3} — missed deeper headings in technical docs)
  function _parseHeadings(source) {
    if (!source) return [];
    var out = [];
    var lines = source.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(/^(#{1,6})\s+(.+)/);
      if (m) out.push({ level: m[1].length, text: m[2].trim() });
    }
    return out;
  }

  /* ── C-09: per-tab heading memoisation ────────────────────
     _parseHeadings splits the whole source. Running it for every open tab on
     every keystroke makes ⌘K latency scale with total open bytes, so cache the
     result per tab keyed on `tab.source` IDENTITY (=== on the string), which
     changes whenever an edit or a live-watch update replaces the source. */
  var _headCache = {};   // tabId -> { src, headings }
  var HEADINGS_PER_TAB_CAP = 100;   // parse-time: bounds the per-tab candidate pool
  var FILE_ROW_CAP = 50;            // parse-time: bounds the candidate pool before ranking
  // P1-4: C-09 reused the parse caps above as the RENDER cap too, so an
  // empty-query ⌘K (which matches everything) grew from ~14 rows to 126 and
  // pushed Commands to row 103. These are the actual on-screen caps, applied
  // AFTER _rankRows() so the best matches still survive the cut.
  var HEADING_RENDER_CAP = 8;
  var FILE_RENDER_CAP = 6;

  // P2-4: nothing ever cleared a closed tab's entry, so a long session held
  // the full source text of every document ever opened, not just the ones
  // still open. Pruned reactively on every render (wired below alongside
  // the MRU listener) rather than hooking closeTab specifically, so it
  // catches every path a tab can disappear by, not just the one button.
  function _pruneHeadCache() {
    if (!window.TV || !window.TV.state || !Array.isArray(window.TV.state.tabs)) return;
    var live = {};
    window.TV.state.tabs.forEach(function (t) { if (t) live[t.id] = true; });
    Object.keys(_headCache).forEach(function (id) {
      if (!live[id]) delete _headCache[id];
    });
  }

  function _headingsFor(tab) {
    if (!tab) return [];
    var hit = _headCache[tab.id];
    if (hit && hit.src === tab.source) return hit.headings;
    var parsed = _parseHeadings(tab.source);
    if (parsed.length > HEADINGS_PER_TAB_CAP) parsed = parsed.slice(0, HEADINGS_PER_TAB_CAP);
    _headCache[tab.id] = { src: tab.source, headings: parsed };
    return parsed;
  }

  // Relative time label (very rough, used for MRU sub-text).
  function _relTime(tab) {
    // We don't have a real timestamp per-tab in the contract, so we just
    // return the tab path/name as sub-text when no richer info available.
    return tab.path || tab.name || '';
  }

  function _isNative() {
    return !!window.__TAURI__;
  }

  function _activeTab() {
    if (window.TV && typeof window.TV.getActiveTab === 'function') return window.TV.getActiveTab();
    var st = window.TV && window.TV.state;
    if (!st || !st.tabs) return null;
    for (var i = 0; i < st.tabs.length; i++) {
      if (st.tabs[i].id === st.activeId) return st.tabs[i];
    }
    return null;
  }

  /* ── D-02 + F-04 + U-05 + F-05 + DR-27 + C-09: command rows ───── */
  // Returns an array of command row objects matching query.
  function _buildCommandRows(query) {
    // F-05 / DR-24-DR-25: Mermaid toggle label reflects current state
    var mermaidEnabled = (window.TV && typeof window.TV.isMermaidEnabled === 'function')
      ? window.TV.isMermaidEnabled()
      : true;
    var mermaidLabel = mermaidEnabled ? 'Disable Mermaid diagrams' : 'Enable Mermaid diagrams';

    // C-09: the zoom rows carry the current size so ⌘K is the readout
    // (DR-31 zero-pixel chrome budget: no new on-screen indicator).
    var fontSize = (window.TV && window.TV.state && window.TV.state.fontSize) ? window.TV.state.fontSize : 16;
    var inEdit = !!(window.TV && window.TV.state && window.TV.state.mode === 'edit');

    var commands = [
      { ic: 'sun',    main: 'Theme: Light',          action: 'theme',          value: 'light' },
      { ic: 'moon',   main: 'Theme: Dark',           action: 'theme',          value: 'dark' },
      { ic: 'circle', main: 'Theme: System',         action: 'theme',          value: 'system' },
      { ic: 'circle', main: 'Accent: Blue',          action: 'accent',         value: 'blue' },
      { ic: 'circle', main: 'Accent: Graphite',      action: 'accent',         value: 'graphite' },
      { ic: 'circle', main: 'Accent: Warm',          action: 'accent',         value: 'warm' },
      // F-04: file/folder open commands
      { ic: 'doc',    main: 'Open File…',            action: 'openFile',       value: '', kbd: '⌘O' },
      { ic: 'folder', main: 'Open Folder…',          action: 'openFolder',     value: '', kbd: '⌘⇧O' },
      // C-09: window/tab commands — ⌘K is the app's command surface, so the
      // accelerators live here too (a palette is where users learn them).
      { ic: 'sidebar', main: 'Toggle Sidebar',       action: 'toggleSidebar',  value: '', kbd: '⌘B' },
      { ic: 'plus',   main: 'New Tab',               action: 'newTab',         value: '', kbd: '⌘T' },
      { ic: 'close',  main: 'Close Tab',             action: 'closeTab',       value: '', kbd: '⌘W' },
      { ic: 'pencil', main: inEdit ? 'Stop editing' : 'Edit document',
                                                     action: 'toggleEdit',     value: '', kbd: '⌘E' },
      { ic: 'doc',    main: 'Save',                  action: 'saveDoc',        value: '', kbd: '⌘S' },
      { ic: 'search', main: 'Find in Document',      action: 'findDoc',        value: '', kbd: '⌘F' },
      { ic: 'search', main: 'Search All Tabs',       action: 'searchAll',      value: '', kbd: '⌘⇧F' },
      // U-12: reload current file from disk
      { ic: 'refresh', main: 'Reload from Disk',     action: 'reloadFile',     value: '' },
      // F-05 / DR-24-DR-25: Mermaid toggle
      { ic: 'circle', main: mermaidLabel,            action: 'toggleMermaid',  value: '' },
      // DR-27: font size commands, with the current size as the readout
      { ic: 'circle', main: 'Increase text size · ' + fontSize + ' px', action: 'fontSizeUp',   value: '', kbd: '⌘=' },
      { ic: 'circle', main: 'Decrease text size · ' + fontSize + ' px', action: 'fontSizeDown', value: '', kbd: '⌘−' },
      // DR-30: F-22 shortcuts overlay (the designated shortcut reference, DR-16)
      { ic: 'kbd',    main: 'Preferences & Shortcuts…', action: 'shortcuts',   value: '', kbd: '?' },
      // U-14 / DR-98: keyboard-accessible tab reorder (flat rows, no group header)
      { ic: 'circle', main: 'Move Tab Left',            action: 'moveTabLeft',  value: '' },
      { ic: 'circle', main: 'Move Tab Right',           action: 'moveTabRight', value: '' },
      // U-15 / DR-99: print / export to PDF (hint ⌘P)
      { ic: 'circle', main: 'Print / Export PDF…',      action: 'printDoc',     value: '', kbd: '⌘P' },
    ];

    // C-33: Esc now DISCARDS edits (one level of undo). Only offer this row
    // when there is actually something to restore, and only for the active
    // tab — matches the ⌘Z-in-reading-mode accelerator it shows.
    if (window.TV && typeof window.TV.hasDiscardedEdits === 'function' && window.TV.hasDiscardedEdits()) {
      commands.push({ ic: 'refresh', main: 'Restore discarded edits', action: 'restoreDiscardedEdits', value: '', kbd: '⌘Z' });
    }

    // C-09: Finder-only rows — hidden outside the native shell where they
    // cannot work at all.
    if (_isNative()) {
      commands.push({ ic: 'reveal', main: 'Reveal in Finder', action: 'revealFinder', value: '' });
      commands.push({ ic: 'doc',    main: 'Copy Path',        action: 'copyPath',     value: '' });
    }

    // C-08: rank command rows by fuzzy score too.
    var out = [];
    for (var i = 0; i < commands.length; i++) {
      var c = commands[i];
      var s = _scoreText(query, c.main);
      if (!s) continue;
      out.push({
        ic: c.ic,
        main: c.main,
        mainHtml: _hl(c.main, s.indices),
        sub: '',
        kbd: c.kbd || '',
        tabId: '',
        action: c.action,
        value: c.value,
        score: s.score,
      });
    }
    return _rankRows(out);
  }

  /* ── build DOM string for the result list ─────────────────*/
  function _buildList(query, tabs, activeId) {
    var I = window.TV_ICONS || {};
    var groups = [];

    // ── Group 1: Jump to Heading ──────────────────────────
    var headingRows = [];
    for (var ti = 0; ti < tabs.length; ti++) {
      var tab = tabs[ti];
      var headings = _headingsFor(tab);
      for (var hi = 0; hi < headings.length; hi++) {
        var h = headings[hi];
        var hs = _scoreText(query, h.text);
        if (!hs) continue;
        headingRows.push({
          ic: 'hash',
          main: h.text,
          mainHtml: _hl(h.text, hs.indices),
          sub: _esc(tab.name),
          kbd: '',
          tabId: tab.id,
          action: 'heading',
          headingText: h.text,
          score: hs.score,
        });
      }
    }
    // C-09: rank first, THEN cap, so the best matches survive the cut.
    // The per-tab cap already ran in _headingsFor(); this bounds the render.
    headingRows = _rankRows(headingRows);
    if (headingRows.length > HEADINGS_PER_TAB_CAP) headingRows = headingRows.slice(0, HEADINGS_PER_TAB_CAP);
    // P1-4: separate render cap — ranking already ran above, so this cuts
    // the worst matches, not arbitrary ones.
    if (headingRows.length > HEADING_RENDER_CAP) headingRows = headingRows.slice(0, HEADING_RENDER_CAP);
    if (headingRows.length) groups.push({ label: 'Jump to Heading', rows: headingRows });

    // ── Group 2: Open File ────────────────────────────────
    var fileRows = [];
    for (var fi = 0; fi < tabs.length; fi++) {
      var ftab = tabs[fi];
      // Score the basename first; fall back to the display path so a query
      // like "proj/read" still finds the file (mirrors the ⌘T launcher).
      var fs1 = _scoreText(query, ftab.name);
      var fs2 = ftab.path ? _scoreText(query, ftab.path) : null;
      if (!fs1 && !fs2) continue;
      var nameScore = fs1 ? fs1.score + 120 : 0;
      var pathScore = fs2 ? fs2.score : 0;
      fileRows.push({
        ic: 'doc',
        main: ftab.name,
        mainHtml: _hl(ftab.name, fs1 ? fs1.indices : []),
        sub: _esc(ftab.path || ''),
        kbd: '',
        tabId: ftab.id,
        action: 'activate',
        score: Math.max(nameScore, pathScore),
      });
    }
    fileRows = _rankRows(fileRows);
    if (fileRows.length > FILE_ROW_CAP) fileRows = fileRows.slice(0, FILE_ROW_CAP);
    // P1-4: separate render cap — ranking already ran above, so this cuts
    // the worst matches, not arbitrary ones.
    if (fileRows.length > FILE_RENDER_CAP) fileRows = fileRows.slice(0, FILE_RENDER_CAP);
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
      var rs = _scoreText(query, rtab.name);
      if (!rs) continue;
      recentRows.push({
        ic: 'clock',
        main: rtab.name,
        mainHtml: _hl(rtab.name, rs.indices),
        sub: _relTime(rtab),
        kbd: '',
        tabId: rtab.id,
        action: 'activate',
        score: rs.score,
      });
      if (recentRows.length >= 4) break;
    }
    // Recent is an MRU list: keep recency order, do not re-rank by score.
    if (recentRows.length) groups.push({ label: 'Recent', rows: recentRows });

    // ── Group 4: Commands (D-02: theme/accent + F-04: file/folder) ───
    var cmdRows = _buildCommandRows(query);
    if (cmdRows.length) groups.push({ label: 'Commands', rows: cmdRows });

    // ── Render HTML ───────────────────────────────────────
    if (!groups.length) {
      return '<div class="tv-pal-empty">No results</div>';
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
          // C-09: right-aligned accelerator chip, same .kbd style as ⌘T
          (row.kbd ? '<span class="kbd">' + _esc(row.kbd) + '</span>' : '') +
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
    // C-32: the box is a modal dialog (ARIA APG) so assistive tech announces
    // the boundary and Tab is trapped inside it.
    return '<div class="tv-palette-scrim" id="tv-pal-scrim">' +
      '<div class="tv-palette" id="tv-pal-box"' +
        ' role="dialog" aria-modal="true" aria-label="Command palette">' +
        '<div class="tv-pal-input">' +
          '<span class="ic">' + (I.search || '') + '</span>' +
          '<input class="tv-pal-input-field" id="tv-pal-input-field" type="text" autocomplete="off" spellcheck="false"' +
            ' role="combobox"' +
            ' aria-expanded="true"' +
            ' aria-haspopup="listbox"' +
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

  /* ── U-16: headings-only list (for openOutline mode) ─────*/
  // Returns HTML showing headings of the active document only (DR-42–DR-45).
  // No file rows, no command rows. H1–H6 with inline padding-left indent (DR-43).
  function _buildOutlineList(query) {
    var tabs = (window.TV && window.TV.state && window.TV.state.tabs) ? window.TV.state.tabs : [];
    var activeId = (window.TV && window.TV.state) ? window.TV.state.activeId : null;
    var I = window.TV_ICONS || {};

    // Find the active tab's source
    var activeTab = null;
    for (var ti = 0; ti < tabs.length; ti++) {
      if (tabs[ti].id === activeId) { activeTab = tabs[ti]; break; }
    }

    var headings = activeTab ? _headingsFor(activeTab) : [];

    if (!headings.length) {
      return '<div class="tv-pal-empty">No headings in this document</div>';
    }

    var html = '';
    var rowIndex = 0;
    var groupHeaderAdded = false;

    for (var hi = 0; hi < headings.length; hi++) {
      var h = headings[hi];
      var hs = _scoreText(query, h.text);
      if (!hs) continue;
      if (!groupHeaderAdded) {
        html += '<div class="tv-pal-group">Jump to Heading</div>';
        groupHeaderAdded = true;
      }
      // DR-43: 2px indent per heading level (H1=0, H2=2, … H6=10)
      var indent = (h.level - 1) * 2;
      var isSel = (rowIndex === 0);
      html += '<div class="tv-pal-row' + (isSel ? ' sel' : '') + '"' +
        ' role="option"' +
        ' aria-selected="' + (isSel ? 'true' : 'false') + '"' +
        ' data-action="heading"' +
        (activeTab ? ' data-tab-id="' + _esc(activeTab.id) + '"' : '') +
        ' data-heading="' + _esc(h.text) + '"' +
        ' style="padding-left:' + (8 + indent) + 'px"' +
        '>' +
        '<span class="ic">' + (I.hash || '') + '</span>' +
        '<span>' + _hl(h.text, hs.indices) + '</span>' +
        '</div>';
      rowIndex++;
    }

    if (!rowIndex) {
      return '<div class="tv-pal-empty">No headings in this document</div>';
    }

    return html;
  }

  // Flag: when true, the palette shows headings-only (openOutline mode)
  var _outlineMode = false;

  /* ── C-10: mark the list when it scrolls ──────────────────
     css-polish paints a bottom fade on .tv-pal-list.is-overflowing so the
     list never appears to end flat on a dangling group header. Recomputed
     after every list rebuild (content height is what changes). */
  function _syncOverflowFlag() {
    if (!_overlayEl) return;
    var listEl = _overlayEl.querySelector('#tv-pal-list');
    if (!listEl || typeof listEl.scrollHeight !== 'number') return;
    var overflowing = listEl.scrollHeight > listEl.clientHeight + 1;
    listEl.classList.toggle('is-overflowing', overflowing);
  }

  /* ── update just the list (on input) ─────────────────────*/
  function _refreshList(query) {
    if (!_overlayEl) return;
    var listEl = _overlayEl.querySelector('#tv-pal-list');
    if (!listEl) return;
    var tabs = (window.TV && window.TV.state && window.TV.state.tabs) ? window.TV.state.tabs : [];
    var activeId = window.TV && window.TV.state ? window.TV.state.activeId : null;
    if (_outlineMode) {
      listEl.innerHTML = _buildOutlineList(query);
    } else {
      listEl.innerHTML = _buildList(query, tabs, activeId);
    }
    _selIndex = 0;
    _syncOverflowFlag();
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

    // U-12: Reload from Disk action
    if (action === 'reloadFile') {
      TVPalette.close();
      if (window.TV && typeof window.TV.reloadActiveTab === 'function') {
        window.TV.reloadActiveTab();
      }
      return;
    }

    // F-05 / DR-24-DR-25: Mermaid toggle
    if (action === 'toggleMermaid') {
      TVPalette.close();
      if (window.TV && typeof window.TV.toggleMermaid === 'function') {
        window.TV.toggleMermaid();
      }
      return;
    }

    // DR-27: font size up/down
    if (action === 'fontSizeUp') {
      TVPalette.close();
      if (window.TV && typeof window.TV.setFontSize === 'function') {
        window.TV.setFontSize((window.TV.state && window.TV.state.fontSize ? window.TV.state.fontSize : 16) + 2);
      }
      return;
    }
    if (action === 'fontSizeDown') {
      TVPalette.close();
      if (window.TV && typeof window.TV.setFontSize === 'function') {
        window.TV.setFontSize((window.TV.state && window.TV.state.fontSize ? window.TV.state.fontSize : 16) - 2);
      }
      return;
    }

    // DR-30 / F-22: Preferences & Shortcuts overlay
    if (action === 'shortcuts') {
      TVPalette.close();
      if (window.TV && typeof window.TV.openShortcuts === 'function') {
        window.TV.openShortcuts();
      }
      return;
    }

    /* ── C-09: window / document commands ─────────────────
       Each delegates to the same entry point the keyboard router uses, so
       the palette can never drift from the accelerator it advertises. */
    if (action === 'toggleSidebar') {
      TVPalette.close();
      if (typeof window.TV.toggleSidebar === 'function') window.TV.toggleSidebar();
      return;
    }
    if (action === 'newTab') {
      TVPalette.close();
      if (typeof window.TV.openUntitledTab === 'function') window.TV.openUntitledTab();
      return;
    }
    if (action === 'closeTab') {
      TVPalette.close();
      var closeId = window.TV.state && window.TV.state.activeId;
      if (closeId && typeof window.TV.closeTab === 'function') window.TV.closeTab(closeId);
      return;
    }
    if (action === 'toggleEdit') {
      TVPalette.close();
      if (typeof window.TV.setMode === 'function') {
        var nextMode = (window.TV.state && window.TV.state.mode === 'edit') ? 'reading' : 'edit';
        window.TV.setMode(nextMode);
      }
      return;
    }
    if (action === 'saveDoc') {
      TVPalette.close();
      if (typeof window.TV.handleSave === 'function') window.TV.handleSave();
      return;
    }
    // C-33: mirrors the ⌘Z-in-reading-mode accelerator the row shows.
    if (action === 'restoreDiscardedEdits') {
      TVPalette.close();
      if (typeof window.TV.restoreDiscardedEdits === 'function') window.TV.restoreDiscardedEdits();
      return;
    }
    if (action === 'findDoc') {
      TVPalette.close();
      if (typeof window.TV.openFindBar === 'function') window.TV.openFindBar();
      return;
    }
    if (action === 'searchAll') {
      TVPalette.close();
      if (window.TVSearch && typeof TVSearch.open === 'function') TVSearch.open();
      return;
    }
    // P2-10: no path, no clipboard API, or a rejected writeText used to all
    // produce nothing at all — the row would close the palette and just do
    // nothing, with no way to tell success from failure. Toast on every
    // failure path now, same as the rest of this pass.
    if (action === 'revealFinder') {
      TVPalette.close();
      var rTab = _activeTab();
      var rPath = rTab && (rTab.nativePath || rTab.path);
      if (rPath && window.TVNative && typeof TVNative.revealInFinder === 'function') {
        // revealInFinder() itself toasts on its own invoke() failure.
        TVNative.revealInFinder(rPath);
      } else if (window.TVNative && typeof TVNative.showToast === 'function') {
        TVNative.showToast('Save this document first, then reveal it in Finder', { kind: 'error' });
      }
      return;
    }
    if (action === 'copyPath') {
      TVPalette.close();
      var cTab = _activeTab();
      var cPath = cTab && (cTab.nativePath || cTab.path);
      var cToastErr = function (msg) {
        if (window.TVNative && typeof TVNative.showToast === 'function') {
          TVNative.showToast(msg, { kind: 'error' });
        }
      };
      if (!cPath) {
        cToastErr('Save this document first, then copy its path');
        return;
      }
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        cToastErr('Could not copy path');
        return;
      }
      navigator.clipboard.writeText(cPath).then(function () {
        if (window.TVNative && typeof TVNative.showToast === 'function') {
          TVNative.showToast('Path copied');
        }
      }).catch(function () {
        cToastErr('Could not copy path');
      });
      return;
    }

    // U-14 / DR-98: Move Tab Left / Right — keyboard-accessible tab reorder.
    // Splices active tab one position, then render() + TV.saveSession().
    if (action === 'moveTabLeft' || action === 'moveTabRight') {
      TVPalette.close();
      if (!window.TV || !window.TV.state) return;
      var tabs = window.TV.state.tabs;
      var activeId = window.TV.state.activeId;
      var activeIdx = -1;
      for (var mti = 0; mti < tabs.length; mti++) {
        if (tabs[mti].id === activeId) { activeIdx = mti; break; }
      }
      if (activeIdx === -1) return;
      var targetIdx = action === 'moveTabLeft' ? activeIdx - 1 : activeIdx + 1;
      // Clamp: no-op at boundaries
      if (targetIdx < 0 || targetIdx >= tabs.length) return;
      // Splice with index correction (same logic as _onTabDrop in tv-app.js)
      var movedTab = tabs.splice(activeIdx, 1)[0];
      var mtInsert = (targetIdx > activeIdx) ? targetIdx - 1 : targetIdx;
      tabs.splice(mtInsert, 0, movedTab);
      if (typeof window.TV.render === 'function') window.TV.render();
      if (typeof window.TV.saveSession === 'function') window.TV.saveSession();
      return;
    }

    // U-15 / DR-99: Print / Export PDF
    if (action === 'printDoc') {
      TVPalette.close();
      // window.print() is a no-op in WKWebView — prefer the native print command.
      if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
        window.__TAURI__.core.invoke('print_page').catch(function (err) {
          console.warn('U-15: native print failed; falling back to window.print()', err);
          if (typeof window.print === 'function') window.print();
        });
      } else if (typeof window.print === 'function') {
        window.print();
      }
      return;
    }

    // F7: close BEFORE scrollToHeading/activateTab so the palette is dismissed
    // unconditionally. After the F2 fix, same-tab-edit-mode heading jumps no longer
    // go through render(), so this explicit close is load-bearing in that path.
    TVPalette.close();
    if (action === 'heading' && tabId && heading) {
      window.TV.scrollToHeading(tabId, heading);
    } else if (tabId) {
      window.TV.activateTab(tabId);
    }
  }

  /* ── C-32: Tab trap ───────────────────────────────────────
     WKWebView gotcha: programmatic .focus() on a div[tabindex] is a no-op
     when macOS Full Keyboard Access is off, so we never move focus onto a
     div. The palette's only real focusable is the input, so the trap is a
     preventDefault that keeps focus where it already is; when a future
     revision adds more real controls the cycle below handles them. */
  function _focusables() {
    if (!_overlayEl) return [];
    var box = _overlayEl.querySelector('#tv-pal-box');
    if (!box) return [];
    var sel = 'input:not([disabled]), button:not([disabled]), select, textarea, a[href]';
    return Array.prototype.slice.call(box.querySelectorAll(sel)).filter(function (el) {
      return el.offsetParent !== null || el === document.activeElement;
    });
  }

  function _trapTab(e) {
    var list = _focusables();
    e.preventDefault();
    if (list.length < 2) {
      // Single control: keep focus on it rather than letting Tab escape.
      if (list.length === 1 && list[0] !== document.activeElement) list[0].focus();
      return;
    }
    var idx = list.indexOf(document.activeElement);
    var next = e.shiftKey
      ? (idx <= 0 ? list.length - 1 : idx - 1)
      : (idx === -1 || idx === list.length - 1 ? 0 : idx + 1);
    list[next].focus();
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
    if (e.key === 'Tab') {
      // C-32: modal dialog — focus must not leak to the page behind.
      e.stopPropagation();
      _trapTab(e);
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
  // UI-03: save focus element before opening palette so we can restore it on close
  var _prevFocusEl = null;

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

      // UI-03: capture focus before opening so close() can restore it
      _prevFocusEl = document.activeElement;

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
      _syncOverflowFlag();

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

      // Click on row → activate. Stop propagation: the dispatch path was
      // computed before close() removed the overlay, so without this the
      // click reaches tvEl's [data-tab-id] handler and re-activates the tab
      // (forcing reading mode and defeating the same-tab edit-mode jump).
      _overlayEl.addEventListener('click', function (e) {
        var row = e.target.closest('.tv-pal-row');
        if (row) {
          e.stopPropagation();
          _activateRow(row);
        }
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
      _outlineMode = false; // U-16: reset outline mode on every close
      document.removeEventListener('keydown', _onKeyDown, true);
      if (_overlayEl && _overlayEl.parentNode) {
        _overlayEl.parentNode.removeChild(_overlayEl);
      }
      _overlayEl = null;
      _selIndex = 0;
      // UI-03 / C-32: restore focus to the element that was active before the
      // dialog opened (ARIA APG requirement, not just a nicety).
      if (_prevFocusEl && typeof _prevFocusEl.focus === 'function') {
        try { _prevFocusEl.focus(); } catch (e) { /* ignore stale reference */ }
      }
      _prevFocusEl = null;
    },

    isOpen: function () {
      return _open;
    },

    // U-16 / DR-42: open the palette pre-filtered to the active document's headings only.
    // No file rows, no command rows. App-core binds ⌘⌥O to this entry point.
    openOutline: function () {
      // If already open in outline mode, just re-focus the input
      if (_open && _outlineMode) {
        var inp = document.getElementById('tv-pal-input-field') ||
                  (_overlayEl && _overlayEl.querySelector('.tv-pal-input-field'));
        if (inp) inp.focus();
        return;
      }
      // If open in normal mode, close first then reopen in outline mode
      if (_open) {
        TVPalette.close();
      }

      _outlineMode = true;
      TVPalette.open();

      // After open() builds the overlay with mixed content, immediately
      // replace the list with the headings-only view (DR-42).
      var listEl = _overlayEl && _overlayEl.querySelector('#tv-pal-list');
      if (listEl) {
        listEl.innerHTML = _buildOutlineList('');
        _selIndex = 0;
        _syncOverflowFlag();
      }
      // Update placeholder to reflect headings context
      var inputEl = _overlayEl && _overlayEl.querySelector('.tv-pal-input-field');
      if (inputEl) {
        inputEl.placeholder = 'Jump to heading…';
      }
    },
  };

  window.TVPalette = TVPalette;

  /* ── test seam ────────────────────────────────────────────
     tv-palette.test.js loads this file via `vm` and drives the private
     matcher/builders directly. Attaching them to the module object keeps
     the public API surface unchanged. */
  TVPalette._internals = {
    scoreText: _scoreText,
    highlight: _hl,
    parseHeadings: _parseHeadings,
    headingsFor: _headingsFor,
    buildList: _buildList,
    buildCommandRows: _buildCommandRows,
    rankRows: _rankRows,
    caps: { files: FILE_ROW_CAP, headings: HEADINGS_PER_TAB_CAP,
             filesRender: FILE_RENDER_CAP, headingsRender: HEADING_RENDER_CAP },
    headCache: _headCache,
    pruneHeadCache: _pruneHeadCache,
  };
})();
