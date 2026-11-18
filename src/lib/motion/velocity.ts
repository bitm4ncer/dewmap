export interface VelocitySample {
  t: number;
  y: number;
}

const WINDOW_MS = 100;

/**
 * Samples a gesture over a short recent window. The last pointer event alone
 * is noisy when the finger pauses just before release.
 */
export class VelocityTracker {
  private samples: VelocitySample[] = [];

  reset(): void {
    this.samples = [];
  }

  add(y: number, t: number): void {
    this.samples.push({ y, t });
    const cutoff = t - WINDOW_MS;
    while (this.samples.length > 2 && this.samples[0].t < cutoff) {
      this.samples.shift();
    }
  }

  /** Pixels per second. Positive means the finger moved down. */
  velocity(now = this.samples[this.samples.length - 1]?.t ?? 0): number {
    if (this.samples.length < 2) return 0;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const dt = Math.max(1, last.t - first.t);
    if (now - last.t > 80) return 0;
    return ((last.y - first.y) / dt) * 1000;
  }
}
