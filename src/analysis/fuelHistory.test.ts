import {describe, expect, it} from '@jest/globals';

import {sameLimit, sinceChange} from './fuelHistory';

const session = (
  id: string,
  n: number,
  fuelL: number,
  vePct: number | null,
) => ({
  id,
  laps: Array.from({length: n}, () => ({fuelL, vePct})),
});

describe('sameLimit', () => {
  it('matches within half a litre, never an unknown limit', () => {
    expect(sameLimit(75, 75)).toBe(true);
    expect(sameLimit(75.4, 75)).toBe(true);
    expect(sameLimit(79, 75)).toBe(false);
    expect(sameLimit(null, 75)).toBe(false);
  });
});

describe('sinceChange', () => {
  // Barcelona 2026-08 (thread 36 #1095): the newest sessions use 2.88 L and
  // 4.30 %/lap, the March and April ones 2.31 L and 3.33 %/lap.
  const newest = [session('n1', 5, 2.88, 4.3), session('n2', 6, 2.88, 4.3)];
  const old = [
    session('o1', 40, 2.31, 3.33),
    session('o2', 60, 2.31, 3.33),
    session('o3', 75, 2.31, 3.33),
  ];

  it('keeps only the laps since a jump in use', () => {
    const out = sinceChange([...newest, ...old]);
    expect(out.sessionIds).toEqual(['n1', 'n2']);
    expect(out.laps).toHaveLength(11);
    expect(out.drift).toEqual({
      fuelL: {newest: 2.88, history: 2.31},
      vePct: {newest: 4.3, history: 3.33},
      direction: 'more',
      applied: true,
      keptSessions: 2,
      keptLaps: 11,
      droppedSessions: 3,
    });
  });

  it('keeps everything when the newest session is in line', () => {
    const out = sinceChange([
      session('n', 8, 2.34, 3.35),
      session('a', 30, 2.31, 3.33),
      session('b', 30, 2.29, 3.31),
    ]);
    expect(out.drift).toBeNull();
    expect(out.sessionIds).toEqual(['n', 'a', 'b']);
  });

  it('reports only the meter that moved', () => {
    const out = sinceChange([
      session('n', 8, 2.32, 4.3),
      session('a', 30, 2.31, 3.33),
    ]);
    expect(out.drift?.fuelL).toBeNull();
    expect(out.drift?.vePct).toEqual({newest: 4.3, history: 3.33});
  });

  it('calls a session 9 % off in line and 11 % off a change', () => {
    const at = (fuelL: number) =>
      sinceChange([session('n', 5, fuelL, null), session('a', 30, 2, null)]);
    expect(at(2.18).drift).toBeNull();
    expect(at(2.22).drift?.fuelL).toEqual({newest: 2.22, history: 2});
    expect(at(1.82).drift).toBeNull();
    expect(at(1.78).drift?.fuelL).toEqual({newest: 1.78, history: 2});
    expect(at(1.78).drift?.direction).toBe('less');
  });

  // Botkin tries fuel saving in practice (thread 36 #1006, camber #1137): one
  // session at -12 % must not shorten the history and lengthen the stints.
  describe('a lower newest session', () => {
    const saving = (id: string, n = 6) => session(id, n, 2.1, 3.0);
    const usual = [session('a', 30, 2.4, 3.4), session('b', 40, 2.4, 3.4)];

    it('keeps the whole history and only reports the row', () => {
      const out = sinceChange([saving('s1'), ...usual]);
      expect(out.sessionIds).toEqual(['s1', 'a', 'b']);
      expect(out.laps).toHaveLength(76);
      expect(out.drift).toMatchObject({
        direction: 'less',
        applied: false,
        fuelL: {newest: 2.1, history: 2.4},
        keptSessions: 3,
        droppedSessions: 0,
      });
    });

    it('switches once two sessions in a row agree on the lower figure', () => {
      const out = sinceChange([saving('s2', 5), saving('s1'), ...usual]);
      expect(out.sessionIds).toEqual(['s2', 's1']);
      expect(out.drift).toMatchObject({
        direction: 'less',
        applied: true,
        keptSessions: 2,
        droppedSessions: 2,
      });
    });

    it('does not switch when the second session is back to normal', () => {
      const out = sinceChange([saving('s2'), usual[0], usual[1]]);
      expect(out.drift?.applied).toBe(false);
      expect(out.sessionIds).toEqual(['s2', 'a', 'b']);
    });

    it('does not switch when the second lower session is a different level', () => {
      const out = sinceChange([
        saving('s2'),
        session('s1', 6, 1.7, 2.4),
        ...usual,
      ]);
      expect(out.drift?.applied).toBe(false);
    });
  });

  it('a mix of one meter higher and one lower counts as higher', () => {
    const out = sinceChange([
      session('n', 6, 2.9, 3.0),
      session('a', 30, 2.4, 3.4),
    ]);
    expect(out.drift).toMatchObject({direction: 'more', applied: true});
  });

  it('judges on the newest session that has enough laps', () => {
    const out = sinceChange([session('tiny', 2, 9, 9), ...newest, ...old]);
    expect(out.sessionIds).toEqual(['tiny', 'n1', 'n2']);
    expect(out.drift?.keptSessions).toBe(3);
  });

  it('does not end the run at a session too short to judge', () => {
    const out = sinceChange([
      newest[0],
      session('short', 2, 2.31, 3.33),
      newest[1],
      ...old,
    ]);
    expect(out.sessionIds).toEqual(['n1', 'short', 'n2']);
  });

  it('cannot compare with nothing else, or without enough laps', () => {
    expect(sinceChange([]).drift).toBeNull();
    expect(sinceChange([session('only', 10, 2.9, 4.3)]).drift).toBeNull();
    expect(
      sinceChange([session('a', 2, 3, 4), session('b', 2, 2, 3)]).drift,
    ).toBeNull();
  });

  it('works on fuel alone when the car has no VE', () => {
    const out = sinceChange([
      session('n', 6, 2.9, null),
      session('a', 30, 2.3, null),
    ]);
    expect(out.drift?.fuelL).toEqual({newest: 2.9, history: 2.3});
    expect(out.drift?.vePct).toBeNull();
  });
});
