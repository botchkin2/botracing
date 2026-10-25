import {describe, expect, it} from '@jest/globals';

import {
  classifyDrag,
  createPanRule,
  DECIDE_TRAVEL_PX,
  FLING_MAX_SPEED,
  FLING_MIN_SPEED,
  FLING_TAU_MS,
  flingStep,
  SCROLL_MIN_ANGLE_DEG,
} from './panGesture';

/** A finger moving at constant velocity, one move every 8 ms. */
function drag(rule: ReturnType<typeof createPanRule>, vx: number, vy: number, ms: number, t0 = 0) {
  rule.down(100, 300, t0);
  let camera = 0;
  for (let t = 8; t <= ms; t += 8) camera += rule.move(100 + vx * t, 300 + vy * t, t0 + t);
  return camera;
}

describe('classifyDrag: the camera for a sideways drag, the page past the angle', () => {
  it('sideways, vertical and the angle between', () => {
    expect(classifyDrag(40, 2)).toBe('camera');
    expect(classifyDrag(-40, -3)).toBe('camera');
    expect(classifyDrag(3, 40)).toBe('scroll');
    expect(classifyDrag(3, -40)).toBe('scroll');
    const rad = (deg: number) => (deg * Math.PI) / 180;
    expect(classifyDrag(Math.cos(rad(SCROLL_MIN_ANGLE_DEG - 2)), Math.sin(rad(SCROLL_MIN_ANGLE_DEG - 2)))).toBe('camera');
    expect(classifyDrag(Math.cos(rad(SCROLL_MIN_ANGLE_DEG + 2)), Math.sin(rad(SCROLL_MIN_ANGLE_DEG + 2)))).toBe('scroll');
  });
});

describe('createPanRule: one drag, one owner', () => {
  it('a vertical drag scrolls the page and never turns the camera', () => {
    const rule = createPanRule();
    expect(drag(rule, 0.02, 0.5, 200)).toBe(0);
    // 200 ms at 0.5 px/ms is 100 px; the first 10 px that decided it are in the sum
    expect(rule.frame(208)).toBeCloseTo(100, 5);
  });

  it('a sideways drag turns the camera by its dx (the first travel included) and sends no scroll', () => {
    const rule = createPanRule();
    const turned = drag(rule, 0.5, 0.02, 200);
    expect(turned).toBeCloseTo(100, 5);
    expect(rule.frame(208)).toBe(0);
  });

  it('nothing moves before the travel that decides it', () => {
    const rule = createPanRule();
    rule.down(0, 0, 0);
    expect(rule.move(DECIDE_TRAVEL_PX - 1, 0, 8)).toBe(0);
    expect(rule.frame(16)).toBe(0);
    expect(rule.move(DECIDE_TRAVEL_PX + 1, 0, 16)).toBe(DECIDE_TRAVEL_PX + 1);
  });

  it('the decision is made once: a camera drag that turns steep stays the camera, a scroll that turns flat stays the page', () => {
    const cam = createPanRule();
    cam.down(0, 0, 0);
    cam.move(30, 0, 8);
    expect(cam.move(30, 80, 16)).toBe(0);
    expect(cam.frame(24)).toBe(0);
    const page = createPanRule();
    page.down(0, 0, 0);
    page.move(0, 30, 8);
    expect(page.move(80, 30, 16)).toBe(0);
    expect(page.frame(24)).toBeCloseTo(30, 5);
  });

  it('coalesces: many moves in a frame are one sum, and the next frame has nothing', () => {
    const rule = createPanRule();
    rule.down(0, 0, 0);
    for (let i = 1; i <= 5; i++) rule.move(0, 12 * i, i * 3);
    expect(rule.frame(16)).toBe(60);
    expect(rule.frame(32)).toBe(0);
  });

  it('pointercancel ends the drag: later moves turn nothing and scroll nothing', () => {
    const cam = createPanRule();
    cam.down(0, 0, 0);
    cam.move(40, 0, 8);
    cam.cancel();
    expect(cam.move(80, 0, 16)).toBe(0);
    expect(cam.busy).toBe(false);
    const page = createPanRule();
    page.down(0, 0, 0);
    page.move(0, 40, 8);
    page.cancel();
    page.move(0, 90, 16);
    expect(page.frame(24)).toBe(40);
    expect(page.frame(40)).toBe(0);
  });

  it('a cancelled scroll drag does not fling', () => {
    const rule = createPanRule();
    drag(rule, 0, 1, 80);
    rule.frame(90);
    rule.cancel();
    expect(rule.frame(106)).toBe(0);
    expect(rule.busy).toBe(false);
  });

  it('a tap, or a drag that never decides, ends with nothing sent', () => {
    const rule = createPanRule();
    rule.down(50, 50, 0);
    rule.move(53, 52, 8);
    rule.up(16);
    expect(rule.frame(32)).toBe(0);
    expect(rule.busy).toBe(false);
  });
});

