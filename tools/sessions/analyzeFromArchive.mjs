// One session's analysis from its archive: what the uploader and analysis on
// open both run (pit-wall thread 1 #4572). Everything it reads is on its
// input; nothing here touches the PC's telemetry folder or the live capture,
// so the same call works from the stored archive in the cloud.
import {createHash} from 'node:crypto';
import {analysisStamp} from './versionKey.mjs';
import {catalogStamp} from './catalogStamp.mjs';
import {
  analysisVersion,
  blockVersions,
  analyzeSession,
  loadRecording,
} from './analyze.mjs';
import {
  buildCornerSlices,
  GRID_STEP_M,
  SLICE_AFTER_M,
  SLICE_BEFORE_M,
  SLICE_FORMAT,
} from './cornerSlices.mjs';
import {classBestsDoc, classLapsDoc} from '../../src/analysis/classLaps.ts';
import {finishDoc} from '../../src/analysis/raceResult.ts';
import {carLabel} from '../../src/design/carModels.ts';
import {lapTraffic} from './lapTraffic.mjs';
import {adapter as adapterOf} from './sims.mjs';

export function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

/** A track or car id: the sim and the adapter's slug of its name. */
export function slugId(sim, name) {
  return `${sim}-${adapterOf(sim).slug(name)}`;
}

/** The session's track-limit totals from its laps (analyze.mjs) and the stored input. */
export function trackLimitsOf(laps, results) {
  const strikes = laps.flatMap(lap => lap.trackLimits ?? []);
  return {
    strikes: strikes.length,
    points: strikes.reduce((n, k) => n + k.points, 0),
    // The file's own ones that fit none of his laps, and the ones that fit a lap
    // of his the recording has no segment for (a reset, a file gap).
    unplaced: results.unplaced + (results.strikes.length - strikes.length),
    disagreements: laps.filter(lap => lap.invalidDisagrees).length,
  };
}

/**
 * @param {object} input
 * @param {string} input.ownerId
 * @param {string} input.sessionId
 * @param {{id: string, info: object, samplesPath: string, eventsPath: string}[]} input.recordings
 *   in order; `info` is the recording's description (the recording doc).
 * @param {object|null} input.trackMap   the layout's stored corner map
 * @param {object|null} input.boundaries the layout's boundary state
 * @param {boolean} input.catalogOnly    curated maps only (every upload)
 * @param {boolean} [input.foldOnly]     analyse for the boundary fold, no docs
 * @param {object|null} input.damage     the car's damage series, null without one
 * @param {{minutes: number}|null} input.raceLength
 * @param {{strikes: object[], unplaced: number, deletedLaps: number[]}|null} input.results
 *   the game's track-limit rulings for the player (resultsInput.mjs), null without its results file
 * @param {{series: string|null, eventId: string|null}} input.event
 * @param {(lite: {t: Float64Array, lapDist: Float64Array}[]) => {field: object|null, meta?: object, reason?: string}} input.fieldFor
 *   the field around the player, given each loaded recording's clock and lap distance
 */
