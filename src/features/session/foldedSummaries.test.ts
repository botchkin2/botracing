import {describe, expect, it} from '@jest/globals';

import {fuelSummary, tiresSummary} from './foldedSummaries';
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
    expect(tiresSummary({kind: 'absent'})).toBe('No tyre channels');
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
