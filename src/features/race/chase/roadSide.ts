// The world beside the road: a post every POST_EVERY_M each side and short ticks on the ground out to TICK_OFFSETS_M
// past each edge, so speed and a car's angle to the road can be read against something (lookout, thread 94: at 160 km/h
// in a void nothing moves past the car but a faint grid). Drawn from the road's own edges, nothing from outside the data.
// Two draw calls: the posts as one merged mesh, the ticks as one line set. Both repeat `spill` rows past the lap's end
// so a window of the road never wraps, and return `window(firstRow, rows)`, which sets what is drawn.

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

/** Indices of one box: 6 faces of 2 triangles. */
const BOX_INDICES = 36;
const BOX_CORNERS = [
  [-1, 0, -1],
  [1, 0, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [-1, 1, 1],
] as const;
const BOX_TRIANGLES = [
  [0, 1, 2],
  [0, 2, 3],
  [4, 6, 5],
  [4, 7, 6],
  [0, 4, 5],
  [0, 5, 1],
  [3, 2, 6],
  [3, 6, 7],
  [0, 3, 7],
  [0, 7, 4],
  [1, 5, 6],
  [1, 6, 2],
] as const;

export interface RoadSide {
  group: THREE.Group;
  /** Draw only the rows from `first` for `rows` of them (road points, the spill included). */
  window(first: number, rows: number): void;
}

export function buildRoadSide(road: ChaseRoad, ix: RoadIndex, T: ChaseTheme, spill: number): RoadSide {
  const group = new THREE.Group();
  const n = road.cx.length;
  const rowsAll = n + spill;
  const postEvery = Math.max(1, Math.round(POST_EVERY_M / road.stepM));
  const tickEvery = Math.max(1, Math.round(TICK_EVERY_M / road.stepM));
  const beside = (i: number, side: -1 | 1, offsetM: number) => {
    const k = i % n;
    const edge = side < 0 ? road.hl[k] : road.hr[k];
    const lam = side * (edge + offsetM);
    return {x: road.cx[k] + ix.normalX[k] * lam, y: road.cy[k] + ix.normalY[k] * lam, z: ix.height[k] + lam * Math.tan(ix.bank[k])};
  };

  // posts: each is 8 vertices and 36 indices, two per row, rows in lap order
  const pos: number[] = [];
  const index: number[] = [];
  let postRows = 0;
  for (let i = 0; i < rowsAll; i += postEvery) {
    postRows++;
    for (const side of [-1, 1] as const) {
      const p = beside(i, side, POST_OFFSET_M);
      const base = pos.length / 3;
      for (const [cx, cy, cz] of BOX_CORNERS) pos.push(p.x + (cx * POST_W_M) / 2, p.z + cy * POST_H_M, -p.y + (cz * POST_W_M) / 2);
      for (const tri of BOX_TRIANGLES) index.push(base + tri[0], base + tri[1], base + tri[2]);
    }
  }
  const postGeo = new THREE.BufferGeometry();
  postGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  postGeo.setIndex(index);
  group.add(new THREE.Mesh(postGeo, new THREE.MeshBasicMaterial({color: new THREE.Color(T.muted), side: THREE.DoubleSide})));

  // ticks: 12 segments (24 vertices) per row, along the road's direction
  const ticks: number[] = [];
  let tickRows = 0;
  for (let i = 0; i < rowsAll; i += tickEvery) {
    tickRows++;
    const dx = Math.cos(ix.heading[i % n]) * (TICK_LEN_M / 2);
    const dy = Math.sin(ix.heading[i % n]) * (TICK_LEN_M / 2);
    for (const side of [-1, 1] as const) {
      for (const off of TICK_OFFSETS_M) {
        const p = beside(i, side, off);
        ticks.push(p.x - dx, p.z + 0.01, -(p.y - dy), p.x + dx, p.z + 0.01, -(p.y + dy));
      }
    }
  }
  const tickGeo = new THREE.BufferGeometry();
  tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(ticks, 3));
  group.add(new THREE.LineSegments(tickGeo, new THREE.LineBasicMaterial({color: new THREE.Color(T.edgeFaint)})));

  const perTickRow = 2 * TICK_OFFSETS_M.length * 2;
  const rowsOf = (first: number, rows: number, every: number, have: number) => {
    const from = Math.min(have, Math.ceil(first / every));
    return {from, count: Math.min(have - from, Math.floor(rows / every) + 1)};
  };
  return {
    group,
    window(first, rows) {
      const p = rowsOf(first, rows, postEvery, postRows);
      postGeo.setDrawRange(p.from * 2 * BOX_INDICES, p.count * 2 * BOX_INDICES);
      const t = rowsOf(first, rows, tickEvery, tickRows);
      tickGeo.setDrawRange(t.from * perTickRow, t.count * perTickRow);
    },
  };
}
