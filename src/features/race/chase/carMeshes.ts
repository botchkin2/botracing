// A car is a low-poly body drawn as a lit outline on a dark shape (pit-wall thread 124, ticket 59 piece 1): a hull
// lofted through a few stations that narrows to the nose, a dark glasshouse, a rear wing and four wheels, merged into
// one body geometry; the body fill is the page background with a touch of the class colour, the edges carry the colour,
// and a slightly larger back-face shell in a dimmer edge colour is the glow (WebGL draws every line 1 px wide, so the
// halo is geometry). Under it a dark footprint grounds it on the road, and a short tick runs forward from the nose. The
// followed car has white-hot edges and a thin ring on the road. No liveries or textures.
//
// Geometries are shared per body shape and materials per colour, in two sets (solid and faded): fading a car swaps
// which set its meshes point at, so fading one car never fades another of the same colour.

import * as THREE from 'three';

import {
  SHAPES,
  SILL_Y,
  SIZE,
  shapeFor,
  type ClassShape,
  type Station,
} from './carShapes';
import {modelPaint} from './carPaint';

const TICK_OF_LENGTH = 0.3;
/** The ring's diameter is about a car's length (chord, thread 83 #6151). */
const RING_INNER_M = 2.35;
const RING_OUTER_M = 2.4;
/** The body fill: the page background with this share of the car's colour; the glasshouse is the background itself. */
const BODY_TINT = 0.12;
/** The halo shell: the edge colour at this share over the background, pushed out this far along the averaged normals. */
const HALO_SHARE = 0.5;
const HALO_OFFSET_M = 0.05;
const WHEEL_SEGMENTS = 8;
/** The wheels stand this far outside the hull's side, so their rims show against it from the side and above (scout #8072). */
const WHEEL_PROUD_M = 0.06;
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
  return [
    {x: L / 2, z: 0},
    ...half,
    ...half.reverse().map(p => ({x: p.x, z: -p.z})),
  ];
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
  for (const [r, flip] of [
    [rings[0], false],
    [rings[rings.length - 1], true],
  ] as const) {
    for (let i = 1; i < 5; i++)
      tri.push(...(flip ? [r[0], r[i], r[i + 1]] : [r[0], r[i + 1], r[i]]));
  }
  const g = new THREE.BufferGeometry().setFromPoints(tri);
  g.computeVertexNormals();
  return g;
}

function slab(
  x: number,
  y: number,
  len: number,
  height: number,
  width: number,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(len, height, width).toNonIndexed();
  g.translate(x, y, 0);
  return g;
}

/** One wheel: an 8-sided disc across the car at an axle, standing on the road, its outer face at `outerZ`. */
function wheel(
  x: number,
  radius: number,
  width: number,
  outerZ: number,
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, width, WHEEL_SEGMENTS);
  g.rotateX(Math.PI / 2);
  g.translate(x, radius, Math.sign(outerZ) * (Math.abs(outerZ) - width / 2));
  return g;
}

/**
 * The glow: `g` (non-indexed, outward-wound) pushed out `offsetM` along each vertex's normal, the face normals of
 * every facet meeting at that position averaged. Flat-shaded bodies have a normal per facet, and moving each facet
 * along its own would tear the shell open at every edge; averaging keeps it closed and the offset even. Drawn with
 * `BackSide`, only its far side shows past the body.
 */
export function shellOf(
  g: THREE.BufferGeometry,
  offsetM: number,
): THREE.BufferGeometry {
  const pos = g.getAttribute('position').array as Float32Array;
  const at = (i: number) =>
    `${Math.round(pos[i] * 1e4)},${Math.round(pos[i + 1] * 1e4)},${Math.round(
      pos[i + 2] * 1e4,
    )}`;
  const sums = new Map<string, [number, number, number]>();
  for (let t = 0; t < pos.length; t += 9) {
    const ux = pos[t + 3] - pos[t];
    const uy = pos[t + 4] - pos[t + 1];
    const uz = pos[t + 5] - pos[t + 2];
    const vx = pos[t + 6] - pos[t];
    const vy = pos[t + 7] - pos[t + 1];
    const vz = pos[t + 8] - pos[t + 2];
    // the area-weighted face normal, so a big facet counts for more than a sliver
    const n: [number, number, number] = [
      uy * vz - uz * vy,
      uz * vx - ux * vz,
      ux * vy - uy * vx,
    ];
    for (const i of [t, t + 3, t + 6]) {
      const sum = sums.get(at(i)) ?? [0, 0, 0];
      sum[0] += n[0];
      sum[1] += n[1];
      sum[2] += n[2];
      sums.set(at(i), sum);
    }
  }
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const [nx, ny, nz] = sums.get(at(i)) as [number, number, number];
    const len = Math.hypot(nx, ny, nz) || 1;
    out[i] = pos[i] + (nx / len) * offsetM;
    out[i + 1] = pos[i + 1] + (ny / len) * offsetM;
    out[i + 2] = pos[i + 2] + (nz / len) * offsetM;
  }
  const shell = new THREE.BufferGeometry();
  shell.setAttribute('position', new THREE.BufferAttribute(out, 3));
  return shell;
}

