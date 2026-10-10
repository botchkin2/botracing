import {describe, expect, it} from '@jest/globals';

import {toPlanBlock, toPlanSessions} from './planBlock';

describe('toPlanSessions', () => {
  const block = {
    v: 1,
    fuel: {fillLimitL: 60, startL: 60, tankL: 105, litresPerVePct: null},
    laps: [
      {
        n: 2,
        usedL: 2.4,
        veUsedPct: null,
        timeS: 90.5,
        comparable: true,
        traffic: {aheadS: 1, passes: 0, blueS: 0, battleS: 0.5, overtakes: 2},
      },
    ],
    race: null,
  };

  it('reads the response of GET /plan: sessions newest first, the cap flag', () => {
    const out = toPlanSessions({
      items: [
        {id: 'a', startedAt: '2026-10-09T10:00:00Z', sessionType: 'Race', plan: block},
        {id: 'b', startedAt: '2026-09-01T10:00:00Z', sessionType: 'Practice'},
      ],
      truncated: true,
    });
    expect(out.truncated).toBe(true);
    expect(out.items.map(i => [i.id, i.sessionType])).toEqual([
      ['a', 'R'],
      ['b', 'P'],
    ]);
    expect(out.items[0].plan?.laps?.[0]).toEqual(block.laps[0]);
    expect(out.items[0].plan?.fuel.litresPerVePctStop).toBeNull();
  });

  it('reads a session with no block as null (no data), and drops a row with no id or time', () => {
    const out = toPlanSessions({
      items: [
        {id: 'b', startedAt: '2026-09-01T10:00:00Z', sessionType: 'Practice'},
        {startedAt: 'x'},
        {id: 'c'},
        'junk',
      ],
    });
    expect(out.items).toHaveLength(1);
    expect(out.items[0].plan).toBeNull();
    expect(out.truncated).toBe(false);
  });

  it('survives a body that is not the shape', () => {
    expect(toPlanSessions(null)).toEqual({items: [], truncated: false});
    expect(toPlanSessions({items: 'x'})).toEqual({items: [], truncated: false});
  });
});

describe('toPlanBlock', () => {
  it('keeps laps as null for a session past the newest few, and drops a lap with a missing number', () => {
    expect(toPlanBlock({v: 1, fuel: {}, laps: null, race: null})?.laps).toBeNull();
    const out = toPlanBlock({
      v: 1,
      fuel: {},
      laps: [{n: 1, usedL: 2, timeS: 90}, {n: 2, usedL: 2}, 'x'],
    });
    expect(out?.laps).toHaveLength(1);
    expect(out?.laps?.[0]).toMatchObject({n: 1, usedL: 2, timeS: 90, veUsedPct: null, comparable: false});
  });

  it('reads a race side, with a stop that carries its loss', () => {
    const out = toPlanBlock({
      v: 1,
      fuel: {},
      laps: null,
      race: {
        raceLaps: 27,
        minutes: 45,
        leftEarly: false,
        playerLapsDone: null,
        classLeaderLapsDone: null,
        startVePct: null,
        formationL: 2.68,
        ownUse: {fuelL: 2.55, vePct: null},
        end: {lapIndex: 28, fuelL: 6.91, vePct: null},
        stops: [{lapIndex: 19, fuelL: 6.98, vePct: null, addedL: 23, lossS: 34.18}],
      },
    });
    expect(out?.race?.stops).toEqual([
      {lapIndex: 19, fuelL: 6.98, vePct: null, addedL: 23, lossS: 34.18},
    ]);
    expect(out?.race?.formationL).toBe(2.68);
  });

  it('is null for anything that is not an object, and a race with no end lap reads as none', () => {
    expect(toPlanBlock(null)).toBeNull();
    expect(toPlanBlock('x')).toBeNull();
    expect(toPlanBlock({v: 1, fuel: {}, race: {raceLaps: 3}})?.race).toBeNull();
  });
});
