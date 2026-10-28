import {describe, expect, it} from '@jest/globals';
import * as THREE from 'three';

import {
  carOutline,
  LIGHT_GAIN,
  createCarKit,
  mixSrgb,
  shellOf,
  tickSegment,
} from './carMeshes';
import {modelPaint} from './carPaint';
import {SHAPES, lightSegments, shapeFor} from './carShapes';
import {MODELS} from './modelShapes';

// The engine places a car with rotation.set(0, heading, 0) in the three.js frame (x east, y up, z = -north).
const placed = (local: {x: number; z: number}, heading: number) => {
  const o = new THREE.Object3D();
  o.rotation.order = 'YZX';
  o.rotation.set(0, heading, 0);
  o.updateMatrix();
  const p = new THREE.Vector3(local.x, 0, local.z).applyMatrix4(o.matrix);
  return {x: p.x, y: -p.z}; // back to the world frame: x east, y north
};

const COLORS = {
  bg: '#0c0d11',
  edge: '#ffffff',
  mark: '#fea92f',
  classes: ['#e64343', '#4697e4', '#f68443'],
};

/** Every material a car draws with, in draw order. */
const materialsOf = (car: THREE.Object3D) => {
  const out: THREE.Material[] = [];
  car.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (m) out.push(m);
  });
  return out;
};

/** The box of what the car is made of, the glow shell left out (it is the glow, not the car). */
const bodyBox = (car: THREE.Object3D) => {
  const box = new THREE.Box3();
  for (const c of car.children)
    if (c.name !== 'halo') box.union(new THREE.Box3().setFromObject(c));
  return box;
};

describe('car geometry', () => {
  it('the tick starts at the nose and runs forward, 0.3 of the car length', () => {
    const [a, b] = tickSegment('GT3');
    const nose = carOutline('GT3').reduce((m, p) => (p.x > m.x ? p : m));
    expect(a.x).toBeCloseTo(nose.x);
    expect(a.z).toBeCloseTo(nose.z);
    expect(b.x - a.x).toBeCloseTo(0.3 * 4.65);
    expect(b.z).toBeCloseTo(0);
  });
  it('forward on the car is the world heading, whatever the heading', () => {
    for (const h of [0, 0.7, Math.PI / 2, Math.PI, -2.1]) {
      const [a, b] = tickSegment('GT3');
      const wa = placed(a, h);
      const wb = placed(b, h);
      expect(Math.atan2(wb.y - wa.y, wb.x - wa.x)).toBeCloseTo(
        Math.atan2(Math.sin(h), Math.cos(h)),
      );
    }
  });
  it('the nose is ahead of the car centre along the heading, the tail behind', () => {
    const h = 1.2;
    const outline = carOutline('Hyper');
    const nose = outline.reduce((m, p) => (p.x > m.x ? p : m));
    const tail = outline.reduce((m, p) => (p.x < m.x ? p : m));
    const forward = {x: Math.cos(h), y: Math.sin(h)};
    const wn = placed(nose, h);
    const wt = placed(tail, h);
    expect(wn.x * forward.x + wn.y * forward.y).toBeGreaterThan(2);
    expect(wt.x * forward.x + wt.y * forward.y).toBeLessThan(-2);
  });
});

