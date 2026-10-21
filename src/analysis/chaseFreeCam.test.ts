import {describe, expect, it} from '@jest/globals';

import {
  dragFree,
  isFree,
  newFreeCam,
  PITCH_MAX_RAD,
  PITCH_MIN_RAD,
  resetFree,
  stepFree,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomFree,
} from './chaseFreeCam';

describe('free camera', () => {
  it('starts on the chase view', () => {
    expect(isFree(newFreeCam())).toBe(false);
  });
  it('a drag turns and raises it, and stays inside the pitch bounds', () => {
    const f = newFreeCam();
    dragFree(f, 100, 50);
    expect(f.yaw).toBeCloseTo(0.8);
    expect(f.pitch).toBeCloseTo(0.4);
    dragFree(f, 0, 1e6);
    expect(f.pitch).toBe(PITCH_MAX_RAD);
    dragFree(f, 0, -1e6);
    expect(f.pitch).toBe(PITCH_MIN_RAD);
  });
  it('the wheel zooms by ratio inside its bounds', () => {
    const f = newFreeCam();
    zoomFree(f, 100);
    expect(f.zoom).toBeGreaterThan(1);
    zoomFree(f, 1e6);
    expect(f.zoom).toBe(ZOOM_MAX);
    zoomFree(f, -1e6);
    expect(f.zoom).toBe(ZOOM_MIN);
  });
  it('reset eases back to exactly the chase view, the short way round', () => {
    const f = newFreeCam();
    dragFree(f, 800, 20); // 6.4 rad: almost a full turn, so the short way is the remainder
    resetFree(f);
    expect(f.yaw).toBeCloseTo(6.4 - 2 * Math.PI);
    
    zoomFree(f, 500);
    f.resetting = true;
    let frames = 0;
    while (stepFree(f, 1 / 60)) frames++;
    expect(frames).toBeLessThan(120);
    expect(isFree(f)).toBe(false);
  });
  it('a drag during the ease takes the camera back from it', () => {
    const f = newFreeCam();
    dragFree(f, 100, 0);
    resetFree(f);
    stepFree(f, 1 / 60);
    dragFree(f, 5, 0);
    expect(f.resetting).toBe(false);
    expect(stepFree(f, 1 / 60)).toBe(false);
  });
  it('reset on the chase view does nothing', () => {
    const f = newFreeCam();
    resetFree(f);
    expect(f.resetting).toBe(false);
  });
});
