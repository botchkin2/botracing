// Number formats from the design handoff ("Units and formats"). Inputs are
// raw numbers in the unit named by the parameter; output is display text.

/** 99.733 → "1:39.733" */
export function formatLapTime(timeS: number): string {
  const totalMs = Math.round(timeS * 1000);
  const minutes = Math.floor(totalMs / 60000);
  const ms = totalMs - minutes * 60000;
  const seconds = (ms / 1000).toFixed(3).padStart(6, '0');
  return `${minutes}:${seconds}`;
}

/** Signed gap with 3 decimals: "+0.312", "−0.105". Uses a true minus sign. */
export function formatGap(deltaS: number, decimals = 3): string {
  const sign = deltaS > 0 ? '+' : deltaS < 0 ? '−' : '±';
  return `${sign}${Math.abs(deltaS).toFixed(decimals)}`;
}

/**
 * A race gap behind a car: "+3.412" under a minute, "+1:04.2" from a minute
 * (a lapped car's gap is real time, so it can be minutes).
 */
export function formatRaceGap(gapS: number): string {
  if (gapS < 60) return `+${gapS.toFixed(3)}`;
  const minutes = Math.floor(gapS / 60);
  return `+${minutes}:${(gapS - minutes * 60).toFixed(1).padStart(4, '0')}`;
}

/** Corner grid: 2 decimals, no leading zero: "+.21", "−1.04". */
export function formatCornerGap(deltaS: number): string {
  return formatGap(deltaS, 2).replace(/^([+−±])0\./, '$1.');
}

/**
 * A corner's display label: "T8". Corners are numbered by this app from its
 * own corner map, so they can differ from a circuit's official turn numbers
 * (Botkin, pit-wall thread 27 #689); where tracks.json carries the official
 * label ("T10a"), pass it as `official` and it replaces the app's number
 * (pitlane, #690 option b).
 */
export function turnLabel(n: number, official?: string): string {
  return official ?? `T${n}`;
}

/**
 * The label without its "T" and any words after it, for badges and number
 * columns: "8", "10a" ("T7 entry" is "7").
 */
export function turnNumber(n: number, official?: string): string {
  return turnLabel(n, official).replace(/^T/, '').split(' ')[0];
}

/** "2,150 m" */
export function formatDistance(distanceM: number): string {
  return `${Math.round(distanceM).toLocaleString('en-US')} m`;
}

/** "21 Sep 2026", in the device's time zone. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** 5891 → {km: "5.891 km", mi: "3.660 mi"} */
export function formatLength(distanceM: number): {km: string; mi: string} {
  return {
    km: `${(distanceM / 1000).toFixed(3)} km`,
    mi: `${(distanceM / 1609.344).toFixed(3)} mi`,
  };
}

/** "14 Sep", in the device's time zone. */
export function formatDayMonth(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // en-GB spells September "Sept"; the frames say "14 Sep".
  const month = d.toLocaleDateString('en-US', {month: 'short'});
  return `${d.getDate()} ${month}`;
}
