/**
 * Presentation helpers for raster shadow tiles.
 *
 * The mask is 1 bit of information per cell. Shipping RGBA PNG costs ~4 bytes
 * per cell before compression; a 256-colour palette PNG or a WebP with alpha
 * comes out at 15-60 kB for a 512x512 tile in the measured test. For vector
 * data the fill layer does this on the GPU and this module is unused.
 */
import type { ShadowMask } from "./types";

export interface ShadowRgbaOptions {
  /** Shadow colour as 0-255 RGB. */
  color?: [number, number, number];
  /** Alpha 0-255 at full shadow. Defaults to 110 (~43 %). */
  alpha?: number;
  /** Optional feathering: soften the mask edge by one cell. */
  feather?: boolean;
}

const DEFAULT_COLOR: [number, number, number] = [11, 26, 51];
const DEFAULT_ALPHA = 110;

/** Encode a mask as RGBA pixels, row 0 = southern edge (same as the mask). */
export function maskToRgba(mask: ShadowMask, options: ShadowRgbaOptions = {}): Uint8ClampedArray {
  const color = options.color ?? DEFAULT_COLOR;
  const alpha = options.alpha ?? DEFAULT_ALPHA;
  const out = new Uint8ClampedArray(mask.width * mask.height * 4);

  if (!options.feather) {
    for (let i = 0; i < mask.data.length; i++) {
      if (!mask.data[i]) continue;
      out[i * 4] = color[0];
      out[i * 4 + 1] = color[1];
      out[i * 4 + 2] = color[2];
      out[i * 4 + 3] = alpha;
    }
    return out;
  }

  // One-cell box blur on the binary mask, then scale alpha.
  const w = mask.width;
  const h = mask.height;
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const y = row + dy;
        if (y < 0 || y >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const x = col + dx;
          if (x < 0 || x >= w) continue;
          sum += mask.data[y * w + x];
          count++;
        }
      }
      const coverage = sum / count;
      if (coverage <= 0) continue;
      const i = row * w + col;
      out[i * 4] = color[0];
      out[i * 4 + 1] = color[1];
      out[i * 4 + 2] = color[2];
      out[i * 4 + 3] = Math.round(alpha * coverage);
    }
  }
  return out;
}

/** Flip a row-major grid between south-up (data) and north-up (canvas). */
export function flipRows(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  bytesPerCell?: number,
): Uint8ClampedArray;
export function flipRows(
  data: Uint8Array,
  width: number,
  height: number,
  bytesPerCell?: number,
): Uint8Array;
export function flipRows(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  bytesPerCell = 1,
): Uint8Array | Uint8ClampedArray {
  const out =
    data instanceof Uint8ClampedArray
      ? new Uint8ClampedArray(data.length)
      : new Uint8Array(data.length);
  const rowBytes = width * bytesPerCell;
  for (let row = 0; row < height; row++) {
    const src = (height - 1 - row) * rowBytes;
    out.set(data.subarray(src, src + rowBytes), row * rowBytes);
  }
  return out;
}
