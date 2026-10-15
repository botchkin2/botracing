import {describe, expect, it, jest} from '@jest/globals';

import {trayRestart} from './trayRestart';

describe('trayRestart', () => {
  it('is null outside the tray window', () => {
    expect(trayRestart(undefined)).toBeNull();
    expect(trayRestart({})).toBeNull();
  });

  it('asks the tray by its command and resolves to null, or to why not', async () => {
    const invoke = jest.fn(async (_command: string) => null);
    const restart = trayRestart({__TAURI_INTERNALS__: {invoke}});
    expect(await restart?.()).toBeNull();
    expect(invoke).toHaveBeenCalledWith('restart_to_update');
    const refused = trayRestart({
      __TAURI_INTERNALS__: {
        invoke: async () => {
          throw 'no update is waiting';
        },
      },
    });
    expect(await refused?.()).toBe('no update is waiting');
  });
});
