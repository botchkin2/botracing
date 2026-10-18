import {describe, expect, it} from '@jest/globals';

import {type Uploader} from './adapters';

import {updateReady} from './updateReady';

const NOW = Date.parse('2026-10-15T03:00:00Z');
const pc = (over: Partial<Uploader>): Uploader =>
  ({
    hostId: 'h',
    host: 'Race PC',
    version: '0.1.11',
    lastSeenAt: NOW - 60_000,
    updateWaiting: null,
    ...over,
  } as Uploader);

describe('updateReady', () => {
  it('names the waiting version, with a button only inside the tray window', () => {
    const pcs = [pc({updateWaiting: '0.1.12'})];
    expect(updateReady(pcs, NOW, true)).toEqual({
      version: '0.1.12',
      line: 'Update 0.1.12 ready',
      canRestart: true,
    });
    expect(updateReady(pcs, NOW, false)).toEqual({
      version: '0.1.12',
      line: 'Update 0.1.12 ready on the PC',
      canRestart: false,
    });
  });

  it('shows nothing with no update, no PCs, or while loading', () => {
    expect(updateReady([pc({})], NOW, true)).toBeNull();
    expect(updateReady([], NOW, true)).toBeNull();
    expect(updateReady(undefined, NOW, true)).toBeNull();
  });

  it('ignores a PC not seen for 10 minutes', () => {
    expect(
      updateReady(
        [pc({updateWaiting: '0.1.12', lastSeenAt: NOW - 11 * 60_000})],
        NOW,
        true,
      ),
    ).toBeNull();
  });

  it('with several PCs takes the highest waiting version', () => {
    const pcs = [
      pc({hostId: 'a', updateWaiting: '0.1.12'}),
      pc({hostId: 'b', updateWaiting: '0.2.0'}),
      pc({hostId: 'c', updateWaiting: null}),
    ];
    expect(updateReady(pcs, NOW, false)?.version).toBe('0.2.0');
  });
});
