// Token bucket that runs on debt: a taker subtracts what it used and, when the
// balance goes negative, sleeps for exactly as long as the rate needs to pay it
// back. Many connections can share one bucket (the global cap) and each
// download can also hold its own (a per-download cap); chained, the tighter
// one wins.

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class RateLimiter {
  private tokens = 0;
  private last = Date.now();

  constructor(private rate = 0) {}

  /** Bytes per second; 0 lifts the cap. */
  setRate(rate: number): void {
    this.rate = Math.max(0, rate);
    this.tokens = 0;
    this.last = Date.now();
  }

  getRate(): number {
    return this.rate;
  }

  async take(n: number): Promise<void> {
    if (!this.rate) return;
    const now = Date.now();
    // Allow at most one second of burst after an idle stretch.
    this.tokens = Math.min(this.rate, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    this.tokens -= n;
    if (this.tokens < 0) await sleep(Math.min(5000, (-this.tokens / this.rate) * 1000));
  }
}

export async function takeAll(limiters: readonly RateLimiter[], n: number): Promise<void> {
  for (const l of limiters) await l.take(n);
}
