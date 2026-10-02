import {describe, expect, it} from '@jest/globals';

import type {Lap, PitStop} from '@/src/data/sessions';
import {toLaps} from '@/src/data/sessions/adapters';

import fixture from './__fixtures__/roadAtlantaRace.json';
import {energyLine} from './energyLine';

const lap = (lapIndex: number, over: Partial<Lap> = {}): Lap => ({
  ...toLaps([{...fixture.laps[0], newTyres: false}])[0],
  id: `l${lapIndex}`,
  lapIndex,
  stint: 1,
  timeS: 90,
  partial: false,
  reasons: [],
  fuel: null,
  pitStop: null,
  pitOut: false,
  tyres: null,
  newTyres: false,
  ...over,
});

const fuel = (over: Partial<NonNullable<Lap['fuel']>> = {}) => ({
  startL: 84,
  endL: 4.9,
  usedL: 5,
  addedL: 0,
  veStartPct: 87,
  veEndPct: 3,
  veUsedPct: 8,
  veAddedPct: 0,
  lapsLeftFuel: 8,
  lapsLeftVe: 7.5,
  green: true,
  ...over,
});

const stop = (fuelL: number | null, vePct: number | null): PitStop =>
  ({
    atEntry: {fuelL: 9.4, vePct: vePct == null ? null : 4},
    added: {fuelL, vePct},
    inPitS: 51.2,
    lapsLeftAtEntry: {fuel: 2.6, ve: 1.1},
    tyres: null,
  } as unknown as PitStop);

const noVe = {veStartPct: null, veEndPct: null};

describe('energyLine', () => {
  it('reads VE start to end for a race with no stop', () => {
    const laps = [lap(1, {fuel: fuel()}), lap(2, {fuel: fuel()})];
    expect(energyLine('R', laps, 'pit')).toEqual({
      text: 'VE 87 % → 3 %',
      target: 'pit',
    });
  });

  it('adds the stops and what they added, VE first', () => {
    const laps = [
      lap(1, {fuel: fuel()}),
      lap(2, {fuel: fuel(), pitIn: true, pitStop: stop(40, 62)}),
      lap(3, {fuel: fuel(), pitIn: true, pitStop: stop(40, 78)}),
      lap(4, {fuel: fuel()}),
    ];
    expect(energyLine('R', laps, 'pit')?.text).toBe(
      'VE 87 % → 3 % · 2 stops added 140 %',
    );
  });

  it('says one stop in the singular and a stop that added nothing as it is', () => {
    const laps = [
      lap(1, {fuel: fuel()}),
      lap(2, {fuel: fuel(), pitIn: true, pitStop: stop(0, 0)}),
      lap(3, {fuel: fuel()}),
    ];
    expect(energyLine('R', laps, 'pit')?.text).toBe(
      'VE 87 % → 3 % · 1 stop added nothing',
    );
  });

  it('falls back to litres with no VE stored', () => {
    const laps = [
      lap(1, {fuel: fuel(noVe)}),
      lap(2, {fuel: fuel(noVe), pitIn: true, pitStop: stop(40.1, null)}),
      lap(3, {fuel: fuel(noVe)}),
    ];
    expect(energyLine('R', laps, 'pit')?.text).toBe(
      '84.0 L → 4.9 L · 1 stop added 40.1 L',
    );
  });

  it('shows practice without stops and keeps the card it opens', () => {
    const laps = [lap(1, {fuel: fuel()}), lap(2, {fuel: fuel()})];
    expect(energyLine('P', laps, 'fuel')).toEqual({
      text: 'VE 87 % → 3 %',
      target: 'fuel',
    });
  });

  it('is absent without a start or end reading', () => {
    expect(energyLine('R', [lap(1)], 'pit')).toBeNull();
    expect(energyLine('R', [], 'pit')).toBeNull();
    const noEnd = [lap(1, {fuel: fuel({veEndPct: null, endL: null})})];
    expect(energyLine('R', noEnd, 'pit')).toBeNull();
  });
});
