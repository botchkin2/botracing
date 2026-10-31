import {describe, expect, it} from '@jest/globals';

import {colors, type Scheme} from '@/src/design/tokens';

import {bannerParts} from './UpdateBanner';

// sRGB relative luminance and the WCAG contrast ratio.
function lum(hex: string): number {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function over(tint: string, bg: string): string {
  const m = /rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(tint)!;
  const a = Number(m[4]);
  const out = [1, 3, 5].map((i, k) => Math.round(Number(m[k + 1]) * a + parseInt(bg.slice(i, i + 2), 16) * (1 - a)));
  return '#' + out.map(v => v.toString(16).padStart(2, '0')).join('');
}
const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

describe('UpdateBanner', () => {
  it('sets the version apart from the words around it', () => {
    expect(bannerParts({line: 'Update 0.1.19 ready', version: '0.1.19'})).toEqual(['Update ', '0.1.19', ' ready']);
    expect(bannerParts({line: 'Update 0.1.19 ready on the PC', version: '0.1.19'})).toEqual(['Update ', '0.1.19', ' ready on the PC']);
  });

  it.each<Scheme>(['dark', 'light'])('the text reads at AA on the accent tint over the page in %s', scheme => {
    const c = colors[scheme];
    expect(ratio(c.text, over(c.accentTint, c.bg))).toBeGreaterThanOrEqual(4.5);
  });
});
