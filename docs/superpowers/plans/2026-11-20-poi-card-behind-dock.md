# Detail card behind the dock bar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The POI detail card slides up from behind the sheet's peek bar and closes whenever the sheet expands, so only one bottom surface is ever open.

**Architecture:** The peek bar becomes a permanent dock: the card is stacked *below* the sheet in z-order and *above* it in layout (`bottom: var(--hud-peek-h)`), inside a clipping wrapper that ends at the bar's top edge. The sheet's own rise occludes the card, so gesture hand-off needs no new gesture code. The card dismisses on a derived signal (`sheetState !== "peek"`), and the sheet-size bookkeeping moves into a pure reducer so the restore path cannot undo a tab tap.

**Tech Stack:** Next.js 16 client components, MapLibre, plain CSS in `src/app/globals.css`, vitest.

**Spec:** `docs/superpowers/specs/2026-11-20-poi-card-behind-dock-design.md`

## Global Constraints

- Mobile only: every positional change sits inside `@media (max-width: 767px)`. Desktop keeps `bottom: 0` and the current z-order.
- The dock bar must stay interactive and never be covered by the card.
- Reduced motion: no transform, card appears and disappears instantly.
- No new dependency; existing tokens (`--hud-peek-h`, `--z-sheet`, `--ease-snap`) only.
- Static export must keep building (`npm run build`).

## Review Focus

- Card opened while the sheet is at `full`, then the card closed: the sheet must not snap back to `full` behind the user's back.
- Tab tapped while the card is animating out: no double snap, no orphaned timer.
- Sheet dragged up and released back to `peek`: the card must survive, not be dismissed by a drag that never changed state.
- Card expanded to near viewport height: the clipping wrapper must not cut its top.
- Desktop ≥768px: the card must not shift or gain a wrapper offset.

---

### Task 1: Stack the card under the dock bar

**Files:**
- Modify: `src/app/globals.css` (`.poi-detail` block, around line 1870; token block around line 119)
- Test: `src/app/theme-css.test.ts`

**Interfaces:**
- Produces: `--z-card: 25` custom property; `.poi-detail` mobile rule `bottom: var(--hud-peek-h)`.
- Consumes: existing `--z-sheet: 30`, `--hud-peek-h`.

- [ ] **Step 1: Write the failing test**

Add to `src/app/theme-css.test.ts`:

```ts
it("keeps the detail card under the sheet dock", () => {
  const card = declarations.filter((d) => d.selector.includes(".poi-detail"));
  const mobileZ = card.find((d) => d.prop === "z-index" && d.value === "var(--z-card)");
  const mobileBottom = card.find(
    (d) => d.prop === "bottom" && d.value === "var(--hud-peek-h)",
  );
  expect(mobileZ).toBeDefined();
  expect(mobileBottom).toBeDefined();
  const sheet = block(":root")?.body.match(/--z-sheet:\s*(\d+)/)?.[1];
  const cardZ = css.match(/--z-card:\s*(\d+)/)?.[1];
  expect(Number(cardZ)).toBeLessThan(Number(sheet));
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/theme-css.test.ts -t "under the sheet dock"`
Expected: FAIL — `mobileZ`/`mobileBottom` undefined.

- [ ] **Step 3: Add the token and the mobile rule**

In the `:root` token block next to `--z-sheet`:

```css
  --z-card: 25;
```

Inside the existing `@media (max-width: 767px)` block that styles `.hud-bottom-sheet` (line ~356), append:

```css
  .poi-detail {
    bottom: var(--hud-peek-h);
    z-index: var(--z-card);
  }
```

- [ ] **Step 4: Run the test again**

Run: `npx vitest run src/app/theme-css.test.ts`
Expected: PASS, 32 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css src/app/theme-css.test.ts
git commit -m "feat(poi): stack the detail card under the sheet dock"
```

---

### Task 2: Sheet bookkeeping as a tested reducer

**Files:**
- Create: `src/components/shell/poiSheet.ts`
- Create: `src/components/shell/poiSheet.test.ts`
- Modify: `src/components/Map.tsx:2310-2366` (`openPoi`, `closePoi`, `sheetBeforePoiRef`)

**Interfaces:**
- Consumes: `SheetState` from `./useSheetGesture`.
- Produces:
  ```ts
  export interface PoiSheetState { saved: SheetState | null }
  export type PoiSheetEvent =
    | { type: "open-poi"; isMobile: boolean; sheetState: SheetState }
    | { type: "close-poi"; isMobile: boolean }
    | { type: "sheet-state"; sheetState: SheetState };
  export function poiSheetReduce(
    state: PoiSheetState,
    event: PoiSheetEvent,
  ): { state: PoiSheetState; snapTo: SheetState | null; dismissCard: boolean };
  ```

- [ ] **Step 1: Write the failing tests**

`src/components/shell/poiSheet.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { poiSheetReduce, type PoiSheetState } from "./poiSheet";

