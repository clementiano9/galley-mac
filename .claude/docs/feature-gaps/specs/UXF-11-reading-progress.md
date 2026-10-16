# UXF-11 — Reading-progress rail

*Status: built 2026-10-12, hide-at-rest 2026-10-16 · Priority: Should (sev 3) · Owner files: `app/js/tv-progress.js` (new), `app/css/tv-app.css`, `app/css/tv-print.css`, `app/index.html`, `app/CONTRACT.md`*

## Why

Owner: "a discreet scrollbar to the viewer so I know how far I have to read." The document's scrollbar is hidden at rest (D-03) and its hover reveal takes 5 px from the text column (step 8, iteration 3, E). URD-03, URD-06. Evidence WAN-120 to WAN-130.

## Decision

A thin overlay rail on the viewer's right edge (E3), owned by `tv-progress.js`, attached after every `render` event.

| State | Look |
|---|---|
| Document fits the window | no rail (`display: none`) |
| At rest | hidden (opacity 0, 3 px right of its place); the 14 px hit area stays live |
| Scrolling | fades in and slides 3 px left (`--tv-dur-base`, `--tv-ease-enter`): 3 px thumb, `--tv-text-muted` at .55, 4 px from the edge |
| Scrolling stops | stays 900 ms after the last scroll event, then fades out (`--tv-dur-slow`, `--tv-ease-exit`) |
| Pointer over the 14 px hit area | shows even when hidden; thumb 7 px wide; tip left of the thumb: `42% · 6 min left`, `under a minute left`, `End` at 100%; on leave it stays 900 ms, then fades |
| Dragging | thumb follows the pointer, document scrolls proportionally |
| Click on the track | the thumb centres on the click, then drag continues from there |

- Track: from `scroller.offsetTop + 6` px, height `clientHeight − 12`, so it sits under the edit toolbar in edit mode.
- Thumb length: share on screen, minimum 28 px. Position: `scrollTop / (scrollHeight − clientHeight)`.
- Minutes left: words of `.md` × share below the fold ÷ 230, rounded up.
- Positions are set through CSSOM (Tauri CSP).
- Updates on scroll (one per frame), on `ResizeObserver` of the scroller and `.tv-content` (images, diagrams, live updates), on window resize and on render.
- One rail element for the app's life; each render moves it into the new viewer, so hover and a drag survive live updates (drag listens on `window`, not pointer capture).
- Wheel and trackpad scrolling over the rail are passed to the document.
- A text selection that starts in the document passes over the rail (`.is-passive`, `pointer-events: none` until the button is released).
- `aria-hidden="true"`: `.tv-scroll` stays the focusable, keyboard and screen-reader scroller.
- Only the reader's scrolling shows it: a scroll event within 400 ms of a wheel event, a scroll key (Space, Page Up/Down, Home, End, ↑, ↓, with or without modifiers) or a pointer press inside the document, or while it is already shown (momentum). A render that swaps the scroller clears that input, so tab switches, live updates, pin-to-tail and image loads never flash it. Owner request 2026-10-16.
- Reduced Motion: no slide and no fade; the app-wide Reduce Motion rule (`tv-app.css`, `.tv *` transitions .01 ms) makes it appear and disappear at once.
- Print: hidden.
- The native document scrollbar is now hidden on hover too (it took width; WAN-124). Sidebar and palette bars are unchanged.
- DR-07 amended: a faint position cue is content state, not chrome.

## Acceptance criteria

1. **PASS/FAIL** A document longer than the window shows no rail at rest. Scrolling (wheel, trackpad, keys) fades it in; 900 ms after the last scroll it fades out. Light and dark.
1a. **PASS/FAIL** A tab switch, a live update (with and without pin) and an image load do not show it; pointing at the right edge does.
2. **PASS/FAIL** A document that fits shows no rail; growing it (live update, image load) brings the rail without a re-render.
3. **PASS/FAIL** Thumb length ≈ clientHeight / scrollHeight of the track; position matches scroll at top, middle and bottom (±2 px).
4. **PASS/FAIL** Hover: thumb widens, tip shows percent and minutes left; tip text right at the top and `End` at the bottom.
5. **PASS/FAIL** Drag the thumb scrolls the document; click on the track jumps there; the text column never shifts (measure the `.md` left edge and width before and during hover/drag).
6. **PASS/FAIL** Tab switch: the rail reflects the new tab's restored scroll position (DR-03).
7. **PASS/FAIL** Edit mode: the track starts below the edit toolbar.
8. **PASS/FAIL** ⌘⇧F search overlay, launcher tab, error tab, empty file: no rail or a correct one, no console error.
9. **PASS/FAIL** Keyboard scrolling (space, arrows, ⌘↓) still works and moves the thumb; the rail never takes focus.
10. **PASS/FAIL** Reduced Motion: no slide; show and hide are instant.
11. **PASS/FAIL** Print preview: no rail.
12. **PASS/FAIL** Clicks on the document's text near the right edge (outside the 14 px hit area) still select text.

## Out of scope

Heading or find-hit marks on the track, a progress line in the tab, persistent time-left text.