/**
 * `a` toward `b` by `t`, mixed in sRGB, the values the screen shows. three.js blends in linear light, where 12 % of an
 * amber over a near-black is already a brown: the body would stop reading as dark.
 */
export function mixSrgb(
  a: THREE.Color,
  b: THREE.Color,
  t: number,
): THREE.Color {
  const x = a.getHex();
  const y = b.getHex();
  const channel = (shift: number) =>
    Math.round(((x >> shift) & 255) * (1 - t) + ((y >> shift) & 255) * t);
  return new THREE.Color((channel(16) << 16) | (channel(8) << 8) | channel(0));
}

/** Everything one body shape needs, shared by every car of that shape. */
interface ClassKit {
  body: THREE.BufferGeometry;
  cabin: THREE.BufferGeometry;
  bodyEdges: THREE.BufferGeometry;
  cabinEdges: THREE.BufferGeometry;
  halo: THREE.BufferGeometry;
  base: THREE.ShapeGeometry;
  tick: THREE.BufferGeometry;
}

function buildClass(carClass: string, c: ClassShape): ClassKit {
  const [wx, wy, chord, span] = c.wing;
  const tail = c.hull[c.hull.length - 1];
  const parts = [
    loft(c.hull, SILL_Y),
    slab(wx, wy, chord, 0.05, span),
    ...[-1, 1].map(side =>
      slab(wx + 0.08, (wy + tail[4]) / 2, 0.12, wy - tail[4], 0.03).translate(
        0,
        0,
        side * span * 0.42,
      ),
    ),
  ];
  if (c.fin)
    parts.push(
      slab(
        c.fin[0] + c.fin[1] / 2,
        c.hull[3][4] + c.fin[2] / 2 - 0.05,
        c.fin[1],
        c.fin[2],
        0.03,
      ),
    );
  // the four wheels stand on the road with their outer faces a little outside the hull's widest half-width
  const [front, rear, radius, width] = c.wheels;
  const outer = Math.max(...c.hull.map(st => st[1])) + WHEEL_PROUD_M;
  for (const x of [front, rear])
    for (const side of [-1, 1])
      parts.push(wheel(x, radius, width, side * outer));
  const body = mergeAll(parts);
  const cabin = loft(c.cabin, c.cabin[0][2] - 0.02);
  const outline = new THREE.Shape(
    carOutline(carClass).map(p => new THREE.Vector2(p.x, -p.z)),
  );
  const base = new THREE.ShapeGeometry(outline);
  base.rotateX(-Math.PI / 2);
  const tick = new THREE.BufferGeometry().setFromPoints(
    tickSegment(carClass).map(p => new THREE.Vector3(p.x, 0.04, p.z)),
  );
  return {
    body,
    cabin,
    bodyEdges: new THREE.EdgesGeometry(body, EDGE_ANGLE_DEG),
    cabinEdges: new THREE.EdgesGeometry(cabin, EDGE_ANGLE_DEG),
    halo: shellOf(body, HALO_OFFSET_M),
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

const onTop = {
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
};

/** The pieces of a car that carry a material, in the order they are drawn. */
type Part =
  | 'base'
  | 'body'
  | 'cabin'
  | 'bodyEdges'
  | 'cabinEdges'
  | 'tick'
  | 'halo'
  | 'ring';
type MaterialSet = Record<Part, THREE.Material | null>;
/** One colour's materials, solid and see-through: cars of that colour share them, and fading a car swaps which one its meshes use. */
interface MaterialSets {
  solid: MaterialSet;
  faded: MaterialSet;
}

export interface CarObject extends THREE.Group {
  userData: {
    player: boolean;
    faded: boolean;
    vehicle: string | null;
    sets: MaterialSets;
    parts: [THREE.Mesh | THREE.Line, Part][];
  };
}

/** A car between the camera and the followed car is drawn see-through, so it never hides the one being followed. */
const FADED_OPACITY = 0.18;

/**
 * The cars of one engine: geometries are shared per body shape (and the ring), materials per colour. `release` is the
 * hook for a removed car (nothing of its own is left to free), `dispose` frees every shared geometry and material, so
 * nothing outlives the engine.
 */
export interface CarKit {
  /** `vehicle` is the car's model (the field's own string): it picks the body family and the edge colour. */
  make(
    carClass: string,
    color: string,
    player: boolean,
    vehicle?: string | null,
  ): CarObject;
  release(car: CarObject): void;
  /** Draw the car see-through (between the camera and the followed car) or solid. */
  fade(car: CarObject, faded: boolean): void;
  dispose(): void;
}

export function createCarKit(colors: {
  bg: string;
  edge: string;
  mark: string;
  /** Every class's colour: a model's edge colour turns away from the nearest other class (carPaint). */
  classes: string[];
}): CarKit {
  const classes = new Map<string, ClassKit>();
  const sets = new Map<string, MaterialSets>();
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
  const bg = new THREE.Color(colors.bg);
  /** One colour's materials, as a solid set and a see-through one. */
  const setsFor = (
    color: string,
    model: number,
    player: boolean,
  ): MaterialSets => {
    const key = `${color}|${model}|${player ? 1 : 0}`;
    const cached = sets.get(key);
    if (cached) return cached;
    const paint = new THREE.Color(color);
    const edge = player
      ? new THREE.Color(colors.edge)
      : new THREE.Color(
          modelPaint(
            color,
            colors.classes.filter(c => c !== color),
            model,
          ),
        );
    const cabinEdge = player ? edge : paint;
    const build = (faded: boolean): MaterialSet => {
      const see = faded
        ? {transparent: true, opacity: FADED_OPACITY, depthWrite: false}
        : {};
      return {
        base: new THREE.MeshBasicMaterial({
          color: bg.clone(),
          ...onTop,
          ...see,
        }),
        body: new THREE.MeshBasicMaterial({
          color: mixSrgb(bg, paint, BODY_TINT),
          side: THREE.DoubleSide,
          ...see,
        }),
        cabin: new THREE.MeshBasicMaterial({
          color: bg.clone(),
          side: THREE.DoubleSide,
          ...see,
        }),
        bodyEdges: new THREE.LineBasicMaterial({color: edge, ...see}),
        cabinEdges: new THREE.LineBasicMaterial({color: cabinEdge, ...see}),
        tick: new THREE.LineBasicMaterial({color: paint, ...see}),
        halo: new THREE.MeshBasicMaterial({
          color: mixSrgb(bg, edge, HALO_SHARE),
          side: THREE.BackSide,
          ...see,
        }),
        ring: player
          ? new THREE.MeshBasicMaterial({
              color: new THREE.Color(colors.mark),
              ...onTop,
              ...see,
            })
          : null,
      };
    };
    const made = {solid: build(false), faded: build(true)};
    sets.set(key, made);
    return made;
  };
  return {
    make(carClass, color, player, vehicle = null) {
      const k = kitFor(carClass, vehicle);
      // the model channel: the body edges take the model's colour in its class (carPaint)
      const set = setsFor(color, shapeFor(vehicle, carClass).paint, player);
      const group = new THREE.Group() as CarObject;
      const parts: CarObject['userData']['parts'] = [];
      const add = (o: THREE.Mesh | THREE.Line, part: Part) => {
        group.add(o);
        parts.push([o, part]);
      };
      add(new THREE.Mesh(k.base, set.solid.base as THREE.Material), 'base');
      add(new THREE.Mesh(k.body, set.solid.body as THREE.Material), 'body');
      add(new THREE.Mesh(k.cabin, set.solid.cabin as THREE.Material), 'cabin');
      add(
        new THREE.LineSegments(
          k.bodyEdges,
          set.solid.bodyEdges as THREE.Material,
        ),
        'bodyEdges',
      );
      add(
        new THREE.LineSegments(
          k.cabinEdges,
          set.solid.cabinEdges as THREE.Material,
        ),
        'cabinEdges',
      );
      add(new THREE.Line(k.tick, set.solid.tick as THREE.Material), 'tick');
      const halo = new THREE.Mesh(k.halo, set.solid.halo as THREE.Material);
      halo.name = 'halo';
      add(halo, 'halo');
      if (player)
        add(
          new THREE.Mesh(ringGeometry(), set.solid.ring as THREE.Material),
          'ring',
        );
      group.userData = {player, faded: false, vehicle, sets: set, parts};
      return group;
    },
    fade(car, faded) {
      if (car.userData.faded === faded) return;
      car.userData.faded = faded;
      const set = faded ? car.userData.sets.faded : car.userData.sets.solid;
      for (const [o, part] of car.userData.parts)
        o.material = set[part] as THREE.Material;
    },
    release() {
      // the materials are shared by colour and freed with the kit
    },
    dispose() {
      for (const k of classes.values()) {
        k.body.dispose();
        k.cabin.dispose();
        k.bodyEdges.dispose();
        k.cabinEdges.dispose();
        k.halo.dispose();
        k.base.dispose();
        k.tick.dispose();
      }
      classes.clear();
      for (const s of sets.values())
        for (const m of [...Object.values(s.solid), ...Object.values(s.faded)])
          m?.dispose();
      sets.clear();
      ring?.dispose();
      ring = null;
    },
  };
}
