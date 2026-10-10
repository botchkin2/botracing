import {describe, expect, test} from '@jest/globals';

import {lapColor, lapColors} from './tokens';

describe('lapColor', () => {
  test('the first slots are the palette, in order', () => {
    expect(lapColor('dark', 0)).toBe(lapColors.dark[0]);
    expect(lapColor('light', 3)).toBe(lapColors.light[3]);
  });

  test('past the palette, every slot gets its own generated hue', () => {
    const n = lapColors.dark.length;
    const past = Array.from({length: 40}, (_, i) => lapColor('dark', n + i));
    expect(new Set(past).size).toBe(past.length);
    expect(past.every(c => c.startsWith('hsl('))).toBe(true);
  });

  test('a generated colour never equals a palette colour for the same scheme', () => {
    const n = lapColors.light.length;
    const past = Array.from({length: 40}, (_, i) => lapColor('light', n + i));
    expect(past.some(c => lapColors.light.includes(c))).toBe(false);
  });
});
