import {describe, expect, it} from '@jest/globals';

import {type Uploader} from '@/src/data/uploaders';

import {
  buildSettingsModel,
  formatAgo,
  formatBytes,
  uploaderCard,
} from './model';

const NOW = Date.parse('2026-09-28T22:00:00Z');
const min = 60_000;

const rig = (over: Partial<Uploader> = {}): Uploader => ({
  hostId: 'RIG',
  host: 'RIG',
  version: '0.3.1',
  lmuFound: true,
  state: 'syncing',
  lastSeenAt: NOW - 2 * min,
  lastUploadAt: NOW - 30 * min,
  lastSessionId: 'bc1d5cd65e511410',
  queue: 2,
  sessionsDone: 14,
  lastError: null,
  disk: {captureBytes: 5.04e9, freeBytes: 2.1e11},
  recorder: {
    state: 'recording',
    gameVersion: '1.2',
    layoutOk: true,
    layoutReason: null,
    lastChunkAt: null,
    updatedAt: NOW - 5000,
  },
  ...over,
});

describe('uploaderCard', () => {
  it('is green within 10 min, with its state and details', () => {
    const c = uploaderCard(rig(), NOW);
    expect(c.dot).toBe('connected');
    expect(c.subtitle).toBe('v0.3.1 · LMU found');
    expect(c.status).toBe('Syncing · seen 2 min ago');
    expect(c.lines).toEqual([
      'Last upload 30 min ago · session bc1d5cd6',
      '14 sessions uploaded · 2 queued',
      'Capture 5.0 GB · 210 GB free',
      'Recorder recording · LMU 1.2',
    ]);
    expect(c.recorderWarning).toBeNull();
  });

  it('is grey past 10 min, and says how long, never red', () => {
    const c = uploaderCard(rig({lastSeenAt: NOW - 3 * 24 * 60 * min}), NOW);
    expect(c.dot).toBe('unseen');
    expect(c.status).toBe('Not seen for 3 days');
    expect(uploaderCard(rig({lastSeenAt: null}), NOW).status).toBe(
      'Not seen yet',
    );
  });

  it('shows the last error with its path', () => {
    const c = uploaderCard(
      rig({lastError: {at: NOW - 5 * min, message: 'EBUSY', path: 'D:/cap'}}),
      NOW,
    );
    expect(c.error).toEqual({
      message: 'EBUSY',
      path: 'D:/cap',
      when: '5 min ago',
    });
  });

  it('warns when a game update broke the recorder layout', () => {
    const c = uploaderCard(
      rig({
        recorder: {
          state: 'refused',
          gameVersion: '1.3',
          layoutOk: false,
          layoutReason: 'header size 312, expected 304',
          lastChunkAt: null,
          updatedAt: NOW,
        },
      }),
      NOW,
    );
    expect(c.recorderWarning).toBe(
      'Recorder stopped writing on LMU 1.3: header size 312, expected 304.',
    );
    expect(c.lines.some(l => l.startsWith('Recorder'))).toBe(false);
  });
});

describe('recorder freshness', () => {
  it('a fresh recorder with no game running reads as waiting for LMU', () => {
    const c = uploaderCard(
      rig({
        recorder: {
          state: 'no-game',
          gameVersion: null,
          layoutOk: true,
          layoutReason: null,
          lastChunkAt: null,
          updatedAt: NOW - 20_000,
        },
      }),
      NOW,
    );
    expect(c.lines).toContain('Recorder waiting for LMU');
  });

  it('a recorder that stopped reporting reads as not running', () => {
    const c = uploaderCard(
      rig({
        recorder: {
          state: 'recording',
          gameVersion: '1.2',
          layoutOk: true,
          layoutReason: null,
          lastChunkAt: null,
          updatedAt: NOW - 5 * min,
        },
      }),
      NOW,
    );
    expect(c.lines).toContain('Recorder not running · LMU 1.2');
  });
});

describe('buildSettingsModel', () => {
  it('none reported is its own state', () => {
    const m = buildSettingsModel({
      uploaders: {state: 'ready', items: []},
      version: '1.0.0',
      nowMs: NOW,
    });
    expect(m.uploaders).toEqual({state: 'none'});
  });
  it('most recently seen first', () => {
    const m = buildSettingsModel({
      uploaders: {
        state: 'ready',
        items: [
          rig({hostId: 'OLD', host: 'OLD', lastSeenAt: NOW - 60 * min}),
          rig(),
        ],
      },
      version: '1.0.0',
      nowMs: NOW,
    });
    expect(
      m.uploaders.state === 'ready' && m.uploaders.cards.map(c => c.hostId),
    ).toEqual(['RIG', 'OLD']);
  });
});

describe('formatters', () => {
  it('ago and bytes', () => {
    expect(formatAgo(NOW - 20_000, NOW)).toBe('just now');
    expect(formatAgo(NOW - 5 * 60 * min, NOW)).toBe('5 h');
    expect(formatBytes(830e6)).toBe('830 MB');
    expect(formatBytes(2.1e11)).toBe('210 GB');
  });
});
