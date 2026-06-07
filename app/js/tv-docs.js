/* ───────────────────────────────────────────────────────────
   tiny-viewer · seed documents
   window.TV_SEED — array of { name, source, live? } opened on first
   launch so the app boots with real, renderable content. Users can
   close these and open their own .md files from disk (DR-06).
   window.TV_STREAM — text appended live on a watched file (URD-10).
   ─────────────────────────────────────────────────────────── */
(function () {
  const WELCOME = `# Welcome to tiny-viewer

A lightweight markdown viewer for AI power users. The document **is** the
interface — chrome stays out of your way until you call it.

## Try it

- Press \`⌘K\` for the command palette — jump to any file or heading
- Press \`⌘⇧F\` to search across every open tab
- Press \`⌘B\` to toggle the sidebar
- **Double-click** any paragraph to edit it, then \`Esc\` or \`⌘S\` to return
- Drag \`.md\` files onto the window, or press \`⌘O\` to open from disk

## What it renders

Tables, fenced code with highlighting, blockquotes, task lists, images, and
Mermaid-style diagrams — all first-class, no configuration.

| Capability      | Status | Shortcut |
|-----------------|--------|----------|
| Command palette | ready  | ⌘K       |
| Cross-tab search| ready  | ⌘⇧F      |
| Inline edit     | ready  | dbl-click|
| Live watch      | ready  | —        |

## Architecture

\`\`\`mermaid
graph LR
  A[Disk] --> B[Reader] --> C[Renderer] --> D[Viewer]
\`\`\`

> Files live on disk. tiny-viewer is a lens, not a database — zero import,
> zero sync, nothing written you didn't ask for.`;

  const SCHEMA = `# Database Schema

## Overview

The system uses a **PostgreSQL** primary with a **Redis** cache layer in front of all
reads. Writes go through the primary and invalidate the affected cache keys on commit,
so the read path stays consistent without a separate sync job.

| Table     | Rows  | Index       |
|-----------|-------|-------------|
| users     | 1.2M  | email       |
| sessions  | 4.8M  | token       |
| events    | 50M   | created_at  |
| invoices  | 320K  | customer_id |

## Architecture Diagram

\`\`\`mermaid
graph LR
  A[Client] --> B[API] --> C[PostgreSQL] --> D[Redis Cache]
\`\`\`

## Indexing Strategy

Compound indexes back every hot query path. The \`events\` table is partitioned by month,
and stale partitions roll off to cold storage nightly. Read more in [the runbook](#).`;

  const API = `# Payments API

## POST /v1/charges

Creates a charge against a saved payment method and returns the resulting object.

\`\`\`json
{
  "amount": 4200,
  "currency": "usd",
  "source": "card_1NXq2eLk"
}
\`\`\`

> All amounts are expressed in the smallest currency unit (cents for USD).

Returns a \`charge\` object with an \`id\` and a \`status\` of \`succeeded\` or \`pending\`.

## POST /v1/refunds

Refunds a charge in full or in part. Idempotent on the \`charge_id\`.

- Full refund — omit \`amount\`
- Partial refund — pass \`amount\` in the smallest currency unit
- Refunds settle in 5–10 business days`;

  const ARCH = `# System Architecture

## Overview

Three independent services behind a single gateway. Each owns its data and communicates
over an internal event bus — no service reaches into another's database.

- **Gateway** — auth, routing, rate limiting
- **Core** — business logic and persistence
- **Workers** — async jobs and notifications

The gateway is stateless and scales horizontally; everything else scales per queue depth.

## Latency budget

The p99 latency target is 200ms for all read endpoints. Network latency should be measured
at the edge, not the origin. Reduce latency by caching the three hottest queries.`;

  const FLOW = `# Onboarding Flow

## Steps

- [x] Account created
- [x] Email verified
- [ ] Workspace named
- [ ] First file opened

## Notes

Keep the first run to **four steps or fewer**. Each extra step measurably lowers
activation, so anything optional moves to settings. End-to-end latency from click to
first paint matters more than absolute numbers.`;

  // A file that "grows" under live watch — seeded short, the tail streams in.
  const AI_OUTPUT = `# AI Output: System Design

## Introduction

The proposed architecture separates concerns into three distinct layers so that each can
scale, fail, and deploy independently of the others.

## Layer 1: Ingestion

Events arrive on a Kafka topic and are validated against a shared JSON schema before
anything downstream sees them. Malformed events route to a dead-letter queue.

## Layer 2: Processing

Each event is enriched, deduplicated, and folded into the running aggregate. Processing
is idempotent, so replays are safe.

## Layer 3: Storage`;

  window.TV_SEED = [
    { name: "welcome.md", source: WELCOME },
    { name: "schema.md", source: SCHEMA },
    { name: "api.md", source: API, live: true },
    { name: "arch.md", source: ARCH },
    { name: "flow.md", source: FLOW },
  ];

  window.TV_LIVE_DOC = { name: "ai-output.md", source: AI_OUTPUT, live: true };

  // streaming continuation appended one word at a time on a watched file
  window.TV_STREAM =
    "Aggregates are written to PostgreSQL in batches and mirrored to Redis for " +
    "sub-millisecond reads. The write path is append-only, so historical state can " +
    "always be reconstructed from the event log. Each layer exposes health and lag " +
    "metrics so operators can see backpressure before it becomes failure.";
})();
