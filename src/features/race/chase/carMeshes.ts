// A car is a low-poly body in its class colour: a hull lofted through a few stations that narrows to the nose, a dark
// glasshouse and a rear wing, lit flat so the facets read, drawn in the class colour's thin edges over a dimmed fill. Under it a dark footprint grounds it
// on the road, and a short tick runs forward from the nose. The followed car keeps its class colour and is marked by a
// thin ring on the road and light edges: nothing else about it differs. No wheels, liveries or textures.

import * as THREE from 'three';

/** Class footprints (length x width, metres): the class nominal, the data carries no model dimensions. */
const SIZE: Record<string, [number, number]> = {Hyper: [5.0, 2.0], LMP2: [4.75, 1.9], GT3: [4.65, 1.95]};

/**
 * A body as stations along the car (x forward from the centre, metres): at each, the half-width at the sill and at the
 * top, the shoulder height and the top height. Lofted between stations, flat shaded, it is a low-poly hull that narrows
 * to the nose and carries a cabin. Proportions follow the class shapes of prototype v2 (thread 83), simplified.
 */
type Station = [x: number, halfW: number, shoulderY: number, topHalfW: number, topY: number];

interface ClassShape {
  hull: Station[];
  /** The glasshouse, drawn dark over the hull. */
  cabin: Station[];
  /** Rear wing: centre x, top y, chord, span. */
  wing: [number, number, number, number];
  /** Prototype shark fin: from x, length, height; null on a GT. */
  fin: [number, number, number] | null;
}

const SILL_Y = 0.1;

const SHAPES: Record<string, ClassShape> = {
  GT3: {
    hull: [
      [2.33, 0.62, 0.34, 0.42, 0.44],
      [1.85, 0.92, 0.52, 0.7, 0.66],
      [1.0, 0.97, 0.7, 0.72, 0.84],
      [-0.9, 0.98, 0.78, 0.7, 0.9],
      [-1.75, 0.99, 0.82, 0.78, 0.94],
      [-2.1, 0.97, 0.8, 0.74, 0.9],
      [-2.34, 0.86, 0.6, 0.6, 0.7],
    ],
    cabin: [
      [0.8, 0.68, 0.84, 0.64, 0.86],
      [0.1, 0.7, 0.86, 0.56, 1.2],
      [-0.75, 0.68, 0.88, 0.52, 1.16],
      [-1.2, 0.66, 0.9, 0.6, 0.94],
    ],
    wing: [-2.15, 1.22, 0.42, 1.85],
    fin: null,
  },
  Hyper: {
    hull: [
      [2.5, 0.7, 0.24, 0.5, 0.32],
      [1.9, 0.98, 0.42, 0.76, 0.56],
      [1.0, 0.99, 0.62, 0.66, 0.7],
      [-0.6, 0.94, 0.66, 0.6, 0.76],
      [-1.8, 1.0, 0.76, 0.8, 0.86],
      [-2.25, 0.98, 0.74, 0.76, 0.82],
      [-2.5, 0.86, 0.52, 0.6, 0.64],
    ],
    cabin: [
      [0.95, 0.56, 0.7, 0.5, 0.72],
      [0.3, 0.6, 0.74, 0.46, 1.06],
      [-0.45, 0.56, 0.76, 0.42, 1.04],
      [-0.95, 0.5, 0.76, 0.42, 0.8],
    ],
    wing: [-2.32, 1.02, 0.4, 1.9],
    fin: [-1.95, 1.4, 0.38],
  },
  LMP2: {
    hull: [
      [2.36, 0.66, 0.24, 0.48, 0.32],
      [1.8, 0.93, 0.4, 0.72, 0.52],
      [0.9, 0.94, 0.58, 0.62, 0.66],
      [-0.6, 0.88, 0.62, 0.56, 0.72],
      [-1.7, 0.95, 0.72, 0.76, 0.82],
      [-2.12, 0.93, 0.7, 0.72, 0.78],
      [-2.36, 0.82, 0.5, 0.58, 0.62],
    ],
    cabin: [
      [0.82, 0.52, 0.66, 0.46, 0.68],
      [0.3, 0.56, 0.7, 0.42, 1.0],
      [-0.4, 0.52, 0.72, 0.4, 0.98],
      [-0.85, 0.48, 0.72, 0.4, 0.76],
    ],
    wing: [-2.2, 1.12, 0.4, 1.8],
    fin: [-1.8, 1.5, 0.46],
  },
};

