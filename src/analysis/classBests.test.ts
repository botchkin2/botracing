import {describe, expect, it} from '@jest/globals';

import {
  CLASS_BESTS_VERSION,
  classBestsCurrent,
  classBestsDoc,
  classLapsDoc,
  type EncodedField,
} from './classLaps';

const DT = 0.2;
const L = 4000;

type Spec = {
  class: string;
  lapS: number;
  offsetM: number;
  vehicle?: string | null;
  player?: boolean;
};

// A field file: each car drives at a steady speed, lap distance wrapping at L,
// decimetre deltas as the uploader writes them.
function build(specs: Spec[], updates: number): EncodedField {
  const dist = specs.map(s => {
    let last = 0;
    return Array.from({length: updates}, (_, u) => {
      const v = Math.round(((s.offsetM + ((u * DT) / s.lapS) * L) % L) * 10);
      const d = v - last;
      last = v;
      return d;
    });
  });
  return {
    hz: 5,
    tDs: Array.from({length: updates}, (_, u) => Math.round(u * DT * 10)),
    cars: specs.map(s => ({
      class: s.class,
      player: s.player,
      ...(s.vehicle !== undefined && {vehicle: s.vehicle}),
    })),
    lapDistDm: dist,
    inPits: specs.map(() => Array.from({length: updates}, () => 0)),
    flag: specs.map(() => Array.from({length: updates}, () => 0)),
  };
}

// 6 laps of the slowest car: every car crosses the line at least 4 times.
const UPDATES = Math.round((6 * 100) / DT);

const field = build(
  [
    {
      class: 'GT3',
      lapS: 100,
      offsetM: 100,
      vehicle: 'Porsche 911 GT3 R',
      player: true,
    },
    {class: 'GT3', lapS: 98, offsetM: 900, vehicle: 'BMW M4 LMGT3'},
    {class: 'GT3', lapS: 99, offsetM: 1700, vehicle: 'BMW M4 LMGT3'},
    {class: 'Hyper', lapS: 80, offsetM: 300, vehicle: 'Cadillac V-Series.R'},
    {class: 'Hyper', lapS: 82, offsetM: 2300, vehicle: null},
    {class: 'Hyper', lapS: 81, offsetM: 3100},
  ],
  UPDATES,
);

