// The world beside the road: a post every POST_EVERY_M each side and short ticks on the ground out to TICK_OFFSETS_M
// past each edge, so speed and a car's angle to the road can be read against something (lookout, thread 94: at 160 km/h
// in a void nothing moves past the car but a faint grid). Drawn from the road's own edges, nothing from outside the data.
// Two draw calls: one InstancedMesh for the posts, one line set for the ticks.

import * as THREE from 'three';

import type {ChaseRoad} from '@/src/analysis/chaseRoad';
import type {RoadIndex} from '@/src/analysis/chaseRoadIndex';

import type {ChaseTheme} from './chaseTypes';

const POST_EVERY_M = 20;
const POST_OFFSET_M = 2.5;
const POST_W_M = 0.25;
const POST_H_M = 1.8;
const TICK_EVERY_M = 5;
const TICK_LEN_M = 4;
const TICK_OFFSETS_M = [3, 6, 10, 16, 24, 40];

export function buildRoadSide(road: ChaseRoad, ix: RoadIndex, T: ChaseTheme): THREE.Group {
  const group = new THREE.Group();
  const n = road.cx.length;
  const postEvery = Math.max(1, Math.round(POST_EVERY_M / road.stepM));
  const tickEvery = Math.max(1, Math.round(TICK_EVERY_M / road.stepM));
  const beside = (i: number, side: -1 | 1, offsetM: number) => {
    const edge = side < 0 ? road.hl[i] : road.hr[i];
    const lam = side * (edge + offsetM);
    return {x: road.cx[i] + ix.normalX[i] * lam, y: road.cy[i] + ix.normalY[i] * lam, z: ix.height[i]};
  };

  const posts = new THREE.InstancedMesh(
    new THREE.BoxGeometry(POST_W_M, POST_H_M, POST_W_M),
    new THREE.MeshBasicMaterial({color: new THREE.Color(T.muted)}),
    Math.ceil(n / postEvery) * 2,
  );
  const at = new THREE.Matrix4();
  let k = 0;
  for (let i = 0; i < n; i += postEvery) {
    for (const side of [-1, 1] as const) {
      const p = beside(i, side, POST_OFFSET_M);
      at.setPosition(p.x, p.z + POST_H_M / 2, -p.y);
      posts.setMatrixAt(k++, at);
    }
  }
  posts.count = k;
  group.add(posts);

  const ticks: number[] = [];
  for (let i = 0; i < n; i += tickEvery) {
    for (const side of [-1, 1] as const) {
      for (const off of TICK_OFFSETS_M) {
        const p = beside(i, side, off);
        // along the road's direction: a stripe the eye can count as it passes
        const dx = Math.cos(ix.heading[i]) * (TICK_LEN_M / 2);
        const dy = Math.sin(ix.heading[i]) * (TICK_LEN_M / 2);
        ticks.push(p.x - dx, p.z + 0.01, -(p.y - dy), p.x + dx, p.z + 0.01, -(p.y + dy));
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(ticks, 3));
  group.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({color: new THREE.Color(T.edgeFaint)})));
  return group;
}
