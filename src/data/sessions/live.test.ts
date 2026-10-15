import {describe, expect, it} from '@jest/globals';

import {
  LIVE_FRESH_MS,
  LIVE_POLL_MS,
  isLive,
  isRecentlyLive,
  livePoll,
} from './live';

describe('live', () => {
  const now = 1_000_000_000;
  it('is live while the last lap stamp is fresh', () => {
    expect(isLive(now - 60_000, now)).toBe(true);
    expect(isLive(now - LIVE_FRESH_MS + 1, now)).toBe(true);
  });
  it('is not live without a stamp or past the window', () => {
    expect(isLive(null, now)).toBe(false);
    expect(isLive(undefined, now)).toBe(false);
    expect(isLive(now - LIVE_FRESH_MS, now)).toBe(false);
  });
  it('polls only a live session', () => {
    expect(livePoll(Date.now())).toBe(LIVE_POLL_MS);
    expect(livePoll(Date.now() - 2 * LIVE_FRESH_MS)).toBe(false);
    expect(livePoll(null)).toBe(false);
  });
});

describe('isRecentlyLive (pit-wall #5291)', () => {
  it('is a session live in the last 2 h; never one that was never live', () => {
    const now = Date.parse('2026-10-14T02:00:00Z');
    expect(isRecentlyLive(now - 60 * 60_000, now)).toBe(true);
    expect(isRecentlyLive(now - 3 * 60 * 60_000, now)).toBe(false);
    expect(isRecentlyLive(null, now)).toBe(false);
  });
});