describe('classBestsDoc', () => {
  const doc = classBestsDoc(field, 'Race');

  it('lists each car once per class, fastest first', () => {
    const gt3 = doc.classes.gt3!;
    expect(Object.keys(gt3).sort()).toEqual(['bestsS', 'player', 'vehicleAt']);
    expect(gt3.bestsS).toEqual([98, 99, 100]);
    const hyper = doc.classes.hypercar!;
    expect(hyper.bestsS).toEqual([80, 81, 82]);
  });

  it('names the car models once, and -1 where the recorder had none', () => {
    expect(doc.vehicles.sort()).toEqual([
      'BMW M4 LMGT3',
      'Cadillac V-Series.R',
      'Porsche 911 GT3 R',
    ]);
    const gt3 = doc.classes.gt3!;
    // The two BMWs share one table entry.
    expect(gt3.vehicleAt[0]).toBe(gt3.vehicleAt[1]);
    const hyper = doc.classes.hypercar!;
    expect(hyper.vehicleAt.map(v => v === -1)).toEqual([false, true, true]);
  });

  it("marks the player's place in their own class and in no other", () => {
    expect(doc.classes.gt3!.player).toBe(2);
    expect(doc.classes.hypercar!.player).toBeNull();
  });

  it('carries no names or numbers, only seconds, indexes and model strings', () => {
    expect(Object.keys(doc).sort()).toEqual([
      'classes',
      'kind',
      'source',
      'vehicles',
      'version',
    ]);
    expect(JSON.stringify(doc)).not.toMatch(/#\d|driver|name/i);
  });

  it('is much smaller than one string per car', () => {
    const naive = JSON.stringify(
      field.cars.map(() => ({s: 98.123, vehicle: 'Cadillac V-Series.R'})),
    ).length;
    expect(JSON.stringify(doc).length).toBeLessThan(naive * 2);
  });
});

describe('classBestsDoc by session kind', () => {
  it('qualifying has bests while its class laps stay null', () => {
    const doc = classBestsDoc(field, 'Qualify');
    expect(doc.kind).toBe('qualify');
    expect(doc.classes.gt3!.bestsS).toEqual([98, 99, 100]);
    expect(classLapsDoc(field, 'Qualify').classes).toBeNull();
  });

  it('practice has them too', () => {
    const doc = classBestsDoc(field, 'Practice');
    expect(doc.kind).toBe('practice');
    expect(doc.classes.hypercar!.bestsS[0]).toBe(80);
  });
});

describe("the game's own best lap (classBests 2)", () => {
  // The same field, each car also carrying mBestLapTime. The line-crossing
  // clock reads 98 for the 98 s car; the game says 98.123.
  const withBests = (bests: (number | null)[]): EncodedField => ({
    ...field,
    cars: field.cars.map((c, i) => ({...c, bestLapS: bests[i]})),
  });

  it("takes each car's best from bestLapS, exactly as the game timed it", () => {
    const doc = classBestsDoc(
      withBests([100.404, 98.123, 99.27, 80.011, 82.5, 81.249]),
      'Race',
    );
    expect(doc.source).toBe('game');
    expect(doc.classes.gt3!.bestsS).toEqual([98.123, 99.27, 100.404]);
    expect(doc.classes.hypercar!.bestsS).toEqual([80.011, 81.249, 82.5]);
    expect(doc.classes.gt3!.player).toBe(2);
  });

  it('a car with no timed lap (null) has no best; a class with none is left out', () => {
    const doc = classBestsDoc(
      withBests([100.4, null, 99.2, null, null, null]),
      'Race',
    );
    expect(doc.classes.gt3!.bestsS).toEqual([99.2, 100.4]);
    expect(doc.classes.hypercar).toBeUndefined();
  });

  it("does not apply the lap rules to the game's number (a single push lap in qualifying)", () => {
    const doc = classBestsDoc(
      withBests([100.4, 98.1, 99.2, 80, 82, 81]),
      'Qualify',
    );
    expect(doc.classes.gt3!.bestsS[0]).toBe(98.1);
  });

  it('a field without bestLapS, or only some cars with it, keeps the line-crossing rule', () => {
    expect(classBestsDoc(field, 'Race').source).toBe('laps');
    const partial: EncodedField = {
      ...field,
      cars: field.cars.map((c, i) => (i === 0 ? {...c, bestLapS: 97} : c)),
    };
    const doc = classBestsDoc(partial, 'Race');
    expect(doc.source).toBe('laps');
    expect(doc.classes.gt3!.bestsS).toEqual([98, 99, 100]);
  });

  it('a version 1 stored doc reads stale', () => {
    const doc = classBestsDoc(field, 'Race');
    expect(classBestsCurrent({...doc, version: 1}, 'Race')).toBe(false);
  });
});

describe('classBestsCurrent', () => {
  it('is true for this version and kind only', () => {
    const doc = classBestsDoc(field, 'Race');
    expect(classBestsCurrent({...doc}, 'Race')).toBe(true);
    expect(classBestsCurrent({...doc}, 'Practice')).toBe(false);
    expect(
      classBestsCurrent({...doc, version: CLASS_BESTS_VERSION - 1}, 'Race'),
    ).toBe(false);
    expect(classBestsCurrent(null, 'Race')).toBe(false);
  });
});

describe('the stored shape', () => {
  it('has no array directly inside an array, which Firestore refuses', () => {
    const arrays = (v: unknown, inside = false): boolean => {
      if (Array.isArray(v)) return inside || v.some(x => arrays(x, true));
      if (v && typeof v === 'object')
        return Object.values(v).some(x => arrays(x, false));
      return false;
    };
    expect(arrays(classBestsDoc(field, 'Race'))).toBe(false);
  });
});
