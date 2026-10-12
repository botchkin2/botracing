import {describe, expect, it} from '@jest/globals';

import {IDLE_S, LAUNCH_WINDOW_S, shouldReloadNow} from './otaPolicy';

describe('shouldReloadNow', () => {
  it('reloads inside the launch window, even while the user is touching', () => {
    expect(shouldReloadNow({sinceStartS: 1, idleS: 0})).toBe(true);
    expect(shouldReloadNow({sinceStartS: LAUNCH_WINDOW_S, idleS: 0})).toBe(
      true,
    );
  });

  it('after launch, waits while the user is mid-interaction', () => {
    expect(shouldReloadNow({sinceStartS: 300, idleS: 0})).toBe(false);
    expect(shouldReloadNow({sinceStartS: 300, idleS: IDLE_S - 0.1})).toBe(
      false,
    );
  });

  it('after launch, reloads once the screen has been left alone', () => {
    expect(shouldReloadNow({sinceStartS: 300, idleS: IDLE_S})).toBe(true);
    expect(shouldReloadNow({sinceStartS: 3600, idleS: 3000})).toBe(true);
  });

  it('just past the launch window, an active user still waits', () => {
    expect(
      shouldReloadNow({sinceStartS: LAUNCH_WINDOW_S + 0.1, idleS: 1}),
    ).toBe(false);
  });
});
