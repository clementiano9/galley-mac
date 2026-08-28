/* ───────────────────────────────────────────────────────────
   tiny-viewer · sample documents + per-screen configuration
   window.TV_DOCS  — markdown keyed by filename
   window.TV_TREE  — sidebar model
   ─────────────────────────────────────────────────────────── */
(function () {
  const DOCS = {
    "schema.md": `# Database Schema

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
and stale partitions roll off to cold storage nightly. Read more in [the runbook](#).`,

    "api.md": `# Payments API

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

Returns a \`charge\` object with an \`id\` and a \`status\` of \`succeeded\` or \`pending\`.`,

    "arch.md": `# System Architecture

## Overview

Three independent services behind a single gateway. Each owns its data and communicates
over an internal event bus — no service reaches into another's database.

- **Gateway** — auth, routing, rate limiting
- **Core** — business logic and persistence
- **Workers** — async jobs and notifications

The gateway is stateless and scales horizontally; everything else scales per queue depth.`,

    "flow.md": `# Onboarding Flow

## Steps

- [x] Account created
- [x] Email verified
- [ ] Workspace named
- [ ] First file opened

## Notes

Keep the first run to **four steps or fewer**. Each extra step measurably lowers
activation, so anything optional moves to settings.`,

    "ai-output.md": `# AI Output: System Design

## Introduction

The proposed architecture separates concerns into three distinct layers so that each can
scale, fail, and deploy independently of the others.

## Layer 1: Ingestion

Events arrive on a Kafka topic and are validated against a shared JSON schema before
anything downstream sees them. Malformed events route to a dead-letter queue.

## Layer 2: Processing

Each event is enriched, deduplicated, and folded into the running aggregate. Processing
is idempotent, so replays are safe.

## Layer 3: Storage`,
  };

  // streaming continuation appended live on the watch screen
  const STREAM = "Aggregates are written to PostgreSQL in batches and mirrored to Redis for sub-millisecond reads. The write path is append-only, so historical state can always be reconstructed from the event log.";

  const TREE = {
    folder: "/ai-projects",
    files: ["arch.md", "api.md", "schema.md", "flow.md"],
    recent: ["arch-v2.md", "spec-draft.md"],
  };

  // cross-tab search fixture (Cmd+Shift+F → "latency")
  const SEARCH = {
    query: "latency",
    count: 12, fileCount: 3,
    files: [
      { name: "arch.md", hits: [
        { ln: 47, pre: "network ", hit: "latency", post: " should be measured at the edge, not the origin" },
        { ln: 89, pre: "the p99 ", hit: "latency", post: " target is 200ms for all read endpoints" },
        { ln: 102, pre: "a ", hit: "latency", post: " budget breakdown per service hop" },
        { ln: 134, pre: "reduce ", hit: "latency", post: " by caching the three hottest queries" },
      ] },
      { name: "schema.md", hits: [
        { ln: 23, pre: "index ", hit: "latency", post: " on the users table dropped after the rebuild", sel: false },
        { ln: 45, pre: "query ", hit: "latency", post: " increased after the 50M-row migration", sel: true },
        { ln: 61, pre: "tail ", hit: "latency", post: " is dominated by the events partition scan" },
      ] },
      { name: "flow.md", hits: [
        { ln: 12, pre: "end-to-end ", hit: "latency", post: " from click to first paint" },
        { ln: 28, pre: "perceived ", hit: "latency", post: " matters more than absolute" },
      ] },
    ],
  };

  // command palette fixture (Cmd+K → "arch")
  const PALETTE = {
    query: "arch",
    groups: [
      { label: "Jump to Heading", rows: [
        { ic: "hash", main: "Architecture Diagram", sub: "schema.md", hl: "Arch" },
        { ic: "hash", main: "System Architecture", sub: "arch.md", hl: "Arch" },
      ] },
      { label: "Open File", rows: [
        { ic: "doc", main: "arch.md", sub: "/ai-projects", hl: "arch" },
        { ic: "doc", main: "arch-v2.md", sub: "/ai-projects", hl: "arch" },
      ] },
      { label: "Recent", rows: [
        { ic: "clock", main: "api.md", sub: "2m ago" },
        { ic: "clock", main: "flow.md", sub: "11m ago" },
      ] },
    ],
  };

  window.TV_DOCS = DOCS;
  window.TV_STREAM = STREAM;
  window.TV_TREE = TREE;
  window.TV_SEARCH = SEARCH;
  window.TV_PALETTE = PALETTE;
})();
