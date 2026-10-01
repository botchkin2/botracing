import {describe, expect, it} from '@jest/globals';

import {
  toClassLaps,
  toLaps,
  toSessionDetail,
  toSessionSummary,
  toSessionTraffic,
  toTrackMap,
} from './adapters';
import {trackCorners} from './corners';

// Shape as served by GET /api/lmu/sessions on 2026-09-27.
const raw = {
  id: 'fd111c3353f7bcad',
  sim: 'lmu',
  trackId: 'lmu-daytona_international_speedway_road_course',
  track: {
    name: 'Daytona International Speedway',
    variant: 'Daytona International Speedway Road Course',
  },
  car: {name: 'Manthey DK Engineering 2026 #91:LM', class: 'GT3'},
  sessionType: 'Qualify',
  startedAt: '2026-09-26T03:20:57Z',
  lapCount: 2,
  comparableCount: 0,
  bestLapTime: null,
  medianLapTime: 101.5,
  updatedAt: '2026-09-27T20:02:17.985Z',
};

describe('toSessionSummary', () => {
  it('reads names from track and car objects', () => {
    const s = toSessionSummary(raw);
    expect(s.track).toBe('Daytona International Speedway');
    expect(s.car).toBe('Manthey DK Engineering 2026 #91:LM');
  });
  it('maps Race/Qualify/Practice to R/Q/P and keeps nulls', () => {
    const s = toSessionSummary(raw);
    expect(s.sessionType).toBe('Q');
    expect(s.bestTimeS).toBeNull();
    expect(s.medianTimeS).toBe(101.5);
  });
});

describe('toSessionSummary class laps', () => {
  const stats = {cars: 8, laps: 120, medianS: 215.4, p10S: 213, p90S: 219};

  it('carries the class pace the list serves, null without it', () => {
    expect(toSessionSummary(raw).classLaps).toBeNull();
    const s = toSessionSummary({
      ...raw,
      classLaps: {kind: 'race', classes: {gt3: stats}},
    });
    expect(s.classLaps).toEqual({
      kind: 'race',
      classes: {gt3: stats},
      startGapsS: null,
    });
  });
});

describe('toSessionDetail', () => {
  it('carries the field pointer, null when the session has none', () => {
    expect(toSessionDetail(raw).field).toBeNull();
    const d = toSessionDetail({
      ...raw,
      field: {hash: 'abc123def456', hz: 5, cars: 62, durationS: 931},
    });
    expect(d.field?.hash).toBe('abc123def456');
  });

  it('carries the corner slices pointer, null before the resync', () => {
    expect(toSessionDetail(raw).slices).toBeNull();
    const d = toSessionDetail({
      ...raw,
      slices: {hash: 'a1b2c3d4e5f6', corners: [1, 2, 4, 'x'], format: 1},
    });
    expect(d.slices).toEqual({hash: 'a1b2c3d4e5f6', corners: [1, 2, 4]});
  });

  it('takes the stint trend from consistency.stints, null when absent', () => {
    const d = toSessionDetail({
      ...raw,
      stints: [{n: 1}, {n: 2}],
      consistency: {stints: [{n: 2, trendPerLap: 0.042}]},
    });
    expect(d.stints.map(s => s.trendSPerLap)).toEqual([null, 0.042]);
  });
});

describe('toClassLaps', () => {
  const stats = {
    cars: 18,
    laps: 108,
    medianS: 96.94,
    p10S: 96.25,
    p90S: 102.58,
  };
  it('reads the kind and the classes it has, skipping a malformed one', () => {
    expect(
      toClassLaps({
        version: 1,
        kind: 'practice',
        classes: {hypercar: stats, gt3: {cars: 2}, other: 'x'},
      }),
    ).toEqual({
      kind: 'practice',
      classes: {hypercar: stats},
      startGapsS: null,
    });
  });
  it('keeps an empty doc as no classes, and reads nothing without a kind', () => {
    expect(toClassLaps({version: 1, kind: 'qualify', classes: null})).toEqual({
      kind: 'qualify',
      classes: null,
      startGapsS: null,
    });
    expect(toClassLaps({classes: {gt3: stats}})).toBeNull();
    expect(toClassLaps(undefined)).toBeNull();
    expect(toClassLaps(null)).toBeNull();
  });
  it('rides on the session detail', () => {
    const doc = {
      version: 2,
      kind: 'race',
      classes: {lmp2: stats},
      startGapsS: {
        hypercar: {firstS: 31.2, lastS: 26.4},
        gt3: {firstS: 5},
        lmp2: 'x',
      },
    };
    expect(toSessionDetail({...raw, classLaps: doc}).classLaps).toEqual({
      kind: 'race',
      classes: {lmp2: stats},
      startGapsS: {hypercar: {firstS: 31.2, lastS: 26.4}},
    });
    expect(toSessionDetail(raw).classLaps).toBeNull();
  });
});

