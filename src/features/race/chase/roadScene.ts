// The road as an instrument: the measured width as a lit fill (so its slopes shade), thin edges, a cross rung every
// bin so the surface's rise and fall reads, the start line, and a faint grid on a flat datum below the lowest point of
// the lap as the ground to read height and speed against, and posts and ground ticks beside the road (roadSide.ts) to read
// speed and a car's angle against. No scenery beyond that.

import * as THREE from 'three';
import type {ChaseRoad} from '@/src/analysis/chaseRoad';
import type {RoadIndex} from '@/src/analysis/chaseRoadIndex';
import type {ChaseTheme} from '@/src/features/race/chase/chaseTypes';
import {buildRoadSide} from './roadSide';

type Point = {x: number; y: number; z: number};
type At = (row: number, col: number, out: Point) => void;

const EDGE_WIDTH_M = 0.38;
const START_LINE_DEPTH_M = 1.2;
const RUNG_EVERY_M = 10;
const GRID_M = 50;
const GRID_MARGIN_M = 400;
/** The ground runs this far past the lap's extent: past the fog's far plane, so its edge is never seen. */
const GROUND_REACH_M = 1800;
/** The near ground runs this far past each edge of the road, at the road's height. */
const NEAR_GROUND_M = 60;
/** The datum sits this far under the lowest point of the road. */
const DATUM_BELOW_M = 3;

export function flat(color: string, extra?: THREE.MeshBasicMaterialParameters) {
  return new THREE.MeshBasicMaterial({color: new THREE.Color(color), ...extra});
}

/** A grid of rows x cols points as one triangulated surface. */
function ribbon(rows: number, cols: number, at: At, material: THREE.Material, order = 0, lit = false) {
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
  if (lit) g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.renderOrder = order;
  return m;
}

/** The road is drawn this far behind and ahead of the followed car, metres of the path: the rest of the lap is fog and stray loops. */
export const WINDOW_BEHIND_M = 300;
export const WINDOW_AHEAD_M = 700;

/**
 * The road as one group. Everything that follows the road (the fill, the edges, the rungs, the posts and ticks) repeats
 * `spill` rows past the lap's end, so any window of the road is one contiguous run, and `userData.window(s)` draws only
 * the window around lap distance `s` (a draw range per piece, no rebuild).
 */
