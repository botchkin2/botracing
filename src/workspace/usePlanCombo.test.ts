import {describe, expect, it} from '@jest/globals';

import type {SessionSummary} from '@/src/data/sessions';
import {planComboKey} from '@/src/nav/routes';

import {defaultCombo, planCombos} from './planCombo';
import {planChoice} from './usePlanCombo';

const sess = (over: Partial<SessionSummary>) =>
  ({
    id: 's',
    sim: 'lmu',
    track: 'Michelin Raceway Road Atlanta',
    trackId: 'lmu-michelin_raceway_road_atlanta',
    car: 'Porsche 911 GT3 R',
    lapCount: 10,
    startedAt: '2026-10-01T10:00:00Z',
    ...over,
  } as unknown as SessionSummary);

const lmuAtl = sess({id: 'atl'});
const lmuSebring = sess({
  id: 'sebring',
  track: 'Sebring International Raceway',
  trackId: 'lmu-sebring',
});
const iracingSebring = sess({
  id: 'iracing-sebring',
  sim: 'iracing',
  track: 'Sebring International Raceway',
  trackId: 'iracing-sebring',
  car: 'Ford Mustang GT3',
});

describe('planChoice: the Plan link follows the open session', () => {
  it('an open LMU session names its own track and car', () => {
    const c = planChoice({
      sessionOpen: true,
      session: lmuSebring,
      trackId: null,
      driven: [lmuAtl],
    });
    expect(c.key).toBe(planComboKey('lmu-sebring', 'Porsche 911 GT3 R'));
    expect(c.pair).toContain('Sebring');
    expect(c.pair).not.toContain('Road Atlanta');
  });

  it('an open iRacing session names its own pair, under its own sim-prefixed key', () => {
    const c = planChoice({
      sessionOpen: true,
      session: iracingSebring,
      trackId: null,
      driven: [lmuAtl],
    });
    expect(c.key).toMatch(/^iracing:/);
    expect(c.pair).toContain('Sebring');
  });

  it('while the open session is still loading, it names nothing yet', () => {
    const c = planChoice({
      sessionOpen: true,
      session: undefined,
      trackId: null,
      driven: [lmuAtl],
    });
    expect(c).toEqual({key: undefined, pair: null});
  });

  it('with no session open, the last LMU drive is the default', () => {
    const c = planChoice({
      sessionOpen: false,
      session: undefined,
      trackId: null,
      driven: [lmuAtl],
    });
    expect(c.key).toBeUndefined();
    expect(c.pair).toContain('Road Atlanta');
  });
});

// Newest first, as the sessions list gives them.
const oneLapNewest = sess({
  id: 'new',
  track: 'Sebring International Raceway',
  trackId: 'lmu-sebring',
  lapCount: 1,
  comparableCount: 0,
  startedAt: '2026-10-24T10:00:00Z',
});
const manyLapsOlder = sess({
  id: 'old',
  lapCount: 30,
  comparableCount: 28,
  startedAt: '2026-10-20T10:00:00Z',
});

describe('planChoice: the bar names what the Plan opens on', () => {
  it('a 1-lap newest drive does not decide it: the Plan skips it, so does the bar', () => {
    const driven = [oneLapNewest, manyLapsOlder];
    const bar = planChoice({
      sessionOpen: false,
      session: undefined,
      trackId: null,
      driven,
    });
    const plan = defaultCombo(planCombos(driven));
    expect(bar.pair).toBe(plan?.label);
    expect(bar.pair).toContain('Road Atlanta');
  });

  it("the Plan's own pick wins over the default, driven or not", () => {
    const driven = [oneLapNewest, manyLapsOlder];
    const picked = planChoice({
      sessionOpen: false,
      session: undefined,
      trackId: null,
      planKey: planComboKey('lmu-sebring', 'Porsche 911 GT3 R'),
      driven,
    });
    expect(picked.pair).toContain('Sebring');
    expect(picked.key).toBe(planComboKey('lmu-sebring', 'Porsche 911 GT3 R'));
    const undriven = planChoice({
      sessionOpen: false,
      session: undefined,
      trackId: null,
      planKey: planComboKey('lmu-fuji', 'Porsche 911 GT3 R'),
      driven,
    });
    expect(undriven.key).toBe(planComboKey('lmu-fuji', 'Porsche 911 GT3 R'));
    expect(undriven.pair).toContain('Porsche 911 GT3 R');
  });

  it('an unknown param falls back to the default', () => {
    const driven = [oneLapNewest, manyLapsOlder];
    const c = planChoice({
      sessionOpen: false,
      session: undefined,
      trackId: null,
      planKey: 'nonsense',
      driven,
    });
    expect(c.pair).toBe(defaultCombo(planCombos(driven))?.label);
    expect(c.key).toBeUndefined();
  });

  it("the Track page's pair still names its own track", () => {
    const c = planChoice({
      sessionOpen: false,
      session: undefined,
      trackId: 'lmu-sebring',
      driven: [oneLapNewest, manyLapsOlder],
    });
    expect(c.pair).toContain('Sebring');
    expect(c.key).toBe(planComboKey('lmu-sebring', 'Porsche 911 GT3 R'));
  });

  it('two layouts of one circuit in one car: the bar and the chip name the same one', () => {
    const silverstone = (layout: 'elms' | 'wec', startedAt: string) =>
      sess({
        id: layout,
        trackId: `lmu-silverstone_grand_prix_circuit_${layout}`,
        track: 'Silverstone Circuit',
        startedAt,
        comparableCount: 28,
      });
    const driven = [
      silverstone('elms', '2026-10-21T10:00:00Z'),
      silverstone('wec', '2026-10-20T10:00:00Z'),
    ];
    const chips = planCombos(driven);
    for (const open of driven) {
      const bar = planChoice({
        sessionOpen: true,
        session: open,
        trackId: null,
        driven,
      });
      expect(bar.pair).toBe(
        chips.find(c => c.sessions[0].id === open.id)?.label,
      );
    }
    expect(chips[0].label).not.toBe(chips[1].label);
  });
});
