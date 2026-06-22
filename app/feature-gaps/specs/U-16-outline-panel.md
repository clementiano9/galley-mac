# U-16 — Persistent Outline / Table-of-Contents Panel

**STATUS: GATED — CONTINGENCY ONLY. DO NOT BUILD.**
**DR numbers: DR-121 through DR-128 (all gated/contingent).**

---

> ## ⛔ GATE BANNER
>
> **THIS SPEC MUST NOT ENTER IMPLEMENTATION UNTIL THE GATE METRIC CONFIRMS IT.**
>
> Trip condition (exact): **≥ 30% of all measured sessions open at least one file whose
> heading count ≥ 30, as recorded in the local `tv-outline-gate` localStorage counter
> over a rolling 90-day post-launch window.**
>
> If the gate has NOT tripped, the correct response to any request to build this feature
> is: "Gate unconfirmed — measure first." The ⌘⌥O palette pre-filter (DR-42–DR-46,
> already shipped) is the production path and satisfies the common case.
>
> The gate exists because: (a) a persistent outline panel permanently consumes sidebar
> space already claimed by F-19 (folder tree) and F-02 (Recent section); (b) research
> confirms (WAN-044) that Obsidian's persistent outline panel creates fragmented
> navigation — users switch between the outline and the document repeatedly rather than
> reading linearly; (c) the target file corpus is 200–500-line AI output (URD-06), not
> book manuscripts — a 30+-heading document is the edge, not the center.

---

## Gate Instrumentation

### Metric definition

**"% of sessions with 30+-heading files"** = the number of sessions in which the user
opened at least one file whose parsed heading count (H1–H6, using `_parseHeadings`
from `tv-palette.js`) was ≥ 30, divided by the total number of measured sessions,
expressed as a percentage.

A **session** is defined as a single app launch from `init()` to `beforeunload`. Each
session is counted exactly once regardless of how many 30+-heading files are opened in
it.

### Implementation (local-only, no network telemetry)

Consistent with URD-07 (file trust, no phone-home): all instrumentation is local
`localStorage` only. No data leaves the device.

**Storage key:** `tv-outline-gate`

**Shape (JSON):**
```json
{
  "sessions": 142,
  "sessionsWithDeepFiles": 47,
  "firstRecordedAt": 1750000000000,
  "lastUpdatedAt":   1751234567890
}
```

- `sessions` — total measured sessions (incremented once per launch in `init()`, after
  session restore completes).
- `sessionsWithDeepFiles` — sessions in which `maxHeadingCount >= 30` was observed at
  any point (incremented at most once per session, set by a flag `_gateTriggeredThisSession`).
- `firstRecordedAt` / `lastUpdatedAt` — epoch ms; used to bound the 90-day review window.

**Where to instrument:**

1. **`init()` — session open** (after `_drainExternalOpenQueue()`):
   Read `tv-outline-gate`, increment `sessions`, write back. Set module-level flag
   `var _gateTriggeredThisSession = false`.

2. **`openDoc()` / tab render completion** — after any tab's source is available:
   Call `_parseHeadings(tab.source).length`; if `>= 30` and
   `!_gateTriggeredThisSession`, set the flag, increment `sessionsWithDeepFiles`,
   write back `tv-outline-gate`.

3. **No tick/poll needed** — instrumentation fires only on file open events; zero idle
   CPU cost (URD-02 compliance).

**Gate check function** (for developer review, never shown to end-users):
```js
function outlineGateStatus() {
  try {
    var g = JSON.parse(localStorage.getItem('tv-outline-gate') || '{}');
    var sessions = g.sessions || 0;
    var deep = g.sessionsWithDeepFiles || 0;
    var pct = sessions > 0 ? ((deep / sessions) * 100).toFixed(1) : 'N/A';
    var daysSince = g.firstRecordedAt
      ? Math.floor((Date.now() - g.firstRecordedAt) / 86400000)
      : 0;
    return { sessions, deep, pct, daysSince, tripped: parseFloat(pct) >= 30 };
  } catch (e) { return null; }
}
```

**Review cadence:** Evaluate at 30 days post-launch (minimum viable sample, N ≥ 50
sessions), then again at 90 days. If at either checkpoint `pct >= 30`, the gate trips.
If at 90 days `pct < 30`, close the gate permanently and archive this spec.

**Privacy note:** `tv-outline-gate` stores only aggregate counts (no file paths, no
content, no user identifiers). It is read-only to the developer via DevTools console;
it never surfaces in any UI.

---

## URD Tie-Back + WAN Grounding

| Signal | ID | Relevance |
|--------|----|-----------|
| Multi-file navigation fragmentation | URD-04 | The core nav pain this IF addresses |
| View-first simplicity | URD-05 | Panel must not impose chrome unconditionally |
| Minimal UI chrome | URD-08 | Panel is only warranted when the content earns it |
| Fragmented Obsidian nav complaint | WAN-044 | Direct anti-pattern: persistent outline creates split attention |
| Multi-file nav overhead | WAN-043, WAN-049 | Cross-section jumping friction in long docs |
| Sidebar space sovereignty | F-19/DR-41 | Folder tree already owns the sidebar; panel cannot displace it |
| WAAD Cluster D2 | Multi-file nav fragmentation | Outline panel addresses D2's long-doc edge case only |

