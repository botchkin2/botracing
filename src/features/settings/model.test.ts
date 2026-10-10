import {describe, expect, it} from '@jest/globals';

import {type Uploader, type UploaderProblem} from '@/src/data/uploaders';

import {
  buildSettingsModel,
  formatAgo,
  formatBytes,
  problemRows,
  problemText,
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
  progress: null,
  retryAt: null,
  sessionsDone: 14,
  problems: [],
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
  });

  it('says when a failed session is tried again, not error', () => {
    const c = uploaderCard(
      rig({state: 'retrying', retryAt: NOW + 30 * min}),
      NOW,
    );
    expect(c.status).toMatch(/^Retrying at \d{2}:\d{2} · seen 2 min ago$/);
  });

  it('says how far a resync is', () => {
    const c = uploaderCard(rig({progress: {done: 120, total: 364}}), NOW);
    expect(c.status).toBe('Re-analysing 120 / 364 · seen 2 min ago');
  });

  it('says the track maps are updating once the sessions are done', () => {
    const c = uploaderCard(
      rig({progress: {done: 7, total: 13, phase: 'surface'}}),
      NOW,
    );
    expect(c.status).toBe('Updating track maps 7 / 13 · seen 2 min ago');
  });

  it('is grey past 10 min, and says how long, never red', () => {
    const c = uploaderCard(rig({lastSeenAt: NOW - 3 * 24 * 60 * min}), NOW);
    expect(c.dot).toBe('unseen');
    expect(c.status).toBe('Not seen for 3 days');
    expect(uploaderCard(rig({lastSeenAt: null}), NOW).status).toBe(
      'Not seen yet',
    );
  });

  it('leaves a recorder that stopped writing to Problems, not the card', () => {
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
    expect(c.lines.some(l => l.startsWith('Recorder'))).toBe(false);
  });
});

const problem = (over: Partial<UploaderProblem>): UploaderProblem => ({
  kind: 'session-failed',
  at: NOW - 5 * min,
  message: 'HTTP 413',
  sessionId: '4dda01bc58a237af',
  count: 3,
  retryAt: null,
  ...over,
});

describe('problems', () => {
  it('reads as data: what, why, how often', () => {
    expect(
      problemText(
        problem({
          kind: 'uploader-stopped',
          message: 'exit code: 1: Error: no file',
          sessionId: null,
        }),
      ),
    ).toBe('Uploader stopped · exit code: 1: Error: no file · 3×');
    expect(problemText(problem({}))).toBe('Session 4dda01bc · HTTP 413 · 3×');
    expect(problemText(problem({count: 1}))).toBe(
      'Session 4dda01bc · HTTP 413',
    );
    expect(problemText(problem({retryAt: NOW + 30 * min}))).toMatch(
      /^Session 4dda01bc · HTTP 413 · 3× · retry \d{2}:\d{2}$/,
    );
    expect(
      problemText(
        problem({
          kind: 'sync-crashed',
          message: 'sync crashed: RangeError: x',
          sessionId: null,
        }),
      ),
    ).toBe('Sync crashed · RangeError: x');
    expect(
      problemText(
        problem({
          kind: 'recorder-layout',
          message: 'header size 312',
          sessionId: null,
        }),
      ),
    ).toBe('Recorder stopped · header size 312');
    expect(
      problemText(
        problem({
          kind: 'not-seen',
          at: Date.parse('2026-10-01T12:00:00Z'),
          message: '',
          sessionId: null,
        }),
      ),
    ).toBe('Not seen since 1 Oct');
  });

  it('lists every PC, names the PC only when there are several, and links sessions', () => {
    const one = rig({problems: [problem({})]});
    expect(problemRows([one])).toEqual([
      {
        key: 'RIG:session-failed:4dda01bc58a237af',
        text: 'Session 4dda01bc · HTTP 413 · 3×',
        sessionId: '4dda01bc58a237af',
      },
    ]);
    const two = rig({
      hostId: 'SIM',
      host: 'Sim PC',
      problems: [
        problem({kind: 'recorder-layout', message: 'x', sessionId: null}),
      ],
    });
    expect(problemRows([one, two]).map(r => [r.text, r.sessionId])).toEqual([
      ['RIG · Session 4dda01bc · HTTP 413 · 3×', '4dda01bc58a237af'],
      ['Sim PC · Recorder stopped · x', null],
    ]);
  });

  it('is empty when all is well, and in the model only once the PCs are read', () => {
    const model = (
      uploaders: Parameters<typeof buildSettingsModel>[0]['uploaders'],
    ) => buildSettingsModel({uploaders, version: '1', nowMs: NOW}).problems;
    expect(model({state: 'ready', items: [rig()]})).toEqual([]);
    expect(model({state: 'loading'})).toEqual([]);
    expect(
      model({state: 'ready', items: [rig({problems: [problem({})]})]}),
    ).toHaveLength(1);
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

  it('trusts the state the uploader wrote, however old updatedAt is', () => {
    const c = uploaderCard(
      rig({
        recorder: {
          state: 'recording',
          gameVersion: '1.2',
          layoutOk: true,
          layoutReason: null,
          lastChunkAt: null,
          updatedAt: NOW - 4 * min,
        },
      }),
      NOW,
    );
    expect(c.lines).toContain('Recorder recording · LMU 1.2');
  });

  it("the uploader's not-running state reads as not running", () => {
    const c = uploaderCard(
      rig({
        recorder: {
          state: 'not-running',
          gameVersion: null,
          layoutOk: true,
          layoutReason: null,
          lastChunkAt: null,
          updatedAt: NOW - 10 * min,
        },
      }),
      NOW,
    );
    expect(c.lines).toContain('Recorder not running');
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
