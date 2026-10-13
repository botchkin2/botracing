import {describe, expect, it} from '@jest/globals';

import {
  LIST_POLL_MS,
  LIVE_FRESH_MS,
  LIVE_POLL_MS,
  isLive,
  listPoll,
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
  it('polls the list fast while it shows a live session, slowly otherwise', () => {
    expect(listPoll([null, Date.now()])).toBe(LIVE_POLL_MS);
    expect(listPoll([null, Date.now() - 2 * LIVE_FRESH_MS])).toBe(LIST_POLL_MS);
    expect(listPoll(undefined)).toBe(LIST_POLL_MS);
  });
});
