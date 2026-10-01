import {beforeEach, describe, expect, it} from '@jest/globals';

import {clampPanelW, PANEL_LIMITS, usePanelPrefs} from './panelPrefs';

describe('clampPanelW', () => {
  it('stays inside the limits, in whole points', () => {
    const {min, max} = PANEL_LIMITS.session;
    expect(clampPanelW('session', 10)).toBe(min);
    expect(clampPanelW('session', 99999)).toBe(max);
    expect(clampPanelW('session', 400.4)).toBe(400);
  });

  it('is kept from squeezing the other column by the room the layout has', () => {
    expect(clampPanelW('session', 700, 500)).toBe(500);
    // Never below the panel’s own minimum, even with no room.
    expect(clampPanelW('session', 700, 100)).toBe(PANEL_LIMITS.session.min);
  });

  it('has a default inside its own limits for every page', () => {
    for (const [id, l] of Object.entries(PANEL_LIMITS)) {
      expect(l.default).toBeGreaterThanOrEqual(l.min);
      expect(l.default).toBeLessThanOrEqual(l.max);
      expect(clampPanelW(id as keyof typeof PANEL_LIMITS, l.default)).toBe(
        l.default,
      );
    }
  });
});

describe('the saved widths', () => {
  beforeEach(() => {
    usePanelPrefs.setState({widths: {}});
  });

  it('keeps a width per page, clamped on the way in', () => {
    usePanelPrefs.getState().setWidth('race', 450.6);
    usePanelPrefs.getState().setWidth('corner', 5000);
    expect(usePanelPrefs.getState().widths).toEqual({
      race: 451,
      corner: PANEL_LIMITS.corner.max,
    });
  });

  it('a reset forgets one page and leaves the others', () => {
    usePanelPrefs.getState().setWidth('race', 450);
    usePanelPrefs.getState().setWidth('session', 500);
    usePanelPrefs.getState().resetWidth('race');
    expect(usePanelPrefs.getState().widths).toEqual({session: 500});
  });
});
