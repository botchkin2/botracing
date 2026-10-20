// A car's attitude in the scene. The three.js frame is x east, y up, z = -north; a car body has x forward, y up and z to
// its right (carMeshes.ts), and is turned yaw (about up), then pitch (about its lateral axis), then roll (about its
// forward axis): Euler order YZX. Pitch is + nose up. Roll is + with the right side up, which turns the body about its
// forward axis the other way round (a positive turn about +x tips +y toward +z, the right side down).

import type * as THREE from 'three';

export function setCarRotation(o: THREE.Object3D, headingRad: number, pitchRad: number, rollRad: number): void {
  o.rotation.order = 'YZX';
  o.rotation.set(-rollRad, headingRad, pitchRad);
}
