// The golden set's runner: a real session's slice (the neutral archive cut to a
// few laps) goes through the real analysis, and what comes out is summarised as
// the key numbers CI compares with `expected/<name>.json`. Pure of the network:
// the slices are fetched by fetch.mjs, made by make.mjs.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {analyzeSession, loadRecording} from '../sessions/analyze.mjs';

/** The slice's recordings and what the analysis is given besides them. */
export function loadGolden(dir) {
  const meta = JSON.parse(readFileSync(resolve(dir, 'golden.json'), 'utf8'));
  const recs = [];
  for (let i = 0; i < meta.files; i++) {
    const info = JSON.parse(readFileSync(resolve(dir, `${i}.info.json`), 'utf8'));
    recs.push(
      loadRecording(
        info,
        resolve(dir, `${i}.samples.parquet`),
        resolve(dir, `${i}.events.parquet`),
      ),
    );
  }
  return {meta, recs};
}

/** The analysis as the uploader runs it, on the slice (no capture, so no damage or field). */
export function analyzeGolden(dir) {
  const {meta, recs} = loadGolden(dir);
  return analyzeSession(recs, {
    trackMap: meta.trackMap ?? null,
    boundaries: meta.boundaries ?? null,
    sessionId: meta.name,
    sessionType: meta.sessionType,
    splitFiles: meta.sim === 'iracing',
  });
}

const pick = (o, keys) =>
  Object.fromEntries(keys.map(k => [k, o?.[k] ?? null]));

/**
 * The key numbers of an analysis, in the stored precision: one row per lap, the
 * session summary, the stints, the fuel facts, the consistency numbers, the
 * pit stops and a median time per corner. Nothing is rounded again here, so a
 * 1 ms drift is a difference.
 */
export function summaryOf(a) {
  const laps = a.laps.map(l => ({
    lap: l.lapNumber,
    time: l.lapTime,
    timed: l.timed,
    partial: l.partial,
    stint: l.stint,
    reasons: l.reasons,
    comparable: l.comparable,
    pitIn: l.pitIn,
    pitOut: l.pitOut,
    offtrack: l.offtrack,
    offTrackSec: l.offTrackSec,
    fuel: l.fuel
      ? pick(l.fuel, ['usedL', 'addedL', 'veUsedPct', 'veAddedPct', 'green'])
      : null,
    pitStop: l.pitStop
      ? {
          added: l.pitStop.added,
          atEntry: l.pitStop.atEntry,
          inPitS: l.pitStop.inPitS,
          tyresChanged: l.pitStop.tyres?.changed ?? null,
          tyreWheels: l.pitStop.tyres?.wheels ?? null,
          visit: l.pitStop.visit?.kind ?? null,
        }
      : null,
    corners: (l.corners ?? []).map(c => c.segTime ?? null),
  }));
  const comparable = a.laps.filter(l => l.comparable);
  const cornerCount = Math.max(0, ...a.laps.map(l => (l.corners ?? []).length));
  const cornerMedians = Array.from({length: cornerCount}, (_, i) => {
    const v = comparable
      .map(l => l.corners?.[i]?.segTime)
      .filter(x => Number.isFinite(x))
      .sort((x, y) => x - y);
    if (v.length === 0) return null;
    const mid = v.length >> 1;
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  });
  return {
    summary: pick(a.summary, [
      'lapCount',
      'comparableCount',
      'bestLapTime',
      'medianLapTime',
      'stdevLapTime',
    ]),
    stints: (a.summary.stints ?? []).map(st =>
      pick(st, [
        'n',
        'startReason',
        'firstLap',
        'lastLap',
        'laps',
        'comparable',
        'bestLapTime',
        'medianLapTime',
        'stdevLapTime',
        'greenLaps',
        'medianFuelL',
        'fuelSpreadL',
        'medianVePct',
        'veSpreadPct',
      ]),
    ),
    fuel: a.fuel ?? null,
    trackMapSource: a.trackMapSource ?? null,
    corners: a.trackMap?.corners?.length ?? 0,
    cornerMedians,
    consistency: a.consistency
      ? {overview: a.consistency.overview ?? null, ...numbersOf(a.consistency)}
      : null,
    laps,
  };
}

// The numeric and boolean top-level facts of the consistency result.
function numbersOf(c) {
  return Object.fromEntries(
    Object.entries(c).filter(
      ([, v]) => typeof v === 'number' || typeof v === 'boolean',
    ),
  );
}
