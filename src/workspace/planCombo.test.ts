import {describe, expect, it} from '@jest/globals';

import {type SessionSummary} from '@/src/data/sessions';

import {
  type Combo,
  comboCar,
  comboTrack,
  defaultCombo,
  planCombos,
  resolveCombo,
  undrivenCombo,
} from './planCombo';

const session = (
  id: string,
  startedAt: string,
  over: Partial<SessionSummary> = {},
): SessionSummary =>
  ({
    id,
    sim: 'lmu',
    trackId: 'lmu-daytona',
    track: 'Daytona',
    car: 'Manthey DK Engineering 2026 #91:LM',
    lapCount: 10,
    comparableCount: 8,
    startedAt,
    ...over,
  } as unknown as SessionSummary);

const driven = (key: string): Combo => ({
  key,
  sim: 'lmu',
  trackId: 'T1',
  track: 'Sebring',
  label: 'Sebring · A',
  car: 'A',
  sessions: [{id: 's'} as Combo['sessions'][number]],
});

describe('planCombos', () => {
  const silverstone = (layout: 'elms' | 'wec', startedAt: string) =>
    session(layout, startedAt, {
      trackId: `lmu-silverstone_grand_prix_circuit_${layout}`,
      track: 'Silverstone Circuit',
      car: 'Porsche 911 GT3 R LMGT3',
    });

  it('lists the combos newest first and skips a session with no laps', () => {
    const combos = planCombos([
      session('a', '2026-10-01T10:00:00Z'),
      session('b', '2026-10-02T10:00:00Z', {
        trackId: 'lmu-sebring',
        track: 'Sebring International Raceway',
      }),
      session('c', '2026-10-03T10:00:00Z', {
        trackId: 'lmu-monza',
        track: 'Autodromo Nazionale Monza',
        lapCount: 0,
      }),
    ]);
    expect(combos.map(c => c.sessions[0].id)).toEqual(['b', 'a']);
  });

  it('tells two layouts of one circuit in one car apart in the label', () => {
    const [newer, older] = planCombos([
      silverstone('elms', '2026-10-02T10:00:00Z'),
      silverstone('wec', '2026-10-01T10:00:00Z'),
    ]);
    expect(newer.label).not.toBe(older.label);
    expect(newer.label.startsWith('Silverstone ')).toBe(true);
    expect(comboTrack(newer)).not.toBe(comboTrack(older));
  });

  it('splits a label into its track and car halves', () => {
    const [c] = planCombos([session('a', '2026-10-01T10:00:00Z')]);
    expect(`${comboTrack(c)} · ${comboCar(c)}`).toBe(c.label);
    expect(comboTrack(c)).toBe('Daytona');
  });
});

describe('defaultCombo', () => {
  const combo = (key: string, comparable: number[]): Combo => ({
    key,
    sim: 'lmu',
    trackId: 't',
    track: 't',
    label: key,
    car: 'c',
    sessions: comparable.map((n, i) => ({
      ...session(`${key}${i}`, '2026-09-20T10:00:00Z'),
      comparableCount: n,
    })),
  });

  it('opens on the newest track and car with enough laps for a median, not one driven for a lap', () => {
    const combos = [combo('cadillac', [1]), combo('porsche', [12, 30])];
    expect(defaultCombo(combos)?.key).toBe('porsche');
  });

  it('counts the laps across a combo’s sessions', () => {
    expect(defaultCombo([combo('a', [1, 1, 1])])?.key).toBe('a');
    expect(defaultCombo([combo('a', [1]), combo('b', [2, 1])])?.key).toBe('b');
  });

  it('falls back to the newest when none has enough, and to null with none', () => {
    expect(defaultCombo([combo('a', [1]), combo('b', [0])])?.key).toBe('a');
    expect(defaultCombo([])).toBeNull();
  });
});

describe('undrivenCombo', () => {
  it('reads an LMU key', () => {
    const c = undrivenCombo('Spa|Ferrari 499P');
    expect(c).toMatchObject({sim: 'lmu', trackId: 'Spa', car: 'Ferrari 499P'});
    expect(c?.sessions).toEqual([]);
  });
  it('reads a sim prefix', () => {
    expect(undrivenCombo('iracing:Spa|Car')).toMatchObject({
      sim: 'iracing',
      trackId: 'Spa',
    });
  });
  it('rejects a key that is not track|car', () => {
    expect(undrivenCombo('Spa')).toBeNull();
    expect(undrivenCombo('|Car')).toBeNull();
    expect(undrivenCombo('Spa|')).toBeNull();
  });
});

describe('resolveCombo', () => {
  const a = driven('T1|A');
  it('finds a driven combo', () => {
    expect(resolveCombo([a], 'T1|A', null)).toBe(a);
  });
  it('opens an empty combo for a key he never drove, not the default', () => {
    const c = resolveCombo([a], 'T9|B', a);
    expect(c?.trackId).toBe('T9');
    expect(c?.sessions).toEqual([]);
  });
  it('uses the default with no key, and for a malformed key', () => {
    expect(resolveCombo([a], null, a)).toBe(a);
    expect(resolveCombo([a], 'junk', a)).toBe(a);
  });
});
