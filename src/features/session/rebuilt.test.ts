import {describe, expect, it} from '@jest/globals';

import {toSessionDetail} from '@/src/data/sessions/adapters';

import fixture from './__fixtures__/roadAtlantaRace.json';
import {rebuiltOf} from './model';

describe('a session a heal rebuilt', () => {
  const raw = {
    ...(fixture.session as Record<string, unknown>),
    rebuilt: {at: '2026-10-16T00:30:00.000Z', replaced: 2, kept: 1},
    supersededBy: 'abcd',
  } as never;

  it('reads its note and where its replacement is', () => {
    const s = toSessionDetail(raw);
    expect(s.rebuilt).toEqual({
      atMs: Date.parse('2026-10-16T00:30:00.000Z'),
      replaced: 2,
      kept: 1,
    });
    expect(s.supersededBy).toBe('abcd');
  });

  it('says one line, and on a tap when and which stretches', () => {
    const r = rebuiltOf({rebuilt: {atMs: Date.parse('2026-10-16T00:30:00Z'), replaced: 2, kept: 1}});
    expect(r?.line).toBe('Rebuilt from the game file');
    expect(r?.detail).toMatch(/2 recordings replaced · 1 stretch kept$/);
    expect(rebuiltOf({rebuilt: null})).toBeNull();
    expect(
      rebuiltOf({rebuilt: {atMs: 0, replaced: 1, kept: 0}})?.detail,
    ).toMatch(/1 recording replaced$/);
  });
});
