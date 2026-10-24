// A car is a low-poly body in its class colour: a hull lofted through a few stations that narrows to the nose, a dark
// glasshouse and a rear wing, lit flat so the facets read, drawn in the class colour's thin edges over a dimmed fill. Under it a dark footprint grounds it
// on the road, and a short tick runs forward from the nose. The followed car keeps its class colour and is marked by a
// thin ring on the road and light edges: nothing else about it differs. No wheels, liveries or textures.

import * as THREE from 'three';

import {SHAPES, SILL_Y, SIZE, shapeFor, type ClassShape, type Station} from './carShapes';
import {stepOfName, tintColor} from './carTint';

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

function buildClass(carClass: string, c: ClassShape): ClassKit {
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
  userData: {player: boolean; faded: boolean; vehicle: string | null};
}

/** A car between the camera and the followed car is drawn see-through, so it never hides the one being followed. */
const FADED_OPACITY = 0.18;

/**
 * The cars of one engine: geometries are shared per class (and the ring), materials belong to each car. `release`
 * frees a removed car's materials, `dispose` the shared geometries, so nothing outlives the engine.
 */
export interface CarKit {
  /** `vehicle` is the car's model (the field's own string): it picks the body family and the edge tint. */
  make(carClass: string, color: string, player: boolean, vehicle?: string | null): CarObject;
  release(car: CarObject): void;
  /** Draw the car see-through (between the camera and the followed car) or solid. */
  fade(car: CarObject, faded: boolean): void;
  dispose(): void;
}

export function createCarKit(colors: {bg: string; edge: string; mark: string}): CarKit {
  const classes = new Map<string, ClassKit>();
  let ring: THREE.RingGeometry | null = null;
  const kitFor = (carClass: string, vehicle: string | null): ClassKit => {
    const {key, shape} = shapeFor(vehicle, carClass);
    const cached = classes.get(key);
    if (cached) return cached;
    const made = buildClass(SHAPES[carClass] ? carClass : 'GT3', shape);
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
    make(carClass, color, player, vehicle = null) {
      const k = kitFor(carClass, vehicle);
      const paint = new THREE.Color(color);
      // the model channel: the body edges lightened by the model's step inside its family (carTint)
      const known = shapeFor(vehicle, carClass);
      const step = known.key.includes(':') ? known.tint : stepOfName(vehicle);
      const modelEdge = new THREE.Color(tintColor(color, step));
      const group = new THREE.Group() as CarObject;
      const edgeColor = player ? new THREE.Color(colors.edge) : paint;
      group.add(
        new THREE.Mesh(k.base, new THREE.MeshBasicMaterial({color: new THREE.Color(colors.bg), ...onTop})),
        new THREE.Mesh(k.body, new THREE.MeshLambertMaterial({color: paint.clone().multiplyScalar(BODY_SHADE), flatShading: true, side: THREE.DoubleSide})),
        new THREE.Mesh(k.cabin, new THREE.MeshLambertMaterial({color: paint.clone().multiplyScalar(CABIN_SHADE), flatShading: true, side: THREE.DoubleSide})),
        new THREE.LineSegments(k.bodyEdges, new THREE.LineBasicMaterial({color: player ? edgeColor : modelEdge})),
        new THREE.LineSegments(k.cabinEdges, new THREE.LineBasicMaterial({color: edgeColor})),
        new THREE.Line(k.tick, new THREE.LineBasicMaterial({color: paint})),
      );
      if (player) {
        group.add(new THREE.Mesh(ringGeometry(), new THREE.MeshBasicMaterial({color: new THREE.Color(colors.mark), ...onTop})));
      }
      group.userData = {player, faded: false, vehicle};
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
