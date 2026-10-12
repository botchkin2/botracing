import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';

import {runLaunch} from './otaLaunch';
import {LAUNCH_BACKSTOP_S, LAUNCH_HOLD_S} from './otaPolicy';

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

function deps(over: {
  fetchUpdate?: () => Promise<boolean>;
  reload?: () => Promise<void>;
  hideSplash?: () => Promise<void>;
}) {
  return {
    fetchUpdate: jest.fn(over.fetchUpdate ?? (async () => false)),
    reload: jest.fn(over.reload ?? (async () => {})),
    hideSplash: jest.fn(over.hideSplash ?? (async () => {})),
  };
}

describe('runLaunch', () => {
  it('hides the splash when there is no update', async () => {
    const d = deps({});
    await runLaunch(d);
    expect(d.reload).not.toHaveBeenCalled();
    expect(d.hideSplash).toHaveBeenCalledTimes(1);
  });

  it('reloads, and leaves the splash up for the new bundle, when an update arrives in time', async () => {
    const d = deps({fetchUpdate: async () => true});
    await runLaunch(d);
    expect(d.reload).toHaveBeenCalledTimes(1);
    expect(d.hideSplash).not.toHaveBeenCalled();
  });

  it('hides the splash when the reload rejects', async () => {
    const d = deps({
      fetchUpdate: async () => true,
      reload: async () => {
        throw new Error('reload failed');
      },
    });
    await runLaunch(d);
    expect(d.hideSplash).toHaveBeenCalledTimes(1);
  });

  it('hides the splash when the fetch rejects (offline)', async () => {
    const d = deps({
      fetchUpdate: async () => {
        throw new Error('network');
      },
    });
    await runLaunch(d);
    expect(d.reload).not.toHaveBeenCalled();
    expect(d.hideSplash).toHaveBeenCalledTimes(1);
  });

  it('hides the splash at the hold when the check hangs, and never reloads', async () => {
    const d = deps({fetchUpdate: () => new Promise<boolean>(() => {})});
    const done = runLaunch(d);
    await jest.advanceTimersByTimeAsync(LAUNCH_HOLD_S * 1000 - 1);
    expect(d.hideSplash).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await done;
    expect(d.reload).not.toHaveBeenCalled();
    expect(d.hideSplash).toHaveBeenCalledTimes(1);
  });

  it('does not reload an update that arrives after the hold', async () => {
    const d = deps({
      fetchUpdate: () =>
        new Promise<boolean>(resolve =>
          setTimeout(() => resolve(true), (LAUNCH_HOLD_S + 1) * 1000),
        ),
    });
    const done = runLaunch(d);
    await jest.advanceTimersByTimeAsync((LAUNCH_HOLD_S + 2) * 1000);
    await done;
    expect(d.reload).not.toHaveBeenCalled();
    expect(d.hideSplash).toHaveBeenCalledTimes(1);
  });

  it('hides the splash at the backstop when the reload never settles', async () => {
    const d = deps({
      fetchUpdate: async () => true,
      reload: () => new Promise<void>(() => {}),
    });
    void runLaunch(d);
    await jest.advanceTimersByTimeAsync(
      (LAUNCH_HOLD_S + LAUNCH_BACKSTOP_S) * 1000,
    );
    expect(d.hideSplash).toHaveBeenCalledTimes(1);
  });

  it('hides the splash at the backstop when the reload resolves but the app does not restart', async () => {
    const d = deps({fetchUpdate: async () => true});
    const done = runLaunch(d);
    await jest.advanceTimersByTimeAsync(0);
    await done;
    expect(d.reload).toHaveBeenCalledTimes(1);
    expect(d.hideSplash).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(
      (LAUNCH_HOLD_S + LAUNCH_BACKSTOP_S) * 1000,
    );
    expect(d.hideSplash).toHaveBeenCalledTimes(1);
  });

  it('survives a hideSplash that rejects', async () => {
    const d = deps({
      hideSplash: async () => {
        throw new Error('no splash');
      },
    });
    await expect(runLaunch(d)).resolves.toBeUndefined();
  });
});
