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
  SILL_Y,
  SIZE,
  WING_PYLONS,
  hullTopAt,
  lightSegments,
  shapeClassOf,
  shapeFor,
  type ClassShape,
  type Station,
} from './carShapes';
import {modelPaint} from './carPaint';
import {bodyGeometry, glassGeometry} from './bodyMesh';
import {featureLines} from './featureLines';
import {stationAt} from './bodyCurves';

const TICK_OF_LENGTH = 0.3;
/** The ring's diameter is about a car's length (chord, thread 83 #6151). */
const RING_INNER_M = 2.35;
const RING_OUTER_M = 2.4;
/** The body fill: the page background with this share of the car's colour; the glasshouse is the background itself. */
const BODY_TINT = 0.12;
/** The halo shell: the edge colour at this share over the background, pushed out this far along the averaged normals. */
const HALO_SHARE = 0.5;
const HALO_OFFSET_M = 0.05;
const WHEEL_SEGMENTS = 16;
/** The wheels stand this far outside the hull's side, so their rims show against it from the side and above (scout #8072). */
const WHEEL_PROUD_M = 0.06;
/** On a real body the wheel's face stands this far outside the flank, so the tyres show from behind (scout #8305). */
const BODY_WHEEL_PROUD_M = 0.07;
const EDGE_ANGLE_DEG = 25;
/** An end plate reaches this far below the wing's top. */
const PLATE_BELOW_M = 0.1;

type Local = {x: number; z: number};

/** A ground box: a class (its nominal length and width) or a model's own [length, width]. */
type Footprint = string | [number, number];

function footprint(of: Footprint): [number, number] {
  return typeof of === 'string' ? SIZE[shapeClassOf(of)] : of;
}

