# Galley — process artifacts

Everything here is **working material, not product**: how Galley was researched,
designed, specified and tested. None of it is loaded by the app or by Claude Code at
session start — it is reference you (or an agent) open deliberately.

It lives under `.claude/` rather than at the repo root for two reasons. Tauri sets
`frontendDist: "../../app"`, so *anything* inside `app/` is embedded into the shipped
binary — QA reports and spec drafts were being compiled into the product. And the root
should show what Galley *is* (`app/`, `tauri-app/`), not how it was made.

| Path | What it holds |
|---|---|
| `ux/` | The 8-step UxPipeline run: `INDEX.md`, `UX-DESIGN-SYSTEM.md` (one-page summary), research streams, steps 2–6, the step-8 evaluation and iteration illustration, and `obsolete-audit.md` |
| `feature-gaps/` | `waad-grounded-requirements.md`, the per-requirement specs in `specs/` (`DR-##`, `U-##`, `F-##`, `UXF-##`) and test `fixtures/` |
| `qa/` | `screenshots/` evidence (gitignored); past QA reports were removed as obsolete and remain in git history |
| `notes/` | Drafts and loose writing not tied to a requirement |

Two of these are gitignored and stay on your machine: `qa/screenshots/` (regenerated
evidence, not sources) and `notes/` (personal drafts).

## Related, deliberately kept elsewhere

- `README.md` at the repo root — the front door: what Galley is, how to build and
  install it, and the dev/test commands. Hand this to a tester.
- `app/CONTRACT.md` and `tauri-app/NATIVE-CONTRACT.md` — **binding** interface
  contracts, kept beside the code they govern.
- `.claude/queue*.json` and `.claude/queue-state/` — Foreman issue-queue runtime
  state, gitignored.

Requirement IDs (`DR-##`, `URD-##`, `U-##`/`F-##`, `ISS-###`) are the spec; trace
changes to an ID and cite it in the commit.
