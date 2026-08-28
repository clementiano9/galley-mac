/* ───────────────────────────────────────────────────────────
   Galley · seed documents
   E-02: All dummy seed data removed for production.
   Demo content is only loaded when ?demo=1 is present in the URL.
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  // Only expose demo data when explicitly requested via ?demo=1
  var isDemoMode = (
    typeof window !== 'undefined' &&
    window.location &&
    window.location.search.indexOf('demo=1') !== -1
  );

  if (!isDemoMode) {
    // Production: no seed data — boot sequence in tv-app.js handles recents
    window.TV_SEED = [];
    window.TV_LIVE_DOC = null;
    window.TV_STREAM = '';
    return;
  }

  /* ── Demo-only content (gate: ?demo=1) ───────────────────── */

  var WELCOME = '# Welcome to Galley\n\n' +
    'A lightweight markdown viewer for AI power users. The document **is** the\n' +
    'interface — chrome stays out of your way until you call it.\n\n' +
    '## Try it\n\n' +
    '- Press `⌘K` for the command palette — jump to any file or heading\n' +
    '- Press `⌘⇧F` to search across every open tab\n' +
    '- Press `⌘B` to toggle the sidebar\n' +
    '- **Double-click** any paragraph to edit it, then `Esc` or `⌘S` to return\n' +
    '- Drag `.md` files onto the window, or press `⌘O` to open from disk\n\n' +
    '## What it renders\n\n' +
    'Tables, fenced code with highlighting, blockquotes, task lists, images, and\n' +
    'Mermaid-style diagrams — all first-class, no configuration.\n\n' +
    '| Capability      | Status | Shortcut |\n' +
    '|-----------------|--------|----------|\n' +
    '| Command palette | ready  | ⌘K       |\n' +
    '| Cross-tab search| ready  | ⌘⇧F      |\n' +
    '| Inline edit     | ready  | dbl-click|\n' +
    '| Live watch      | ready  | —        |\n\n' +
    '## Architecture\n\n' +
    '```mermaid\n' +
    'graph LR\n' +
    '  A[Disk] --> B[Reader] --> C[Renderer] --> D[Viewer]\n' +
    '```\n\n' +
    '> Files live on disk. Galley is a lens, not a database — zero import,\n' +
    '> zero sync, nothing written you didn\'t ask for.';

  var SCHEMA = '# Database Schema\n\n' +
    '## Overview\n\n' +
    'The system uses a **PostgreSQL** primary with a **Redis** cache layer.\n\n' +
    '| Table     | Rows  | Index       |\n' +
    '|-----------|-------|-------------|\n' +
    '| users     | 1.2M  | email       |\n' +
    '| sessions  | 4.8M  | token       |\n' +
    '| events    | 50M   | created_at  |\n' +
    '| invoices  | 320K  | customer_id |\n\n' +
    '```mermaid\n' +
    'graph LR\n' +
    '  A[Client] --> B[API] --> C[PostgreSQL] --> D[Redis Cache]\n' +
    '```';

  var AI_OUTPUT = '# AI Output: System Design\n\n' +
    '## Introduction\n\n' +
    'The proposed architecture separates concerns into three distinct layers.\n\n' +
    '## Layer 1: Ingestion\n\n' +
    'Events arrive on a Kafka topic and are validated against a shared JSON schema.\n\n' +
    '## Layer 2: Processing\n\n' +
    'Each event is enriched, deduplicated, and folded into the running aggregate.\n\n' +
    '## Layer 3: Storage';

  window.TV_SEED = [
    { name: 'welcome.md', source: WELCOME },
    { name: 'schema.md', source: SCHEMA },
  ];

  window.TV_LIVE_DOC = { name: 'ai-output.md', source: AI_OUTPUT, live: true };

  window.TV_STREAM =
    'Aggregates are written to PostgreSQL in batches and mirrored to Redis for ' +
    'sub-millisecond reads. The write path is append-only, so historical state can ' +
    'always be reconstructed from the event log.';
})();
