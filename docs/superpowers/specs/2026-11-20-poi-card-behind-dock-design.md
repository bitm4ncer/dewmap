# Detail card behind the dock bar

Date: 2026-11-20
Status: approved (behaviour agreed in conversation)

## Intent

Today the POI detail card (`z-index: 45`) covers the bottom sheet (`--z-sheet: 30`).
With the sheet open at half or full, the card hides the panel content and the
safe-area strip; two bottom surfaces compete for the same space.

The agreed behaviour: the sheet's peek bar (grabber plus the four pane tabs)
becomes a permanent dock. Opening a place collapses the sheet to peek and the
card rises from **behind** that bar, so exactly one surface is open at a time.
Tapping a tab, or dragging the sheet up, dismisses the card and opens the panel.

## Goals

1. The dock bar stays visible and on top in every state; the card never covers it.
2. Place tap: sheet goes to `peek`, card slides up from behind the bar.
3. Tab tap or sheet swipe up: card slides back behind the bar in the same
   motion that raises the sheet.
4. The card keeps its compact/expanded drag; a drag on the bar hands off to the
   sheet, never to the card.
5. Closing the card with `×` restores the sheet size it had before the card
   opened (current behaviour), and leaves the sheet at peek when it was peek.
6. Reduced motion: no transform, instant appear/disappear.

## Non-goals

- No redesign of the card's content, no new panel, no new detents.
- Desktop (≥768px) is unchanged: no sheet there, card stays at `bottom: 0`.
- No change to what opens a place (tap, long press, search).

## Approach

Stack instead of fight: put the card **below** the sheet in z-order and above it
in layout. The opaque dock bar occludes the card's bottom edge, so the slide
reads as "emerging from under the bar" without any clipping.

Rejected alternatives:

- Dismiss the card whenever the sheet expands (no overlap, but loses the place
  context and has no visual continuity).
- Let the card ride on top of the sheet and pad the sheet by the card height
  (two surfaces still compete, and at `full` the card has nowhere to go).

## Decisions

- Mobile only: `.poi-detail` gets `bottom: var(--hud-peek-h)` and a z-index
  under `--z-sheet` (new `--z-card: 25`). Desktop keeps `bottom: 0`.
- The card's enter/exit is a transform (`translateY(100% + bar)` ↔ `0`), driven
  by the same easing as the sheet, not by an independent fade.
- Dismissal is derived, not imperative: the card closes when the sheet leaves
  `peek`. The rising bar hides it, so no second animation is visible.
- Opening a place while the sheet is half/full snaps to `peek` first (existing
  `openPoi`); the card enters once the sheet is at rest at `peek`.
- A tab click must clear `sheetBeforePoiRef` before snapping, otherwise the
  card's close path would restore the pre-card sheet size and undo the tap.
- `×` keeps the existing restore path: `closePoi` returns the sheet to the size
  remembered in `sheetBeforePoiRef`, or leaves it at `peek`.
- The dock bar is interactive in every state — the card sits above it, so no
  hit-testing changes are needed.

## Constraints

- `PoiDetail` owns height springs and rubber-band gestures; the new transform
  must compose with `el.style.height` writes, not replace them.
- `.hud-bottom-sheet` uses `contain: layout paint`; the card lives outside it
  and is `position: fixed`, so stacking is unaffected.
- The app ships as a static export; no runtime feature detection.

## Verification

`Map.tsx` has no component test harness. The change is verified in Chromium
(SwiftShader) by driving place-tap, tab-tap and sheet-drag, checking the
computed z-order and that the card never intersects the dock bar, plus the
existing `npm test` suite and a visual check on the phone.

## Left to the builder

Exact spring/easing constants and whether the card reuses the sheet's spring,
plus how the transform is torn down after exit (transitionend vs spring
completion).
