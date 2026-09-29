// Plain TypeScript with erasable syntax only, no imports: Node runs it as is.
// Display units (handoff v2 M5). Stored data stays metric; these only change
// what a number reads as on screen.

export type Units = {speed: 'kmh' | 'mph'; distance: 'm' | 'ft'};

export const METRIC: Units = {speed: 'kmh', distance: 'm'};

const MPH_PER_KMH = 1 / 1.609344;
const FT_PER_M = 1 / 0.3048;

export function speedValue(kph: number, u: Units): number {
  return u.speed === 'mph' ? kph * MPH_PER_KMH : kph;
}

export const speedUnit = (u: Units): string =>
  u.speed === 'mph' ? 'mph' : 'km/h';

/** Whole units, no label: "187". */
export function formatSpeed(kph: number, u: Units): string {
  return speedValue(kph, u).toFixed(0);
}

export function distanceValue(m: number, u: Units): number {
  return u.distance === 'ft' ? m * FT_PER_M : m;
}

export const distanceUnit = (u: Units): string =>
  u.distance === 'ft' ? 'ft' : 'm';