export function buildRoadScene(road: ChaseRoad, ix: RoadIndex, T: ChaseTheme): THREE.Group {
  const group = new THREE.Group();
  const n = road.cx.length;
  const spill = Math.ceil((WINDOW_BEHIND_M + WINDOW_AHEAD_M) / road.stepM) + 2;
  const windows: ((first: number, rows: number) => void)[] = [];
  const rowPoint = (r: number, lam: number, lift: number, out: Point) => {
    const i = r % n;
    out.x = road.cx[i] + ix.normalX[i] * lam;
    out.y = road.cy[i] + ix.normalY[i] * lam;
    // a banked road is tilted about its centre line: lam is the measured horizontal distance from it, and the right
    // side (lam > 0) rises by lam x tan(roll), so the surface leans by exactly the roll
    out.z = ix.height[i] + lift + lam * Math.tan(ix.bank[i]);
  };
  // a ribbon of two columns: a quad (6 indices) per row
  const strip = (mesh: THREE.Mesh) => {
    windows.push((first, rows) => mesh.geometry.setDrawRange(first * 6, rows * 6));
    return mesh;
  };
  group.add(
    strip(
      ribbon(
        n + 1 + spill,
        2,
        (r, k, out) => rowPoint(r, k ? road.hr[r % n] : -road.hl[r % n], 0, out),
        new THREE.MeshLambertMaterial({color: new THREE.Color(T.fill), side: THREE.DoubleSide}),
        0,
        true,
      ),
    ),
  );
  // a rung across the road every RUNG_EVERY_M of the path
  const rungs: number[] = [];
  const p: Point = {x: 0, y: 0, z: 0};
  const every = Math.max(1, Math.round(RUNG_EVERY_M / road.stepM));
  let rungCount = 0;
  for (let i = 0; i < n + spill; i += every) {
    rungCount++;
    rowPoint(i, -road.hl[i % n], 0.015, p);
    rungs.push(p.x, p.z, -p.y);
    rowPoint(i, road.hr[i % n], 0.015, p);
    rungs.push(p.x, p.z, -p.y);
  }
  const rungLines = lines(rungs, T.edgeFaint);
  windows.push((first, rows) => {
    const from = Math.min(rungCount, Math.ceil(first / every));
    rungLines.geometry.setDrawRange(from * 2, Math.min(rungCount - from, Math.floor(rows / every) + 1) * 2);
  });
  group.add(rungLines);
  for (const side of [-1, 1]) {
    group.add(
      strip(
        ribbon(
          n + 1 + spill,
          2,
          (r, k, out) => {
            const hw = side < 0 ? road.hl[r % n] : road.hr[r % n];
            rowPoint(r, side * (hw - (k ? 0 : EDGE_WIDTH_M)), 0.02, out);
          },
          flat(T.edge, {side: THREE.DoubleSide}), // the left strip's triangles wind the other way
          1,
        ),
      ),
    );
  }
  // the near ground: a strip at the road's own height out to NEAR_GROUND_M past each edge, so the road and the posts
  // stand on the land beside them and not above the flat horizon plane (gauge #6314)
  for (const side of [-1, 1]) {
    group.add(
      strip(
        ribbon(
          n + 1 + spill,
          2,
          (r, k, out) => {
            const hw = side < 0 ? road.hl[r % n] : road.hr[r % n];
            rowPoint(r, side * (hw + (k ? NEAR_GROUND_M : 0)), -0.02, out);
          },
          flat(T.fill, {side: THREE.DoubleSide, fog: true}),
          -1,
        ),
      ),
    );
  }
  let lowest = Infinity;
  for (let i = 0; i < n; i++) lowest = Math.min(lowest, ix.height[i]);
  const datum = lowest - DATUM_BELOW_M;
  group.add(datumGrid(road, datum, T.grid));
  group.add(ground(road, datum, T.fill));
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
  const side = buildRoadSide(road, ix, T, spill);
  windows.push(side.window);
  group.add(side.group);
  const windowRows = Math.ceil((WINDOW_BEHIND_M + WINDOW_AHEAD_M) / road.stepM) + 1;
  group.userData.window = (s: number) => {
    const first = Math.floor(((((s - WINDOW_BEHIND_M) % road.lengthM) + road.lengthM) % road.lengthM) / road.stepM);
    for (const w of windows) w(first, windowRows);
  };
  return group;
}

function lines(pos: number[], color: string): THREE.LineSegments {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({color: new THREE.Color(color)}));
}

/** The ground to the horizon: a flat plane on the datum under the grid, so the world ends in a horizon line and not in black. */
function ground(road: ChaseRoad, datum: number, color: string): THREE.Mesh {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < road.cx.length; i++) {
    x0 = Math.min(x0, road.cx[i]);
    x1 = Math.max(x1, road.cx[i]);
    y0 = Math.min(y0, road.cy[i]);
    y1 = Math.max(y1, road.cy[i]);
  }
  const reach = GROUND_REACH_M;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(x1 - x0 + 2 * reach, y1 - y0 + 2 * reach),
    new THREE.MeshBasicMaterial({color: new THREE.Color(color), fog: true}),
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.set((x0 + x1) / 2, datum - 0.05, -(y0 + y1) / 2);
  return plane;
}

/** A square grid on the datum, GRID_M apart, over the lap's extent and a margin, on whole multiples so it never shifts. */
function datumGrid(road: ChaseRoad, datum: number, color: string): THREE.LineSegments {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < road.cx.length; i++) {
    x0 = Math.min(x0, road.cx[i]);
    x1 = Math.max(x1, road.cx[i]);
    y0 = Math.min(y0, road.cy[i]);
    y1 = Math.max(y1, road.cy[i]);
  }
  const snap = (v: number, up: boolean) => (up ? Math.ceil : Math.floor)(v / GRID_M) * GRID_M;
  x0 = snap(x0 - GRID_MARGIN_M, false);
  x1 = snap(x1 + GRID_MARGIN_M, true);
  y0 = snap(y0 - GRID_MARGIN_M, false);
  y1 = snap(y1 + GRID_MARGIN_M, true);
  const pos: number[] = [];
  for (let x = x0; x <= x1; x += GRID_M) pos.push(x, datum, -y0, x, datum, -y1);
  for (let y = y0; y <= y1; y += GRID_M) pos.push(x0, datum, -y, x1, datum, -y);
  return lines(pos, color);
}

export function disposeGroup(group: THREE.Object3D) {
  group.traverse(o => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => x.dispose());
  });
}
