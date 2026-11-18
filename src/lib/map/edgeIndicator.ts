export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface EdgeHint extends Point {
  angle: number;
}

/**
 * Clamps an off-screen map point to the visible edge of the map area and
 * returns the rotation (degrees) pointing from the centre towards it.
 * Returns null while the point is inside the safe area.
 */
export function edgeIndicator(
  point: Point,
  size: Size,
  insets: Insets,
): EdgeHint | null {
  const left = insets.left;
  const right = size.width - insets.right;
  const top = insets.top;
  const bottom = size.height - insets.bottom;
  if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) {
    return null;
  }
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const dx = point.x - cx;
  const dy = point.y - cy;
  if (dx === 0 && dy === 0) return null;
  const sx = dx === 0 ? Infinity : dx > 0 ? (right - cx) / dx : (cx - left) / -dx;
  const sy = dy === 0 ? Infinity : dy > 0 ? (bottom - cy) / dy : (cy - top) / -dy;
  const scale = Math.min(sx, sy);
  return {
    x: cx + dx * scale,
    y: cy + dy * scale,
    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}