describe('car bodies', () => {
  it('stand on the road, nose forward: the body spans its class length and sits between 0 and 1.4 m, wheels included', () => {
    const kit = createCarKit(COLORS);
    const car = kit.make('Hyper', '#ff0000', false);
    const box = bodyBox(car);
    expect(box.min.y).toBeGreaterThanOrEqual(-1e-6); // the wheels stand on the road
    expect(box.max.y).toBeLessThan(1.4);
    expect(box.max.x).toBeGreaterThan(2.4); // the tick runs past the nose
    expect(box.min.x).toBeLessThan(-2.4); // the tail, or the wing just behind it
    expect(box.min.x).toBeGreaterThan(-2.7);
    // the class width, and the wheels' outer faces 6 cm outside the hull on each side
    expect(box.max.z - box.min.z).toBeCloseTo(2.0 + 2 * 0.06, 1);
    kit.release(car);
    kit.dispose();
  });

  it('the wheels are in the body geometry: four discs, no extra mesh and no extra draw', () => {
    const kit = createCarKit(COLORS);
    const car = kit.make('GT3', '#ff8800', false);
    // base, body, cabin, body edges, cabin edges, tick, halo: seven draws for a car, eight for the followed one
    expect(car.children.length).toBe(7);
    expect(kit.make('GT3', '#ff8800', true).children.length).toBe(8);
    // a hull alone is 6 faces per station gap; the wheels add 4 discs of 8 segments (8 sides + 2 caps each)
    const wheelsOnly = 4 * 8 * 4; // triangles: per segment 2 for the side and 1 per cap
    const body = (car.children[1] as THREE.Mesh).geometry;
    expect(body.getAttribute('position').count / 3).toBeGreaterThan(wheelsOnly);
    kit.dispose();
  });

  it('the body is dark, with the class colour in the edges: the fill sits nearer the background than the colour does', () => {
    const kit = createCarKit(COLORS);
    const car = kit.make('GT3', '#ff8800', false);
    const fill = (
      (car.children[1] as THREE.Mesh).material as THREE.MeshBasicMaterial
    ).color;
    const edge = (
      (car.children[3] as THREE.LineSegments)
        .material as THREE.LineBasicMaterial
    ).color;
    const bg = new THREE.Color(COLORS.bg);
    const dist = (a: THREE.Color, b: THREE.Color) =>
      Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
    expect(dist(fill, bg)).toBeLessThan(dist(edge, bg) * 0.3);
    kit.dispose();
  });

  it('the followed car has white-hot edges and its ring', () => {
    const kit = createCarKit(COLORS);
    const mine = kit.make('GT3', '#ff8800', true);
    const edge = (
      (mine.children[3] as THREE.LineSegments)
        .material as THREE.LineBasicMaterial
    ).color.getHexString();
    expect(edge).toBe('ffffff');
    expect(
      mine.children.some(
        c => (c as THREE.Mesh).material === mine.userData.sets.solid.ring,
      ),
    ).toBe(true);
    kit.dispose();
  });
});

