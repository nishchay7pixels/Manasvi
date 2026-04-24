export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

interface CounterState {
  windowStart: number;
  count: number;
}

export class InMemoryRateLimiter {
  private readonly counters = new Map<string, CounterState>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {}

  evaluate(key: string, nowMs = Date.now()): RateLimitDecision {
    const state = this.counters.get(key);
    if (!state || nowMs - state.windowStart >= this.windowMs) {
      this.counters.set(key, { windowStart: nowMs, count: 1 });
      return {
        allowed: true,
        remaining: Math.max(0, this.maxRequests - 1),
        retryAfterMs: 0
      };
    }
    if (state.count >= this.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(0, state.windowStart + this.windowMs - nowMs)
      };
    }
    state.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequests - state.count),
      retryAfterMs: 0
    };
  }
}

export class InMemoryDuplicateGuard {
  private readonly seen = new Map<string, number>();

  constructor(private readonly ttlMs: number) {}

  markOrReject(key: string, nowMs = Date.now()): boolean {
    const expiresAt = this.seen.get(key);
    if (expiresAt && expiresAt > nowMs) {
      return false;
    }
    this.seen.set(key, nowMs + this.ttlMs);
    return true;
  }
}
