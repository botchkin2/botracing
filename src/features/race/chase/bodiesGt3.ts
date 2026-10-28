// The GT3 bodies (ticket 59, real bodies): each a BodyModel, the curves of one car measured from its public side and top
// views (the Le Mans Ultimate gallery on its car page) and the published dimensions in pit-wall design/car-shapes/
// reference-table.md. Numbers only; no image is in the repo. x is metres from the middle of the length, + forward; y is the
// height above the road. One const per model, in the order of GT3_MODELS.

import type {BodyModel} from './bodyCurves';

/**
 * Porsche 911 GT3 R (992), rear engine. 4,619 mm long, 2,050 wide and a 2,507 mm wheelbase (reference table, grades B and
 * C). Read from the gallery's side view (92-992-17), its top view (Porsche-5) and its rear view (Porsche-6): a low nose
 * and a hood that rises in one line to a steeply raked windscreen, a short roof, a long fastback that falls to the engine
 * deck, the rear haunches wider than the front, the cabin far forward over a long tail.
 */
export const BODY_911: BodyModel = {
  lengthM: 4.62,
  frontAxleX: 1.36,
  rearAxleX: -1.147,
  bottom: [
    [2.31, 0.1],
    [1.8, 0.12],
    [1.2, 0.16],
    [-1.2, 0.16],
    [-1.9, 0.2],
    [-2.31, 0.28],
  ],
  belt: [
    [2.31, 0.32],
    [1.4, 0.58],
    [0.7, 0.72],
    [-0.2, 0.74],
    [-1.13, 0.78],
    [-2.31, 0.66],
  ],
  top: [
    [2.31, 0.36],
    [2.06, 0.45],
    [1.34, 0.63],
    [0.66, 0.78],
    [0.23, 1.09],
    [-0.11, 1.14],
    [-0.57, 1.09],
    [-1.48, 0.85],
    [-1.93, 0.73],
    [-2.31, 0.68],
  ],
  half: [
    [2.31, 0.55],
    [2, 0.8],
    [1.38, 0.97],
    [0.4, 0.93],
    [-1.13, 1.025],
    [-2.31, 0.93],
  ],
  greenhouse: {
    screenBaseX: 0.66,
    roofFrontX: 0.23,
    roofRearX: -0.57,
    rearBaseX: -1.48,
    roofHalfW: 0.58,
  },
};
