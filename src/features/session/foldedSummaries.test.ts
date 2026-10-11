import {describe, expect, it} from '@jest/globals';

import {fuelSummary, pitSummary, tiresSummary} from './foldedSummaries';
import type {PitCard} from './pitCard';
import type {FuelUse} from './fuelUse';
import type {TiresCard} from './tireCard';

const stint = (n: number) =>
  ({
    n,
    tab: `S${n}`,
    title: `Stint ${n} · L1–L10`,
    sub: '8 green laps',
  } as TiresCard extends {stints: (infer S)[]} ? S : never);

describe('tiresSummary', () => {
  it('says there are no channels', () => {
    expect(tiresSummary({kind: 'absent'})).toBe('No tire channels');
  });

  it('names the last stint, the one the card opens on', () => {
    const card = {kind: 'stints', stints: [stint(1), stint(2)]} as TiresCard;
    expect(tiresSummary(card)).toBe('Stint 2 · L1–L10 · 8 green laps');
  });
});

describe('fuelSummary', () => {
  const fuel = (used: number[]) =>
    ({
      points: used.map((fuelL, i) => ({lapId: `l${i}`, fuelL})),
    } as unknown as FuelUse);

  it('is the median fuel use over the green laps, with how many', () => {
    expect(fuelSummary(fuel([3, 3.4, 3.2]))).toBe(
      '3.20 L a lap · median of 3 green laps',
    );
    expect(fuelSummary(fuel([3, 3.2, 3.4, 3.6]))).toBe(
      '3.30 L a lap · median of 4 green laps',
    );
    expect(fuelSummary(fuel([3.1]))).toBe(
      '3.10 L a lap · median of 1 green lap',
    );
  });

  it('says so when no lap is in the medians', () => {
    expect(fuelSummary(fuel([]))).toBe('No stint with enough laps');
  });
});

describe('pitSummary', () => {
  const stops = (lanes: (string | null)[]) =>
    ({
      kind: 'stops',
      columns: lanes.map(v => ({lane: v == null ? null : {value: v}})),
    } as unknown as PitCard);

  it('counts the stops and gives the time each took in the lane', () => {
    expect(pitSummary(stops(['95.6 s', '45.4 s']))).toBe(
      '2 stops · 95.6 s and 45.4 s in the lane',
    );
    expect(pitSummary(stops(['58.0 s']))).toBe('1 stop · 58.0 s in the lane');
  });

  it('leaves out a lane time that is not measured', () => {
    expect(pitSummary(stops([null, null]))).toBe('2 stops');
  });

  it('has no line for the fuel card of a race with no stop', () => {
    expect(pitSummary({kind: 'fuel'} as unknown as PitCard)).toBeNull();
  });
});
