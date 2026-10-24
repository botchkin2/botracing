import {describe, expect, it} from '@jest/globals';
import * as THREE from 'three';

import {carOutline, createCarKit, tickSegment} from './carMeshes';

// The engine places a car with rotation.set(0, heading, 0) in the three.js frame (x east, y up, z = -north).
const placed = (local: {x: number; z: number}, heading: number) => {
  const o = new THREE.Object3D();
  o.rotation.order = 'YZX';
  o.rotation.set(0, heading, 0);
  o.updateMatrix();
  const p = new THREE.Vector3(local.x, 0, local.z).applyMatrix4(o.matrix);
  return {x: p.x, y: -p.z}; // back to the world frame: x east, y north
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
      expect(Math.atan2(wb.y - wa.y, wb.x - wa.x)).toBeCloseTo(Math.atan2(Math.sin(h), Math.cos(h)));
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
  it('stand on the road, nose forward: the body spans its class length and sits between 0 and 1.4 m', () => {
    const kit = createCarKit({bg: '#000000', edge: '#ffffff', mark: '#fea92f'});
    const car = kit.make('Hyper', '#ff0000', false);
    const box = new THREE.Box3().setFromObject(car);
    expect(box.min.y).toBeGreaterThanOrEqual(-1e-9);
    expect(box.max.y).toBeLessThan(1.4);
    expect(box.max.x).toBeGreaterThan(2.4); // the tick runs past the nose
    expect(box.min.x).toBeLessThan(-2.4); // the tail, or the wing just behind it
    expect(box.min.x).toBeGreaterThan(-2.7);
    expect(box.max.z - box.min.z).toBeCloseTo(2.0, 1);
    kit.release(car);
    kit.dispose();
  });
});

describe('car kit', () => {
  it('fades a car see-through and back, every material', () => {
    const kit = createCarKit({bg: '#000000', edge: '#ffffff', mark: '#ffffff'});
    const car = kit.make('LMP2', '#3366ff', false);
    const mats = () => {
      const out: THREE.Material[] = [];
      car.traverse(o => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (m) out.push(m);
      });
      return out;
    };
    kit.fade(car, true);
    expect(mats().every(m => m.transparent && m.opacity < 0.5 && !m.depthWrite)).toBe(true);
    kit.fade(car, false);
    expect(mats().every(m => !m.transparent && m.opacity === 1 && m.depthWrite)).toBe(true);
    kit.release(car);
    kit.dispose();
  });

  it('frees the materials of released cars and the shared geometries on dispose, nothing earlier', () => {
    const kit = createCarKit({bg: '#000000', edge: '#ffffff', mark: '#fea92f'});
    const player = kit.make('GT3', '#ff0000', true);
    const other = kit.make('GT3', '#ff0000', false);
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    for (const car of [player, other]) {
      car.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.geometry) geos.add(m.geometry);
        if (m.material) mats.add(m.material as THREE.Material);
      });
    }
    const geoDisposed: THREE.BufferGeometry[] = [];
    const matDisposed: THREE.Material[] = [];
    geos.forEach(g => g.addEventListener('dispose', () => geoDisposed.push(g)));
    mats.forEach(m => m.addEventListener('dispose', () => matDisposed.push(m)));
    // two cars of one class share their geometries (footprint, body, cabin, two edge sets, tick), plus the player's ring
    expect(geos.size).toBe(7);
    kit.release(other);
    expect(matDisposed.length).toBe(6);
    expect(geoDisposed.length).toBe(0);
    kit.release(player);
    kit.dispose();
    expect(matDisposed.length).toBe(6 + 7);
    expect(geoDisposed.length).toBe(7);
  });
});

describe('car families in the kit', () => {
  const colors = {bg: '#000000', edge: '#ffffff', mark: '#fea92f'};
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
      if ((o as THREE.LineSegments).isLineSegments) lines.push(o as THREE.LineSegments);
    });
    return (lines[0].material as THREE.LineBasicMaterial).color.getHexString();
  };

  it('two cars of one family share their shape, and a different family has its own', () => {
    const kit = createCarKit(colors);
    const a = kit.make('GT3', '#ff8800', false, 'BMW M4 LMGT3');
    const b = kit.make('GT3', '#ff8800', false, 'Mercedes-AMG LMGT3'); // the same family (front engine)
    const c = kit.make('GT3', '#ff8800', false, 'McLaren 720S LMGT3 Evo');
    const bodyOf = (car: THREE.Object3D) => (car.children[1] as THREE.Mesh).geometry;
    expect(bodyOf(a)).toBe(bodyOf(b));
    expect(bodyOf(a)).not.toBe(bodyOf(c));
    expect(geometries(a).size).toBe(6); // footprint, body, cabin, two edge sets, tick (the ring is the followed car's)
    kit.dispose();
  });
  it('a model with no family draws the class hull, the same as no model at all', () => {
    const kit = createCarKit(colors);
    const none = kit.make('GT3', '#ff8800', false);
    const unknown = kit.make('GT3', '#ff8800', false, 'Some New Car');
    expect((none.children[1] as THREE.Mesh).geometry).toBe((unknown.children[1] as THREE.Mesh).geometry);
    kit.dispose();
  });
  it('the body edges carry the model step, the fill the class colour, and the followed car keeps its light edges', () => {
    const kit = createCarKit(colors);
    const first = kit.make('Hyper', '#3366ff', false, 'Ferrari 499P'); // step 0 of lmh
    const second = kit.make('Hyper', '#3366ff', false, 'Peugeot 9x8'); // step 1 of lmh
    expect(bodyEdgeColor(first)).toBe('3366ff');
    expect(bodyEdgeColor(second)).not.toBe(bodyEdgeColor(first));
    const mine = kit.make('Hyper', '#3366ff', true, 'Peugeot 9x8');
    expect(bodyEdgeColor(mine)).toBe('ffffff');
    const fill = (car: THREE.Object3D) => ((car.children[1] as THREE.Mesh).material as THREE.MeshLambertMaterial).color.getHexString();
    expect(fill(first)).toBe(fill(second)); // the fill is the class colour on both
    kit.dispose();
  });
  it('remembers the model on the car, so the engine can tell a changed model', () => {
    const kit = createCarKit(colors);
    expect(kit.make('GT3', '#ff8800', false, 'Ford Mustang LMGT3').userData.vehicle).toBe('Ford Mustang LMGT3');
    expect(kit.make('GT3', '#ff8800', false).userData.vehicle).toBeNull();
    kit.dispose();
  });
});