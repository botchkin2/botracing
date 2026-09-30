import {describe, expect, it} from '@jest/globals';

import {type GreenLap} from '@/src/analysis/fuelPlan';
import {type SessionSummary} from '@/src/data/sessions';

import {planCombos} from '../plan/model';
import {lastRaceLine, planCardModel, perLapUseLine} from './planCards';

const session = (
  id: string,
  startedAt: string,
  over: Partial<SessionSummary> = {},
): SessionSummary => ({
  id,
  sim: 'lmu',
  trackId: 'lmu-daytona',
  track: 'Daytona International Speedway',
  car: '911 GT3 R #91',
  carClass: 'GT3',
  sessionType: 'R',
  startedAt,
  lapCount: 72,
  comparableCount: 70,
  bestTimeS: 108,
  medianTimeS: 109,
  bestLapId: null,
  series: null,
  eventId: null,
  cornerMapSource: 'stored',
  updatedAt: startedAt,
  ...over,
});

const lap = (fuelL: number, vePct: number | null): GreenLap => ({
  fuelL,
  vePct,
  lapTimeS: 108,
  sessionId: 'a',
});

const combo = (sessions: SessionSummary[]) => planCombos(sessions)[0];

describe('lastRaceLine', () => {
  it('names the newest race by date, skipping a newer practice, with no lap count', () => {
    const c = combo([
      session('p', '2026-09-29T20:00:00Z', {
        sessionType: 'P',
        lapCount: 30,
      }),
      session('r1', '2026-09-28T20:00:00Z', {lapCount: 72}),
      session('r0', '2026-09-20T20:00:00Z', {lapCount: 10}),
    ]);
    expect(lastRaceLine(c)).toMatch(/^Last race d{2} w{3,4} 2026$/);
  });

  it('says so when the car has only practice here', () => {
    const c = combo([session('p', '2026-09-29T20:00:00Z', {sessionType: 'P'})]);
    expect(lastRaceLine(c)).toBe('No race here yet');
  });
});

describe('perLapUseLine', () => {
  it('is the median of the laps the plan counts, with n', () => {
    expect(perLapUseLine([lap(2.3, 3.4), lap(2.4, 3.5), lap(2.6, 3.9)])).toBe(
      'Fuel 2.40 L/lap · VE 3.50 %/lap (n = 3)',
    );
  });

  it('drops VE, not zero, when no lap carries it (fuel-only)', () => {
    expect(perLapUseLine([lap(2.3, null), lap(2.5, null)])).toBe(
      'Fuel 2.40 L/lap (n = 2)',
    );
  });

  it('shows VE only from three laps that carry it, with its own n when fewer than fuel', () => {
    expect(perLapUseLine([lap(2.3, 3.0), lap(2.5, 3.2), lap(2.4, null)])).toBe(
      'Fuel 2.40 L/lap (n = 3)',
    );
    expect(
      perLapUseLine([
        lap(2.3, 3.0),
        lap(2.5, 4.0),
        lap(2.6, 3.5),
        lap(2.4, null),
      ]),
    ).toBe('Fuel 2.45 L/lap (n = 4) · VE 3.50 %/lap (n = 3)');
  });

  it('is null without laps', () => {
    expect(perLapUseLine([])).toBeNull();
  });
});

describe('planCardModel', () => {
  it('carries the combo key and car for the link', () => {
    const c = combo([session('r', '2026-09-28T20:00:00Z')]);
    const m = planCardModel(c, [lap(2.3, 3.4), lap(2.3, 3.4), lap(2.3, 3.4)]);
    expect(m.key).toBe(c.key);
    expect(m.car).toBe(c.car);
    expect(m.use).toBe('Fuel 2.30 L/lap · VE 3.40 %/lap (n = 3)');
  });
});
