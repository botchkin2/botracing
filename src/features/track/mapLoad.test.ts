import {describe, expect, test} from '@jest/globals';

import {failedText, mapLoadOf, type MapLoadInput} from './mapLoad';

const READY = {pending: false, failed: false};
const PENDING = {pending: true, failed: false};
const FAILED = {pending: false, failed: true};

function input(over: Partial<MapLoadInput> = {}): MapLoadInput {
  return {hasRef: true, map: READY, surface: READY, trace: READY, ...over};
}

describe('mapLoadOf', () => {
  test('the outline is ready when map and surface arrive, even with the lap still pending', () => {
    expect(mapLoadOf(input({trace: PENDING}))).toEqual({
      loading: false,
      failed: [],
    });
  });

  test('a failed reference lap leaves loading and names the lap', () => {
    expect(mapLoadOf(input({trace: FAILED}))).toEqual({
      loading: false,
      failed: ['the reference lap'],
    });
  });

  test('a failed map leaves loading and names the map', () => {
    expect(mapLoadOf(input({map: FAILED}))).toEqual({
      loading: false,
      failed: ['the track map'],
    });
  });

  test('a failed surface leaves loading and names the surface', () => {
    expect(mapLoadOf(input({surface: FAILED}))).toEqual({
      loading: false,
      failed: ['the measured surface'],
    });
  });

  test('all three failing leaves loading and names all three', () => {
    expect(
      mapLoadOf(input({map: FAILED, surface: FAILED, trace: FAILED})),
    ).toEqual({
      loading: false,
      failed: ['the track map', 'the measured surface', 'the reference lap'],
    });
  });

  test('a pending map or surface is still loading', () => {
    expect(mapLoadOf(input({map: PENDING})).loading).toBe(true);
    expect(mapLoadOf(input({surface: PENDING})).loading).toBe(true);
  });

  test('no reference session means nothing is loading', () => {
    expect(
      mapLoadOf(input({hasRef: false, map: PENDING, surface: PENDING})),
    ).toEqual({
      loading: false,
      failed: [],
    });
  });
});

describe('failedText', () => {
  test('names one failed part', () => {
    expect(failedText(['the reference lap'])).toBe(
      'Could not load the reference lap.',
    );
  });

  test('names two failed parts', () => {
    expect(failedText(['the track map', 'the measured surface'])).toBe(
      'Could not load the track map and the measured surface.',
    );
  });
});
