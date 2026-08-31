import { advanceThrottleWindow, ThrottleWindow } from './throttle-window';

// The window is the rate limit. These cases are the reason it was pulled out
// of the storage class into a pure function: every one of them is a boundary
// that would otherwise need a database and a controllable clock to reach.
describe('advanceThrottleWindow', () => {
  const TTL = 60_000;
  const LIMIT = 5;
  // ThrottlerGuard defaults blockDuration to ttl when a route does not set
  // one, which is every route in this app.
  const BLOCK = TTL;
  const NOW = 1_000_000;

  const advance = (current: ThrottleWindow | null, now = NOW) =>
    advanceThrottleWindow(current, now, TTL, LIMIT, BLOCK);

  it('opens a window on the first request for a key', () => {
    const { next, record } = advance(null);

    expect(next).toEqual({
      totalHits: 1,
      windowEndsAt: NOW + TTL,
      blockedUntil: 0,
    });
    expect(record).toEqual({
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });

  it('counts a second request into the same window', () => {
    const { next } = advance(
      { totalHits: 1, windowEndsAt: NOW + 30_000, blockedUntil: 0 },
      NOW,
    );

    expect(next.totalHits).toBe(2);
    // The window is not extended by activity — it ends when it ends.
    expect(next.windowEndsAt).toBe(NOW + 30_000);
  });

  it('allows exactly the configured limit before blocking', () => {
    const { record } = advance({
      totalHits: LIMIT - 1,
      windowEndsAt: NOW + 30_000,
      blockedUntil: 0,
    });

    expect(record.totalHits).toBe(LIMIT);
    expect(record.isBlocked).toBe(false);
  });

  it('blocks on the request that goes over the limit', () => {
    const { next, record } = advance({
      totalHits: LIMIT,
      windowEndsAt: NOW + 30_000,
      blockedUntil: 0,
    });

    expect(record.isBlocked).toBe(true);
    expect(record.timeToBlockExpire).toBe(60);
    expect(next.blockedUntil).toBe(NOW + BLOCK);
  });

  it('does not count hits while a key is blocked', () => {
    // Otherwise every retry during a block would push the block further out
    // and a client that keeps trying could never come back.
    const blocked = {
      totalHits: LIMIT + 1,
      windowEndsAt: NOW + 30_000,
      blockedUntil: NOW + 30_000,
    };

    const { next, record } = advance(blocked);

    expect(next.totalHits).toBe(LIMIT + 1);
    expect(next.blockedUntil).toBe(NOW + 30_000);
    expect(record.isBlocked).toBe(true);
  });

  it('starts over once the block has lapsed, counting the current request', () => {
    const { next, record } = advance({
      totalHits: LIMIT + 1,
      windowEndsAt: NOW + 30_000,
      blockedUntil: NOW - 1,
    });

    expect(next.totalHits).toBe(1);
    expect(next.blockedUntil).toBe(0);
    expect(next.windowEndsAt).toBe(NOW + TTL);
    expect(record.isBlocked).toBe(false);
  });

  it('replaces a window that has ended rather than extending it', () => {
    const { next } = advance({
      totalHits: LIMIT,
      windowEndsAt: NOW - 1,
      blockedUntil: 0,
    });

    expect(next.totalHits).toBe(1);
    expect(next.windowEndsAt).toBe(NOW + TTL);
  });

  it('treats a window ending exactly now as over', () => {
    const { next } = advance({
      totalHits: LIMIT,
      windowEndsAt: NOW,
      blockedUntil: 0,
    });

    expect(next.totalHits).toBe(1);
  });

  it('rounds the reported times up to whole seconds', () => {
    // These land in Retry-After and X-RateLimit-Reset. Rounding down would
    // tell a client to retry while it is still blocked.
    const { record } = advance(
      { totalHits: 1, windowEndsAt: NOW + 1_500, blockedUntil: 0 },
      NOW,
    );

    expect(record.timeToExpire).toBe(2);
  });
});
