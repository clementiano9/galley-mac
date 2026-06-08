/* ───────────────────────────────────────────────────────────
   tiny-viewer · cross-tab search
   window.TVSearch = { open(), close(), isOpen() }

   Replaces .tv-scroll with a searchbar + results view in the
   active .tv-viewer.  Restored on close().
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var _open       = false;
  var _savedScroll = null;   // {el, display, scrollTop} to restore on close
  var _containerEl = null;   // the injected search wrapper element
  var _debounceTimer = null;
  var _selIndex   = 0;

  /* ── HTML escape (do NOT skip this — snippets are user content) ──*/
  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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
      if (!tab.source) continue;

      var lines = tab.source.split('\n');
      var hits  = [];

      for (var li = 0; li < lines.length; li++) {
        var line = lines[li];
        var idx  = line.toLowerCase().indexOf(lq);
        if (idx === -1) continue;

        // Build snippet: pre + <mark>hit</mark> + post
        // Trim pre/post to keep snippet readable (max ~40 chars each side)
        var pre  = line.slice(0, idx);
        var hit  = line.slice(idx, idx + query.length);
        var post = line.slice(idx + query.length);

        var maxCtx = 45;
        if (pre.length > maxCtx)  pre  = '…' + pre.slice(pre.length - maxCtx);
        if (post.length > maxCtx) post = post.slice(0, maxCtx) + '…';

        hits.push({
          ln:   li + 1,
          pre:  pre,
          hit:  hit,
          post: post,
          lineIndex: li,
          tabId: tab.id,
        });
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
      html = '<div class="tv-sr-count" style="padding-top:8px">Type to search across all open tabs…</div>';
      return html;
    }

    if (!result.totalMatches) {
      html = '<div class="tv-sr-count" style="padding-top:8px">No results for <strong>' + _esc(query) + '</strong></div>';
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

      for (var hi = 0; hi < file.hits.length; hi++) {
        var h = file.hits[hi];
        var isSel = (globalRowIdx === 0);
        html += '<div class="tv-sr-row' + (isSel ? ' sel' : '') + '"' +
          ' data-tab-id="' + _esc(tab.id) + '"' +
          ' data-line="' + h.lineIndex + '"' +
          ' data-heading="' + _esc(h.hit) + '"' +
          '>' +
          '<span class="ln">L' + h.ln + '</span>' +
          '<span class="snip">' +
            _esc(h.pre) + '<mark>' + _esc(h.hit) + '</mark>' + _esc(h.post) +
          '</span>' +
          '</div>';
        globalRowIdx++;
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
    var row = rs[_selIndex] || rs[0];
    if (row) _activateRow(row);
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

      // Proportional scroll fallback
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
    var result = query ? _runSearch(query) : { totalMatches: 0, fileCount: 0, files: [] };
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
      _containerEl.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;';

      var barHtml =
        '<div class="tv-searchbar">' +
          '<div class="field">' +
            '<span class="ic">' + (I.search || '') + '</span>' +
            '<input class="tv-search-field" type="text" autocomplete="off" spellcheck="false"' +
              ' placeholder="Search…" style="flex:1;border:none;outline:none;background:transparent;' +
              'font-size:14px;color:inherit;">' +
          '</div>' +
          '<span class="scope">All open tabs · ⌘⇧F</span>' +
        '</div>';

      var resultsHtml =
        '<div class="tv-scroll" style="flex:1;overflow-y:auto;">' +
          '<div class="tv-search-results">' +
            '<div class="tv-sr-count" style="padding-top:8px">Type to search across all open tabs…</div>' +
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
          _debounceTimer = setTimeout(function () {
            _refreshResults(q);
          }, 80);
        });
      }

      // Click on result row → activate
      _containerEl.addEventListener('click', function (e) {
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
    },

    isOpen: function () {
      return _open;
    },
  };

  window.TVSearch = TVSearch;
})();
