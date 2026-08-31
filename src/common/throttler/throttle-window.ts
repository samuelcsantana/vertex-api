// The record shape ThrottlerGuard reads back from a storage. Redeclared
// rather than imported because @nestjs/throttler does not re-export the type
// from its entry point, and reaching into its dist/ path would tie this file
// to the package layout. TypeScript is structural, so a matching shape is the
// same type as far as `implements ThrottlerStorage` is concerned.
export interface ThrottleDecision {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * The counter state a single throttler key carries.
 *
 * Times are epoch milliseconds, compared against a clock the caller passes in.
 * `blockedUntil` is 0 when the key is not blocked.
 */
export interface ThrottleWindow {
  totalHits: number;
  windowEndsAt: number;
  blockedUntil: number;
}

/**
 * The whole rate-limiting decision, as a pure function.
 *
 * Everything that decides whether a request is allowed lives here rather than
 * inside the storage class, for two reasons. It can be tested exhaustively
 * with no database and no clock — expiry boundaries, the first hit over the
 * limit, a block that has just lapsed — and it makes the storage class a thin
 * shell whose only job is reading and writing this state atomically.
 *
 * The behaviour deliberately mirrors @nestjs/throttler's in-memory storage,
 * because the two are interchangeable at runtime and a request must not be
 * treated differently depending on which one is configured:
 *
 * - A window that has ended is replaced rather than extended.
 * - A blocked key does not accumulate hits; the block is what is being waited
 *   out, and counting during it would extend the block forever.
 * - When a block lapses, the counter starts over and the current request is
 *   its first hit.
 *
 * Note that `blockDuration` defaults to `ttl` in ThrottlerGuard rather than to
 * zero, so blocking is always live in practice, not an opt-in.
 */
export function advanceThrottleWindow(
  current: ThrottleWindow | null,
  now: number,
  ttl: number,
  limit: number,
  blockDuration: number,
): { next: ThrottleWindow; record: ThrottleDecision } {
  const fresh = (): ThrottleWindow => ({
    totalHits: 0,
    windowEndsAt: now + ttl,
    blockedUntil: 0,
  });

  let next: ThrottleWindow;

  if (!current || current.windowEndsAt <= now) {
    next = fresh();
  } else if (current.blockedUntil > 0 && current.blockedUntil <= now) {
    next = fresh();
  } else {
    next = { ...current };
  }

  if (next.blockedUntil === 0) {
    next.totalHits += 1;
  }

  if (next.totalHits > limit && next.blockedUntil === 0) {
    next.blockedUntil = now + blockDuration;
  }

  return {
    next,
    record: {
      totalHits: next.totalHits,
      // Seconds, and rounded up, because these two land in Retry-After and
      // X-RateLimit-Reset headers.
      timeToExpire: Math.ceil((next.windowEndsAt - now) / 1000),
      isBlocked: next.blockedUntil > now,
      timeToBlockExpire:
        next.blockedUntil > now
          ? Math.ceil((next.blockedUntil - now) / 1000)
          : 0,
    },
  };
}
