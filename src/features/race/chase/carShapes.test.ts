import {describe, expect, it} from '@jest/globals';

import rivals from './__fixtures__/rivalCars.json';
import {PAINTS} from './carPaint';
import {
  KNOWN,
  SHAPES,
  SIZE,
  familyOf,
  hullTopAt,
  shapeClassOf,
  shapeFor,
  type Family,
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

// the `vehicle` strings a real LMU Hyper field carries, class as the field gives it
const HYPERS: [string, Family][] = [
  ['Ferrari 499P', 'lmh'],
  ['Genesis GMR-001', 'lmdh'],
  ['Cadillac V-Series.R', 'lmdh'],
  ['Peugeot 9x8', 'lmh'],
  ['BMW M Hybrid V8', 'lmdh'],
  ['Aston Martin Valkyrie LMH', 'lmh'],
  ['Porsche 963', 'lmdh'],
  ['Toyota TR010 ', 'lmh'],
  ['Toyota GR010', 'lmh'],
  ['Glickenhaus SCG007', 'lmh'],
];

describe('hyper families', () => {
  it.each(HYPERS)('%s is %s', (vehicle, family) => {
    expect(familyOf(vehicle, 'Hyper')?.family).toBe(family);
  });
  it("a bare '007' is not a Glickenhaus, and a model in the wrong class is no family", () => {
    expect(familyOf('Some Car 007 X', 'Hyper')).toBeNull();
    expect(familyOf('Ferrari 499P', 'GT3')).toBeNull();
  });
  it('a family keeps its colour in every session: its place in the list, unique inside the family', () => {
    for (const family of Object.keys(KNOWN) as Family[])
      expect(KNOWN[family].length).toBeLessThanOrEqual(PAINTS);
    const paintOf = (v: string | null) => shapeFor(v, 'Hyper').paint;
    expect(paintOf('Ferrari 499P')).toBe(0);
    expect(paintOf('Peugeot 9x8')).toBe(1);
    expect(paintOf('Some New Car')).toBe(paintOf('some new car'));
    expect(paintOf(null)).toBe(0);
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
        r.cls === 'GT3' ? 'GT3' : r.cls === 'Hyper' ? 'Hyper' : 'LMP2',
      );
      expect(shapeFor(r.car, r.cls).key.startsWith(cls)).toBe(true);
    }
  });
  it('every Hyper he meets has a family but the two rare ones (Isotta, Vanwall), which the class hull draws', () => {
    const rare = /isotta|vanwall/i;
    for (const r of RIVALS.filter(x => x.cls === 'Hyper')) {
      const key = shapeFor(r.car, r.cls).key;
      if (rare.test(r.car)) expect(key).toBe('Hyper');
      else expect(key).toMatch(/^Hyper:/);
    }
  });
  it('a class with no shape of its own is read by its name, and GT3 only when the name says nothing', () => {
    expect(shapeClassOf('LMP2_ELMS')).toBe('LMP2');
    expect(shapeClassOf('LMP3')).toBe('LMP2');
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
