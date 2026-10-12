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
    expect(gt3.cars).toBe(3);
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