const TICK_OF_LENGTH = 0.3;
/** The ring's diameter is about a car's length (chord, thread 83 #6151). */
const RING_INNER_M = 2.35;
const RING_OUTER_M = 2.4;
/** The body is the class colour dimmed, so its lit edges carry the colour; the glasshouse is darker still. */
const BODY_SHADE = 0.42;
const CABIN_SHADE = 0.14;
const EDGE_ANGLE_DEG = 25;

type Local = {x: number; z: number};

function footprint(carClass: string): [number, number] {
  return SIZE[carClass] ?? SIZE.GT3;
}

function shapeOf(carClass: string): ClassShape {
  return SHAPES[carClass] ?? SHAPES.GT3;
}

/** The car's footprint on the ground in its own frame: x forward (the nose at +L/2), z to the right. */
export function carOutline(carClass: string): Local[] {
  const [L, W] = footprint(carClass);
  const half: Local[] = [
    {x: L * 0.42, z: W * 0.36},
    {x: L * 0.2, z: W / 2},
    {x: -L / 2 + 0.1, z: W / 2},
    {x: -L / 2, z: W * 0.45},
  ];
  return [{x: L / 2, z: 0}, ...half, ...half.reverse().map(p => ({x: p.x, z: -p.z}))];
}

/** The heading tick: from the nose, forward, a fraction of the car's length. */
export function tickSegment(carClass: string): [Local, Local] {
  const [L] = footprint(carClass);
  return [
    {x: L / 2, z: 0},
    {x: L / 2 + L * TICK_OF_LENGTH, z: 0},
  ];
}

/** The six corners of a station's cross-section, left sill round to right sill. */
function ring(st: Station, sillY: number): THREE.Vector3[] {
  const [x, w, sh, wt, top] = st;
  return [
    new THREE.Vector3(x, sillY, -w),
    new THREE.Vector3(x, sh, -w),
    new THREE.Vector3(x, top, -wt),
    new THREE.Vector3(x, top, wt),
    new THREE.Vector3(x, sh, w),
    new THREE.Vector3(x, sillY, w),
  ];
}

/** Stations lofted into a closed faceted hull (non-indexed, so every facet keeps its own flat normal). */
function loft(stations: Station[], sillY: number): THREE.BufferGeometry {
  const rings = stations.map(st => ring(st, sillY));
  const tri: THREE.Vector3[] = [];
  for (let k = 0; k < rings.length - 1; k++) {
    const a = rings[k];
    const b = rings[k + 1];
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6;
      tri.push(a[i], b[i], b[j], a[i], b[j], a[j]);
    }
  }
  // the nose and tail caps, fanned from their first corner
  for (const [r, flip] of [[rings[0], false], [rings[rings.length - 1], true]] as const) {
    for (let i = 1; i < 5; i++) tri.push(...(flip ? [r[0], r[i], r[i + 1]] : [r[0], r[i + 1], r[i]]));
  }
  const g = new THREE.BufferGeometry().setFromPoints(tri);
  g.computeVertexNormals();
  return g;
}

function slab(x: number, y: number, len: number, height: number, width: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(len, height, width).toNonIndexed();
  g.translate(x, y, 0);
  return g;
}

/** Everything one class needs, shared by every car of that class. */
interface ClassKit {
  body: THREE.BufferGeometry;
  cabin: THREE.BufferGeometry;
  bodyEdges: THREE.BufferGeometry;
  cabinEdges: THREE.BufferGeometry;
  base: THREE.ShapeGeometry;
  tick: THREE.BufferGeometry;
}

function buildClass(carClass: string): ClassKit {
  const c = shapeOf(carClass);
  const [wx, wy, chord, span] = c.wing;
  const tail = c.hull[c.hull.length - 1];
  const parts = [
    loft(c.hull, SILL_Y),
    slab(wx, wy, chord, 0.05, span),
    ...[-1, 1].map(side => slab(wx + 0.08, (wy + tail[4]) / 2, 0.12, wy - tail[4], 0.03).translate(0, 0, side * span * 0.42)),
  ];
  if (c.fin) parts.push(slab(c.fin[0] + c.fin[1] / 2, c.hull[3][4] + c.fin[2] / 2 - 0.05, c.fin[1], c.fin[2], 0.03));
  const body = mergeAll(parts);
  const cabin = loft(c.cabin, c.cabin[0][2] - 0.02);
  const outline = new THREE.Shape(carOutline(carClass).map(p => new THREE.Vector2(p.x, -p.z)));
  const base = new THREE.ShapeGeometry(outline);
  base.rotateX(-Math.PI / 2);
  const tick = new THREE.BufferGeometry().setFromPoints(tickSegment(carClass).map(p => new THREE.Vector3(p.x, 0.04, p.z)));
  return {
    body,
    cabin,
    bodyEdges: new THREE.EdgesGeometry(body, EDGE_ANGLE_DEG),
    cabinEdges: new THREE.EdgesGeometry(cabin, EDGE_ANGLE_DEG),
    base,
    tick,
  };
}

