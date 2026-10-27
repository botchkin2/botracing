import {describe, expect, it} from '@jest/globals';

import {
  KNOWN,
  SHAPES,
  SIZE,
  familyOf,
  shapeFor,
  type Family,
} from './carShapes';
import {PAINTS} from './carPaint';

// the `vehicle` strings a real LMU race field carries (seat-test's Road Atlanta race, 54 cars), class as the field gives it
const FIELD: [string, string, Family][] = [
  ['Hyper', 'Ferrari 499P', 'lmh'],
  ['Hyper', 'Genesis GMR-001', 'lmdh'],
  ['Hyper', 'Cadillac V-Series.R', 'lmdh'],
  ['Hyper', 'Peugeot 9x8', 'lmh'],
  ['Hyper', 'BMW M Hybrid V8', 'lmdh'],
  ['Hyper', 'Aston Martin Valkyrie LMH', 'lmh'],
  ['Hyper', 'Porsche 963', 'lmdh'],
  ['Hyper', 'Toyota TR010 ', 'lmh'],
  ['GT3', 'BMW M4 LMGT3', 'gt3-front'],
  ['GT3', 'Porsche 911 GT3 R LMGT3', 'gt3-rear'],
  ['GT3', 'Mercedes-AMG LMGT3', 'gt3-front'],
  ['GT3', 'McLaren 720S LMGT3 Evo', 'gt3-mid'],
  ['GT3', 'Ferrari 296 LMGT3 Evo', 'gt3-mid'],
  ['GT3', 'Ferrari 296 LMGT3', 'gt3-mid'],
  ['GT3', 'Ford Mustang LMGT3', 'gt3-front'],
];

describe('car families', () => {
  it.each(FIELD)('%s %s is %s', (cls, vehicle, family) => {
    expect(familyOf(vehicle, cls)?.family).toBe(family);
  });
  it('an unknown, empty or missing model, or one in the wrong class, keeps the class hull', () => {
    const cases: [string | null, string][] = [
      ['Some New Car', 'GT3'],
      ['', 'GT3'],
      [null, 'GT3'],
      [null, 'Hyper'],
      ['Oreca 07', 'LMP2'],
      ['Ferrari 499P', 'GT3'],
      ['Porsche 911 GT3 R', 'Hyper'],
    ];
    for (const [v, cls] of cases) {
      expect(familyOf(v, cls)).toBeNull();
      const s = shapeFor(v, cls);
      expect(s.key).toBe(cls);
      expect(s.shape).toBe(SHAPES[cls]);
    }
    expect(shapeFor('x', 'Unknown class').key).toBe('GT3');
  });
  it('a model keeps its colour in every session: its place in the family list, unique inside a family and across the class where it can be', () => {
    for (const family of Object.keys(KNOWN) as Family[]) {
      expect(KNOWN[family].length).toBeLessThanOrEqual(PAINTS);
    }
    // the colour index is stable: the families of a class continue one another, so only a class's seventh model onward repeats
    const paintOf = (cls: string, v: string | null) => shapeFor(v, cls).paint;
    expect(paintOf('Hyper', 'Ferrari 499P')).toBe(0);
    expect(paintOf('Hyper', 'Peugeot 9x8')).toBe(1);
    expect(paintOf('GT3', 'BMW M4 LMGT3')).toBe(0);
    expect(paintOf('GT3', 'McLaren 720S LMGT3 Evo')).toBe(5);
    const gt3 = FIELD.filter(([c]) => c === 'GT3').map(([c, v]) => paintOf(c, v));
    for (const p of gt3) expect(p).toBeGreaterThanOrEqual(0);
    for (const p of gt3) expect(p).toBeLessThan(PAINTS);
    // a model nothing placed gets a stable colour from its name, in range
    expect(paintOf('GT3', 'Some New Car')).toBe(paintOf('GT3', 'some new car'));
    expect(paintOf('GT3', null)).toBe(0);
    const seen = new Map<string, string>();
    for (const [cls, vehicle] of FIELD) {
      const fam = familyOf(vehicle, cls)!;
      const key = fam.family + ':' + fam.slot;
      const other = seen.get(key);
      // the two Ferrari 296 variants are one model
      if (other && !(other.includes('296') && vehicle.includes('296')))
        throw new Error(vehicle + ' and ' + other + ' share ' + key);
      seen.set(key, vehicle);
    }
  });
  it('the families look different inside a class: the cabin sits further forward or back, by more than 0.3 m', () => {
    const cabinFront = (v: string, cls: string) =>
      shapeFor(v, cls).shape.cabin[0][0];
    const front = cabinFront('BMW M4 LMGT3', 'GT3');
    const mid = cabinFront('McLaren 720S LMGT3 Evo', 'GT3');
    const rear = cabinFront('Porsche 911 GT3 R LMGT3', 'GT3');
    expect(mid - front).toBeGreaterThan(0.5);
    expect(rear - front).toBeGreaterThan(0.3);
    expect(Math.abs(mid - rear)).toBeGreaterThan(0.1);
    expect(
      cabinFront('Ferrari 499P', 'Hyper') -
        cabinFront('Cadillac V-Series.R', 'Hyper'),
    ).toBeGreaterThan(0.3);
  });
  it('stays inside the class: no hull, cabin or footprint beyond the class own, the wing where it was', () => {
    for (const [cls, vehicle] of FIELD) {
      const base = SHAPES[cls];
      const {shape, footprint} = shapeFor(vehicle, cls);
      expect(footprint).toBe(SIZE[cls]);
      const nose = base.hull[0][0];
      const tail = base.hull[base.hull.length - 1][0];
      for (const st of shape.hull) {
        expect(st[0]).toBeLessThanOrEqual(nose + 1e-9);
        expect(st[0]).toBeGreaterThanOrEqual(tail - 1e-9);
      }
      shape.hull.forEach((st, i) =>
        expect(st.slice(1)).toEqual(base.hull[i].slice(1)),
      ); // widths and heights untouched
      for (const st of shape.cabin) {
        expect(st[0]).toBeLessThanOrEqual(nose);
        expect(st[0]).toBeGreaterThanOrEqual(tail);
        for (const n of st) expect(Number.isFinite(n)).toBe(true);
      }
      expect(shape.wing[0]).toBe(base.wing[0]);
      expect(shape.wing[3]).toBe(base.wing[3]);
    }
  });
});

describe('the wheels', () => {
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
  it('every family keeps its class wheels', () => {
    for (const [cls, vehicle] of FIELD)
      expect(shapeFor(vehicle, cls).shape.wheels).toBe(SHAPES[cls].wheels);
  });
});
