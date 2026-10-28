import {describe, expect, it} from '@jest/globals';

import rivals from './__fixtures__/rivalCars.json';
import {PAINTS} from './carPaint';
import {
  SHAPES,
  SIZE,
  hullTopAt,
  shapeClassOf,
  shapeFor,
  type ClassShape,
} from './carShapes';
import {MODELS} from './modelShapes';

// Every (class, car) pair in his 474 LMU results files, one per driver (tools/sessions/lmuResults.mjs `driversOf`), with
// the number of files it is in; `recent` counts those dated since 2026-09-01.
const RIVALS = rivals as {
  cls: string;
  car: string;
  files: number;
  recent: number;
}[];

// the `vehicle` strings his Hyper fields carry (rivalCars.json) and the model entry each one is drawn as
const HYPERS: [string, string][] = [
  ['Ferrari 499P', 'ferrari-499p'],
  ['Genesis GMR-001', 'genesis-gmr-001'],
  ['Genesis GMR001', 'genesis-gmr-001'],
  ['Cadillac V-Series.R', 'cadillac-v-series-r'],
  ['Peugeot 9x8', 'peugeot-9x8'],
  ['BMW M Hybrid V8', 'bmw-m-hybrid-v8'],
  ['Aston Martin Valkyrie LMH', 'aston-valkyrie'],
  ['Porsche 963', 'porsche-963'],
  ['Toyota TR010', 'toyota-gr010'],
  ['Toyota GR010', 'toyota-gr010'],
  ['Alpine A424', 'alpine-a424'],
  ['Lamborghini SC63', 'lamborghini-sc63'],
];