/** Non-indexed geometries joined into one, so a body is one draw. */
function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map(p => (p.index ? p.toNonIndexed() : p));

  let n = 0;
  for (const p of flat) n += p.getAttribute('position').count;
  const pos = new Float32Array(n * 3);
  let o = 0;
  for (const p of flat) {
    const a = p.getAttribute('position').array as Float32Array;
    pos.set(a, o);
    o += a.length;
  }
  for (const p of [...parts, ...flat]) p.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

const onTop = {polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2};

export interface CarObject extends THREE.Group {
  userData: {player: boolean; faded: boolean};
}

/** A car between the camera and the followed car is drawn see-through, so it never hides the one being followed. */
const FADED_OPACITY = 0.18;

/**
 * The cars of one engine: geometries are shared per class (and the ring), materials belong to each car. `release`
 * frees a removed car's materials, `dispose` the shared geometries, so nothing outlives the engine.
 */
export interface CarKit {
  make(carClass: string, color: string, player: boolean): CarObject;
  release(car: CarObject): void;
  /** Draw the car see-through (between the camera and the followed car) or solid. */
  fade(car: CarObject, faded: boolean): void;
  dispose(): void;
}

export function createCarKit(colors: {bg: string; edge: string; mark: string}): CarKit {
  const classes = new Map<string, ClassKit>();
  let ring: THREE.RingGeometry | null = null;
  const kitFor = (carClass: string): ClassKit => {
    const key = SHAPES[carClass] ? carClass : 'GT3';
    const cached = classes.get(key);
    if (cached) return cached;
    const made = buildClass(key);
    classes.set(key, made);
    return made;
  };
  const ringGeometry = () => {
    if (!ring) {
      ring = new THREE.RingGeometry(RING_INNER_M, RING_OUTER_M, 72);
      ring.rotateX(-Math.PI / 2);
    }
    return ring;
  };
  return {
    make(carClass, color, player) {
      const k = kitFor(carClass);
      const paint = new THREE.Color(color);
      const group = new THREE.Group() as CarObject;
      const edgeColor = player ? new THREE.Color(colors.edge) : paint;
      group.add(
        new THREE.Mesh(k.base, new THREE.MeshBasicMaterial({color: new THREE.Color(colors.bg), ...onTop})),
        new THREE.Mesh(k.body, new THREE.MeshLambertMaterial({color: paint.clone().multiplyScalar(BODY_SHADE), flatShading: true, side: THREE.DoubleSide})),
        new THREE.Mesh(k.cabin, new THREE.MeshLambertMaterial({color: paint.clone().multiplyScalar(CABIN_SHADE), flatShading: true, side: THREE.DoubleSide})),
        new THREE.LineSegments(k.bodyEdges, new THREE.LineBasicMaterial({color: edgeColor})),
        new THREE.LineSegments(k.cabinEdges, new THREE.LineBasicMaterial({color: edgeColor})),
        new THREE.Line(k.tick, new THREE.LineBasicMaterial({color: paint})),
      );
      if (player) {
        group.add(new THREE.Mesh(ringGeometry(), new THREE.MeshBasicMaterial({color: new THREE.Color(colors.mark), ...onTop})));
      }
      group.userData = {player, faded: false};
      return group;
    },
    fade(car, faded) {
      if (car.userData.faded === faded) return;
      car.userData.faded = faded;
      car.traverse(o => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (!m) return;
        m.transparent = faded;
        m.opacity = faded ? FADED_OPACITY : 1;
        m.depthWrite = !faded;
      });
    },
    release(car) {
      car.traverse(o => {
        const m = (o as THREE.Mesh).material;
        if (m) (Array.isArray(m) ? m : [m]).forEach(x => x.dispose());
      });
    },
    dispose() {
      for (const k of classes.values()) {
        k.body.dispose();
        k.cabin.dispose();
        k.bodyEdges.dispose();
        k.cabinEdges.dispose();
        k.base.dispose();
        k.tick.dispose();
      }
      classes.clear();
      ring?.dispose();
      ring = null;
    },
  };
}
