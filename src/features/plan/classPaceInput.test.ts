import {describe, expect, it} from '@jest/globals';

import {type SessionClassLaps, type SessionSummary} from '@/src/data/sessions';
import {type Combo} from '@/src/workspace/planCombo';

import {classPaceInput} from './classPaceInput';

// A frozen clock: the stats window starts 183 days before it, 29 Apr 2026 (ticket 79).
const NOW = new Date('2026-10-29T12:00:00Z');

const stats = {cars: 6, laps: 90, medianS: 100, p10S: 98, p90S: 103};

const doc = (over: Partial<SessionClassLaps> = {}): SessionClassLaps => ({
  version: 6,
  kind: 'race',
  classes: {hypercar: stats},
  startGapsS: null,
  player: null,
  ...over,
});

const summary = (
  id: string,
  over: Partial<SessionSummary> = {},
): SessionSummary => ({
  id,
  sim: 'lmu',
  trackId: 'lmu-daytona',
  track: 'Daytona',
  car: '911 GT3 R',
  carClass: 'GT3',
  sessionType: 'R',
  startedAt: '2026-10-01T20:00:00Z',
  lapCount: 10,
  comparableCount: 8,
  bestTimeS: 108,
  medianTimeS: 110,
  bestLapId: null,
  series: null,
  classLaps: doc(),
  finish: null,
  eventId: null,
  online: null,
  endedAt: null,
  cornerMapSource: 'stored',
  updatedAt: '2026-10-01T20:00:00Z',
  ...over,
});

const comboOf = (sessions: SessionSummary[], sim = 'lmu'): Combo => ({
  key: `lmu-daytona|911 GT3 R`,
  sim,
  trackId: 'lmu-daytona',
  track: 'Daytona',
  label: 'Daytona · 911 GT3 R',
  car: '911 GT3 R',
  sessions,
});

describe('classPaceInput', () => {
  it('pools races and practices at the track in the same sim, whatever car', () => {
    const mine = summary('a');
    const input = classPaceInput({
      combo: comboOf([mine]),
      sessions: [
        mine,
        summary('lmp2-car', {car: 'Oreca 07', carClass: 'LMP2'}),
        summary('practice', {
          sessionType: 'P',
          classLaps: doc({kind: 'practice'}),
        }),
        summary('quali', {sessionType: 'Q'}),
        summary('other-track', {trackId: 'lmu-spa'}),
        summary('iracing', {sim: 'iracing'}),
      ],
      plan: null,
      chosen: null,
      now: NOW,
    });
    expect(input.sessions.map(s => s.kind)).toEqual([
      'race',
      'race',
      'practice',
    ]);
  });

  it("takes his class from the field's flag first (iRacing short names say little)", () => {
    const flagged = summary('ir', {
      sim: 'iracing',
      carClass: 'IMSA23',
      classLaps: doc({player: 'gt3'}),
    });
    const input = classPaceInput({
      combo: comboOf([flagged], 'iracing'),
      sessions: [flagged],
      plan: null,
      chosen: null,
      now: NOW,
    });
    expect(input.mine.key).toBe('gt3');
  });

  it("falls back to the car's class when no doc flags the player (LMU before version 6)", () => {
    const lmu = summary('lmu', {
      carClass: 'LMGT3',
      classLaps: doc({version: 5}),
    });
    const input = classPaceInput({
      combo: comboOf([lmu]),
      sessions: [lmu],
      plan: null,
      chosen: null,
      now: NOW,
    });
    expect(input.mine.key).toBe('gt3');
    expect(input.sessions).toHaveLength(1);
  });

  it('a car he has not driven here has no class and no median', () => {
    const input = classPaceInput({
      combo: comboOf([]),
      sessions: [summary('someone')],
      plan: null,
      chosen: null,
      now: NOW,
    });
    expect(input.mine).toEqual({
      key: null,
      medianLapS: null,
      laps: 0,
      sessions: 0,
    });
    expect(input.sessions).toHaveLength(1);
  });

  it("uses the plan's median and race when there is a plan, the slider's stops over the plan's", () => {
    const s = summary('a');
    const plan = {
      medianLapS: 109.2,
      greenLaps: 40,
      sessions: 3,
      raceLaps: 30,
      stopsAfter: [15],
    };
    expect(
      classPaceInput({
        combo: comboOf([s]),
        sessions: [s],
        plan,
        chosen: null,
        now: NOW,
      }),
    ).toMatchObject({
      mine: {medianLapS: 109.2, laps: 40, sessions: 3},
      raceLaps: 30,
      stopsAfter: [15],
    });
    expect(
      classPaceInput({
        combo: comboOf([s]),
        sessions: [s],
        plan,
        chosen: {raceLaps: 31, stopsAfter: [14]},
        now: NOW,
      }),
    ).toMatchObject({raceLaps: 31, stopsAfter: [14]});
  });

  it('a plan with no green laps under its rules falls back to his sessions', () => {
    const sessions = [summary('a', {medianTimeS: 110})];
    const plan = {
      medianLapS: null,
      greenLaps: 0,
      sessions: 0,
      raceLaps: 30,
      stopsAfter: [],
    };
    expect(
      classPaceInput({
        combo: comboOf(sessions),
        sessions,
        plan,
        chosen: null,
        now: NOW,
      }).mine,
    ).toMatchObject({medianLapS: 110, laps: 8, sessions: 1});
  });

  it('without a plan (no fuel rules) his median is the median of his newest sessions', () => {
    const sessions = [
      summary('a', {medianTimeS: 110}),
      summary('b', {medianTimeS: 112, comparableCount: 5}),
      summary('c', {medianTimeS: null, comparableCount: 0}),
    ];
    expect(
      classPaceInput({
        combo: comboOf(sessions),
        sessions,
        plan: null,
        chosen: null,
        now: NOW,
      }).mine,
    ).toMatchObject({medianLapS: 111, laps: 13, sessions: 2});
  });
  it('pools only the field sessions inside the stats window, and labels the window', () => {
    const recent = summary('recent', {startedAt: '2026-08-01T20:00:00Z'});
    const old = summary('old', {startedAt: '2026-03-01T20:00:00Z'});
    const input = classPaceInput({
      combo: comboOf([recent]),
      sessions: [recent, old],
      plan: null,
      chosen: null,
      now: NOW,
    });
    expect(input.sessions).toHaveLength(1);
    expect(input.window?.since).toMatch(/^since Apr 2[89]$/);
    expect(input.window?.olderText).toBeNull();
  });

  it('says so when the only field sessions here are older than the window', () => {
    const old = summary('old', {startedAt: '2026-03-01T20:00:00Z'});
    const input = classPaceInput({
      combo: comboOf([old]),
      sessions: [old],
      plan: null,
      chosen: null,
      now: NOW,
    });
    expect(input.sessions).toEqual([]);
    expect(input.window?.olderText).toMatch(
      /^Nothing since Apr 2[89]\. Older sessions are in the list$/,
    );
    // a track with no field at all is not "older": no text
    const none = classPaceInput({
      combo: comboOf([]),
      sessions: [summary('quali', {sessionType: 'Q'})],
      plan: null,
      chosen: null,
      now: NOW,
    });
    expect(none.window?.olderText).toBeNull();
  });
});
