import {describe, expect, it} from '@jest/globals';

import races from './__fixtures__/raceLapStarts.json';
import {lapLabel, lapNoOf, lapRangeLabel} from './lapNumbering';

type LmuRace = {
  parts: [number, number, number][];
  resultLaps: [number, number, number | null][];
};

// The game's own lap for a part of his capture: 1 + the laps its results file
// says he had finished when the part began. A lap ends where the next starts,
// the last one at its start plus its time.
function resultsLapAt(race: LmuRace, t0: number): number {
  const ends = race.resultLaps.map(([, et, timeS], i) =>
    i + 1 < race.resultLaps.length
      ? race.resultLaps[i + 1][1]
      : et + (timeS ?? Infinity),
  );
  return 1 + ends.filter(end => end <= t0 + 0.5).length;
}

describe('lapNoOf: a race lap is numbered from the green flag', () => {
  const lmu = {
    silverstone: races['silverstone-2026-10-15'] as unknown as LmuRace,
    daytona: races['daytona-2026-10-07'] as unknown as LmuRace,
    sebring: races['sebring-2026-10-21'] as unknown as LmuRace,
  };

  it.each(Object.entries(lmu))(
    'LMU %s: every lap of the capture matches the results file',
    (_name: string, race: LmuRace) => {
      race.parts.forEach(([lapNumber, t0], i) => {
        expect(
          lapNoOf({sim: 'lmu', race: true, lapNumber, lapIndex: i + 1}),
        ).toBe(resultsLapAt(race, t0));
      });
    },
  );

  it('Silverstone: the counter is 0 at the green; the lap holding the formation and the start is L1', () => {
    const [first, second] = lmu.silverstone.parts;
    const [[, greenS]] = lmu.silverstone.resultLaps;
    expect(first[1] < greenS && greenS < first[2]).toBe(true);
    expect(lapNoOf({sim: 'lmu', race: true, lapNumber: first[0], lapIndex: 1})).toBe(1);
    expect(lapNoOf({sim: 'lmu', race: true, lapNumber: second[0], lapIndex: 2})).toBe(2);
  });

  it('Daytona 10-07: the capture starts in the pits on counter 1, after lap 1, so its first lap is L2', () => {
    const [[lapNumber, t0]] = lmu.daytona.parts;
    const [[, et, timeS]] = lmu.daytona.resultLaps;
    expect(lapNumber).toBe(1);
    expect(t0).toBeGreaterThan(et + (timeS ?? 0));
    expect(lapNoOf({sim: 'lmu', race: true, lapNumber, lapIndex: 1})).toBe(2);
  });

  it('Sebring 10-21: a capture that starts in the formation still starts at L1', () => {
    const [[lapNumber, t0, t1]] = lmu.sebring.parts;
    const [[, greenS]] = lmu.sebring.resultLaps;
    expect(t0 < greenS && greenS < t1).toBe(true);
    expect(lapNoOf({sim: 'lmu', race: true, lapNumber, lapIndex: 1})).toBe(1);
  });

  it('iRacing Road Atlanta 08-27: the counter turns 1 at the line after the green; the lap before is the formation', () => {
    const race = races['iracing-road-atlanta-2026-08-27'] as unknown as {
      greenS: number;
      lapChanges: [number, number][];
    };
    // The sim's counter from the line, without its 5 s bump in the parade.
    const parts = race.lapChanges.filter(([, t]) => t < 172 || t > 178);
    const green = race.greenS;
    for (const [lapNumber, t] of parts) {
      const crossed = parts.filter(([n, at]) => n > 0 && at >= green && at <= t).length;
      expect(lapNoOf({sim: 'iracing', race: true, lapNumber, lapIndex: 0})).toBe(
        crossed === 0 ? null : crossed,
      );
    }
  });

  it('practice and qualifying keep the place in driving order', () => {
    expect(lapNoOf({sim: 'lmu', race: false, lapNumber: 6, lapIndex: 3})).toBe(3);
    expect(lapNoOf({sim: 'iracing', race: false, lapNumber: 0, lapIndex: 1})).toBe(1);
  });

  it('a race lap doc with no counter keeps its place', () => {
    expect(lapNoOf({sim: 'lmu', race: true, lapNumber: null, lapIndex: 4})).toBe(4);
  });
});

describe('lapLabel', () => {
  it('names the formation and racing laps', () => {
    expect(lapLabel(null)).toBe('Formation');
    expect(lapLabel(1)).toBe('L1');
    expect(lapRangeLabel(1, 14)).toBe('L1–L14');
    expect(lapRangeLabel(7, 7)).toBe('L7');
  });
});
