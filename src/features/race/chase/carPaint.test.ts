import {describe, expect, it} from '@jest/globals';

import {colors} from '@/src/design/tokens';
import {PAINTS, colorGap, modelPaint, stepOfName, toOklab} from './carPaint';

// The class colours the map key uses, read from the tokens so a retuned token is held to the same bars.
const CLASSES = [colors.dark.class1, colors.dark.class2, colors.dark.class3];
const WHITE_HOT = '#ffffff';
const paintsOf = (anchor: string) =>
  Array.from({length: PAINTS}, (_, i) =>
    modelPaint(
      anchor,
      CLASSES.filter(c => c !== anchor),
      i,
    ),
  );

describe('model paint, on the real class colours', () => {
  it('the class colours are the same in both themes', () => {
    expect([colors.light.class1, colors.light.class2, colors.light.class3]).toEqual(CLASSES);
  });
  it('colour 0 is the class colour itself, and every colour is a #rrggbb', () => {
    for (const anchor of CLASSES) {
      const all = paintsOf(anchor);
      expect(all[0]).toBe(anchor);
      for (const c of all) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
  it('two models of a class are told apart: every in-class pair is at least 4.5 apart (OKLab x100)', () => {
    for (const anchor of CLASSES) {
      const all = paintsOf(anchor);
      for (let i = 0; i < all.length; i++)
        for (let j = i + 1; j < all.length; j++)
          expect(colorGap(all[i], all[j])).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('every colour stays in its class: nearer its own class colour than any other, by at least 2', () => {
    for (const anchor of CLASSES)
      for (const c of paintsOf(anchor))
        for (const other of CLASSES.filter(o => o !== anchor))
          expect(colorGap(c, other) - colorGap(c, anchor)).toBeGreaterThanOrEqual(2);
  });
  it('no colour of one class is the same as a colour of another: cross-class pairs are at least 7 apart', () => {
    for (const a of CLASSES)
      for (const b of CLASSES)
        if (a < b)
          for (const x of paintsOf(a))
            for (const y of paintsOf(b))
              expect(colorGap(x, y)).toBeGreaterThanOrEqual(7);
  });
  it("the followed car's white-hot is outside every band: at least 18 from every model colour, and a model colour is never grey or white", () => {
    for (const anchor of CLASSES)
      for (const c of paintsOf(anchor)) {
        expect(colorGap(c, WHITE_HOT)).toBeGreaterThanOrEqual(18);
        const lab = toOklab(c)!;
        expect(Math.hypot(lab[1], lab[2])).toBeGreaterThan(0.1);
      }
  });
  it('the hue turns away from the nearest other class: Hyper toward rose, GT3 toward yellow', () => {
    const hue = (c: string) => {
      const lab = toOklab(c)!;
      return ((Math.atan2(lab[2], lab[1]) * 180) / Math.PI + 360) % 360;
    };
    const turned = (from: string, to: string) => ((hue(to) - hue(from) + 540) % 360) - 180;
    const [hyper, , gt3] = CLASSES;
    // red 25 deg and orange 48 deg: red goes down (toward pink, which wraps below 0), orange up (toward yellow)
    expect(turned(hyper, modelPaint(hyper, [CLASSES[1], gt3], 2))).toBeLessThan(-20);
    expect(turned(gt3, modelPaint(gt3, [hyper, CLASSES[1]], 2))).toBeGreaterThan(20);
  });
  it('is the same colour every call, with finite inputs only giving colours', () => {
    expect(modelPaint(CLASSES[0], CLASSES, 3)).toBe(modelPaint(CLASSES[0], CLASSES, 3));
    for (const i of [-5, 0, 2.6, 5, 99, Number.NaN]) {
      const c = modelPaint(CLASSES[2], [CLASSES[0]], i);
      expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('model paint, the edges of its input', () => {
  it('hands anything that is not #rrggbb back as it was', () => {
    expect(modelPaint('rebeccapurple', [], 3)).toBe('rebeccapurple');
    expect(modelPaint('#abc', [], 3)).toBe('#abc');
  });
  it('with no rival it turns up, and with a rival that is not a colour it ignores it', () => {
    expect(modelPaint('#4697e4', [], 2)).toMatch(/^#[0-9a-f]{6}$/);
    expect(modelPaint('#4697e4', ['nope'], 2)).toBe(modelPaint('#4697e4', [], 2));
  });
  it('a model with no place in a family gets a stable index from its name, in range, 0 for no name', () => {
    expect(stepOfName(null)).toBe(0);
    expect(stepOfName('  ')).toBe(0);
    const a = stepOfName('Alpine A424');
    expect(stepOfName('alpine a424')).toBe(a);
    for (const n of ['Oreca 07', 'Ligier JS P217', 'Lexus RC F', 'x']) {
      const s = stepOfName(n);
      expect(Number.isInteger(s) && s >= 0 && s < PAINTS).toBe(true);
    }
  });
  it('colorGap is 0 for the same colour, symmetric, and infinite for a non-colour', () => {
    expect(colorGap('#e64343', '#e64343')).toBe(0);
    expect(colorGap('#e64343', '#4697e4')).toBeCloseTo(colorGap('#4697e4', '#e64343'), 9);
    expect(colorGap('#e64343', 'x')).toBe(Infinity);
  });
});
