import {describe, expect, it} from '@jest/globals';

import raceFixture from '@/src/features/session/__fixtures__/roadAtlantaRace.json';

import {toLaps, toSessionDetail} from './adapters';
import {
  defaultLapIds,
  defaultSessionOf,
  referenceDefaultLapIds,
} from './defaultLaps';
import planFixture from './__fixtures__/planRace.json';

// The lap selection algorithm is protected (decisions/lap/2026-10-15-lap-
// selection-protected.md). Off-track time is one of its inputs (a lap that went
// off is not the fairest reference), and the track-limits work (thread 70)
// deleted the OFF verdict from the screens but not that input. These pin what
// the default selection picks on the real sessions we hold, so a change to
// the input shows here and not in a user's compare.
const cases = [
  [
    'Road Atlanta race 2026-09-26',
    raceFixture,
    {withOff: 18, defaultIds: ['020', '007'], referenceIds: ['002', '014']},
  ],
  [
    'plan race fixture',
    planFixture,
    {withOff: 0, defaultIds: ['013', '016'], referenceIds: ['013', '010']},
  ],
] as const;

describe('default lap selection on the held sessions', () => {
  for (const [name, fixture, expected] of cases) {
    it(`${name}`, () => {
      const session = toSessionDetail(fixture.session as never);
      const laps = toLaps(fixture.laps as never);
      const s = defaultSessionOf(session);
      expect({
        withOff: laps.filter(l => l.offTrackS > 0).length,
        defaultIds: defaultLapIds(laps, session.bestLapId).map(id =>
          id.slice(-3),
        ),
        referenceIds: referenceDefaultLapIds(laps, s).map(id => id.slice(-3)),
      }).toEqual(expected);
    });
  }
});

describe('off-track time is an input of the reference ranking', () => {
  it('the fairest reference for the race median is another lap once no lap went off', () => {
    const session = toSessionDetail(raceFixture.session as never);
    const laps = toLaps(raceFixture.laps as never);
    const clean = laps.map(l => ({...l, offTrackS: 0}));
    const s = defaultSessionOf(session);
    const ids = (ls: typeof laps) =>
      referenceDefaultLapIds(ls, s).map(id => id.slice(-3));
    expect(ids(laps)).toEqual(['002', '014']);
    expect(ids(clean)).not.toEqual(ids(laps));
  });
});