const empty: PoiSheetState = { saved: null };

describe("poiSheetReduce", () => {
  it("remembers the sheet size and collapses to peek when a place opens", () => {
    const r = poiSheetReduce(empty, { type: "open-poi", isMobile: true, sheetState: "half" });
    expect(r.state.saved).toBe("half");
    expect(r.snapTo).toBe("peek");
  });

  it("does not collapse when the sheet is already at peek", () => {
    const r = poiSheetReduce(empty, { type: "open-poi", isMobile: true, sheetState: "peek" });
    expect(r.state.saved).toBeNull();
    expect(r.snapTo).toBeNull();
  });

  it("ignores the collapse on desktop", () => {
    const r = poiSheetReduce(empty, { type: "open-poi", isMobile: false, sheetState: "half" });
    expect(r.state.saved).toBeNull();
    expect(r.snapTo).toBeNull();
  });

  it("drops the saved size and dismisses the card when the sheet expands", () => {
    const open: PoiSheetState = { saved: "half" };
    const r = poiSheetReduce(open, { type: "sheet-state", sheetState: "half" });
    expect(r.state.saved).toBeNull();
    expect(r.dismissCard).toBe(true);
    expect(r.snapTo).toBeNull();
  });

  it("keeps the card while the sheet stays at peek", () => {
    const r = poiSheetReduce({ saved: null }, { type: "sheet-state", sheetState: "peek" });
    expect(r.dismissCard).toBe(false);
    expect(r.state.saved).toBeNull();
  });

  it("restores the remembered size when the card closes", () => {
    const r = poiSheetReduce({ saved: "half" }, { type: "close-poi", isMobile: true });
    expect(r.snapTo).toBe("half");
    expect(r.state.saved).toBeNull();
  });

  it("leaves the sheet alone when nothing was remembered", () => {
    const r = poiSheetReduce({ saved: null }, { type: "close-poi", isMobile: true });
    expect(r.snapTo).toBeNull();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/components/shell/poiSheet.test.ts`
Expected: FAIL — cannot resolve `./poiSheet`.

- [ ] **Step 3: Implement the reducer**

`src/components/shell/poiSheet.ts`:

```ts
import type { SheetState } from "./useSheetGesture";

export interface PoiSheetState {
  saved: SheetState | null;
}

export type PoiSheetEvent =
  | { type: "open-poi"; isMobile: boolean; sheetState: SheetState }
  | { type: "close-poi"; isMobile: boolean }
  | { type: "sheet-state"; sheetState: SheetState };

export function poiSheetReduce(
  state: PoiSheetState,
  event: PoiSheetEvent,
): { state: PoiSheetState; snapTo: SheetState | null; dismissCard: boolean } {
  switch (event.type) {
    case "open-poi":
      if (!event.isMobile || state.saved !== null || event.sheetState === "peek") {
        return { state, snapTo: null, dismissCard: false };
      }
      return { state: { saved: event.sheetState }, snapTo: "peek", dismissCard: false };
    case "sheet-state":
      if (event.sheetState === "peek") return { state, snapTo: null, dismissCard: false };
      return { state: { saved: null }, snapTo: null, dismissCard: true };
    case "close-poi": {
      const target = event.isMobile ? state.saved : null;
      return { state: { saved: null }, snapTo: target, dismissCard: false };
    }
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/shell/poiSheet.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Wire it into `Map.tsx`**

Replace `sheetBeforePoiRef` with `const poiSheetRef = useRef<PoiSheetState>({ saved: null })` and a helper `const applyPoiSheet = (event: PoiSheetEvent) => { const next = poiSheetReduce(poiSheetRef.current, event); poiSheetRef.current = next.state; if (next.snapTo) snapTo(next.snapTo); if (next.dismissCard) setPoiDismissing(true); };`

- `openPoi` calls `applyPoiSheet({ type: "open-poi", isMobile, sheetState })` before `setPoiSelection(selection)`.
- `closePoi` calls `applyPoiSheet({ type: "close-poi", isMobile })`, then `setPoiSelection(null)` and `setPoiDismissing(false)`.
- A `useEffect` on `[sheetState]` calls `applyPoiSheet({ type: "sheet-state", sheetState })`.

`dismissCard` sets `poiDismissing` instead of clearing the selection: the card owns its exit animation and calls `onClose` when it is done (Task 3). Unmounting it immediately would skip the animation.

Keep `applyPoiSheet` stable with `useCallback` over `[isMobile, sheetState, snapTo]`.

- [ ] **Step 6: Verify nothing regressed**

Run: `npm run typecheck && npx vitest run src/components/shell`
Expected: 0 errors, all shell tests pass (`useSheetGesture.test.ts` unchanged).

- [ ] **Step 7: Commit**

```bash
git add src/components/shell/poiSheet.ts src/components/shell/poiSheet.test.ts src/components/Map.tsx
git commit -m "feat(poi): derive card dismissal from the sheet state"
```

---

### Task 3: Animate the card in and out

**Files:**
- Modify: `src/components/poi/PoiDetail.tsx` (`Props`, `PoiDetailContent`, `closeCard`)
- Modify: `src/components/Map.tsx:5178-5183` (pass `dismissed`)

**Interfaces:**
- Consumes: `--hud-peek-h`, `--z-card`, `prefersReducedMotion()`, `dismissed: boolean` from `Map.tsx` (`poiDismissing`).
- Produces: `onClose` fires only after the exit animation.

No clipping wrapper: with the card resting above the opaque dock bar, `translateY(100%)`
already hides it behind the bar and then off-screen (ruling in the ledger).

- [ ] **Step 1: React to the dismiss signal**

Add `dismissed?: boolean` to `Props` and, in `PoiDetailContent`:

```tsx
useEffect(() => {
  if (dismissed) closeCard();
}, [dismissed]);
```

`closeCard` already respects `prefersReducedMotion()` and calls `onClose()` when done.

- [ ] **Step 2: Animate the enter**

In `PoiDetailContent`, after mount:

```tsx
useEffect(() => {
  const el = cardRef.current;
  if (!el || prefersReducedMotion()) return;
  el.style.transition = "none";
  el.style.transform = "translateY(100%)";
  el.getBoundingClientRect();
  requestAnimationFrame(() => {
    el.style.transition = `transform ${CARD_EXIT_MS}ms var(--ease-snap)`;
    el.style.transform = "translateY(0)";
  });
  return () => {
    el.style.removeProperty("transition");
  };
}, []);
```

with `const CARD_EXIT_MS = 300;` at module scope, and `closeCard`'s timer moved from
260 ms to the same constant so enter and exit share one duration.

- [ ] **Step 3: Pass the signal from `Map.tsx`**

`<PoiDetail ... dismissed={poiDismissing} />`.

- [ ] **Step 4: Verify in the browser**

Dev server at 390x844: open a place, watch the card rise from behind the bar; tap a tab
and watch it sink behind the bar while the sheet rises.

- [ ] **Step 5: Commit**

```bash
git add src/components/poi/PoiDetail.tsx src/components/Map.tsx src/app/globals.css
git commit -m "feat(poi): slide the detail card out from behind the dock bar"
```

### Task 4: Full gate and hand-off check

**Files:** none (verification only).

- [ ] **Step 1: Run the suite**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all pass, 0 errors.

- [ ] **Step 2: Drive the three hand-offs in the browser**

With the dev server up at 390×844:
1. Place → tab tap ("Routes"): card slides down, sheet rises, no snap-back, sheet stays at half.
2. Place → drag the sheet grabber up and release at half: the card is swallowed by the sheet, then unmounted.
3. Place → drag up and release back to peek: the card is still there.
4. Card → `×`: sheet returns to the size it had before the card (open the panel first to test the restore path).

- [ ] **Step 3: Build the export**

Run: `NEXT_PUBLIC_BASE_PATH=/dewmap NEXT_PUBLIC_SITE_URL=https://bitm4ncer.github.io/dewmap npm run build`
Expected: static export succeeds, 9 pages.