describe('Hyper models', () => {
  const hyper = MODELS.Hyper;
  it.each(HYPERS)('%s is drawn as %s', (vehicle, key) => {
    expect(shapeFor(vehicle, 'Hyper').key).toBe('Hyper:' + key);
  });
  it('Isotta, Glickenhaus and Vanwall, and a model in the wrong class, keep the class hull', () => {
    for (const v of [
      'Isotta Fraschini TIPO6',
      'Glickenhaus SCG007',
      'Vanwall 680',
      'Some Car 007 X',
      '',
      null,
    ]) {
      const s = shapeFor(v, 'Hyper');
      expect(s.key).toBe('Hyper');
      expect(s.shape).toBe(SHAPES.Hyper);
    }
    expect(shapeFor('Ferrari 499P', 'GT3').key).toBe('GT3');
  });
  it('there are ten, each with a distinct key and a real vehicle string that matches only itself', () => {
    expect(hyper).toHaveLength(10);
    expect(new Set(hyper.map(m => m.key)).size).toBe(10);
    for (const m of hyper) {
      const hits = hyper.filter(o => o.match.test(m.example.toLowerCase()));
      expect(hits.map(h => h.key)).toEqual([m.key]);
      expect(shapeFor(m.example, 'Hyper').key).toBe('Hyper:' + m.key);
    }
  });
  it('a model keeps the colour it had as a family member (pinned: a reorder shows up here)', () => {
    const paintOf = (v: string) => shapeFor(v, 'Hyper').paint;
    expect(hyper.map(m => [m.key, paintOf(m.example)])).toEqual([
      ['ferrari-499p', 0],
      ['peugeot-9x8', 1],
      ['toyota-gr010', 2],
      ['aston-valkyrie', 3],
      ['lamborghini-sc63', 4],
      ['cadillac-v-series-r', 5],
      ['bmw-m-hybrid-v8', 0],
      ['porsche-963', 1],
      ['genesis-gmr-001', 2],
      ['alpine-a424', 3],
    ]);
    expect(paintOf('Some New Car')).toBe(paintOf('some new car'));
  });
  it('two models that share a colour differ in body (colour is the place in the block, six colours)', () => {
    const bodyOf = (i: number) => JSON.stringify(hyper[i].params);
    for (let i = 0; i < hyper.length; i++)
      for (let j = i + 1; j < hyper.length; j++)
        if (i % PAINTS === j % PAINTS) expect(bodyOf(i)).not.toBe(bodyOf(j));
  });
  it('each model stands on the class hull: its own length on the class footprint width, the class station count (one more for a round tail)', () => {
    for (const m of hyper) {
      const {shape, footprint} = shapeFor(m.example, 'Hyper');
      expect(footprint[1]).toBe(SIZE.Hyper[1]);
      expect(footprint[0]).toBe(m.params.lengthM ?? SIZE.Hyper[0]);
      expect(shape.hull).toHaveLength(
        SHAPES.Hyper.hull.length + (m.params.tailRound ? 1 : 0),
      );
      const half = Math.max(...shape.hull.map(st => st[1]));
      expect(half).toBeLessThanOrEqual(SHAPES.Hyper.hull[2][1] + 0.1);
      const length = shape.hull[0][0] - shape.hull[shape.hull.length - 1][0];
      expect(length).toBeCloseTo(m.params.lengthM ?? length, 6);
    }
  });
  it('every number is finite, the hull descends in x, nothing is taller than 1.4 m or below its shoulder, the cabin sits on the hull, the wing is above the deck', () => {
    for (const m of hyper) {
      const {shape} = shapeFor(m.example, 'Hyper');
      shape.hull.forEach((st, i) => {
        for (const n of st) expect(Number.isFinite(n)).toBe(true);
        if (i > 0) expect(st[0]).toBeLessThan(shape.hull[i - 1][0]);
        expect(st[4]).toBeGreaterThanOrEqual(st[2]);
        expect(st[4]).toBeLessThanOrEqual(1.4);
      });
      const nose = shape.hull[0][0];
      const tail = shape.hull[shape.hull.length - 1][0];
      shape.cabin.forEach((st, i) => {
        for (const n of st) expect(Number.isFinite(n)).toBe(true);
        expect(st[0]).toBeLessThanOrEqual(nose);
        expect(st[0]).toBeGreaterThanOrEqual(tail);
        expect(st[4]).toBeGreaterThanOrEqual(st[2]);
        if (i > 0) expect(st[0]).toBeLessThan(shape.cabin[i - 1][0]);
      });
      for (const n of shape.wing) expect(Number.isFinite(n)).toBe(true);
      expect(shape.wing[1]).toBeLessThanOrEqual(1.7);
      expect(shape.wing[1]).toBeGreaterThan(
        hullTopAt(shape.hull, shape.wing[0]) - 0.01,
      );
      for (const b of shape.bulges ?? []) {
        for (const n of Object.values(b)) expect(Number.isFinite(n)).toBe(true);
        expect(b.x - b.len / 2).toBeGreaterThan(tail);
        expect(b.x + b.len / 2).toBeLessThan(nose);
      }
    }
  });
  it('the wheels come from the model: the wheelbase it names (the LMDh cars run 3,148 mm), inside the hull', () => {
    for (const m of hyper) {
      const {shape} = shapeFor(m.example, 'Hyper');
      const [front, rear, radius] = shape.wheels;
      expect(front).toBeGreaterThan(rear);
      expect(front - rear).toBeCloseTo(
        m.params.wheelbaseM ?? SHAPES.Hyper.wheels[0] - SHAPES.Hyper.wheels[1],
        6,
      );
      expect(front + radius).toBeLessThan(shape.hull[0][0]);
      expect(rear - radius).toBeGreaterThan(
        shape.hull[shape.hull.length - 1][0],
      );
    }
    for (const v of [
      'Cadillac V-Series.R',
      'BMW M Hybrid V8',
      'Porsche 963',
      'Alpine A424',
      'Lamborghini SC63',
    ]) {
      const [front, rear] = shapeFor(v, 'Hyper').shape.wheels;
      expect(front - rear).toBeCloseTo(3.148, 6);
    }
  });
  it('the cues are there, as numbers: the Valkyrie has the narrowest canopy, the 9X8 the lowest wing, the Toyota the shortest hull, the 499P a higher wing than the class; the LMDh cars with a fin have a taller one than the class', () => {
    const shape = (v: string) => shapeFor(v, 'Hyper').shape;
    const all = hyper.map(m => shape(m.example));
    const cabinW = (s: ClassShape) => Math.max(...s.cabin.map(st => st[1]));
    expect(cabinW(shape('Aston Martin Valkyrie LMH'))).toBe(
      Math.min(...all.map(cabinW)),
    );
    const wingAbove = (s: ClassShape) =>
      s.wing[1] - hullTopAt(s.hull, s.wing[0]);
    expect(wingAbove(shape('Peugeot 9x8'))).toBe(
      Math.min(...all.map(wingAbove)),
    );
    expect(shape('Peugeot 9x8').wingKind).toBe('low');
    expect(wingAbove(shape('Ferrari 499P'))).toBeGreaterThan(
      wingAbove(SHAPES.Hyper),
    );
    const lengths = hyper.map(m => shapeFor(m.example, 'Hyper').footprint[0]);
    expect(shapeFor('Toyota TR010', 'Hyper').footprint[0]).toBe(
      Math.min(...lengths),
    );
    const classFin = SHAPES.Hyper.fin?.[2] ?? 0;
    for (const v of [
      'Genesis GMR-001',
      'BMW M Hybrid V8',
      'Porsche 963',
      'Alpine A424',
    ])
      expect(shape(v).fin?.[2]).toBeGreaterThan(classFin);
    expect(shape('Cadillac V-Series.R').bulges).toHaveLength(2);
  });
});

