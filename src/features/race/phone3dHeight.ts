/** The 3D view's share of a phone's height. A drag in it is the camera's, so the rest of the screen stays page: at 812 pt the board's header is still in view below it, a place to put a finger and scroll. */
const SHARE = 0.5;
const MIN_H = 380;
const MAX_H = 560;

/** The 3D view's height on a phone `screenH` pt tall. Pure. */
export function phone3dHeight(screenH: number): number {
  return Math.round(Math.min(MAX_H, Math.max(MIN_H, screenH * SHARE)));
}