**URD-04** is the primary anchor: "switching between markdown files in every existing
tool loses scroll position… the basic contract of 'return to where I left off' is
unmet." A 30+-heading document stretches this contract within a single file — the user
must scroll to navigate sections, losing their place. The ⌘⌥O palette (DR-42–46) solves
the common case; a persistent panel would only add value if the common case itself
involves very high heading density.

---

## Problem Statement (IF gate trips)

Developer / Technical Writer needs a way to see the full section structure of a long
architecture or API document at a glance and jump between sections without dismissing a
panel after each jump, because ⌘⌥O — while sufficient for 20-heading files — requires
re-invoking the shortcut after every navigation step in a 30+-heading document,
interrupting the reading rhythm that URD-04's flow model ("picks up exactly at line 47")
depends on.

**HMW (contingent):** How might we let a user scan a document's full heading structure
as a persistent ambient reference, without permanently displacing the folder tree and
Recent sections that the sidebar is already committed to hosting?

---

## Contingency Decision: Sidebar-Space Conflict Resolution

The central design problem is that the sidebar already has three committed sections:
folder tree (F-19, top), Recent (F-02, middle), and search (pinned bottom). A
traditional persistent outline panel added as a fourth section would either (a) collapse
one of the existing three, violating their committed specs, or (b) extend the sidebar
height unboundedly. Neither is acceptable.

**Chosen resolution: a temporary overlay drawer, toggled per-file, that slides over
(not into) the sidebar — and auto-closes when the user navigates away from the file.**

The panel is:
- A `position: fixed` or `position: absolute` drawer that overlays the sidebar from the
  left edge (same x-position as the sidebar), z-indexed above the sidebar content.
- Width: same as the sidebar (`var(--tv-sidebar-w, 224px)`), or up to 280px if the
  heading list is dense.
- Triggered by a dedicated shortcut (⌘⌥T — "Table of contents"; ⌘⌥O remains the
  palette path and is unchanged) or a contextual icon that appears in the tab title area
  only when the active file has ≥ 30 headings (the gate condition makes this
  appropriately rare).
- Dismissed by: clicking outside the drawer, pressing Esc, switching tabs, or toggling
  the shortcut again.
- Auto-closes on tab switch: because the heading list is file-specific, switching to a
  different tab closes the drawer (the user did not ask for it on the new file).
- Does NOT resize the sidebar or push content: it is an overlay, not a layout column.
  The reading surface, sidebar width, and folder tree are entirely unaffected.

This resolves the sidebar-space conflict without permanently stealing real estate, and
honors URD-08 "earned, not imposed" — the drawer only appears on explicit invocation,
only on files that actually have ≥ 30 headings, and disappears automatically when no
longer in context.

---

## DR Table (Gated / Contingent)

All requirements below are **GATED**. None may be implemented until the gate metric
confirms ≥ 30% of sessions contain 30+-heading files.

| DR | Requirement | URD | MoSCoW |
|----|-------------|-----|--------|
| **DR-121** [GATED] | A `⌘⌥T` shortcut opens a temporary outline drawer for the active file if and only if that file has ≥ 1 heading. If the file has no headings the shortcut is a no-op (same behavior as DR-45 "No headings in this document"). | URD-04, URD-08 | Must |
| **DR-122** [GATED] | The drawer overlays the sidebar as a `position: fixed` panel anchored to the left edge, width = `var(--tv-sidebar-w, 224px)` minimum and capped at 280px. It does NOT reflow the `.tv-body` layout, does not resize the sidebar, and does not affect the reading surface. | URD-08 | Must |
| **DR-123** [GATED] | The drawer renders the full H1–H6 heading list for the active file, using `_parseHeadings()` from `tv-palette.js` (no duplicate implementation). Visual indent: 4px per heading level (H1 = 0px, H2 = 4px, … H6 = 20px). Each heading row is clickable and keyboard-reachable. | URD-04 | Must |
| **DR-124** [GATED] | Clicking a heading row scrolls the active document to that heading (same mechanism as DR-44: `scrollToHeading`), keeps the drawer open, and moves keyboard focus back to the drawer — so the user can navigate multiple sections without re-invoking the shortcut. | URD-04 | Must |
| **DR-125** [GATED] | The drawer closes on: (a) `Esc`, (b) click outside the drawer, (c) `⌘⌥T` pressed again (toggle), (d) the active tab changing to a different file. The drawer does NOT close when the user clicks a heading row (DR-124). | URD-08 | Must |
| **DR-126** [GATED] | The drawer includes a live filter input (same interaction pattern as the ⌘⌥O palette) so users can narrow headings by text when the list is long. The input is auto-focused when the drawer opens. | URD-04 | Should |
| **DR-127** [GATED] | The drawer shows a count badge ("42 headings") in the drawer header so users can orient themselves before scrolling. | URD-04 | Could |
| **DR-128** [GATED] | The ⌘⌥O palette shortcut (DR-42–DR-46) remains unchanged and functional. ⌘⌥T is additive, not a replacement. The `?` shortcut overlay (DR-23) lists ⌘⌥T as "Outline panel (long docs)" only after the gate trips and this spec is built. | URD-04, URD-08 | Must |

