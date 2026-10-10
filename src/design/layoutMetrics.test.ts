import {describe, expect, it} from '@jest/globals';

import {layoutMetrics} from './layoutMetrics';

describe('layoutMetrics', () => {
  it('phone portrait: neither desktop nor landscape', () => {
    const m = layoutMetrics(375, 812, 0);
    expect(m).toMatchObject({
      isDesktop: false,
      isWide: false,
      isLandscapePhone: false,
      contentWidth: 343,
    });
  });

  it('phone landscape 812x375 keeps the phone layout and gets the width', () => {
    const m = layoutMetrics(812, 375, 0);
    expect(m).toMatchObject({
      isDesktop: false,
      isWide: false,
      isLandscapePhone: true,
      contentWidth: 780,
      height: 375,
    });
  });

  it('a short desktop browser window stays desktop', () => {
    const m = layoutMetrics(1440, 480, 0);
    expect(m.isLandscapePhone).toBe(false);
    expect(m.isDesktop).toBe(true);
    expect(m.isWide).toBe(true);
  });

  it('landscape phone keeps the larger side inset on both sides', () => {
    const m = layoutMetrics(812, 375, 0, 47, 0);
    expect(m.sideInset).toBe(47);
    expect(m.contentWidth).toBe(812 - 94 - 32);
    expect(layoutMetrics(375, 812, 0, 0, 0).sideInset).toBe(0);
    expect(layoutMetrics(1440, 900, 0, 47, 47).sideInset).toBe(0);
  });

  it('large phone landscape 932x430 is past 900 wide but still a phone', () => {
    const m = layoutMetrics(932, 430, 0);
    expect(m.isLandscapePhone).toBe(true);
    expect(m.isDesktop).toBe(false);
  });

  it('desktop 1440x900 is wide, not a landscape phone', () => {
    const m = layoutMetrics(1440, 900, 0);
    expect(m).toMatchObject({
      isDesktop: true,
      isWide: true,
      isLandscapePhone: false,
    });
  });

  it('tablet portrait 768x1024 and landscape 1024x768 are not phones', () => {
    expect(layoutMetrics(768, 1024, 0).isLandscapePhone).toBe(false);
    const t = layoutMetrics(1024, 768, 0);
    expect(t.isLandscapePhone).toBe(false);
    expect(t.isDesktop).toBe(true);
    expect(t.isWide).toBe(false);
  });

  it('subtracts the content inset from width but breakpoints use the window', () => {
    const m = layoutMetrics(1000, 800, 280);
    expect(m.width).toBe(720);
    expect(m.isDesktop).toBe(true);
  });

  it('an unmeasured window never yields negative widths', () => {
    expect(layoutMetrics(0, 0, 280)).toMatchObject({
      width: 0,
      contentWidth: 0,
      isLandscapePhone: false,
    });
  });
});
