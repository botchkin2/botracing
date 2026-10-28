import {describe, expect, it} from '@jest/globals';

import {MODELS} from './modelShapes';
import {
  MIN_DIFFERENCES,
  differingFeatures,
  rearSignature,
  type RearSignature,
} from './rearSignature';

const sig = (over: Partial<RearSignature> = {}): RearSignature => ({
  wingKind: 'stalks',
  wingTopM: 1,
  wingSpanM: 1.85,
  tailHalfW: [0.8, 0.6],
  deckTopM: 0.7,
  endPlateM: 0,
  finM: 0.4,
  lights: '[]',
  ...over,
});

describe('differingFeatures', () => {
  it('counts a kind or a pattern, and a metre step only from 0.15 m', () => {
    expect(differingFeatures(sig(), sig())).toEqual([]);
    expect(differingFeatures(sig(), sig({wingKind: 'pylon'}))).toEqual([
      'wing kind',
    ]);
    expect(differingFeatures(sig(), sig({lights: '[[[0,1]]]'}))).toEqual([
      'light pattern',
    ]);
    expect(differingFeatures(sig(), sig({wingSpanM: 2.05}))).toEqual([
      'wing span',
    ]);
    expect(differingFeatures(sig(), sig({wingSpanM: 1.95}))).toEqual([]);
    expect(
      differingFeatures(sig(), sig({wingTopM: 1.14, deckTopM: 0.84})),
    ).toEqual([]);
    expect(
      differingFeatures(
        sig(),
        sig({
          wingTopM: 1.15,
          deckTopM: 0.55,
          finM: 0.6,
          endPlateM: 0.15,
          tailHalfW: [0.8, 0.45],
        }),
      ),
    ).toEqual([
      'wing height',
      'tail width',
      'deck height',
      'end plate',
      'fin height',
    ]);
  });
});

describe('no two models of a class share a rear', () => {
  // both blocks: GT3's rows are wrench's, Hyper's circuit's
  it.each(['GT3', 'Hyper'])(
    '%s: every pair differs in at least two rear features',
    cls => {
      const block = MODELS[cls];
      const tooClose: string[] = [];
      for (let i = 0; i < block.length; i++)
        for (let j = i + 1; j < block.length; j++) {
          const diff = differingFeatures(
            rearSignature(block[i].example, cls),
            rearSignature(block[j].example, cls),
          );
          if (diff.length < MIN_DIFFERENCES)
            tooClose.push(
              `${block[i].key} / ${block[j].key}: ${
                diff.join(', ') || 'nothing'
              }`,
            );
        }
      expect(tooClose).toEqual([]);
    },
  );
});

describe('the Hyper lights', () => {
  // A light pattern is drawn only where the real car's tail has it (the reference table, a source per row); a car
  // without one has none, never an invented one (steward #8277, scout #8284)
  const SOURCED = [
    'alpine-a424',
    'porsche-963',
    'lamborghini-sc63',
    'genesis-gmr-001',
    'peugeot-9x8',
  ];
  it('only the source-backed Hypers have lights, and no two share a pattern', () => {
    const lit = MODELS.Hyper.map(m => ({
      key: m.key,
      lights: rearSignature(m.example, 'Hyper').lights,
    })).filter(p => p.lights !== '[]');
    expect(lit.map(p => p.key).sort()).toEqual([...SOURCED].sort());
    expect(new Set(lit.map(p => p.lights)).size).toBe(lit.length);
  });
});
