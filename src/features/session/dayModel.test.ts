import {describe, expect, it} from '@jest/globals';

// Adapters are internal to data/; tests may reach them to build real shapes.
import {toLaps, toSessionDetail} from '@/src/data/sessions/adapters';
import {dayLapSet, splitDayLapId} from '@/src/data/sessions/lapSet';
import {formatLapTime} from '@/src/design';

import fixture from './__fixtures__/roadAtlantaRace.json';
import {buildSessionModel, type LapRowModel} from './model';

// A day made of two copies of the Road Atlanta race fixture, as two sessions.
const detail = (id: string, startedAt: string) => ({
  ...toSessionDetail({...fixture.session, id, startedAt}),
  stale: false,
});
const members = [
  {
    session: detail('a', '2026-09-26T20:00:00'),
    laps: toLaps(fixture.laps),
  },
  {
    session: detail('b', '2026-09-26T22:00:00'),
    laps: toLaps(fixture.laps),
  },
];
const day = dayLapSet(members);
const selection = {laps: day.openingIds, ref: null, hl: null};
const model = buildSessionModel(
  day.members[0],
  day.laps,
  selection,
  null,
  'turns',
  day,
);

describe('a day as the set of laps', () => {
  it('names a day and its sessions, and counts every lap of both', () => {
    expect(model.title).toBe('Day · Race · Road Atlanta');
    expect(model.subtitle).toMatch(/ · 2 sessions$/);
    expect(model.facts.find(f => f.label === 'Laps')?.value).toBe(
      String(members[0].laps.length * 2),
    );
  });

  it('leaves out the session cards: fuel, tyres, pit review, field, energy', () => {
    expect(model.tires).toBeNull();
    expect(model.pitCard).toBeNull();
    expect(model.fuelUse).toBeNull();
    expect(model.energy).toBeNull();
    expect(model.classTable).toBeNull();
    expect(model.rebuilt).toBeNull();
    expect(model.planVsRace).toBeNull();
    expect(model.rows.filter(r => r.kind === 'note')).toEqual([]);
  });

  it('names a stint by when its session began and opens that session', () => {
    const stints = model.rows.filter(r => r.kind === 'stint');
    expect(stints.length).toBeGreaterThan(1);
    expect(stints[0].label).toMatch(/^\d\d:\d\d · L1–/);
    expect(new Set(stints.map(s => s.kind === 'stint' && s.sessionId))).toEqual(
      new Set(['a', 'b']),
    );
  });

  it('keys every lap row by the merged id, and the best lap is the fastest of the day', () => {
    const rows = model.rows.filter((r): r is LapRowModel => r.kind === 'lap');
    expect(rows.every(r => r.lapId.includes('~'))).toBe(true);
    expect(splitDayLapId(rows[0].lapId)).toEqual({
      sessionId: 'a',
      lapId: expect.any(String),
    });
    const best = Math.min(
      ...day.laps
        .filter(l => l.comparable && l.timeS != null)
        .map(l => l.timeS as number),
    );
    expect(model.facts.find(f => f.label === 'Best')?.value).toBe(
      formatLapTime(best),
    );
  });
});
