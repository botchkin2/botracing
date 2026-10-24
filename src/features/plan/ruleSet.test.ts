import {describe, expect, it} from '@jest/globals';

import {type RuleSession, ruleSetsOf} from './ruleSet';

const s = (
  id: string,
  startedAt: string,
  sessionType: 'R' | 'Q' | 'P',
  over: Partial<RuleSession> = {},
): RuleSession => ({
  id,
  startedAt,
  sessionType,
  ratio: 0.5,
  stopRatio: null,
  fillLimitL: null,
  startL: null,
  ...over,
});

// The five sessions of one series week at one track and car, from his real ones (numbers only)
const week = [
  s('wedR', '2026-10-22T00:39:00Z', 'R', {ratio: 0.625, stopRatio: 0.609, fillLimitL: 73, startL: 73}),
  s('wedQ', '2026-10-22T00:27:00Z', 'Q', {ratio: 0.625, stopRatio: 0.803, fillLimitL: 73, startL: 20.4}),
  s('wedP', '2026-10-21T23:58:00Z', 'P', {ratio: 0.839, stopRatio: 0.935, startL: 78.9}),
  s('tueR', '2026-10-21T00:40:00Z', 'R', {ratio: 0.835, stopRatio: 0.823, startL: 85}),
  s('tueQ', '2026-10-21T00:28:00Z', 'Q', {ratio: 0.837, stopRatio: 0.857, fillLimitL: 85, startL: 25.5}),
];

describe('ruleSetsOf', () => {
  it('plans the newest rules: the Wed race and qualifying, never Tue 85 L with Wed 0.625 (T3)', () => {
    const [planned] = ruleSetsOf(week);
    expect(planned.sessionIds).toEqual(['wedR', 'wedQ']);
    expect(planned.ratio.perPctL).toBe(0.625);
    expect(planned.mostRunL).toBe(73);
    expect(planned.stopRatio).toBe(0.609);
    expect(planned.fromPracticeOnly).toBe(false);
  });

  it('puts the practice that ran last week\'s rules in that week\'s set, ratio from its race (T4)', () => {
    const [, tue] = ruleSetsOf(week);
    expect(tue.sessionIds).toEqual(['wedP', 'tueR', 'tueQ']);
    // the newest race or qualifying of the set, not the practice's 0.839
    expect(tue.ratio).toEqual({perPctL: 0.835, from: {startedAt: '2026-10-21T00:40:00Z', sessionType: 'R'}});
    expect(tue.fromPracticeOnly).toBe(false);
    expect(tue.mostRunL).toBe(85);
  });

  it('plans the rules of a set with no race or qualifying from its practice, and says so (T4b)', () => {
    const [only] = ruleSetsOf([s('p', '2026-10-01T00:00:00Z', 'P', {ratio: 0.7})]);
    expect(only.ratio.perPctL).toBe(0.7);
    expect(only.ratio.from.sessionType).toBe('P');
    expect(only.fromPracticeOnly).toBe(true);
  });

  it('never takes a practice start as the load (T5)', () => {
    const [only] = ruleSetsOf([
      s('p1', '2026-10-02T00:00:00Z', 'P', {ratio: 0.7, startL: 17.4}),
      s('q1', '2026-10-01T00:00:00Z', 'Q', {ratio: 0.7, startL: 20.4}),
    ]);
    expect(only.mostRunL).toBeNull();
  });

  it('takes the start fuel of the newest race when no session has a fill limit', () => {
    const [only] = ruleSetsOf([
      s('r2', '2026-10-03T00:00:00Z', 'R', {ratio: 0.8, startL: 85}),
      s('p1', '2026-10-02T00:00:00Z', 'P', {ratio: 0.8, startL: 17.4}),
    ]);
    expect(only.mostRunL).toBe(85);
  });

  it('groups ratios within 0.015 and keeps two sets 0.016 apart (T7)', () => {
    const at = (id: string, ratio: number, day: number) =>
      s(id, `2026-10-${String(day).padStart(2, '0')}T00:00:00Z`, 'R', {ratio});
    // noise inside one event (0.005) stays one set, chained
    expect(ruleSetsOf([at('a', 0.835, 3), at('b', 0.837, 2), at('c', 0.839, 1)])).toHaveLength(1);
    // exactly 0.015 is one set
    expect(ruleSetsOf([at('a', 0.7, 2), at('b', 0.715, 1)])).toHaveLength(1);
    // 0.016 is two
    expect(ruleSetsOf([at('a', 0.7, 2), at('b', 0.716, 1)])).toHaveLength(2);
  });

  it('leaves a session with no VE out of every set', () => {
    expect(ruleSetsOf([s('x', '2026-10-01T00:00:00Z', 'R', {ratio: null})])).toEqual([]);
  });
});