export function analyzeFromArchive({
  ownerId,
  sessionId,
  recordings,
  trackMap,
  boundaries,
  catalogOnly,
  foldOnly = false,
  damage,
  raceLength,
  results = null,
  event,
  fieldFor,
}) {
  const first = recordings[0].info;
  const last = recordings[recordings.length - 1].info;
  const sim = first.sim;
  const adapter = adapterOf(sim);
  const endMs = Date.parse(last.recordedAt) + (last.endT - last.startT) * 1000;
  const recs = recordings.map(r =>
    loadRecording(r.info, r.samplesPath, r.eventsPath),
  );
  const a = analyzeSession(recs, {
    trackMap,
    boundaries,
    sessionId,
    foldOnly,
    carDamage: damage,
    sessionType: first.sessionType,
    splitFiles: sim === 'iracing',
    catalogOnly,
    steerRightSign: adapter.steerRightSign,
    results,
  });
  if (foldOnly) return {a};
  // variant is for display; the layout key stays the id (iRacing's is a number
  // and a slug, so its adapter also gives the layout's own name).
  const track = {name: first.track, variant: first.layoutName ?? first.layout};
  const trackId = slugId(sim, first.layout);
  // A new corner map is stored as the track's own doc, where custom sectors
  // and official turn names can attach later.
  const trackDoc = a.newTrackMap
    ? plain({
        id: trackId,
        ownerId,
        sim,
        track,
        ...a.trackMap,
        source: {sessionId: sessionId, builtAt: new Date().toISOString()},
        analysisVersion,
      })
    : null;
  const car = {name: first.car, class: first.carClass};
  const carId = slugId(sim, first.car);
  const lapId = lap =>
    `${recordings[lap.rec].id}-${String(lap.index).padStart(3, '0')}`;

  // Every car in the session, when tools/capture recorded it (field.mjs).
  const fieldOut = fieldFor(
    recs.map(r => ({t: r.s.t, lapDist: r.s.lap_dist_m})),
  );
  // Traffic around the player per lap, from the field (lapTraffic.mjs). The
  // windows go out with the laps: a sync without the capture reads the
  // uploaded field with them (store.mjs).
  const lapWindows = a.laps.map(lap => ({from: lap.startT, to: lap.endT}));
  const tags = fieldOut.field ? lapTraffic(fieldOut.field, lapWindows) : null;

  const traces = [];
  const laps = a.laps.map((lap, k) => {
    const rec = recordings[lap.rec].info;
    const id = lapId(lap);
    const tracePath = `traces/${ownerId}/${id}/v2.csv.gz`;
    traces.push({dest: tracePath, csv: () => a.trace(lap)});
    const startTime = new Date(
      Date.parse(rec.recordedAt) + (lap.startT - rec.startT) * 1000,
    ).toISOString();
    return plain({
      id,
      ownerId,
      sim,
      sessionId: sessionId,
      recordingId: recordings[lap.rec].id,
      trackId,
      track,
      carId,
      car,
      sessionType: first.sessionType,
      startTime,
      lapNumber: lap.lapNumber,
      lapTime: lap.lapTime,
      gameLapTime: lap.gameLapTime,
      durationSec: lap.durationSec,
      timed: lap.timed,
      // The game deleted this lap: a strike of a deleting ruling in its results
      // file (invalidFrom 'results'), else -1 at its closing line (a real
      // crossing; invalidFrom 'lapTime', or absent when the lap is not invalid).
      invalid: lap.invalid,
      invalidFrom: lap.invalidFrom,
      // The game's rulings that fell in the lap, with where (analyze.mjs
      // lapStrikes); absent without a results file.
      trackLimits: lap.trackLimits,
      partial: lap.partial,
      // 'grid' (the parked car and the roll to the line), 'file' (cut by a
      // recording boundary), or null.
      partialWhy: lap.partialWhy,
      // A lap cut short by a reset to the garage, and the first lap after one.
      endedInReset: lap.endedInReset,
      afterReset: lap.afterReset,
      incomplete: lap.partial || !lap.timed,
      pitlane: lap.pitlane,
      pitIn: lap.pitIn,
      pitOut: lap.pitOut,
      offtrack: lap.offtrack,
      offTrackSec: lap.offTrackSec,
      pastEdgeSec: lap.pastEdgeSec,
      impactMax: lap.impactMax,
      // The fastest recorded speed sample of the lap, and where.
      maxSpeedKmh: lap.maxSpeedKmh,
      maxSpeedAtM: lap.maxSpeedAtM,
      sectors: lap.sectors,
      stint: lap.stint,
      comparable: lap.comparable,
      clean: lap.clean,
      reasons: lap.reasons,
      distanceM: lap.distanceM,
      traceHz: lap.traceHz,
      // Conditions, and per-corner facts through the track's corners: what
      // src/analysis/consistency.ts needs to rerun on any selection.
      stintLap: lap.stintLap,
      start: lap.start,
      // Per wheel (FL FR RL RR): wear at the end of the lap, the lap's median
      // pressure and temperatures, and the wheels changed in the stop that
      // ended during it (tyres.mjs); null without the channels. The lap after
      // a change is the first on new tyres (consistency's cold-tyres rule).
      tyres: lap.tyres,
      tyreCarcassC: lap.tyreCarcassC,
      courseYellowSec: lap.courseYellowSec,
      compound: lap.compound,
      wetness: lap.wetness,
      corners: lap.corners || [],
      // The start straight, and the layout's boundary rev these corner times
      // were cut at (a lap on an older rev is re-analysed, never compared).
      startStraight: lap.startStraight ?? null,
      cornerBoundaries: lap.cornerBoundaries ?? null,
      // Fuel and Virtual Energy used on the lap, added back across a stop
      // (fuelFacts.mjs), and the pit stop entered during it; null without
      // the channels or a stop.
      fuel: lap.fuel,
      pitStop: lap.pitStop,
      // The battery and motor energy of the lap (hybrid.mjs); null on a car
      // without a hybrid.
      hybrid: lap.hybrid,
      // Cars around the player, seconds and counts (fieldTags.mjs); null
      // when the session has no field.
      traffic: tags?.[k] ?? null,
      // Not in the default "normal racing" selection, and why.
      excluded: lap.excluded,
      // Against the session's normal racing laps: residual to the pace
      // trend, and where an off-pace lap lost its time.
      consistency: lap.consistency,
      trace: {path: tracePath, rows: lap.i1 - lap.i0 + 1},
      analysisVersion,
    });
  });

  // Every lap's window around every corner, one file per corner
  // (cornerSlices.mjs). Named by content like the field, so a resync never
  // serves a stale cached slice.
  const slices = buildCornerSlices(
    a.laps.map(lap => ({
      id: lapId(lap),
      csv: () => a.trace(lap),
      hz: lap.traceHz,
    })),
    a.trackMap,
    a.windows,
  );
  const slicePrefix = slices
    ? `slices/${ownerId}/${sessionId}/${slices.hash}`
    : null;

  // Named by its content, so the route can cache it as immutable: a resync
  // that changes the field writes a new file (pitlane #680).
  const fieldText = fieldOut.field ? JSON.stringify(fieldOut.field) : null;
  const fieldHash = fieldText
    ? createHash('sha1').update(fieldText).digest('hex').slice(0, 12)
    : null;
  const fieldPath = fieldHash
    ? `field/${ownerId}/${sessionId}/${fieldHash}.json.gz`
    : null;
  const session = plain({
    id: sessionId,
    ownerId,
    sim,
    // This is still the layout id when nobody has curated the track. The
    // storage-rules change must not refuse that upload: store trackId null
    // until a curator maps it, and the app shows the laps with no map and
    // no sections.
    trackId,
    track,
    carId,
    car,
    // The car model without the livery, the Plan's key (src/design/carModels.ts):
    // the plan route filters on it, so it is a field of its own.
    carModel: carLabel(first.car).model,
    sessionType: first.sessionType,
    sessionClock: first.sessionClock,
    weather: first.weather,
    race: raceLength,
    // The game's rulings over the session: how many, their points, how many
    // could not be placed on a lap of his, and how many laps the results file and
    // the lap time disagree on; absent without a results file.
    trackLimits: results ? trackLimitsOf(a.laps, results) : undefined,
    series: event.series,
    eventId: event.eventId,
    startedAt: first.recordedAt,
    endedAt: new Date(endMs).toISOString(),
    recordingIds: recordings.map(r => r.id),
    ...a.summary,
    bestLapId: a.best ? lapId(a.best) : null,
    // The analysis names laps by index; the stored docs use lap ids.
    consistency: {
      ...a.consistency,
      stints: a.consistency.stints.map(st => ({
        ...st,
        lapIds: st.lapIds.map(i => laps[Number(i)].id),
      })),
    },
    // Where the corners came from: the track's stored map, a new stored map
    // made from this session, or a map of this session's own (not stored:
    // too few clean laps, or the stored map does not fit).
    trackMapSource: a.trackMapSource,
    trackMapMismatch: a.trackMapMismatch,
    // The layout's corner boundaries these laps were cut at (rev), null on a
    // map of this session's own.
    cornerBoundaries: a.boundaries
      ? {v: a.boundaries.state.v, rev: a.boundaries.state.rev}
      : null,
    // Start fuel, the fill limit and the tank in litres (fuelFacts.mjs); the
    // limit and tank are null when the car setup is missing.
    fuel: a.fuel,
    band: a.band
      ? {
          path: `bands/${ownerId}/${sessionId}/v1.json.gz`,
          stepM: a.band.stepM,
          lengthM: a.band.lengthM,
          laps: a.band.laps,
        }
      : null,
    field: fieldPath
      ? {path: fieldPath, hash: fieldHash, ...fieldOut.meta}
      : null,
    // Lap times by class, from the field (src/analysis/classLaps.ts); null
    // without one.
    classLaps: fieldOut.field
      ? classLapsDoc(fieldOut.field, first.sessionType)
      : null,
    // The fastest cars of each class, from the same field; its own field of
    // the doc because classLaps rides in the session list (classBests.test.ts).
    classBests: fieldOut.field
      ? classBestsDoc(fieldOut.field, first.sessionType)
      : null,
    // The player's finishing position in a race, from the same field
    // (src/analysis/raceResult.ts); null without one and outside a race.
    result: fieldOut.field
      ? finishDoc(fieldOut.field, first.sessionType)
      : null,
    // Per-corner slices of every lap (cornerSlices.mjs): the corner numbers
    // with a file at {prefix}/c{n}.json.gz, and the window they cover.
    slices: slices
      ? {
          format: SLICE_FORMAT,
          hash: slices.hash,
          prefix: slicePrefix,
          corners: slices.corners,
          beforeM: SLICE_BEFORE_M,
          afterM: SLICE_AFTER_M,
          stepM: GRID_STEP_M,
        }
      : null,
    lapTable: laps.map(lap => ({
      id: lap.id,
      lapNumber: lap.lapNumber,
      lapTime: lap.lapTime,
      stint: lap.stint,
      comparable: lap.comparable,
      reasons: lap.reasons,
      offTrackSec: lap.offTrackSec,
      maxSpeedKmh: lap.maxSpeedKmh,
      endedInReset: lap.endedInReset,
      afterReset: lap.afterReset,
      excluded: lap.excluded,
      offPace: lap.consistency?.offPace ?? null,
    })),
    analysisVersion,
    // The rules this session was made under; store.mjs adds what it kept.
    // and the curated track it was cut at (catalogStamp.mjs): a curator's edit
    // makes the session stale as a rule change does.
    analysis: {
      ...analysisStamp(analysisVersion, blockVersions),
      catalog: catalogStamp(trackMap, boundaries),
    },
    updatedAt: new Date().toISOString(),
  });

  // session.plan is written by store.mjs, after it settles the race, result,
  // traffic and visits that a resync keeps from the stored docs.

  return {
    session,
    laps,
    lapWindows,
    band: a.band,
    fieldText,
    slices,
    fieldReason: fieldOut.reason,
    // No damage record this run (capture pruned): store.mjs keeps the stored
    // visits that were read from damage (keepCapture.mjs).
    damageMissing: !foldOnly && damage === null,
    track: trackDoc,
    // The layout's boundaries when this session changed them, to be kept.
    boundaries:
      a.boundaries && a.boundaries.changed
        ? {
            trackId,
            state: a.boundaries.state,
            windows: a.boundaries.windows,
            moved: a.boundaries.moved,
          }
        : null,
    boundariesRev: a.boundaries ? a.boundaries.state.rev : null,
    traces,
  };
}
