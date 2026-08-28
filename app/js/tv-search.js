/* ───────────────────────────────────────────────────────────
   Galley · cross-tab search
   window.TVSearch = { open(), close(), isOpen() }

   Replaces .tv-scroll with a searchbar + results view in the
   active .tv-viewer.  Restored on close().

   C-11: clicking a result marks the actual match text in the destination
         tab and centres it, instead of a proportional scroll guess.
   C-12: a close button, a 2-char minimum before searching, a 20-hit
         per-file cap with "Show N more", and readable (marker-stripped,
         word-trimmed) snippets.
   C-32: role="dialog" aria-modal + Tab trap + focus restore.
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var _open        = false;
  var _savedScroll = null;   // {el, display, scrollTop} to restore on close
  var _containerEl = null;   // the injected search wrapper element
  var _debounceTimer = null;
  var _selIndex    = 0;
  var _prevFocusEl = null;   // UI-03: element focused before search opened
  var _expandedFiles = {};   // C-12: tab.id -> true once "Show N more" is clicked
  var MIN_QUERY_LEN  = 2;    // C-12: below this we don't search at all
  var HITS_PER_FILE_CAP = 20; // C-12

  /* ── HTML escape (do NOT skip this — snippets are user content) ──*/
  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ── C-12: strip inline markdown markers from a snippet ──────
     Mirrors tv-edit.js's _stripInlineMarkers (each module stays
     self-contained per CONTRACT.md — no cross-module import). A raw
     "**is**" in a search snippet reads as noise; strip to plain text. */
  function _stripInlineMarkers(s) {
    return s
      .replace(/!\[.*?\]\(.*?\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\*\*([^*]*)\*\*/g, '$1')
      .replace(/__([^_]*)__/g, '$1')
      .replace(/\*([^*]*)\*/g, '$1')
      .replace(/_([^_]*)_/g, '$1')
      .replace(/~~([^~]*)~~/g, '$1');
  }

  /* ── C-12: trim to maxLen at the nearest word boundary ───────
     A hard character cut lands mid-word ("…htweight"); prefer breaking on
     a nearby space so the snippet reads as prose. Falls back to a hard
     cut when no space is close enough (e.g. a long URL). */
  function _trimPreBoundary(s, maxLen) {
    if (s.length <= maxLen) return s;
    var cut = s.slice(s.length - maxLen);
    var sp = cut.indexOf(' ');
    if (sp > -1 && sp < maxLen * 0.5) cut = cut.slice(sp + 1);
    return '…' + cut;
  }
  function _trimPostBoundary(s, maxLen) {
    if (s.length <= maxLen) return s;
    var cut = s.slice(0, maxLen);
    var sp = cut.lastIndexOf(' ');
    if (sp > maxLen * 0.5) cut = cut.slice(0, sp);
    return cut + '…';
  }

  /* ── C-32: Tab trap ───────────────────────────────────────
     Same approach as tv-palette.js: only real, already-focusable controls
     (input/button) are ever targeted — never a div[tabindex] — because
     programmatic .focus() on one is a no-op in WKWebView when macOS Full
     Keyboard Access is off.
     P2-7: the selector used to include `[tabindex]:not([disabled])`, which
     contradicted the comment above it — it matched .tv-sr-more
     (role="button" tabindex="0"), a div, so .focus() on it silently did
     nothing with Full Keyboard Access off and Tab appeared to stop moving.
     Matches tv-palette.js's selector now. */
  function _focusables() {
    if (!_containerEl) return [];
    var sel = 'input:not([disabled]), button:not([disabled]), select, textarea, a[href]';
    return Array.prototype.slice.call(_containerEl.querySelectorAll(sel)).filter(function (el) {
      return el.offsetParent !== null || el === document.activeElement;
    });
  }

  function _trapTab(e) {
    var list = _focusables();
    e.preventDefault();
    if (list.length < 2) {
      if (list.length === 1 && list[0] !== document.activeElement) list[0].focus();
      return;
    }
    var idx = list.indexOf(document.activeElement);
    var next = e.shiftKey
      ? (idx <= 0 ? list.length - 1 : idx - 1)
      : (idx === -1 || idx === list.length - 1 ? 0 : idx + 1);
    list[next].focus();
  }

  /* ── keyboard handler ────────────────────────────────────*/
  function _onKeyDown(e) {
    if (!_open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      TVSearch.close();
      return;
    }
    if (e.key === 'Tab') {
      // C-32: modal dialog — focus must not leak to the page behind.
      e.stopPropagation();
      _trapTab(e);
      return;
    }
    // C-12: Enter/Space on a focused "Show N more" row activates it (ARIA
    // APG button pattern) instead of falling through to _activateSel below.
    if ((e.key === 'Enter' || e.key === ' ') &&
        document.activeElement && document.activeElement.classList &&
        document.activeElement.classList.contains('tv-sr-more')) {
      e.preventDefault();
      document.activeElement.click();
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

  /* ── search across all open tabs ─────────────────────────*/
  function _runSearch(query) {
    if (!window.TV) return { totalMatches: 0, fileCount: 0, files: [] };

    var tabs = (window.TV.state && window.TV.state.tabs) ? window.TV.state.tabs : [];
    var lq = query.toLowerCase();
    var files = [];
    var totalMatches = 0;

    for (var ti = 0; ti < tabs.length; ti++) {
      var tab = tabs[ti];
      if (tab.untitled) continue; // untitled new-tab pages have no document content
      if (!tab.source) continue;

      var lines = tab.source.split('\n');
      var hits  = [];

      for (var li = 0; li < lines.length; li++) {
        var line  = lines[li];
        var lLine = line.toLowerCase();
        // P1-3: walk EVERY occurrence in the line, not just the first. The
        // renderer can merge several source lines into one text node (a
        // soft-wrapped paragraph), so _markOccurrence's per-node occurrence
        // count only lines up with this file's occurrence count when both
        // sides count every match rather than one-per-unit.
        var idx = lLine.indexOf(lq);
        while (idx !== -1) {
          // Build snippet: pre + <mark>hit</mark> + post
          // C-12: strip markdown markers and trim at word boundaries so the
          // snippet reads as prose instead of raw "**is**"/mid-word cuts.
          var pre  = line.slice(0, idx);
          var hit  = line.slice(idx, idx + query.length);
          var post = line.slice(idx + query.length);

          var maxCtx = 45;
          pre  = _stripInlineMarkers(pre);
          post = _stripInlineMarkers(post);
          pre  = _trimPreBoundary(pre, maxCtx);
          post = _trimPostBoundary(post, maxCtx);

          hits.push({
            ln:   li + 1,
            pre:  pre,
            hit:  hit,
            post: post,
            lineIndex: li,
            tabId: tab.id,
            // C-11: this hit's rank among all occurrences of the query in this
            // file's rendered text, in document order — lets the click handler
            // find the SAME occurrence in the rendered .md content.
            occurrence: hits.length,
          });

          idx = lLine.indexOf(lq, idx + lq.length);
        }
      }

      if (hits.length) {
        files.push({ tab: tab, hits: hits });
        totalMatches += hits.length;
      }
    }

    return { totalMatches: totalMatches, fileCount: files.length, files: files };
  }

  /* ── render results HTML ─────────────────────────────────*/
  function _renderResults(query, result) {
    var I = window.TV_ICONS || {};
    var html = '';

    if (!query) {
      html = '<div class="tv-sr-count tv-sr-count--hint">Type to search across all open tabs…</div>';
      return html;
    }

    // C-12: require at least MIN_QUERY_LEN characters before searching — a
    // single character matches so much of any document that showing every
    // hit is pure cost with no signal.
    if (result.tooShort) {
      html = '<div class="tv-sr-count tv-sr-count--hint">Type at least ' + MIN_QUERY_LEN + ' characters to search</div>';
      return html;
    }

    if (!result.totalMatches) {
      html = '<div class="tv-sr-count tv-sr-count--hint">No results for <strong>' + _esc(query) + '</strong></div>';
      return html;
    }

    html += '<div class="tv-sr-count">' +
      result.totalMatches + ' match' + (result.totalMatches === 1 ? '' : 'es') +
      ' across ' + result.fileCount + ' file' + (result.fileCount === 1 ? '' : 's') +
    '</div>';

    var globalRowIdx = 0;
    for (var fi = 0; fi < result.files.length; fi++) {
      var file = result.files[fi];
      var tab  = file.tab;

      html += '<div class="tv-sr-file">';
      html += '<div class="tv-sr-filehead">' +
        '<span class="ic">' + (I.doc || '') + '</span>' +
        _esc(tab.name) +
        ' <span class="cnt">(' + file.hits.length + ' match' + (file.hits.length === 1 ? '' : 'es') + ')</span>' +
      '</div>';

      // C-12: cap rendered hits per file at HITS_PER_FILE_CAP; a "Show N more"
      // row expands the rest (tracked per tab.id in _expandedFiles).
      var expanded = !!_expandedFiles[tab.id];
      var hitsToRender = (!expanded && file.hits.length > HITS_PER_FILE_CAP)
        ? file.hits.slice(0, HITS_PER_FILE_CAP)
        : file.hits;

      for (var hi = 0; hi < hitsToRender.length; hi++) {
        var h = hitsToRender[hi];
        var isSel = (globalRowIdx === 0);
        html += '<div class="tv-sr-row' + (isSel ? ' sel' : '') + '"' +
          ' data-tab-id="' + _esc(tab.id) + '"' +
          ' data-line="' + h.lineIndex + '"' +
          ' data-heading="' + _esc(h.hit) + '"' +
          ' data-occurrence="' + h.occurrence + '"' +
          ' data-query="' + _esc(query) + '"' +
          '>' +
          '<span class="ln">L' + h.ln + '</span>' +
          '<span class="snip">' +
            _esc(h.pre) + '<mark>' + _esc(h.hit) + '</mark>' + _esc(h.post) +
          '</span>' +
          '</div>';
        globalRowIdx++;
      }

      if (!expanded && file.hits.length > HITS_PER_FILE_CAP) {
        var more = file.hits.length - HITS_PER_FILE_CAP;
        html += '<div class="tv-sr-more" data-expand-file="' + _esc(tab.id) + '" role="button" tabindex="0">' +
          'Show ' + more + ' more' +
        '</div>';
      }

      html += '</div>';
    }

    return html;
  }

  /* ── selection helpers ───────────────────────────────────*/
  function _srRows() {
    if (!_containerEl) return [];
    return Array.prototype.slice.call(_containerEl.querySelectorAll('.tv-sr-row'));
  }

  function _setSel(idx) {
    var rs = _srRows();
    if (!rs.length) return;
    _selIndex = Math.max(0, Math.min(idx, rs.length - 1));
    for (var i = 0; i < rs.length; i++) {
      rs[i].classList.toggle('sel', i === _selIndex);
    }
    rs[_selIndex].scrollIntoView({ block: 'nearest' });
  }

  function _activateSel() {
    var rs = _srRows();
    if (!rs.length) return;
    // F5 invariant: _selIndex is always clamped to [0, rs.length-1] by _setSel;
    // the rs[0] fallback below is untriggerable under normal usage.
    var row = rs[_selIndex] || rs[0];
    if (row) _activateRow(row);
  }

  /* ── C-11: local marking pass over rendered .md text nodes ───
     tv-search.js is self-contained (CONTRACT.md file ownership) so this
     does not reach into tv-app.js's private find-bar state; it is a small,
     scoped walk that only needs to locate ONE known occurrence, not build a
     stepping index like ⌘F does. Recurses over childNodes rather than
     document.createTreeWalker so it is trivially testable with a plain DOM
     stub (see tv-search.runtime.test.js). */
  function _collectTextNodes(root, out) {
    out = out || [];
    var kids = root.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      var node = kids[i];
      if (node.nodeType === 3) {
        out.push(node);
      } else if (node.nodeType === 1) {
        var tag = node.nodeName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'MARK') continue;
        _collectTextNodes(node, out);
      }
    }
    return out;
  }

  // Find the `occurrence`-th (0-based) match of `query` in the rendered
  // text (case-insensitive), wrap it in the SAME mark[data-find].current
  // treatment the ⌘F find bar uses (tv-app.css already styles it — C-14's
  // .current rule), and centre it. Returns true on success, false when not
  // found (the caller falls back to the proportional scroll).
  // P1-3: walks EVERY match inside each node before advancing `seen`,
  // mirroring _runSearch's per-line loop — a soft-wrapped source paragraph
  // renders as ONE text node holding several of the file's occurrences, so
  // counting only the first match per node let the two sides' indices
  // diverge on the most ordinary content there is.
  function _markOccurrence(mdEl, query, occurrence) {
    if (!mdEl || !query || occurrence < 0) return false;
    var lq = query.toLowerCase();
    var nodes = _collectTextNodes(mdEl);
    var seen = 0;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var text  = node.textContent || '';
      var lText = text.toLowerCase();
      var pos = lText.indexOf(lq);
      while (pos !== -1) {
        if (seen === occurrence) {
          var before = text.slice(0, pos);
          var hit    = text.slice(pos, pos + query.length);
          var after  = text.slice(pos + query.length);
          var parent = node.parentNode;
          if (!parent) return false;
          var frag = document.createDocumentFragment();
          if (before) frag.appendChild(document.createTextNode(before));
          var mk = document.createElement('mark');
          mk.setAttribute('data-find', '');
          mk.className = 'current';
          mk.textContent = hit;
          frag.appendChild(mk);
          if (after) frag.appendChild(document.createTextNode(after));
          parent.replaceChild(frag, node);
          if (mk.scrollIntoView) mk.scrollIntoView({ block: 'center' });
          return true;
        }
        seen++;
        pos = lText.indexOf(lq, pos + lq.length);
      }
    }
    return false;
  }

  function _activateRow(row) {
    if (!window.TV) return;
    var tabId     = row.getAttribute('data-tab-id');
    var lineIndex = parseInt(row.getAttribute('data-line'), 10);
    var heading   = row.getAttribute('data-heading');

    TVSearch.close();

    if (!tabId) return;

    // activate the tab first, then try to scroll to the hit
    window.TV.activateTab(tabId);

    // After activateTab re-renders, attempt to scroll to the matched line.
    // We do this in a rAF so the DOM has settled.
    requestAnimationFrame(function () {
      var tab = null;
      var tabs = window.TV.state ? window.TV.state.tabs : [];
      for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].id === tabId) { tab = tabs[i]; break; }
      }
      if (!tab) return;

      // Try heading scroll first (works well for heading-match lines)
      var isHeading = /^#{1,3}\s/.test(
        tab.source ? tab.source.split('\n')[lineIndex] || '' : ''
      );
      if (isHeading && heading) {
        // strip leading #s and spaces to get the heading text
        var hText = (tab.source.split('\n')[lineIndex] || '').replace(/^#{1,6}\s+/, '').trim();
        window.TV.scrollToHeading(tabId, hText);
        return;
      }

      // C-11: mark and centre the actual occurrence in the rendered content.
      var occurrence = parseInt(row.getAttribute('data-occurrence'), 10);
      var query = row.getAttribute('data-query') || '';
      var mdEl = window.TV.el() && window.TV.el().querySelector('.md');
      if (query && !isNaN(occurrence) && mdEl && _markOccurrence(mdEl, query, occurrence)) {
        return;
      }

      // Proportional scroll fallback — only when the mark could not be
      // found (e.g. the hit fell inside markup the renderer transformed).
      var scrollEl = window.TV.el() && window.TV.el().querySelector('.tv-scroll');
      if (!scrollEl) return;
      var lineCount = tab.source ? tab.source.split('\n').length : 1;
      var ratio = lineIndex / Math.max(lineCount - 1, 1);
      var newTop = Math.round(ratio * (scrollEl.scrollHeight - scrollEl.clientHeight));
      scrollEl.scrollTop = newTop;
      // S-07: persist scroll position so tab-switch restores correct position
      tab.scrollTop = newTop;
    });
  }

  /* ── live update the results pane ────────────────────────*/
  function _refreshResults(query) {
    if (!_containerEl) return;
    var resultsEl = _containerEl.querySelector('.tv-search-results');
    if (!resultsEl) return;
    var result;
    if (!query) {
      result = { totalMatches: 0, fileCount: 0, files: [] };
    } else if (query.length < MIN_QUERY_LEN) {
      // C-12: below the minimum, we have not searched — say so, not "No results".
      result = { totalMatches: 0, fileCount: 0, files: [], tooShort: true };
    } else {
      result = _runSearch(query);
    }
    resultsEl.innerHTML = _renderResults(query, result);
    _selIndex = 0;
  }

  /* ── public API ───────────────────────────────────────────*/
  var TVSearch = {
    open: function () {
      if (_open) {
        // re-focus input
        if (_containerEl) {
          var inp = _containerEl.querySelector('.tv-search-field');
          if (inp) inp.focus();
        }
        return;
      }

      if (!window.TV) return;
      var root = window.TV.el();
      if (!root) return;

      var viewer = root.querySelector('.tv-viewer');
      if (!viewer) return;

      // UI-03: capture focus before opening so close() can restore it
      _prevFocusEl = document.activeElement;

      // Hide the existing scroll area (preserve it for restoration)
      var scrollEl = viewer.querySelector('.tv-scroll');
      if (scrollEl) {
        _savedScroll = {
          el:          scrollEl,
          displayPrev: scrollEl.style.display,
        };
        scrollEl.style.display = 'none';
      } else {
        _savedScroll = null;
      }

      // Build the search container
      var I = window.TV_ICONS || {};

      _containerEl = document.createElement('div');
      _containerEl.className = 'tv-search-container';
      // C-32: same dialog semantics as the palette — announced boundary,
      // focus restored to _prevFocusEl on close (below).
      _containerEl.setAttribute('role', 'dialog');
      _containerEl.setAttribute('aria-modal', 'true');
      _containerEl.setAttribute('aria-label', 'Search all tabs');

      // C-12: a fresh search session starts collapsed.
      _expandedFiles = {};

      var barHtml =
        '<div class="tv-searchbar">' +
          '<div class="field">' +
            '<span class="ic">' + (I.search || '') + '</span>' +
            '<input class="tv-search-field" type="text" autocomplete="off" spellcheck="false"' +
              ' placeholder="Search…" aria-label="Search across all open tabs">' +
          '</div>' +
          '<span class="scope">All open tabs · ⌘⇧F</span>' +
          // C-12: an explicit exit — mirrors the find bar's .tv-find-close.
          '<button class="tv-search-close" data-search-close type="button" aria-label="Close search">&#10005;</button>' +
        '</div>';

      var resultsHtml =
        '<div class="tv-scroll tv-search-scroll">' +
          '<div class="tv-search-results">' +
            '<div class="tv-sr-count tv-sr-count--hint">Type to search across all open tabs…</div>' +
          '</div>' +
        '</div>';

      _containerEl.innerHTML = barHtml + resultsHtml;
      viewer.appendChild(_containerEl);

      _open = true;
      _selIndex = 0;

      // Focus the input
      var inputEl = _containerEl.querySelector('.tv-search-field');
      if (inputEl) {
        inputEl.focus();

        inputEl.addEventListener('input', function () {
          clearTimeout(_debounceTimer);
          var q = inputEl.value;
          // C-12: a new query starts each file collapsed again.
          _expandedFiles = {};
          _debounceTimer = setTimeout(function () {
            _refreshResults(q);
          }, 80);
        });
      }

      // C-12: close button
      var closeBtn = _containerEl.querySelector('[data-search-close]');
      if (closeBtn) {
        closeBtn.addEventListener('click', function () { TVSearch.close(); });
      }

      // Click on result row → activate; click on "Show N more" → expand in place
      _containerEl.addEventListener('click', function (e) {
        var more = e.target.closest('.tv-sr-more');
        if (more) {
          var fileId = more.getAttribute('data-expand-file');
          if (fileId) {
            _expandedFiles[fileId] = true;
            var inp = _containerEl.querySelector('.tv-search-field');
            _refreshResults(inp ? inp.value : '');
          }
          return;
        }
        var row = e.target.closest('.tv-sr-row');
        if (row) _activateRow(row);
      });

      // Hover → update selection
      _containerEl.addEventListener('mousemove', function (e) {
        var row = e.target.closest('.tv-sr-row');
        if (!row) return;
        var rs = _srRows();
        var idx = rs.indexOf(row);
        if (idx !== -1) _setSel(idx);
      });

      document.addEventListener('keydown', _onKeyDown, true);
    },

    close: function () {
      if (!_open) return;
      _open = false;

      clearTimeout(_debounceTimer);
      document.removeEventListener('keydown', _onKeyDown, true);

      // Restore the hidden scroll area
      if (_savedScroll && _savedScroll.el) {
        _savedScroll.el.style.display = _savedScroll.displayPrev || '';
      }
      _savedScroll = null;

      // Remove the search container
      if (_containerEl && _containerEl.parentNode) {
        _containerEl.parentNode.removeChild(_containerEl);
      }
      _containerEl = null;
      _selIndex = 0;

      // UI-03: restore focus to the element that was active before search opened
      if (_prevFocusEl && typeof _prevFocusEl.focus === 'function') {
        try { _prevFocusEl.focus(); } catch (e) { /* ignore stale reference */ }
      }
      _prevFocusEl = null;
    },

    isOpen: function () {
      return _open;
    },
  };

  window.TVSearch = TVSearch;
})();