/** The car's footprint on the ground in its own frame: x forward (the nose at +L/2), z to the right. */
export function carOutline(of: Footprint): Local[] {
  const [L, W] = footprint(of);
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
export function tickSegment(of: Footprint): [Local, Local] {
  const [L] = footprint(of);
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

/** A wing end plate at lateral z: a thin slab from below the wing to `h` above it, its top vertices swept toward the tail. */
function plate(
  x: number,
  wingY: number,
  chord: number,
  {h, sweep}: {h: number; sweep: number},
  z: number,
): THREE.BufferGeometry {
  const bottom = wingY - PLATE_BELOW_M;
  const g = new THREE.BoxGeometry(
    chord,
    wingY + h - bottom,
    0.03,
  ).toNonIndexed();
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++)
    if (pos.getY(i) > 0) pos.setX(i, pos.getX(i) - sweep);
  g.translate(x, (wingY + h + bottom) / 2, z);
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

/** One coordinate of a position key: 0.1 mm steps, shifted so a car's coordinates (a few metres) are positive. */
const KEY_STEP = 1e4;
const KEY_SHIFT = 1 << 16;
const KEY_SPAN = 1 << 17;

/**
 * A number naming a position to 0.1 mm, so vertices that meet in a body are one key without building a string for each
 * (a body of a thousand triangles is three thousand lookups). Exact: three 17-bit parts in one double, for positions
 * within +/- 6.5 m of the car's centre.
 */
export function positionKey(x: number, y: number, z: number): number {
  const part = (v: number) => {
    if (!(Math.abs(v) < KEY_SHIFT / KEY_STEP))
      throw new RangeError(
        `positionKey: ${v} m is outside +/- ${
          KEY_SHIFT / KEY_STEP
        } m of the car's centre`,
      );
    return Math.round(v * KEY_STEP) + KEY_SHIFT;
  };
  return (part(x) * KEY_SPAN + part(y)) * KEY_SPAN + part(z);
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
  const at = (i: number) => positionKey(pos[i], pos[i + 1], pos[i + 2]);
  const sums = new Map<number, [number, number, number]>();
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

function buildClass(ground: [number, number], c: ClassShape): ClassKit {
  const [wx, wy, chord, span] = c.wing;
  // the wing's pylons stand on the body's own deck at the wing, or on the hull's tail when there is no real body
  const deckTop = c.body
    ? stationAt(c.body, Math.max(wx, -c.body.lengthM / 2)).top
    : c.hull[c.hull.length - 1][4];
  const kind = c.wingKind ?? 'stalks';
  // a model with a real body draws it in place of the hull; everything else on the car is the same parts
  const first = c.body ? bodyGeometry(c.body) : loft(c.hull, SILL_Y);
  const parts: THREE.BufferGeometry[] = [];
  if (kind !== 'none') {
    parts.push(
      slab(wx, wy, chord, 0.05, span),
      ...WING_PYLONS[kind].map(f =>
        slab(wx + 0.08, (wy + deckTop) / 2, 0.12, wy - deckTop, 0.03).translate(
          0,
          0,
          f * span,
        ),
      ),
    );
  }
  // end plates: a slab at each end of the wing, rising above it, its top rear corner swept back
  if (kind !== 'none' && c.endPlate)
    for (const side of [-1, 1])
      parts.push(plate(wx, wy, chord, c.endPlate, side * (span / 2)));
  // raised pods (fender crests, haunches): a slab each side, standing on the hull's top line
  for (const b of c.bulges ?? []) {
    const top = hullTopAt(c.hull, b.x);
    for (const side of [-1, 1])
      parts.push(
        slab(b.x, top - 0.02 + b.h / 2, b.len, b.h, b.w).translate(
          0,
          0,
          side * b.z,
        ),
      );
  }
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
  const hullOuter = Math.max(...c.hull.map(st => st[1])) + WHEEL_PROUD_M;
  for (const x of [front, rear]) {
    const outer = c.body
      ? stationAt(c.body, x).half + BODY_WHEEL_PROUD_M
      : hullOuter;
    for (const side of [-1, 1])
      parts.push(wheel(x, radius, width, side * outer));
  }
  // a real body's outline is its feature lines, not creases (a smooth body has few): only the other parts are edged
  const outlineParts = c.body ? mergeAll(parts.map(p => p.clone())) : null;
  const body = mergeAll([first, ...parts]);
  const cabin = c.body
    ? glassGeometry(c.body)
    : loft(c.cabin, c.cabin[0][2] - 0.02);
  const outline = new THREE.Shape(
    carOutline(ground).map(p => new THREE.Vector2(p.x, -p.z)),
  );
  const base = new THREE.ShapeGeometry(outline);
  base.rotateX(-Math.PI / 2);
  const tick = new THREE.BufferGeometry().setFromPoints(
    tickSegment(ground).map(p => new THREE.Vector3(p.x, 0.04, p.z)),
  );
  return {
    body,
    cabin,
    bodyEdges: withSegments(
      new THREE.EdgesGeometry(outlineParts ?? body, EDGE_ANGLE_DEG),
      c.body ? featureLines(c.body, radius).body : [],
      lightSegments(c),
    ),
    cabinEdges: c.body
      ? segmentsGeometry(featureLines(c.body, radius).glass)
      : new THREE.EdgesGeometry(cabin, EDGE_ANGLE_DEG),
    halo: shellOf(body, HALO_OFFSET_M),
    base,
    tick,
  };
}

/**
 * The vertex colour that marks a light vertex in the body-edges buffer (an outline vertex is 1). The material turns a
 * marked vertex into its car's colour at full brightness, hue and saturation held: paint / max(r, g, b) (steward #8229,
 * #8272; scout #8241). A plain gain clamps a channel and pulls the colour toward white, and white-hot is his car's alone.
 */
export const LIGHT_FLAG = 2;

/** `color` at its brightest with the same hue and saturation: the top channel at 1 and the ratios kept (linear light, as the shader works). */
export function lightColor(color: THREE.Color): THREE.Color {
  const top = Math.max(color.r, color.g, color.b, 1e-3);
  return new THREE.Color(color.r / top, color.g / top, color.b / top);
}

/**
 * Patches the body-edges material's fragment shader: where `vColor.r` is LIGHT_FLAG the fragment takes lightColor of
 * the material's own colour, elsewhere it stays the material's colour. One program for every body-edges material, still
 * one LineSegments a car. The GLSL mirrors lightColor above.
 */
export function patchBodyEdges(mat: THREE.LineBasicMaterial): void {
  mat.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#ifdef USE_COLOR
  float lightTop = max(max(diffuse.r, diffuse.g), max(diffuse.b, 0.001));
  diffuseColor.rgb = vColor.r > ${(LIGHT_FLAG * 0.75).toFixed(
    2,
  )} ? diffuse / lightTop : diffuse;
#endif`,
    );
  };
  mat.customProgramCacheKey = () => 'bodyEdgesLights';
}

function bodyEdgesMaterial(
  color: THREE.Color,
  see: object,
): THREE.LineBasicMaterial {
  const mat = new THREE.LineBasicMaterial({color, vertexColors: true, ...see});
  patchBodyEdges(mat);
  return mat;
}

/**
 * A line geometry with more segments appended to it, so they ride the same draw, and a colour attribute: 1 for every
 * outline vertex, LIGHT_FLAG for the appended light lines. The colour attribute is on every body-edges geometry, because
 * the material that draws them reads vertex colours.
 */
function withSegments(
  edges: THREE.BufferGeometry,
  outline: number[][],
  lights: number[][],
): THREE.BufferGeometry {
  const at = edges.getAttribute('position');
  const plain = at.count * 3 + outline.length * 6;
  const pos = new Float32Array(plain + lights.length * 6);
  pos.set(at.array as Float32Array, 0);
  outline.forEach((seg, i) => pos.set(seg, at.count * 3 + i * 6));
  lights.forEach((seg, i) => pos.set(seg, plain + i * 6));
  const colors = new Float32Array(pos.length).fill(1);
  colors.fill(LIGHT_FLAG, plain);
  edges.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** A line geometry of explicit segments (each [x1, y1, z1, x2, y2, z2]). */
function segmentsGeometry(segments: number[][]): THREE.BufferGeometry {
  const pos = new Float32Array(segments.length * 6);
  segments.forEach((seg, i) => pos.set(seg, i * 6));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return g;
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
  /**
   * Builds the next model body still waiting, one at most, and swaps it onto every car drawn as its class shape until now:
   * a model with a real body is built after the first frame, one a frame, so a field of fourteen models does not stall the
   * frame that opens the 3D (steward #8288). Returns how many it built (0 or 1).
   */
  tick(): number;
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
    const {key, shape, footprint: ground} = shapeFor(vehicle, carClass);
    const cached = classes.get(key);
    if (cached) return cached;
    const made = buildClass(ground, shape);
    classes.set(key, made);
    return made;
  };
  // a model with a real body is not built where its car is made: the car is its class shape now and the body is queued
  const queue: string[] = [];
  const waiting = new Map<
    string,
    {cars: CarObject[]; carClass: string; vehicle: string | null}
  >();
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
        bodyEdges: bodyEdgesMaterial(edge, see),
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
      const target = shapeFor(vehicle, carClass);
      const deferred = !!target.shape.body && !classes.has(target.key);
      const k = kitFor(carClass, deferred ? null : vehicle);
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
      if (deferred) {
        let w = waiting.get(target.key);
        if (!w) {
          w = {cars: [], carClass, vehicle};
          waiting.set(target.key, w);
          queue.push(target.key);
        }
        w.cars.push(group);
      }
      return group;
    },
    tick() {
      const key = queue.shift();
      if (key === undefined) return 0;
      const w = waiting.get(key);
      waiting.delete(key);
      if (!w) return 0;
      const k = kitFor(w.carClass, w.vehicle);
      for (const car of w.cars)
        for (const [o, part] of car.userData.parts)
          if (part !== 'ring') (o as THREE.Mesh).geometry = k[part];
      return 1;
    },
    fade(car, faded) {
      if (car.userData.faded === faded) return;
      car.userData.faded = faded;
      const set = faded ? car.userData.sets.faded : car.userData.sets.solid;
      for (const [o, part] of car.userData.parts)
        o.material = set[part] as THREE.Material;
    },
    release(car) {
      // the materials are shared by colour and freed with the kit; a car that never got its body leaves the queue
      for (const [key, w] of waiting) {
        const i = w.cars.indexOf(car);
        if (i < 0) continue;
        w.cars.splice(i, 1);
        if (w.cars.length === 0) {
          waiting.delete(key);
          queue.splice(queue.indexOf(key), 1);
        }
      }
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
      queue.length = 0;
      waiting.clear();
      for (const s of sets.values())
        for (const m of [...Object.values(s.solid), ...Object.values(s.faded)])
          m?.dispose();
      sets.clear();
      ring?.dispose();
      ring = null;
    },
  };
}
