import type {Vector3} from 'three';

/** The world is x east, y north, z up; three.js is (x, z, -y). */
export function setWorld(v: Vector3, x: number, y: number, z: number): Vector3 {
  return v.set(x, z, -y);
}
