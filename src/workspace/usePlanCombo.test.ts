import {describe, expect, it} from '@jest/globals';

import type {SessionSummary} from '@/src/data/sessions';
import {planComboKey} from '@/src/nav/routes';

import {planChoice} from './usePlanCombo';

const sess = (over: Partial<SessionSummary>) =>
  ({
    id: 's',
    sim: 'lmu',
    track: 'Michelin Raceway Road Atlanta',
    trackId: 'lmu-michelin_raceway_road_atlanta',
    car: 'Porsche 911 GT3 R',
    lapCount: 10,
    ...over,
  } as unknown as SessionSummary);

const lmuAtl = sess({});
const lmuSebring = sess({
  track: 'Sebring International Raceway',
  trackId: 'lmu-sebring',
});
const iracingSebring = sess({
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

  it('an open iRacing session names no Plan pair, not the last LMU drive', () => {
    const c = planChoice({
      sessionOpen: true,
      session: iracingSebring,
      trackId: null,
      driven: [lmuAtl],
    });
    expect(c).toEqual({key: undefined, pair: null});
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
