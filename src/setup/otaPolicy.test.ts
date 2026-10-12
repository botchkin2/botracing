import {describe, expect, it} from '@jest/globals';

import {
  FRESH_START_S,
  LAUNCH_HOLD_S,
  shouldReloadAtLaunch,
  shouldReloadOnReturn,
} from './otaPolicy';

describe('shouldReloadAtLaunch', () => {
  it('reloads when the update arrived within the splash hold', () => {
    expect(shouldReloadAtLaunch({fetchedAfterS: 0.4})).toBe(true);
    expect(shouldReloadAtLaunch({fetchedAfterS: LAUNCH_HOLD_S})).toBe(true);
  });

  it('does not reload when there was no update, or it came too late', () => {
    expect(shouldReloadAtLaunch({fetchedAfterS: null})).toBe(false);
    expect(shouldReloadAtLaunch({fetchedAfterS: LAUNCH_HOLD_S + 0.1})).toBe(
      false,
    );
  });
});

describe('shouldReloadOnReturn', () => {
  it('never reloads a short trip to another app', () => {
    expect(shouldReloadOnReturn({backgroundedS: 0})).toBe(false);
    expect(shouldReloadOnReturn({backgroundedS: 120})).toBe(false);
    expect(shouldReloadOnReturn({backgroundedS: FRESH_START_S - 1})).toBe(
      false,
    );
  });

  it('reloads on a return after a long time away', () => {
    expect(shouldReloadOnReturn({backgroundedS: FRESH_START_S})).toBe(true);
    expect(shouldReloadOnReturn({backgroundedS: 6 * 3600})).toBe(true);
  });
});