describe('fuel facts', () => {
  it('reads the session fuel, null on an older session doc', () => {
    expect(toSessionDetail(raw).fuel).toBeNull();
    const d = toSessionDetail({
      ...raw,
      fuel: {startL: 84, fillLimitL: 84, tankL: 115},
    });
    expect(d.fuel).toEqual({
      startL: 84,
      fillLimitL: 84,
      tankL: 115,
      litresPerVePct: null,
      litresPerVePctStop: null,
    });
    expect(
      toSessionDetail({
        ...raw,
        fuel: {startL: 84, litresPerVePct: 0.81, litresPerVePctStop: 0.8},
      }).fuel,
    ).toMatchObject({litresPerVePct: 0.81, litresPerVePctStop: 0.8});
    // A recording without a setup string: the limits are null, the start stays.
    expect(
      toSessionDetail({...raw, fuel: {startL: 100, fillLimitL: null}}).fuel,
    ).toMatchObject({startL: 100, fillLimitL: null, tankL: null});
  });

  it('reads a lap fuel, null when the lap has none', () => {
    const [plain, withFuel] = toLaps([
      {id: 'a'},
      {
        id: 'b',
        fuel: {
          startL: 40,
          endL: 37.6,
          usedL: 2.4,
          addedL: 0,
          veStartPct: 50,
          veEndPct: 46.4,
          veUsedPct: 3.6,
          veAddedPct: 0,
          green: true,
        },
      },
    ]);
    expect(plain.fuel).toBeNull();
    expect(withFuel.fuel).toMatchObject({
      usedL: 2.4,
      veUsedPct: 3.6,
      green: true,
    });
  });

  it('reads a lap that is not green as not green', () => {
    const [lap] = toLaps([{id: 'a', fuel: {usedL: 2.4, veUsedPct: null}}]);
    expect(lap.fuel).toMatchObject({usedL: 2.4, veUsedPct: null, green: false});
  });
});

describe('pit stop tyres', () => {
  const stopWith = (tyres: unknown) =>
    toLaps([{id: 'a', pitStop: {tyres}}])[0].pitStop;
  it('reads the wheels of a stop, in car order, dropping unknown names', () => {
    expect(
      stopWith({changed: true, wheels: ['RR', 'FL', 'XX']})?.tyres,
    ).toEqual({
      changed: true,
      wheels: ['FL', 'RR'],
      entryPct: null,
      exitPct: null,
      coolDown: null,
      compound: null,
    });
    expect(stopWith({changed: false, wheels: []})?.tyres).toEqual({
      changed: false,
      wheels: [],
      entryPct: null,
      exitPct: null,
      coolDown: null,
      compound: null,
    });
  });
  it('reads the cool-down by wheel name and the compound of a full set', () => {
    const t = stopWith({
      changed: false,
      wheels: [],
      coolDown: {
        afterS: 45,
        rubberC: {FL: -9.5, FR: null, RL: -8, RR: 'x'},
        carcassC: {FL: -4, FR: -4.2, RL: -3.9, RR: -4.1},
        pressureKpa: {FL: -3, FR: -3.2, RL: -2.8, RR: null},
      },
      compound: 'other',
    })?.tyres;
    expect(t?.coolDown).toEqual({
      afterS: 45,
      rubberC: {FL: -9.5, FR: null, RL: -8, RR: null},
      carcassC: {FL: -4, FR: -4.2, RL: -3.9, RR: -4.1},
      pressureKpa: {FL: -3, FR: -3.2, RL: -2.8, RR: null},
    });
    expect(t?.compound).toBe('other');
    // A name no file carries is not read, and a half-written cool-down is none.
    expect(
      stopWith({changed: false, wheels: [], compound: 'Hard'})?.tyres?.compound,
    ).toBeNull();
    expect(
      stopWith({changed: false, wheels: [], coolDown: {afterS: 45}})?.tyres
        ?.coolDown,
    ).toBeNull();
  });
  it('reads the wear at pit entry and exit by wheel name', () => {
    const t = stopWith({
      changed: true,
      wheels: ['FR'],
      entryPct: {FL: 61.2, FR: 55.4, RL: 63, RR: null},
      exitPct: {FL: 61.2, FR: 100, RL: 63, RR: 'x'},
    })?.tyres;
    expect(t?.entryPct).toEqual({FL: 61.2, FR: 55.4, RL: 63, RR: null});
    expect(t?.exitPct).toEqual({FL: 61.2, FR: 100, RL: 63, RR: null});
  });
  it('is null before analysisVersion 15, and never changed without a wheel', () => {
    expect(stopWith(undefined)?.tyres).toBeNull();
    expect(stopWith('yes')?.tyres).toBeNull();
    expect(stopWith({changed: true, wheels: []})?.tyres).toEqual({
      changed: false,
      wheels: [],
      entryPct: null,
      exitPct: null,
      coolDown: null,
      compound: null,
    });
  });
});

