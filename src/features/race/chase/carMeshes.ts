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

const shapes = new Map<string, Shape>();

function shapeFor(carClass: string): Shape {
  const cached = shapes.get(carClass);
  if (cached) return cached;
  const [L, W] = SIZE[carClass] ?? SIZE.GT3;
  const s = new THREE.Shape();
  s.moveTo(L / 2, 0);
  s.lineTo(L * 0.12, W / 2);
  s.lineTo(-L / 2, W * 0.46);
  s.lineTo(-L / 2 + 0.55, 0);
  s.lineTo(-L / 2, -W * 0.46);
  s.lineTo(L * 0.12, -W / 2);
  s.closePath();
  const fill = new THREE.ShapeGeometry(s);
  fill.rotateX(-Math.PI / 2); // shape (x, y) lies on the ground as (x, -z)
  const edge = new THREE.BufferGeometry().setFromPoints(s.getPoints().map(p => new THREE.Vector3(p.x, 0, -p.y)));
  const tick = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(L / 2, 0, 0), new THREE.Vector3(L / 2 + L * TICK_OF_LENGTH, 0, 0)]);
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
