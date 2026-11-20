export interface CardHeightContext {
  /** Desktop shows the card as a floating panel, not a bottom sheet. */
  desktop: boolean;
  /** Sheet dock height (`--hud-peek-h`), bottom inset included. */
  peek: number;
  /** Top bar height (`--topbar-h`), top inset included. */
  topbar: number;
}

/**
 * Height of the expanded place card.
 *
 * The card rests on the dock bar, so its top must stay below the top bar and
 * the search pill: 78 dvh alone would push a notched phone's card up over it.
 */
export function expandedCardHeight(vh: number, ctx: CardHeightContext): number {
  if (ctx.desktop) return vh - 90;
  const available = vh - ctx.peek - ctx.topbar - 12;
  return Math.round(Math.min(vh * 0.78, Math.max(0, available)));
}