describe('the halo shell', () => {
  const box = () => new THREE.BoxGeometry(2, 1, 4).toNonIndexed();

  it('moves every vertex out by exactly the offset, and closed: no vertex is left inside the body', () => {
    const body = box();
    const shell = shellOf(body, 0.05);
    const was = body.getAttribute('position');
    const now = shell.getAttribute('position');
    expect(now.count).toBe(was.count);
    for (let i = 0; i < was.count; i++) {
      const moved = Math.hypot(
        now.getX(i) - was.getX(i),
        now.getY(i) - was.getY(i),
        now.getZ(i) - was.getZ(i),
      );
      expect(moved).toBeCloseTo(0.05, 5);
      const inside =
        Math.abs(now.getX(i)) <= 1 &&
        Math.abs(now.getY(i)) <= 0.5 &&
        Math.abs(now.getZ(i)) <= 2;
      expect(inside).toBe(false);
    }
  });

  it('keeps two facets that met at a vertex meeting there: the shell is not torn open', () => {
    const shell = shellOf(box(), 0.05);
    const pos = shell.getAttribute('position');
    const seen = new Map<string, string>();
    // every original corner has one shell position, however many facets share it
    for (let i = 0; i < pos.count; i++) {
      const corner = `${Math.sign(pos.getX(i))},${Math.sign(
        pos.getY(i),
      )},${Math.sign(pos.getZ(i))}`;
      const at = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos
        .getZ(i)
        .toFixed(4)}`;
      expect(seen.get(corner) ?? at).toBe(at);
      seen.set(corner, at);
    }
    expect(seen.size).toBe(8);
  });

  it('is built per body shape, drawn back-faced in a dimmer edge colour, and never part of the car box', () => {
    const kit = createCarKit(COLORS);
    const a = kit.make('GT3', '#ff8800', false, 'BMW M4 LMGT3');
    const b = kit.make('GT3', '#ff8800', false, 'BMW M4 LMGT3');
    const halo = (car: THREE.Object3D) =>
      car.children.find(c => c.name === 'halo') as THREE.Mesh;
    expect(halo(a).geometry).toBe(halo(b).geometry);
    expect((halo(a).material as THREE.Material).side).toBe(THREE.BackSide);
    const full = new THREE.Box3().setFromObject(a);
    const car = bodyBox(a);
    expect(full.max.z - full.min.z).toBeGreaterThan(car.max.z - car.min.z);
    kit.dispose();
  });
});

describe('car kit', () => {
  it('fades a car see-through and back, every material', () => {
    const kit = createCarKit({
      bg: '#000000',
      edge: '#ffffff',
      mark: '#ffffff',
      classes: [],
    });
    const car = kit.make('LMP2', '#3366ff', true);
    kit.fade(car, true);
    expect(
      materialsOf(car).every(
        m => m.transparent && m.opacity < 0.5 && !m.depthWrite,
      ),
    ).toBe(true);
    kit.fade(car, false);
    expect(
      materialsOf(car).every(
        m => !m.transparent && m.opacity === 1 && m.depthWrite,
      ),
    ).toBe(true);
    kit.release(car);
    kit.dispose();
  });

  it('fading one car leaves another of the same colour and model solid: the materials are shared, the fade swaps them', () => {
    const kit = createCarKit(COLORS);
    const a = kit.make('GT3', '#ff8800', false, 'BMW M4 LMGT3');
    const b = kit.make('GT3', '#ff8800', false, 'BMW M4 LMGT3');
    expect(materialsOf(a)).toEqual(materialsOf(b)); // one set for both
    kit.fade(a, true);
    expect(materialsOf(a).every(m => m.transparent)).toBe(true);
    expect(
      materialsOf(b).every(
        m => !m.transparent && m.opacity === 1 && m.depthWrite,
      ),
    ).toBe(true);
    kit.fade(a, false);
    expect(materialsOf(a)).toEqual(materialsOf(b));
    kit.dispose();
  });

  it('a different colour has its own materials', () => {
    const kit = createCarKit(COLORS);
    const a = kit.make('GT3', '#ff8800', false);
    const b = kit.make('GT3', '#3366ff', false);
    const shared = materialsOf(a).filter(m => materialsOf(b).includes(m));
    expect(shared).toEqual([]);
    kit.dispose();
  });

  it("shares what it can: two cars use 7 geometries and 7 materials between them, the ring and its material the followed car's", () => {
    const kit = createCarKit(COLORS);
    const player = kit.make('GT3', '#ff0000', true);
    const other = kit.make('GT3', '#ff0000', false);
    const geos = new Set<THREE.BufferGeometry>();
    for (const car of [player, other])
      car.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.geometry) geos.add(m.geometry);
      });
    // footprint, body, cabin, two edge sets, tick, glow shell, plus the player's ring
    expect(geos.size).toBe(8);
    kit.dispose();
  });

  it('frees nothing when a car is released, and every shared geometry and material once on dispose', () => {
    const kit = createCarKit(COLORS);
    const player = kit.make('GT3', '#ff0000', true);
    const other = kit.make('GT3', '#ff0000', false);
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    for (const car of [player, other]) {
      kit.fade(car, true); // the see-through sets exist from the start, so they are counted too
      kit.fade(car, false);
      const set = car.userData.sets;
      for (const s of [set.solid, set.faded])
        for (const m of Object.values(s)) if (m) mats.add(m);
      car.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.geometry) geos.add(m.geometry);
      });
    }
    const geoDisposed: THREE.BufferGeometry[] = [];
    const matDisposed: THREE.Material[] = [];
    geos.forEach(g => g.addEventListener('dispose', () => geoDisposed.push(g)));
    mats.forEach(m => m.addEventListener('dispose', () => matDisposed.push(m)));
    // the player's set (8 parts, solid and see-through) and the other car's (7 parts, both)
    expect(mats.size).toBe(8 * 2 + 7 * 2);
    expect(geos.size).toBe(8);
    kit.release(other);
    kit.release(player);
    expect(matDisposed.length).toBe(0);
    expect(geoDisposed.length).toBe(0);
    kit.dispose();
    expect(matDisposed.length).toBe(mats.size);
    expect(geoDisposed.length).toBe(geos.size);
  });
});

describe('car families in the kit', () => {
  const colors = COLORS;
  const geometries = (car: THREE.Object3D) => {
    const out = new Set<THREE.BufferGeometry>();
    car.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry) out.add(m.geometry);
    });
    return out;
  };
  const bodyEdgeColor = (car: THREE.Object3D) => {
    const lines: THREE.LineSegments[] = [];
    car.traverse(o => {
      if ((o as THREE.LineSegments).isLineSegments)
        lines.push(o as THREE.LineSegments);
    });
    return (lines[0].material as THREE.LineBasicMaterial).color.getHexString();
  };

  it('two cars of one model share their shape (the 296 and its Evo are one model), and a different model has its own', () => {
    const kit = createCarKit(colors);
    const a = kit.make('GT3', '#ff8800', false, 'Ferrari 296 LMGT3');
    const b = kit.make('GT3', '#ff8800', false, 'Ferrari 296 LMGT3 Evo');
    const c = kit.make('GT3', '#ff8800', false, 'BMW M4 LMGT3');
    const bodyOf = (car: THREE.Object3D) =>
      (car.children[1] as THREE.Mesh).geometry;
    expect(bodyOf(a)).toBe(bodyOf(b));
    expect(bodyOf(a)).not.toBe(bodyOf(c));
    expect(geometries(a).size).toBe(7); // footprint, body, cabin, two edge sets, tick, glow shell (the ring is the followed car's)
    kit.dispose();
  });
  it('a model with no family draws the class hull, the same as no model at all', () => {
    const kit = createCarKit(colors);
    const none = kit.make('GT3', '#ff8800', false);
    const unknown = kit.make('GT3', '#ff8800', false, 'Some New Car');
    expect((none.children[1] as THREE.Mesh).geometry).toBe(
      (unknown.children[1] as THREE.Mesh).geometry,
    );
    kit.dispose();
  });
  it('the body edges carry the model colour, the fill the class colour, and the followed car keeps its light edges', () => {
    const kit = createCarKit(colors);
    const first = kit.make('Hyper', '#e64343', false, 'Ferrari 499P'); // colour 0 of Hyper
    const second = kit.make('Hyper', '#e64343', false, 'Peugeot 9x8'); // colour 1 of Hyper
    expect(bodyEdgeColor(first)).toBe('e64343');
    expect(bodyEdgeColor(second)).toBe(
      modelPaint('#e64343', ['#4697e4', '#f68443'], 1).slice(1),
    );
    expect(bodyEdgeColor(second)).not.toBe(bodyEdgeColor(first));
    // the same model in the same class colour is the same colour, whatever else is in the field
    const again = kit.make('Hyper', '#e64343', false, 'Peugeot 9x8');
    expect(bodyEdgeColor(again)).toBe(bodyEdgeColor(second));
    const mine = kit.make('Hyper', '#e64343', true, 'Peugeot 9x8');
    expect(bodyEdgeColor(mine)).toBe('ffffff');
    const fill = (car: THREE.Object3D) =>
      (
        (car.children[1] as THREE.Mesh).material as THREE.MeshBasicMaterial
      ).color.getHexString();
    expect(fill(first)).toBe(fill(second)); // the fill is the class colour's on both
    kit.dispose();
  });
  it('remembers the model on the car, so the engine can tell a changed model', () => {
    const kit = createCarKit(colors);
    expect(
      kit.make('GT3', '#ff8800', false, 'Ford Mustang LMGT3').userData.vehicle,
    ).toBe('Ford Mustang LMGT3');
    expect(kit.make('GT3', '#ff8800', false).userData.vehicle).toBeNull();
    kit.dispose();
  });
});

describe('mixing in sRGB', () => {
  it('half way from black to white is the mid grey the screen shows, not the lighter grey of linear light', () => {
    const mid = mixSrgb(
      new THREE.Color('#000000'),
      new THREE.Color('#ffffff'),
      0.5,
    );
    expect(mid.getHexString()).toBe('808080');
  });

  it('a body is its background with 12 % of the colour: a near-black warm tone for an amber, not a brown', () => {
    const kit = createCarKit(COLORS);
    const car = kit.make('GT3', '#ffaa28', false);
    const fill = (
      (car.children[1] as THREE.Mesh).material as THREE.MeshBasicMaterial
    ).color;
    const hex = fill.getHex();
    const [r, g, b] = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
    // #0c0d11 toward #ffaa28 by 12 %
    expect(r).toBeCloseTo(12 + (255 - 12) * 0.12, -0.5);
    expect(g).toBeCloseTo(13 + (170 - 13) * 0.12, -0.5);
    expect(b).toBeCloseTo(17 + (40 - 17) * 0.12, -0.5);
    expect(r).toBeLessThan(60);
    kit.dispose();
  });
});

describe('a full field', () => {
  // Seat-test's Road Atlanta race (54 cars: 34 Hyper red, 20 GT3 amber), the models its results file carries.
  const HYPER = [
    'Ferrari 499P',
    'Peugeot 9x8',
    'Cadillac V-Series.R',
    'BMW M Hybrid V8',
    'Porsche 963',
    'Aston Martin Valkyrie LMH',
    'Alpine A424',
    'Toyota TR010',
  ];
  const GT3 = [
    'BMW M4 LMGT3',
    'Mercedes-AMG LMGT3',
    'Porsche 911 GT3 R LMGT3',
    'McLaren 720S LMGT3 Evo',
    'Ferrari 296 LMGT3',
    'Ford Mustang LMGT3',
    'Chevrolet Corvette Z06 GT3.R',
  ];

  it('draws a car in 7 calls (8 for the followed one) and shares its materials by colour: far fewer than a set a car', () => {
    const kit = createCarKit(COLORS);
    const cars = [
      ...Array.from({length: 34}, (_, i) =>
        kit.make('Hyper', '#e5484d', false, HYPER[i % HYPER.length]),
      ),
      ...Array.from({length: 19}, (_, i) =>
        kit.make('GT3', '#ffa83a', false, GT3[i % GT3.length]),
      ),
      kit.make('GT3', '#ffa83a', true, GT3[2]),
    ];
    expect(cars.length).toBe(54);
    const calls = cars.reduce((n, c) => n + c.children.length, 0);
    expect(calls).toBe(53 * 7 + 8);
    const mats = new Set<THREE.Material>();
    const geos = new Set<THREE.BufferGeometry>();
    for (const car of cars) {
      kit.fade(car, true);
      kit.fade(car, false);
      for (const set of [car.userData.sets.solid, car.userData.sets.faded])
        for (const m of Object.values(set)) if (m) mats.add(m);
      car.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.geometry) geos.add(m.geometry);
      });
    }
    // before: 6 materials a car (7 for the followed car), 53 x 6 + 7 = 325, none shared
    expect(mats.size).toBeLessThan(200);
    expect(mats.size).toBeLessThan(0.6 * 325);
    // a geometry set (7) a body shape present in the field, plus the ring
    const shapes = new Set([
      ...HYPER.map(v => shapeFor(v, 'Hyper').key),
      ...GT3.map(v => shapeFor(v, 'GT3').key),
    ]);
    expect(geos.size).toBeLessThanOrEqual(7 * shapes.size + 1);
    kit.dispose();
  });
});

describe('every body shape builds', () => {
  // one car per shape: every model in every block, and each class hull
  const examples: [string, string | null][] = [
    ...Object.entries(MODELS).flatMap(([cls, block]) =>
      block.map(m => [cls, m.example] as [string, string]),
    ),
    ...Object.keys(SHAPES).map(cls => [cls, null] as [string, null]),
  ];
  const bodyOf = (car: THREE.Object3D) =>
    (car.children[1] as THREE.Mesh).geometry;
  const haloOf = (car: THREE.Object3D) =>
    (car.children.find(c => c.name === 'halo') as THREE.Mesh).geometry;
  const key = (a: THREE.BufferAttribute, i: number) =>
    `${Math.round(a.getX(i) * 1e4)},${Math.round(a.getY(i) * 1e4)},${Math.round(
      a.getZ(i) * 1e4,
    )}`;

  it.each(examples)(
    '%s %s: 7 draws, a closed halo, on the road, its own footprint',
    (cls, vehicle) => {
      const kit = createCarKit(COLORS);
      const car = kit.make(cls, '#e64343', false, vehicle);
      expect(car.children).toHaveLength(7);
      const body = bodyOf(car).getAttribute(
        'position',
      ) as THREE.BufferAttribute;
      const halo = haloOf(car).getAttribute(
        'position',
      ) as THREE.BufferAttribute;
      expect(halo.count).toBe(body.count);
      // the shell is not torn open: vertices that met in the body still meet in the shell, and every one moved
      const moved = new Map<string, string>();
      for (let i = 0; i < body.count; i++) {
        const at = key(body, i);
        const to = key(halo, i);
        expect(moved.get(at) ?? to).toBe(to);
        moved.set(at, to);
        expect(to).not.toBe(at);
      }
      // it stands on the road and nothing reaches past 1.7 m
      const box = new THREE.Box3().setFromBufferAttribute(body);
      expect(box.min.y).toBeGreaterThanOrEqual(-0.001);
      expect(box.max.y).toBeLessThanOrEqual(1.7);
      // the ground box is the shape's own length
      const [length] = shapeFor(vehicle, cls).footprint;
      const base = new THREE.Box3().setFromBufferAttribute(
        car.children[0].type === 'Mesh'
          ? ((car.children[0] as THREE.Mesh).geometry.getAttribute(
              'position',
            ) as THREE.BufferAttribute)
          : body,
      );
      expect(base.max.x - base.min.x).toBeCloseTo(length, 1);
      kit.dispose();
    },
  );
});

describe('the tail light lines', () => {
  const edgesOf = (car: THREE.Object3D) =>
    (car.children[3] as THREE.LineSegments).geometry.getAttribute(
      'position',
    ) as THREE.BufferAttribute;
  const has = (a: THREE.BufferAttribute, seg: number[]) => {
    const f = Math.fround;
    for (let i = 0; i + 1 < a.count; i += 2)
      if (
        a.getX(i) === f(seg[0]) &&
        a.getY(i) === f(seg[1]) &&
        a.getZ(i) === f(seg[2]) &&
        a.getX(i + 1) === f(seg[3]) &&
        a.getY(i + 1) === f(seg[4]) &&
        a.getZ(i + 1) === f(seg[5])
      )
        return true;
    return false;
  };
  it.each([
    ['Alpine A424', 4],
    ['Peugeot 9x8', 3],
  ])(
    '%s: its %i light segments are in the one body-edges buffer, behind the tail, and the car still draws 7 meshes',
    (vehicle, count) => {
      const kit = createCarKit(COLORS);
      const car = kit.make('Hyper', '#e64343', false, vehicle);
      expect(car.children).toHaveLength(7);
      expect(car.children[3]).toBeInstanceOf(THREE.LineSegments);
      const {shape} = shapeFor(vehicle, 'Hyper');
      const segments = lightSegments(shape);
      expect(segments).toHaveLength(count);
      const tailX = shape.hull[shape.hull.length - 1][0];
      const edges = edgesOf(car);
      for (const s of segments) {
        expect(s[0]).toBeLessThan(tailX);
        expect(s[0]).toBeGreaterThan(tailX - 0.05);
        expect(has(edges, s)).toBe(true);
      }
      kit.dispose();
    },
  );
  it('a model without lights has none, and a light line never adds a draw', () => {
    const kit = createCarKit(COLORS);
    const plain = shapeFor('Ferrari 499P', 'Hyper').shape;
    expect(lightSegments(plain)).toEqual([]);
    const lit = kit.make('Hyper', '#e64343', false, 'Alpine A424');
    const dark = kit.make('Hyper', '#e64343', false, 'Ferrari 499P');
    expect(lit.children).toHaveLength(dark.children.length);
    kit.dispose();
  });
});

describe('lights lead the outline', () => {
  const colorsOf = (car: THREE.Object3D) =>
    (car.children[3] as THREE.LineSegments).geometry.getAttribute(
      'color',
    ) as THREE.BufferAttribute;
  it.each([
    ['GT3', 'Porsche 911 GT3 R LMGT3'],
    ['Hyper', 'Alpine A424'],
  ])(
    '%s %s: the outline is 1 and each light vertex is LIGHT_GAIN, in the one body-edges buffer',
    (cls, vehicle) => {
      const kit = createCarKit(COLORS);
      const car = kit.make(cls, '#e64343', false, vehicle);
      const edges = (
        car.children[3] as THREE.LineSegments
      ).geometry.getAttribute('position');
      const color = colorsOf(car);
      expect(color.count).toBe(edges.count);
      const lights = lightSegments(shapeFor(vehicle, cls).shape).length * 2;
      expect(lights).toBeGreaterThan(0);
      for (let i = 0; i < edges.count; i++)
        expect(color.getX(i)).toBe(
          Math.fround(i >= edges.count - lights ? LIGHT_GAIN : 1),
        );
      const mat = (car.children[3] as THREE.LineSegments)
        .material as THREE.LineBasicMaterial;
      expect(mat.vertexColors).toBe(true);
      expect(car.children).toHaveLength(7);
      kit.dispose();
    },
  );
  it('a model without lights has an all-ones colour attribute, so the shared material still reads it', () => {
    const kit = createCarKit(COLORS);
    const car = kit.make('GT3', '#e64343', false, 'Toyota nothing');
    const color = colorsOf(car);
    for (let i = 0; i < color.count; i++) expect(color.getX(i)).toBe(1);
    kit.dispose();
  });
  it('a light line is brighter than the car colour it multiplies, and the gain is a real brightening', () => {
    expect(LIGHT_GAIN).toBeGreaterThan(1.5);
  });
});

describe('the wing end plates', () => {
  const plateVertices = (vehicle: string) => {
    const kit = createCarKit(COLORS);
    const car = kit.make('Hyper', '#e64343', false, vehicle);
    const {shape} = shapeFor(vehicle, 'Hyper');
    const pos = (car.children[1] as THREE.Mesh).geometry.getAttribute(
      'position',
    ) as THREE.BufferAttribute;
    const [, wy, , span] = shape.wing;
    const plate = shape.endPlate as {h: number; sweep: number};
    const out = {top: [] as number[], bottom: [] as number[]};
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(Math.abs(pos.getZ(i)) - span / 2) > 0.03) continue;
      if (Math.abs(pos.getY(i) - (wy + plate.h)) < 1e-4)
        out.top.push(pos.getX(i));
      if (Math.abs(pos.getY(i) - (wy - 0.1)) < 1e-4)
        out.bottom.push(pos.getX(i));
    }
    kit.dispose();
    return {...out, plate};
  };
  it.each(['Genesis GMR-001', 'Ferrari 499P', 'Alpine A424'])(
    '%s: a plate stands at each wing end, rising h above the wing',
    vehicle => {
      const {top, bottom, plate} = plateVertices(vehicle);
      expect(plate.h).toBeGreaterThan(0);
      // two plates, four top and four bottom corners each (a box has 36 non-indexed vertices; the rest are shared corners)
      expect(top.length).toBeGreaterThanOrEqual(8);
      expect(bottom.length).toBeGreaterThanOrEqual(8);
    },
  );
  it('a swept plate cuts its top back by the sweep; a square one does not', () => {
    const swept = plateVertices('Alpine A424');
    expect(Math.min(...swept.top)).toBeCloseTo(
      Math.min(...swept.bottom) - swept.plate.sweep,
      4,
    );
    const square = plateVertices('Genesis GMR-001');
    expect(Math.min(...square.top)).toBeCloseTo(Math.min(...square.bottom), 4);
  });
});