describe('toTrackMap official turn labels', () => {
  const corners = [1, 2].map(n => ({
    n,
    entryM: n * 100,
    apexM: n * 100 + 50,
    exitM: n * 100 + 90,
    parts: [],
  }));
  const plain = (extra: Record<string, unknown>) =>
    toTrackMap({lengthM: 1000, corners, ...extra});

  it('carries the official label where tracks.json has one, and only there', () => {
    // Road Atlanta: the app's 7 and 8 are two parts of T7; 9, 10 and 11 are T10a, T10b and T12.
    const m = toTrackMap({
      trackId: 'lmu-michelin_raceway_road_atlanta',
      lengthM: 4000,
      corners: [1, 7, 8, 9, 10, 11].map(n => ({
        n,
        entryM: n * 100,
        apexM: n * 100 + 50,
        exitM: n * 100 + 90,
        parts: [],
      })),
    });
    expect(m.sections.map(s => s.official)).toEqual([
      undefined,
      'T7 entry',
      'T7',
      'T10a',
      'T10b',
      'T12',
    ]);
    expect(trackCorners(m).map(c => c.official)).toEqual([
      undefined,
      'T7 entry',
      'T7',
      'T10a',
      'T10b',
      'T12',
    ]);
  });

  it('leaves other tracks and missing ids as the app numbers them', () => {
    expect(
      plain({trackId: 'lmu-nowhere'}).sections[0].official,
    ).toBeUndefined();
    expect(plain({}).sections[1].official).toBeUndefined();
  });

  it('names a section range by its first and last official label', () => {
    const m = toTrackMap({
      trackId: 'lmu-michelin_raceway_road_atlanta',
      lengthM: 4000,
      corners: [
        {
          n: 5,
          entryM: 3300,
          apexM: 3520,
          exitM: 4000,
          parts: [9, 10, 11].map(n => ({
            n,
            entryM: 3300,
            apexM: 3520,
            exitM: 4000,
          })),
        },
      ],
    });
    expect(trackCorners(m)[0].sectionLabel).toBe('S5 (T10a–T12)');
  });
});

describe('toLaps tyres', () => {
  const lap = (changed: string[] | null) => ({
    id: 'l',
    lapTime: 90,
    tyres: {v: 1, changed},
  });

  it('reads the lap tyres and marks the lap after a change as the first on new tyres', () => {
    const laps = toLaps([lap([]), lap(['FR']), lap([]), lap(null)]);
    expect(laps[1].tyres?.changed).toEqual(['FR']);
    expect(laps.map(l => l.newTyres)).toEqual([false, false, true, false]);
  });

  it('has no tyres and no new-tyres flag on laps analysed before the block', () => {
    const laps = toLaps([
      {id: 'a', lapTime: 90},
      {id: 'b', lapTime: 90},
    ]);
    expect(laps.map(l => l.tyres)).toEqual([null, null]);
    expect(laps.map(l => l.newTyres)).toEqual([false, false]);
  });
});

describe('toSessionTraffic', () => {
  it('reads the clean and traffic sets', () => {
    expect(
      toSessionTraffic({
        v: 1,
        clean: {laps: 12, medianS: 81.5},
        traffic: {laps: 2, medianS: null},
      }),
    ).toEqual({
      v: 1,
      clean: {laps: 12, medianS: 81.5},
      traffic: {laps: 2, medianS: null},
    });
  });

  it('is null without a block or with a malformed one', () => {
    expect(toSessionTraffic(undefined)).toBeNull();
    expect(toSessionTraffic({v: 1, clean: {laps: 3}})).toBeNull();
  });
});

describe('lap traffic positions', () => {
  const lap = (traffic: unknown) =>
    toLaps([{id: 'a', lapTime: 20, comparable: true, reasons: [], traffic}])[0]
      .traffic!;

  it('reads spans, passes, overtakes and the field lap length', () => {
    const t = lap({
      aheadSpans: [{fromM: 100.5, toM: 180, s: 2.4}],
      blueSpans: [{fromM: 10, toM: 20, s: 0.2}],
      draftSpans: [{fromM: 300, toM: 380, s: 1.2}],
      passMarks: [{atM: 500, made: true}],
      overtakes: [{cls: 'Hyper', atM: 900}],
      fieldLapM: 5000,
    });
    expect(t.aheadSpans).toEqual([{fromM: 100.5, toM: 180, s: 2.4}]);
    expect(t.blueSpans).toEqual([{fromM: 10, toM: 20, s: 0.2}]);
    expect(t.draftSpans).toEqual([{fromM: 300, toM: 380, s: 1.2}]);
    expect(t.passMarks).toEqual([{atM: 500, made: true}]);
    expect(t.overtakes).toEqual([{cls: 'Hyper', atM: 900}]);
    expect(t.fieldLapM).toBe(5000);
  });

  it('is empty, and the lap length null, before traffic v3', () => {
    const t = lap({draftS: 1});
    expect(t.aheadSpans).toEqual([]);
    expect(t.draftSpans).toEqual([]);
    expect(t.passMarks).toEqual([]);
    expect(t.overtakes).toEqual([]);
    expect(t.fieldLapM).toBeNull();
  });

  it('drops a malformed span rather than drawing a wrong one', () => {
    expect(
      lap({
        aheadSpans: [[1, 2, 3], 'x', {fromM: 1, toM: 2, s: 'y'}, {fromM: 1}],
      }).aheadSpans,
    ).toEqual([]);
  });
});
