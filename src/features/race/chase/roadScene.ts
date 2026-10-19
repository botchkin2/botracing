// The road as a flat instrument: the measured width as a fill, thin edges, the start line, and, only where the track has
// a measured height profile, a faint drop line from each edge every 20 m so the height reads without scenery.

import * as THREE from 'three';
import type {ChaseRoad} from '@/src/analysis/chaseRoad';
import type {RoadIndex} from '@/src/analysis/chaseRoadIndex';
import type {ChaseTheme} from '@/src/features/race/chase/chaseTypes';

type Point = {x: number; y: number; z: number};
type At = (row: number, col: number, out: Point) => void;

const EDGE_WIDTH_M = 0.38;
const START_LINE_DEPTH_M = 1.2;
const DROP_EVERY_M = 20;

export function flat(color: string, extra?: THREE.MeshBasicMaterialParameters) {
  return new THREE.MeshBasicMaterial({color: new THREE.Color(color), ...extra});
}

/** A grid of rows x cols points as one triangulated surface. */
function ribbon(rows: number, cols: number, at: At, material: THREE.Material, order = 0) {
  const pos = new Float32Array(rows * cols * 3);
  const p: Point = {x: 0, y: 0, z: 0};
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      at(r, k, p);
      const o = (r * cols + k) * 3;
      pos[o] = p.x;
      pos[o + 1] = p.z;
      pos[o + 2] = -p.y;
    }
  }
  const index: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let k = 0; k < cols - 1; k++) {
      const a = r * cols + k;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(index);
  const m = new THREE.Mesh(g, material);
  m.renderOrder = order;
  return m;
}

export function buildRoadScene(road: ChaseRoad, ix: RoadIndex, T: ChaseTheme): THREE.Group {
  const group = new THREE.Group();
  const n = road.cx.length;
  const rowPoint = (r: number, lam: number, lift: number, out: Point) => {
    const i = r % n;
    out.x = road.cx[i] + ix.normalX[i] * lam;
    out.y = road.cy[i] + ix.normalY[i] * lam;
    out.z = ix.height[i] + lift;
  };
  group.add(
    ribbon(n + 1, 2, (r, k, out) => rowPoint(r, k ? road.hr[r % n] : -road.hl[r % n], 0, out), flat(T.fill), 0),
  );
  for (const side of [-1, 1]) {
    group.add(
      ribbon(
        n + 1,
        2,
        (r, k, out) => {
          const hw = side < 0 ? road.hl[r % n] : road.hr[r % n];
          rowPoint(r, side * (hw - (k ? 0 : EDGE_WIDTH_M)), 0.02, out);
        },
        flat(T.edge, {side: THREE.DoubleSide}), // the left strip's triangles wind the other way
        1,
      ),
    );
  }
  if (ix.hasHeight) {
    let lowest = Infinity;
    for (let i = 0; i < n; i++) lowest = Math.min(lowest, ix.height[i]);
    const datum = lowest - 2;
    const pos: number[] = [];
    for (let i = 0; i < n; i += Math.max(1, Math.round(DROP_EVERY_M / road.stepM))) {
      for (const side of [-1, 1]) {
        const hw = side < 0 ? road.hl[i] : road.hr[i];
        const x = road.cx[i] + ix.normalX[i] * side * hw;
        const y = road.cy[i] + ix.normalY[i] * side * hw;
        pos.push(x, ix.height[i], -y, x, datum, -y);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    group.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({color: new THREE.Color(T.edgeFaint)})));
  }
  // the start line, flat on the road
  group.add(
    ribbon(
      2,
      2,
      (r, k, out) => {
        const lam = k ? road.hr[0] : -road.hl[0];
        const along = r ? START_LINE_DEPTH_M : 0;
        out.x = road.cx[0] + ix.normalX[0] * lam + Math.cos(ix.heading[0]) * along;
        out.y = road.cy[0] + ix.normalY[0] * lam + Math.sin(ix.heading[0]) * along;
        out.z = ix.height[0] + 0.03;
      },
      flat(T.text),
      1,
    ),
  );
  return group;
}

export function disposeGroup(group: THREE.Object3D) {
  group.traverse(o => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => x.dispose());
  });
}
