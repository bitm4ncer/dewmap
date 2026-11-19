import type { SpringConfig } from "./spring";

export const SPRING = {
  /** Regular sheet detent change: calm, critically damped, no rebound. */
  sheetSnap: { response: 0.52, dampingFraction: 1 },
  /** Small peek/mode transition. */
  sheetPeek: { response: 0.44, dampingFraction: 1 },
  /** Detail card expand/collapse. */
  card: { response: 0.46, dampingFraction: 1 },
  /** Detail card dismissal. */
  cardDismiss: { response: 0.34, dampingFraction: 1 },
  /** Apple's default SwiftUI spring, used for gentle reveals. */
  reveal: { response: 0.5, dampingFraction: 0.825 },
} as const satisfies Record<string, SpringConfig>;