describe('the fling', () => {
  it('a fast lift keeps scrolling with a decaying step and ends', () => {
    const rule = createPanRule();
    drag(rule, 0, 2, 120);
    rule.up(122);
    let t = 122;
    const steps: number[] = [];
    rule.frame(t); // the drag's own travel
    for (let i = 0; i < 400 && rule.busy; i++) {
      t += 16;
      steps.push(rule.frame(t));
    }
    expect(steps[0]).toBeGreaterThan(steps[5]);
    expect(steps.every(s => s >= 0)).toBe(true);
    expect(rule.busy).toBe(false);
    const total = steps.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(2 * FLING_TAU_MS * 0.8);
    expect(total).toBeLessThan(2 * FLING_TAU_MS * 1.05);
  });

  it('a drag upward flings upward', () => {
    const rule = createPanRule();
    drag(rule, 0, -1.5, 120);
    rule.up(122);
    rule.frame(122);
    expect(rule.frame(138)).toBeLessThan(0);
  });

  it('a finger held still before the lift does not fling', () => {
    const rule = createPanRule();
    drag(rule, 0, 1.5, 120);
    rule.up(120 + 300);
    rule.frame(430);
    expect(rule.frame(446)).toBe(0);
  });

  it('a slow lift does not fling', () => {
    const rule = createPanRule();
    drag(rule, 0, FLING_MIN_SPEED / 2, 3000);
    rule.up(3002);
    rule.frame(3002);
    expect(rule.busy).toBe(false);
  });

  it('the lift speed is capped', () => {
    const rule = createPanRule();
    drag(rule, 0, 40, 40);
    rule.up(42);
    rule.frame(42);
    expect(rule.frame(58)).toBeLessThanOrEqual(flingStep(FLING_MAX_SPEED, 16).dy + 1e-9);
  });

  it('a new touch stops a fling', () => {
    const rule = createPanRule();
    drag(rule, 0, 2, 120);
    rule.up(122);
    rule.frame(122);
    rule.down(10, 10, 130);
    expect(rule.frame(146)).toBe(0);
  });

  it('is the same distance at 30 and 120 frames a second, finite for any frame time', () => {
    const run = (frameMs: number) => {
      let v = 1.5;
      let sum = 0;
      for (let t = 0; t < 4000; t += frameMs) {
        const s = flingStep(v, frameMs);
        sum += s.dy;
        v = s.v;
      }
      return sum;
    };
    expect(run(33.3)).toBeCloseTo(run(8.3), 0);
    for (const dt of [0, 1e-6, 8, 16, 1000, 1e9, -5]) {
      const s = flingStep(2, dt);
      expect(Number.isFinite(s.dy)).toBe(true);
      expect(Number.isFinite(s.v)).toBe(true);
    }
  });

  it('a late frame advances the fling by a bounded step', () => {
    const rule = createPanRule();
    drag(rule, 0, 2, 120);
    rule.up(122);
    rule.frame(122);
    const late = rule.frame(122 + 10_000);
    expect(late).toBeLessThanOrEqual(flingStep(2, 64).dy + 1e-9);
    expect(Number.isFinite(late)).toBe(true);
  });
});
