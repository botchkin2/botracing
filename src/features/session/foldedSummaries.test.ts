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
  const fuel = (medians: (number | null)[]) =>
    ({
      stints: medians.map((m, i) => ({n: i + 1, medianFuelL: m})),
    } as unknown as FuelUse);

  it('is the median of the stint medians, with how many stints', () => {
    expect(fuelSummary(fuel([3, 3.2, 3.4]))).toBe('3.20 L a lap · 3 stints');
    expect(fuelSummary(fuel([3, null, 3.4]))).toBe('3.20 L a lap · 2 stints');
    expect(fuelSummary(fuel([3.1]))).toBe('3.10 L a lap · 1 stint');
  });

  it('says so when no stint has a median', () => {
    expect(fuelSummary(fuel([null]))).toBe('No stint with enough laps');
  });
});