describe('LMP2 models', () => {
  it.each([
    ['LMP2', 'Oreca 07'],
    ['LMP2_ELMS', 'Oreca 07'],
  ])(
    '%s %s is drawn as the Oreca, with its own length and wheelbase',
    (cls, car) => {
      const s = shapeFor(car, cls);
      expect(s.key).toBe('LMP2:oreca-07');
      expect(s.footprint).toEqual([4.745, SIZE.LMP2[1]]);
      expect(s.shape.wheels[0] - s.shape.wheels[1]).toBeCloseTo(3.005, 6);
      expect(s.shape.bulges).toHaveLength(1);
    },
  );
  it('the four LMP3 chassis get the one LMP3 class hull: the LMP2 language at the LMP3 envelope (4.63 x 1.9 m, 2.89 m wheelbase), never the Oreca', () => {
    const lmp3 = RIVALS.filter(r => r.cls === 'LMP3');
    expect(lmp3).toHaveLength(4);
    for (const r of lmp3) {
      const s = shapeFor(r.car, r.cls);
      expect(s.key).toBe('LMP3');
      expect(s.shape).toBe(SHAPES.LMP3);
      expect(s.footprint).toEqual(SIZE.LMP3);
    }
    expect(SIZE.LMP3).toEqual([4.63, SIZE.LMP2[1]]);
    const hull = SHAPES.LMP3.hull;
    expect(hull[0][0] - hull[hull.length - 1][0]).toBeCloseTo(4.63, 6);
    const [front, rear] = SHAPES.LMP3.wheels;
    expect(front - rear).toBeCloseTo(2.89, 6);
    expect(SHAPES.LMP3.fin).not.toBeNull();
  });
});

