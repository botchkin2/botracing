import {describe, expect, it} from '@jest/globals';

import {type CheckRun, collapseTwins, planChecks} from './planChecks';
import {ruleSetsOf} from './ruleSet';

// Numbers are his real sessions' (pit-wall thread 104, chief-ve-ratio-scan.tsv);
// ids are the real ones' first 8 characters; start times are made up inside
// the minute the scan prints.
const run = (
  id: string,
  startedAt: string,
  over: Partial<CheckRun> = {},
): CheckRun => ({
  id,
  startedAt,
  sessionType: 'P',
  trackCar: 'sebring|911',
  ratio: 0.5,
  stopRatio: null,
  fillLimitL: null,
  tankL: null,
  startL: null,
  online: null,
  setupVePct: null,
  setupVePerLapPct: null,
  fuelPerLapL: null,
  ...over,
});

const check = (
  sessions: CheckRun[],
  planned: string[],
  measured: {fuelPerLapL: number | null; vePerLapPct: number | null},
  ownIds = planned,
) => {
  const sets = ruleSetsOf(
    [...sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
  );
  const set = sets.find(s => s.sessionIds.includes(planned[0]));
  if (!set) throw new Error('no rule set');
  return planChecks({set, sessions, measured, ownIds});
};

// Sebring, Wed 10-22: the week's rules (73 L cap, 0.625 L per 1 % VE) and his
// Tuesday and earlier sessions under other rules.
const sebringWed = [
  run('73c538c3', '2026-10-22T00:39:10Z', {
    sessionType: 'R',
    ratio: 0.625,
    stopRatio: 0.609,
    fillLimitL: 73,
    tankL: 73,
    startL: 73,
    online: false,
    setupVePct: 100,
    setupVePerLapPct: 5.41, // '100% (18.5 laps)'
    fuelPerLapL: 3.57,
  }),
  run('88602891', '2026-10-22T00:27:10Z', {
    sessionType: 'Q',
    ratio: 0.625,
    fillLimitL: 73,
    tankL: 73,
    online: false,
    fuelPerLapL: 3.58,
  }),
];
const sebringTue = [
  run('28dcbd41', '2026-10-19T23:56:10Z', {ratio: 0.837, fillLimitL: 85, tankL: 117, fuelPerLapL: 3.62}),
  run('53128f6f', '2026-10-21T00:39:10Z', {sessionType: 'R', ratio: 0.835, fillLimitL: 85, tankL: 117, fuelPerLapL: 3.6}),
  // the same race's .duckdb twin: no fill limit, 30 s later
  run('0dddbcb7', '2026-10-21T00:39:40Z', {sessionType: 'R', ratio: 0.835, tankL: 117, fuelPerLapL: 3.6}),
  run('6194e3bb', '2026-10-21T23:58:10Z', {ratio: 0.839, tankL: 117, fuelPerLapL: 3.66}),
];

describe('planChecks', () => {
  it('Sebring Wed 10-22: max fuel, litres a lap and VE a lap all read checked', () => {
    const c = check([...sebringWed, ...sebringTue], ['73c538c3', '88602891'], {
      fuelPerLapL: 3.57,
      vePerLapPct: 5.7,
    });
    // 73 L from the setup string, equal to its maxValue 73
    expect(c.maxFuelL).toEqual({value: 73, state: 'checked'});
    // 3.57 against his Tuesday runs' median 3.62: 1.4 %
    expect(c.fuelPerLapL).toEqual({value: 3.57, state: 'checked'});
    // 5.7 against LMU's 5.41: 5.4 % over
    expect(c.vePerLapPct).toEqual({value: 5.7, state: 'checked', lmuPct: 5.41});
  });

  it('Daytona Manthey 3.31 against 3.43 L a lap is 3.5 % apart: checked', () => {
    const c = check(
      [
        run('7166aff5', '2026-08-06T00:05:10Z', {ratio: 0.688, fuelPerLapL: 3.31, trackCar: 'daytona|manthey'}),
        run('e5c5b07d', '2026-08-04T23:42:10Z', {ratio: 0.98, fuelPerLapL: 3.43, trackCar: 'daytona|manthey'}),
      ],
      ['7166aff5'],
      {fuelPerLapL: 3.31, vePerLapPct: null},
    );
    expect(c.fuelPerLapL).toEqual({value: 3.31, state: 'checked'});
  });

  it('a 10 % litres gap disagrees', () => {
    const c = check(
      [
        run('a', '2026-10-22T00:39:10Z', {ratio: 0.625, fuelPerLapL: 3.95}),
        run('b', '2026-10-21T00:39:10Z', {ratio: 0.835, fuelPerLapL: 3.6}),
      ],
      ['a'],
      {fuelPerLapL: 3.95, vePerLapPct: null},
    );
    expect(c.fuelPerLapL).toEqual({value: 3.95, state: 'disagrees'});
  });

  it('no other run with laps is 1 source for litres a lap', () => {
    const c = check(
      [
        run('a', '2026-10-22T00:39:10Z', {ratio: 0.625, fuelPerLapL: 3.57}),
        // an older run without lap rows (only the newest sessions carry them)
        run('b', '2026-09-01T00:39:10Z', {ratio: 0.835}),
      ],
      ['a'],
      {fuelPerLapL: 3.57, vePerLapPct: 5.7},
    );
    expect(c.fuelPerLapL.state).toBe('one-source');
  });

  describe('VE a lap against LMU\'s setup expectation (5.41)', () => {
    const veState = (vePerLapPct: number) =>
      check(
        [run('a', '2026-10-22T00:39:10Z', {ratio: 0.625, setupVePct: 100, setupVePerLapPct: 5.41})],
        ['a'],
        {fuelPerLapL: null, vePerLapPct},
      ).vePerLapPct;

    it('5 % under disagrees, and says what LMU expected', () => {
      expect(veState(5.14)).toEqual({value: 5.14, state: 'disagrees', lmuPct: 5.41});
    });
    it('holds from 3 % under to 10 % over', () => {
      expect(veState(5.25).state).toBe('checked'); // 3.0 % under
      expect(veState(5.95).state).toBe('checked'); // 10.0 % over
      expect(veState(5.96).state).toBe('disagrees'); // 10.2 % over
      expect(veState(5.2).state).toBe('disagrees'); // 3.9 % under
    });
    it('without LMU\'s expectation it is 1 source', () => {
      const c = check([run('a', '2026-10-22T00:39:10Z', {ratio: 0.625})], ['a'], {
        fuelPerLapL: null,
        vePerLapPct: 5.7,
      });
      expect(c.vePerLapPct).toEqual({value: 5.7, state: 'one-source', lmuPct: null});
    });
    it('takes the expectation of the set\'s file with the highest VE setting', () => {
      const c = check(
        [
          run('p20', '2026-10-22T00:50:10Z', {ratio: 0.625, setupVePct: 20, setupVePerLapPct: 3.77}), // '20% (5.3 laps)'
          run('r100', '2026-10-22T00:39:10Z', {ratio: 0.625, setupVePct: 100, setupVePerLapPct: 5.41}),
        ],
        ['p20', 'r100'],
        {fuelPerLapL: null, vePerLapPct: 5.7},
      );
      expect(c.vePerLapPct.lmuPct).toBe(5.41);
      expect(c.vePerLapPct.state).toBe('checked');
    });
  });

  describe('the duplicate docs of one run are never its own second source', () => {
    // Silverstone Porsche, 10-15 race: three docs, one run (thread 104 #7393)
    const triple = (over: Partial<CheckRun> = {}) =>
      ['32c9d386', '7e812df9', 'c7ae92b3'].map((id, i) =>
        run(id, `2026-10-15T01:09:${String(i * 20).padStart(2, '0')}Z`, {
          trackCar: 'silverstone|911',
          sessionType: 'R',
          ratio: 0.678,
          fuelPerLapL: 3.42,
          ...over,
        }),
      );

    it('litres a lap from the triple alone is 1 source', () => {
      const ids = ['c7ae92b3'];
      const c = check(triple(), ids, {fuelPerLapL: 3.42, vePerLapPct: null}, ids);
      expect(c.fuelPerLapL).toEqual({value: 3.42, state: 'one-source'});
    });

    it('max fuel from the triple alone, with the cap above the tank, is 1 source', () => {
      const c = check(triple({fillLimitL: 100, tankL: 117}), ['c7ae92b3'], {
        fuelPerLapL: null,
        vePerLapPct: null,
      });
      expect(c.maxFuelL).toEqual({value: 100, state: 'one-source'});
    });

    it('collapses the triple, and 682524ed + 9b96efed, to one run each', () => {
      const runs = collapseTwins([
        ...triple(),
        run('682524ed', '2026-10-14T00:25:05Z', {trackCar: 'silverstone|911'}),
        run('9b96efed', '2026-10-14T00:25:50Z', {trackCar: 'silverstone|911'}),
      ]);
      expect(runs.map(r => r.ids)).toEqual([
        ['32c9d386', '7e812df9', 'c7ae92b3'],
        ['682524ed', '9b96efed'],
      ]);
    });

    it('sessions a minute and a half apart, or of another car, are separate runs', () => {
      const runs = collapseTwins([
        run('a', '2026-10-15T01:09:00Z'),
        run('b', '2026-10-15T01:10:30Z'),
        run('c', '2026-10-15T01:09:10Z', {trackCar: 'sebring|other'}),
      ]);
      expect(runs).toHaveLength(3);
    });

    it('the merged run takes the game file\'s setup over the capture\'s', () => {
      const [merged] = collapseTwins([
        run('live', '2026-10-17T00:13:00Z', {tankL: 117, fuelPerLapL: 2.82}),
        run('duck', '2026-10-17T00:13:20Z', {fillLimitL: 87, tankL: 117, setupVePct: 100, setupVePerLapPct: 3.36}),
      ]);
      expect(merged.ids).toEqual(['live', 'duck']);
      expect(merged.run).toMatchObject({fillLimitL: 87, setupVePerLapPct: 3.36, fuelPerLapL: 2.82});
    });
  });

  describe('max fuel', () => {
    it('another run of the set with a different cap disagrees', () => {
      const c = check(
        [
          run('a', '2026-10-22T00:39:10Z', {ratio: 0.625, fillLimitL: 73, tankL: 73}),
          run('b', '2026-10-22T00:27:10Z', {ratio: 0.625, fillLimitL: 75, tankL: 75}),
        ],
        ['a', 'b'],
        {fuelPerLapL: null, vePerLapPct: null},
      );
      expect(c.maxFuelL.state).toBe('disagrees');
    });
    it('another run of the set with the same cap checks an uncapped one', () => {
      const c = check(
        [
          run('a', '2026-10-22T00:39:10Z', {ratio: 0.625, fillLimitL: 100, tankL: 117}),
          run('b', '2026-10-22T00:27:10Z', {ratio: 0.625, fillLimitL: 100, tankL: 117}),
        ],
        ['a', 'b'],
        {fuelPerLapL: null, vePerLapPct: null},
      );
      expect(c.maxFuelL).toEqual({value: 100, state: 'checked'});
    });
    it('a live capture with no setup has no max fuel', () => {
      const c = check([run('live', '2026-10-22T00:39:10Z', {ratio: 0.8, tankL: 117})], ['live'], {
        fuelPerLapL: null,
        vePerLapPct: null,
      });
      expect(c.maxFuelL).toEqual({value: null, state: null});
    });
  });

  describe('offline against online', () => {
    // Algarve 10-17, the Manthey offline practice: the capture and the game
    // file of one run, ratio 0.845.
    const algarve = [
      run('b0ff7e5d', '2026-10-17T00:13:00Z', {trackCar: 'algarve|manthey', ratio: 0.845, online: false, tankL: 117}),
      run('9f83861f', '2026-10-17T00:13:20Z', {
        trackCar: 'algarve|manthey',
        ratio: 0.845,
        online: false,
        fillLimitL: 87,
        tankL: 117,
      }),
    ];
    const online = (ratio: number) =>
      run('on1', '2026-10-28T20:00:00Z', {trackCar: 'algarve|manthey', sessionType: 'R', ratio, online: true});
    const none = {fuelPerLapL: null, vePerLapPct: null};

    it('an offline practice alone has not been compared with an online session', () => {
      expect(check(algarve, ['b0ff7e5d'], none).offline).toEqual({kind: 'not-compared'});
    });
    it('an online race 0.850 in the same rule set (0.845 + 0.005 within 0.015) matches it', () => {
      expect(check([online(0.85), ...algarve], ['on1'], none).offline).toEqual({
        kind: 'matched',
        online: {startedAt: '2026-10-28T20:00:00Z', sessionType: 'R'},
      });
    });
    it('an online race at 0.917 is another rule set: still not compared', () => {
      expect(check([online(0.917), ...algarve], ['b0ff7e5d'], none).offline).toEqual({
        kind: 'not-compared',
      });
    });
    it('a set with no offline session has no offline line', () => {
      expect(check([online(0.85)], ['on1'], none).offline).toBeNull();
    });
  });
});