---

## Acceptance Criteria (Contingent)

The following acceptance criteria apply only after the gate trips and the spec is approved for build.

- **No heading file:** `⌘⌥T` with zero-heading active file → no-op, no drawer appears.
- **Heading file:** `⌘⌥T` with a 32-heading file → drawer slides in over sidebar, auto-focused filter input, all 32 headings visible with H1–H6 indent.
- **Navigation:** click heading row 15 → document scrolls to heading 15, drawer stays open, focus returns to drawer; pressing Enter on a keyboard-highlighted row produces identical scroll behavior.
- **Close on Esc:** `Esc` closes drawer, focus returns to reading surface.
- **Close on tab switch:** drawer open on Tab A → click Tab B → drawer closes; `⌘⌥T` on Tab B opens a fresh drawer for Tab B's headings.
- **Toggle:** `⌘⌥T` while drawer is open → closes it. `⌘⌥T` again → re-opens.
- **Layout integrity:** sidebar width, folder tree, Recent section, and reading surface are pixel-identical whether drawer is open or closed (overlay, not reflow).
- **Live filter:** typing "API" in the filter input narrows the heading list to rows matching "API" (case-insensitive substring); clearing the input restores all headings.
- **⌘⌥O unchanged:** `⌘⌥O` still opens the palette pre-filtered to headings only (DR-42–DR-46 unaffected).
- **Reduced-motion:** drawer appears/disappears instantly (no slide animation) under `prefers-reduced-motion: reduce`.

---

## Out of Scope (Contingent)

Even if the gate trips, the following are explicitly excluded from this spec:
- Persistent sidebar outline column (permanent reflow of layout).
- Cross-file outline (drawer is always scoped to the active file only).
- Heading-level filter controls (H1 only, H2 only, etc.) — the live text filter covers the use case.
- Heading folding / section collapse in the reading view.
- Tab-bar heading-count badge.
- Synced scroll indicator (highlighting the heading that corresponds to the current viewport position) — a future evaluation item, not part of this gate.
- Any persistent UI chrome added unconditionally regardless of file heading count.

---

## Implementation Notes (Contingent)

**Reuse `_parseHeadings`:** expose the existing function from `tv-palette.js` on the
`TVPalette` public API (e.g. `TVPalette.parseHeadings(source)`) so `tv-app.js` can
call it without duplication. Do not copy-paste the implementation.

**Drawer DOM:** inject a `<div class="tv-outline-drawer">` as a direct child of
`.tv-sidebar` with `position: absolute; top: 0; left: 0; width: 100%; height: 100%;
z-index: 10; overflow-y: auto` — this keeps the overlay within the sidebar's stacking
context without affecting `.tv-body` layout.

**Close on tab switch:** wire into the `TV.on('tabchange', ...)` event already emitted
by `tv-app.js`. If drawer is open when `tabchange` fires, close it.

**⌘⌥T binding:** add `if (e.metaKey && e.altKey && k === 't')` to the keyboard router
in `tv-app.js`. Confirm ⌘⌥T is not a macOS system binding before shipping (verify
against current shortcut map in `waad-grounded-requirements.md`).

**Gate instrumentation location:** `init()` for session counting and the tab-render
completion path for per-session max heading count — both locations already exist and
are the minimal-cost insertion points. See Gate Instrumentation section above for the
exact counter shape.

---

## Relationship to Existing DRs

| Existing DR | Relationship |
|-------------|--------------|
| DR-42–DR-46 | The ⌘⌥O palette-outline path these define is the **production path**. This spec is additive only. |
| DR-33–DR-41 (F-19) | Sidebar folder tree owns the sidebar layout. This spec's overlay drawer must not displace it. |
| DR-08 (URD-08) | "Earned, not imposed" — the drawer is gated behind both a usage metric AND an explicit per-session user invocation. |
| DR-31 (no settings panel) | The outline drawer is not a settings surface; it does not conflict. |
| DR-23 (? overlay) | ⌘⌥T is added to the shortcut overlay only after the gate trips and the feature ships. |

---

*Prepared via UxPipeline Step 3 (contingency pass). Status: GATED. Not build-ready.*
*Gate review cadence: 30 days post-launch (N ≥ 50 sessions) and 90 days post-launch.*
*If gate does not trip by 90-day review, archive this spec and close U-16 permanently.*
