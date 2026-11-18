export { rubberband } from "./rubberband";
export {
  createSpring,
  isSpringSettled,
  stepSpring,
  type SpringConfig,
  type SpringHandle,
  type SpringOptions,
  type SpringSnapshot,
} from "./spring";
export { VelocityTracker, type VelocitySample } from "./velocity";
export { chooseDetent, type DetentOption } from "./detents";
export { SPRING } from "./presets";

/** True when the user asked the OS to reduce motion. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined"
    && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
  );
}
