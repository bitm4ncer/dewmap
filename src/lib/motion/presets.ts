import type { SpringConfig } from "./spring";

export const SPRING = {
  /** Regular sheet detent change. */
  sheetSnap: { response: 0.38, dampingFraction: 0.9 },
  /** Small peek/mode transition, slightly quicker. */
  sheetPeek: { response: 0.32, dampingFraction: 0.92 },
  /** Detail card expand/collapse. */
  card: { response: 0.36, dampingFraction: 0.9 },
  /** Detail card dismissal. */
  cardDismiss: { response: 0.3, dampingFraction: 0.92 },
  /** Apple's default SwiftUI spring, used for gentle reveals. */
  reveal: { response: 0.5, dampingFraction: 0.825 },
} as const satisfies Record<string, SpringConfig>;
