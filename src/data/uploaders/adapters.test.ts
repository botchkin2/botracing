import {describe, expect, it} from '@jest/globals';

import {toUploader} from './adapters';

describe('toUploader', () => {
  it('reads a full heartbeat, times as ISO or epoch ms', () => {
    const u = toUploader({
      hostId: 'rig',
      label: 'Race PC',
      version: '0.3.1',
      lmuFound: true,
      state: 'syncing',
      lastSeenAt: '2026-09-28T20:00:00Z',
      lastUploadAt: 1790000000000,
      lastSessionId: 'bc1d',
      queue: 2,
      sessionsDone: 14,
      problems: [
        {kind: 'not-seen', at: '2026-09-25T19:00:00Z'},
        {
          kind: 'session-failed',
          at: '2026-09-28T19:00:00Z',
          message: 'HTTP 413',
          sessionId: '4dda01bc58a237af',
          count: 2,
          retryAt: 1790000000000,
        },
        {kind: 'from-the-future', at: null, message: 'x'},
      ],
      disk: {captureBytes: 5e9, freeBytes: 2e11},
      recorder: {
        state: 'refused',
        gameVersion: 1234,
        layoutOk: false,
        layoutReason: 'x',
      },
    });
    expect(u.recorder).toEqual({
      state: 'refused',
      gameVersion: '1234',
      layoutOk: false,
      layoutReason: 'x',
      lastChunkAt: null,
      updatedAt: null,
    });
    expect(u.lastSeenAt).toBe(Date.parse('2026-09-28T20:00:00Z'));
    expect(u.lastUploadAt).toBe(1790000000000);
    expect(u.state).toBe('syncing');
    expect(u.host).toBe('Race PC');
    expect(u.problems).toEqual([
      {
        kind: 'not-seen',
        at: Date.parse('2026-09-25T19:00:00Z'),
        message: '',
        sessionId: null,
        count: null,
        retryAt: null,
      },
      {
        kind: 'session-failed',
        at: Date.parse('2026-09-28T19:00:00Z'),
        message: 'HTTP 413',
        sessionId: '4dda01bc58a237af',
        count: 2,
        retryAt: 1790000000000,
      },
    ]);
    expect(u.disk?.captureBytes).toBe(5e9);
  });

  it('defaults what is missing, and unknown states to idle', () => {
    const u = toUploader({id: 'rig', state: 'dancing'});
    expect(u).toMatchObject({
      hostId: 'rig',
      host: 'rig',
      state: 'idle',
      lmuFound: null,
      lastSeenAt: null,
      queue: 0,
      problems: [],
      disk: null,
      recorder: null,
    });
  });

  it('reads resync progress, and drops a malformed one', () => {
    expect(
      toUploader({id: 'rig', progress: {done: 3, total: 9}}).progress,
    ).toEqual({done: 3, total: 9});
    expect(toUploader({id: 'rig', progress: null}).progress).toBeNull();
    expect(toUploader({id: 'rig', progress: {done: 3}}).progress).toBeNull();
    expect(
      toUploader({id: 'rig', progress: {done: 0, total: 0}}).progress,
    ).toBeNull();
    // A finished resync left behind is not "in progress".
    expect(
      toUploader({id: 'rig', progress: {done: 364, total: 364}}).progress,
    ).toBeNull();
  });

  it('keeps the surface phase, and drops a finished fold like a finished resync', () => {
    expect(
      toUploader({id: 'rig', progress: {done: 7, total: 13, phase: 'surface'}})
        .progress,
    ).toEqual({done: 7, total: 13, phase: 'surface'});
    expect(
      toUploader({id: 'rig', progress: {done: 13, total: 13, phase: 'surface'}})
        .progress,
    ).toBeNull();
    expect(
      toUploader({id: 'rig', progress: {done: 7, total: 13, phase: 'other'}})
        .progress,
    ).toEqual({done: 7, total: 13});
  });

  it('reads the retry time and the retrying state', () => {
    const u = toUploader({
      id: 'rig',
      state: 'retrying',
      retryAt: '2026-09-28T21:30:00Z',
    });
    expect(u.state).toBe('retrying');
    expect(u.retryAt).toBe(Date.parse('2026-09-28T21:30:00Z'));
    expect(toUploader({id: 'rig'}).retryAt).toBeNull();
  });

  it('throws without a host id', () => {
    expect(() => toUploader({host: 'x'})).toThrow('hostId');
  });
});
