import type {BodyModel} from '../bodyCurves';

// A small coupe on made-up numbers: 4 m long, axles at +1.2 and -0.8, a flare over each axle, a greenhouse in the middle.
// Shared by the body tests; no real car's numbers.
export const COUPE: BodyModel = {
  lengthM: 4,
  frontAxleX: 1.2,
  rearAxleX: -0.8,
  bottom: [
    [2, 0.1],
    [1.5, 0.12],
    [-1.5, 0.12],
    [-2, 0.2],
  ],
  belt: [
    [2, 0.4],
    [0, 0.7],
    [-2, 0.6],
  ],
  top: [
    [2, 0.3],
    [1.4, 0.6],
    [0.6, 0.72],
    [0.1, 1.15],
    [-0.4, 1.15],
    [-1.2, 0.8],
    [-2, 0.7],
  ],
  half: [
    [2, 0.5],
    [1.2, 0.95],
    [0.2, 0.85],
    [-0.8, 1],
    [-2, 0.9],
  ],
  greenhouse: {
    screenBaseX: 0.6,
    roofFrontX: 0.1,
    roofRearX: -0.4,
    rearBaseX: -1.2,
    roofHalfW: 0.6,
  },
};
