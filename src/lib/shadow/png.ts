/**
 * Encode a shadow mask as a PNG data URL.
 *
 * Runs in the worker: `OffscreenCanvas` + `convertToBlob` keep both the
 * rasterisation and the PNG compression off the main thread. A 500×400 mask
 * with one colour compresses to 10–30 kB, which is small enough to hand to
 * MapLibre as an image source on every slider step.
 */
import { maskToRgba, flipRows } from "./palette";
import type { ShadowMask } from "./types";

/** Shadow colour, matching the vector fill in `overlay.ts`. */
const SHADOW_COLOR: [number, number, number] = [11, 26, 51];

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

export interface EncodeMaskOptions {
  /** 0–255. Defaults to 255; the layer applies the user's opacity on top. */
  alpha?: number;
  /** One-cell feather, matches the penumbra better than a hard edge. */
  feather?: boolean;
}

/** `null` when the environment has no OffscreenCanvas (very old browsers). */
export async function encodeMaskPng(
  mask: ShadowMask,
  options: EncodeMaskOptions = {},
): Promise<string | null> {
  if (typeof OffscreenCanvas === "undefined") return null;
  const alpha = options.alpha ?? 255;
  const rgba = maskToRgba(mask, {
    color: SHADOW_COLOR,
    alpha,
    feather: options.feather ?? true,
  });
  // mask row 0 is south; canvas row 0 is north.
  // Copy into a fresh buffer: ImageData wants an ArrayBuffer-backed view.
  const flipped = new Uint8ClampedArray(flipRows(rgba, mask.width, mask.height, 4));
  const canvas = new OffscreenCanvas(mask.width, mask.height);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.putImageData(new ImageData(flipped, mask.width, mask.height), 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return toDataUrl(blob);
}