describe('GT3 models', () => {
  const gt3 = MODELS.GT3;
  it('there are ten, each with a distinct key and a real vehicle string that matches only itself', () => {
    expect(gt3).toHaveLength(10);
    expect(new Set(gt3.map(m => m.key)).size).toBe(10);
    for (const m of gt3) {
      const hits = gt3.filter(o => o.match.test(m.example.toLowerCase()));
      expect(hits.map(h => h.key)).toEqual([m.key]);
      expect(shapeFor(m.example, 'GT3').key).toBe('GT3:' + m.key);
    }
  });
  it('two models that share a colour differ in body (colour is the place in the block, six colours)', () => {
    const colour = (i: number) => i % PAINTS;
    const bodyOf = (i: number) => JSON.stringify(gt3[i].params);
    for (let i = 0; i < gt3.length; i++)
      for (let j = i + 1; j < gt3.length; j++)
        if (colour(i) === colour(j)) expect(bodyOf(i)).not.toBe(bodyOf(j));
  });
  it('each model stands on the class hull: the same widths and the class footprint width, its own length', () => {
    for (const m of gt3) {
      const {shape, footprint} = shapeFor(m.example, 'GT3');
      expect(footprint[1]).toBe(SIZE.GT3[1]);
      expect(footprint[0]).toBe(m.params.lengthM ?? SIZE.GT3[0]);
      const base = SHAPES.GT3;
      expect(shape.hull).toHaveLength(base.hull.length);
      const half = Math.max(...shape.hull.map(st => st[1]));
      expect(half).toBeLessThanOrEqual(base.hull[2][1] + 0.1);
      const length = shape.hull[0][0] - shape.hull[shape.hull.length - 1][0];
      expect(length).toBeCloseTo(m.params.lengthM ?? length, 6);
    }
  });
  it('every number is finite, the hull descends in x, nothing is taller than 1.4 m or below its shoulder, the cabin sits on the hull', () => {
    for (const m of gt3) {
      const {shape} = shapeFor(m.example, 'GT3');
      shape.hull.forEach((st, i) => {
        for (const n of st) expect(Number.isFinite(n)).toBe(true);
        if (i > 0) expect(st[0]).toBeLessThan(shape.hull[i - 1][0]);
        expect(st[4]).toBeGreaterThanOrEqual(st[2]);
        expect(st[4]).toBeLessThanOrEqual(1.4);
      });
      const nose = shape.hull[0][0];
      const tail = shape.hull[shape.hull.length - 1][0];
      for (const st of shape.cabin) {
        for (const n of st) expect(Number.isFinite(n)).toBe(true);
        expect(st[0]).toBeLessThanOrEqual(nose);
        expect(st[0]).toBeGreaterThanOrEqual(tail);
        expect(st[4]).toBeGreaterThanOrEqual(st[2]);
      }
      shape.cabin.forEach((st, i) => {
        if (i > 0) expect(st[0]).toBeLessThan(shape.cabin[i - 1][0]);
      });
      expect(shape.wing[1]).toBeLessThanOrEqual(1.7);
      expect(shape.wing[1]).toBeGreaterThan(
        hullTopAt(shape.hull, shape.wing[0]) - 0.01,
      );
    }
  });
  it('the wheels come from the model: the wheelbase it names, a front axle ahead of the rear, inside the hull', () => {
    for (const m of gt3) {
      const {shape} = shapeFor(m.example, 'GT3');
      const [front, rear, radius] = shape.wheels;
      expect(front).toBeGreaterThan(rear);
      if (m.params.wheelbaseM)
        expect(front - rear).toBeCloseTo(m.params.wheelbaseM, 6);
      else
        expect(front - rear).toBeCloseTo(
          SHAPES.GT3.wheels[0] - SHAPES.GT3.wheels[1],
          6,
        );
      expect(front + radius).toBeLessThan(shape.hull[0][0]);
      expect(rear - radius).toBeGreaterThan(
        shape.hull[shape.hull.length - 1][0],
      );
    }
  });
  it('the cues are there, as numbers: the 911 cabin is far forward and the Mustang and AMG far back; the M4 roof is the tallest and the Huracán the lowest; the 296 deck is the lowest', () => {
    const shape = (v: string) => shapeFor(v, 'GT3').shape;
    const cabinX = (v: string) => shape(v).cabin[1][0];
    const roof = (v: string) => Math.max(...shape(v).cabin.map(st => st[4]));
    const deck = (v: string) => shape(v).hull[4][4];
    expect(
      cabinX('Porsche 911 GT3 R LMGT3') - cabinX('Ford Mustang LMGT3'),
    ).toBeGreaterThan(0.9);
    expect(
      cabinX('Porsche 911 GT3 R LMGT3') - cabinX('Mercedes-AMG LMGT3'),
    ).toBeGreaterThan(0.9);
    const roofs = MODELS.GT3.map(m => roof(m.example));
    expect(roof('BMW M4 LMGT3')).toBe(Math.max(...roofs));
    expect(roof('Lamborghini Huracan LMGT3 Evo2')).toBe(Math.min(...roofs));
    expect(deck('Ferrari 296 LMGT3 Evo')).toBe(
      Math.min(...MODELS.GT3.map(m => deck(m.example))),
    );
    expect(shape('BMW M4 LMGT3').wingKind).toBe('pylon');
    expect(shape('Porsche 911 GT3 R LMGT3').wingKind).toBe('pylons');
    expect(shape('Lexus RCF LMGT3').wingKind).toBe('wide');
    expect(shape('Chevrolet Corvette Z06 LMGT3.R').bulges).toHaveLength(1);
  });
  it('an unknown, empty or missing GT3 keeps the class hull; a model in the wrong class is not matched', () => {
    for (const v of ['Some New Car', '', null, 'Ferrari 499P', 'Oreca 07']) {
      const s = shapeFor(v, 'GT3');
      expect(s.key).toBe('GT3');
      expect(s.shape).toBe(SHAPES.GT3);
    }
  });
});

