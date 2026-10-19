// The player's inputs painted on the road ahead (throttle / brake colour along his lap as driven), and 3, 2 and 1 bars
// at 150, 100 and 50 m before each of his brake-ons. Measured from his trace, not scenery.

import * as THREE from 'three';
import type {RoadIndex} from '@/src/analysis/chaseRoadIndex';
import type {ChaseRibbon, ChaseTheme} from '@/src/features/race/chase/chaseTypes';
import {setWorld} from './sceneFrame';

const HALF_WIDTH_M = 0.3;
const BRAKE_ON_PCT = 55;
const BRAKE_OFF_PCT = 10;
const BRAKE_COLOUR_PCT = 4;
const FULL_THROTTLE_PCT = 96;
const LIFT_PCT = 8;
const BAR_MARKS: [number, number][] = [
  [150, 3],
  [100, 2],
  [50, 1],
];
const DEFAULT_HALF_ROAD_M = 7;

export interface InputsScene {
  mesh: THREE.Mesh;
  bars: THREE.Group;
  count: number;
}

export function buildInputsScene(rb: ChaseRibbon, ix: RoadIndex, T: ChaseTheme): InputsScene {
  const n = rb.x.length;
  const pos = new Float32Array(n * 6);
  const col = new Float32Array(n * 6);
  const colour = new THREE.Color();
  for (let k = 0; k < n; k++) {
    const a = Math.max(0, k - 1);
    const b = Math.min(n - 1, k + 1);
    const hd = Math.atan2(rb.y[b] - rb.y[a], rb.x[b] - rb.x[a]);
    const nx = -Math.sin(hd) * HALF_WIDTH_M;
    const ny = Math.cos(hd) * HALF_WIDTH_M;
    const near = ix.nearest(rb.x[k], rb.y[k], 3);
    const z = near ? ix.heightAt(near.s) : 0;
    for (const [j, sg] of [
      [0, 1],
      [1, -1],
    ]) {
      const o = (k * 2 + j) * 3;
      pos[o] = rb.x[k] + nx * sg;
      pos[o + 1] = z + 0.06;
      pos[o + 2] = -(rb.y[k] + ny * sg);
    }
    const br = rb.br[k];
    const th = rb.th[k];
    colour.set(br > BRAKE_COLOUR_PCT ? T.bad : th > FULL_THROTTLE_PCT ? T.good : th > LIFT_PCT ? T.accent : T.muted);
    for (let j = 0; j < 2; j++) {
      const o = (k * 2 + j) * 3;
      col[o] = colour.r;
      col[o + 1] = colour.g;
      col[o + 2] = colour.b;
    }
  }
  const index: number[] = [];
  for (let k = 0; k < n - 1; k++) {
    const a = k * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(index);
  const mesh = new THREE.Mesh(
    g,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -8,
      polygonOffsetUnits: -8,
    }),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;

  const bars = new THREE.Group();
  const barMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(T.text),
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -9,
    polygonOffsetUnits: -9,
  });
  let braking = false;
  for (let k = 0; k < n; k++) {
    if (!braking && rb.br[k] > BRAKE_ON_PCT) {
      braking = true;
      // on the outside of the corner: the turn direction a few points on
      const k2 = Math.min(n - 1, k + 12);
      const k3 = Math.min(n - 1, k + 24);
      const turn = (rb.x[k2] - rb.x[k]) * (rb.y[k3] - rb.y[k2]) - (rb.y[k2] - rb.y[k]) * (rb.x[k3] - rb.x[k2]);
      const side = turn > 0 ? -1 : 1;
      for (const [dist, count] of BAR_MARKS) {
        const kk = k - Math.round(dist / rb.stepM);
        if (kk < 1 || kk >= n - 1) continue;
        const hd = Math.atan2(rb.y[kk + 1] - rb.y[kk - 1], rb.x[kk + 1] - rb.x[kk - 1]);
        const near = ix.nearest(rb.x[kk], rb.y[kk], 3);
        const hw = near ? ix.widthAt(near.s, near.side) : DEFAULT_HALF_ROAD_M;
        const z = near ? ix.heightAt(near.s) : 0;
        for (let b = 0; b < count; b++) {
          const along = b * 0.9;
          const cx = rb.x[kk] + Math.cos(hd) * along + Math.sin(hd) * side * (hw - 0.9);
          const cy = rb.y[kk] + Math.sin(hd) * along - Math.cos(hd) * side * (hw - 0.9);
          const m = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 1.7), barMaterial);
          m.rotation.order = 'YXZ';
          m.rotation.set(-Math.PI / 2, hd - Math.PI / 2, 0);
          setWorld(m.position, cx, cy, z + 0.05);
          bars.add(m);
        }
      }
    } else if (braking && rb.br[k] < BRAKE_OFF_PCT) braking = false;
  }
  return {mesh, bars, count: n};
}
