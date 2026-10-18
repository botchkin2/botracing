// A car is a flat chevron on the road plane at its class footprint, a short heading tick and a thin edge. The player
// keeps the class colour and is marked by a white edge and a ring on the road: nothing else about him differs.

import * as THREE from 'three';

/** Class footprints (length x width, metres): the class nominal, the data carries no model dimensions. */
const SIZE: Record<string, [number, number]> = {Hyper: [5.0, 2.0], LMP2: [4.75, 1.9], GT3: [4.65, 1.95]};
const TICK_OF_LENGTH = 0.3;
const RING_INNER_M = 3.3;
const RING_OUTER_M = 3.36;
const PLAYER_EDGE = '#ffffff';

interface Shape {
  fill: THREE.ShapeGeometry;
  edge: THREE.BufferGeometry;
  tick: THREE.BufferGeometry;
}

type Local = {x: number; z: number};

function footprint(carClass: string): [number, number] {
  return SIZE[carClass] ?? SIZE.GT3;
}

/** The chevron's outline on the ground in the car's own frame: x forward (the nose at +L/2), z to the right. */
function chevronShape(carClass: string): THREE.Shape {
  const [L, W] = footprint(carClass);
  const s = new THREE.Shape();
  s.moveTo(L / 2, 0);
  s.lineTo(L * 0.12, W / 2);
  s.lineTo(-L / 2, W * 0.46);
  s.lineTo(-L / 2 + 0.55, 0);
  s.lineTo(-L / 2, -W * 0.46);
  s.lineTo(L * 0.12, -W / 2);
  s.closePath();
  return s;
}

export function carOutline(carClass: string): Local[] {
  // shape (x, y) lies on the ground as (x, -z)
  return chevronShape(carClass)
    .getPoints()
    .map(p => ({x: p.x, z: -p.y}));
}

/** The heading tick: from the nose, forward, a fraction of the car's length. */
export function tickSegment(carClass: string): [Local, Local] {
  const [L] = footprint(carClass);
  return [
    {x: L / 2, z: 0},
    {x: L / 2 + L * TICK_OF_LENGTH, z: 0},
  ];
}

const shapes = new Map<string, Shape>();

function shapeFor(carClass: string): Shape {
  const cached = shapes.get(carClass);
  if (cached) return cached;
  const fill = new THREE.ShapeGeometry(chevronShape(carClass));
  fill.rotateX(-Math.PI / 2);
  const toVec = (p: Local) => new THREE.Vector3(p.x, 0, p.z);
  const edge = new THREE.BufferGeometry().setFromPoints(carOutline(carClass).map(toVec));
  const tick = new THREE.BufferGeometry().setFromPoints(tickSegment(carClass).map(toVec));
  const made = {fill, edge, tick};
  shapes.set(carClass, made);
  return made;
}

let ringGeometry: THREE.RingGeometry | null = null;
function ring() {
  if (!ringGeometry) {
    ringGeometry = new THREE.RingGeometry(RING_INNER_M, RING_OUTER_M, 64);
    ringGeometry.rotateX(-Math.PI / 2);
  }
  return ringGeometry;
}

const onTop = {polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2};

export interface CarObject extends THREE.Group {
  userData: {body: THREE.Mesh; player: boolean};
}

export function makeCar(carClass: string, color: string, player: boolean, bg: string): CarObject {
  const {fill, edge, tick} = shapeFor(carClass);
  const group = new THREE.Group() as CarObject;
  const body = new THREE.Mesh(fill, new THREE.MeshBasicMaterial({color: new THREE.Color(color), ...onTop}));
  const outline = new THREE.LineLoop(edge, new THREE.LineBasicMaterial({color: new THREE.Color(player ? PLAYER_EDGE : bg)}));
  const nose = new THREE.Line(tick, new THREE.LineBasicMaterial({color: new THREE.Color(color)}));
  outline.position.y = 0.03;
  nose.position.y = 0.03;
  group.add(body, outline, nose);
  if (player) group.add(new THREE.Mesh(ring(), new THREE.MeshBasicMaterial({color: new THREE.Color(PLAYER_EDGE), ...onTop})));
  group.userData = {body, player};
  return group;
}