describe('his real cars (every pair in his results files)', () => {
  it('no GT3 car falls back to the class hull: each of the eleven strings resolves to a model', () => {
    const gt3 = RIVALS.filter(r => r.cls === 'GT3');
    expect(gt3.length).toBeGreaterThanOrEqual(11);
    for (const r of gt3) expect(shapeFor(r.car, r.cls).key).toMatch(/^GT3:/);
  });
  it('no class is drawn as the wrong kind of car: a prototype class never gets the GT3 hull, a Hyper keeps its own', () => {
    for (const r of RIVALS) {
      const cls = shapeClassOf(r.cls);
      expect(cls).toBe(
        r.cls === 'GT3'
          ? 'GT3'
          : r.cls === 'Hyper'
          ? 'Hyper'
          : r.cls === 'LMP3'
          ? 'LMP3'
          : 'LMP2',
      );
      expect(shapeFor(r.car, r.cls).key.startsWith(cls)).toBe(true);
    }
  });
  it('every Hyper he meets has a model but the three rare ones (Isotta, Glickenhaus, Vanwall), which the class hull draws', () => {
    const rare = /isotta|glickenhaus|vanwall/i;
    for (const r of RIVALS.filter(x => x.cls === 'Hyper')) {
      const key = shapeFor(r.car, r.cls).key;
      if (rare.test(r.car)) expect(key).toBe('Hyper');
      else expect(key).toMatch(/^Hyper:/);
    }
  });
  it('a class with no shape of its own is read by its name, and GT3 only when the name says nothing', () => {
    expect(shapeClassOf('LMP2_ELMS')).toBe('LMP2');
    expect(shapeClassOf('LMP3')).toBe('LMP3');
    expect(shapeClassOf('Hypercar')).toBe('Hyper');
    expect(shapeClassOf('GTP')).toBe('Hyper');
    expect(shapeClassOf('GTE')).toBe('GT3');
    expect(shapeClassOf('Unknown class')).toBe('GT3');
    expect(shapeFor('x', 'Unknown class').key).toBe('GT3');
  });
});

describe('the wheels of the class hulls', () => {
  it('stand inside every class: on the road, within the hull and its width, a front axle ahead of the rear', () => {
    for (const [cls, shape] of Object.entries(SHAPES)) {
      const [front, rear, radius, width] = shape.wheels;
      const nose = shape.hull[0][0];
      const tail = shape.hull[shape.hull.length - 1][0];
      expect(front).toBeGreaterThan(rear);
      expect(front + radius).toBeLessThan(nose);
      expect(rear - radius).toBeGreaterThan(tail);
      expect(radius).toBeGreaterThan(0.25);
      expect(width).toBeGreaterThan(0.1);
      expect(width).toBeLessThan(Math.max(...shape.hull.map(st => st[1])));
      expect(SIZE[cls][1]).toBeGreaterThan(1.8);
    }
  });
});
