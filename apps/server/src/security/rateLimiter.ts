interface RateLimitRecord {
  readonly count: number;
  readonly expiresAt: number;
}

export class SlidingWindowRateLimiter {
  private readonly windowMs: number;
  private readonly maxAttempts: number;
  private readonly store = new Map<string, RateLimitRecord>();

  constructor(options: { windowSeconds: number; maxAttempts: number }) {
    this.windowMs = options.windowSeconds * 1000;
    this.maxAttempts = options.maxAttempts;
  }

  /**
   * Returns true if the attempt should be allowed. When false the caller should reject the action.
   */
  allow(key: string, now: number = Date.now()): boolean {
    this.evictExpired(now);

    const existing = this.store.get(key);
    if (!existing || existing.expiresAt <= now) {
      this.store.set(key, { count: 1, expiresAt: now + this.windowMs });
      return true;
    }

    if (existing.count >= this.maxAttempts) {
      return false;
    }

    this.store.set(key, { count: existing.count + 1, expiresAt: existing.expiresAt });
    return true;
  }

  private evictExpired(now: number) {
    for (const [key, record] of this.store) {
      if (record.expiresAt <= now) {
        this.store.delete(key);
      }
    }
  }
}
