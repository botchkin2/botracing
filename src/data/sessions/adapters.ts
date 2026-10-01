import {
  type ClassLaps,
  type ClassLapsKind,
  type ClassLapStats,
  type PaceClass,
  type StartGap,
} from '@/src/analysis/classLaps';
import {type LapSet, type SessionTraffic} from '@/src/analysis/traffic';
import {freshTyres, type LapTyres, toLapTyres} from '@/src/analysis/tyres';
import {type FieldPointer, toFieldPointer} from '../field/adapters';
import {type TrackSurface} from '@/src/analysis/trackSurface';
import {turnLabelsOf} from '../tracks/catalog';

// API v2 session shapes (functions/src/sessionStore.ts returns raw Firestore
// docs) → the typed shapes the app uses. Only fields a screen reads are typed;
// add them here as screens need them. Times are seconds.

export type SessionType = 'R' | 'Q' | 'P';

export type SessionSummary = {
  id: string;
  sim: string;
  trackId: string;
  track: string;
  car: string;
  /** LMU's class for the car ("GT3", "Hyper"); empty when not recorded. */
  carClass: string;
  sessionType: SessionType;
  startedAt: string;
  lapCount: number;
  comparableCount: number;
  bestTimeS: number | null;
  medianTimeS: number | null;
  bestLapId: string | null;
  series: string | null;
  /** Pace of each class in the field (analysis v17); null without a field. */
  classLaps: SessionClassLaps | null;
  eventId: string | null;
  /**
   * Where the session's corners came from: the track's stored map
   * ('stored', or 'new' when this session created it), or a map of its own
   * ('session') that other screens and sessions do not share.
   */
  cornerMapSource: 'stored' | 'new' | 'session' | null;
  updatedAt: string;
};

export type SessionListResponse = {items: RawSession[]; total: number};

type RawSession = Record<string, unknown> & {id: string};

const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : fallback;
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

/** Track and car arrive as {name, ...} objects. */
const name = (v: unknown): string =>
  typeof v === 'string'
    ? v
    : v && typeof v === 'object' && 'name' in v
    ? str((v as {name: unknown}).name)
    : '';

function toCornerMapSource(v: unknown): SessionSummary['cornerMapSource'] {
  return v === 'stored' || v === 'new' || v === 'session' ? v : null;
}

function toSessionType(v: unknown): SessionType {
  const t = str(v).toLowerCase();
  if (t.startsWith('r')) return 'R';
  if (t.startsWith('q')) return 'Q';
  return 'P';
}

export function toSessionSummary(raw: RawSession): SessionSummary {
  return {
    id: raw.id,
    sim: str(raw.sim, 'lmu'),
    trackId: str(raw.trackId),
    track: name(raw.track),
    car: name(raw.car),
    carClass: str(obj(raw.car).class),
    sessionType: toSessionType(raw.sessionType),
    startedAt: str(raw.startedAt),
    lapCount: num(raw.lapCount) ?? 0,
    comparableCount: num(raw.comparableCount) ?? 0,
    bestTimeS: num(raw.bestLapTime),
    medianTimeS: num(raw.medianLapTime),
    bestLapId: str(raw.bestLapId) || null,
    series: str(raw.series) || null,
    classLaps: toClassLaps(raw.classLaps),
    eventId: str(raw.eventId) || null,
    cornerMapSource: toCornerMapSource(raw.trackMapSource),
    updatedAt: str(raw.updatedAt),
  };
}

// --- session detail -------------------------------------------------------

export type Stint = {
  n: number;
  lapCount: number;
  comparableCount: number;
  bestTimeS: number | null;
  medianTimeS: number | null;
  stdevS: number | null;
  /**
   * Lap-time trend within the stint, seconds per lap (positive = slowing),
   * from the session doc's `consistency.stints[].trendPerLap`. Null when the
   * uploader did not store one for this stint.
   */
  trendSPerLap: number | null;
  /**
   * Fuel and Virtual Energy per green lap (tools/sessions/fuelFacts.mjs): the
   * median and spread over `greenLaps` laps, null under 3.
   */
  greenLaps: number;
  medianFuelL: number | null;
  fuelSpreadL: number | null;
  medianVePct: number | null;
  veSpreadPct: number | null;
};

/**
 * Session doc `fuel` (tools/sessions/fuelFacts.mjs): what he started with and
 * the limits from the car setup. fillLimitL is litres of fuel the event let
 * him load (VE 100 % is that full load); tankL is the physical tank. Both are
 * null when the recording had no setup string.
 */
export type SessionFuel = {
  startL: number | null;
  fillLimitL: number | null;
  tankL: number | null;
  /**
   * Litres of fuel one % of VE is worth here: the median over green laps of
   * used litres per used % (it depends on the fill limit and is not in the
   * setup), and the same from what was added at the stops as a cross-check.
   * Null on sessions analysed before analysisVersion 11.
   */
  litresPerVePct: number | null;
  litresPerVePctStop: number | null;
};

function toSessionFuel(v: unknown): SessionFuel | null {
  if (v == null || typeof v !== 'object') return null;
  const x = obj(v);
  return {
    startL: num(x.startL),
    fillLimitL: num(x.fillLimitL),
    tankL: num(x.tankL),
    litresPerVePct: num(x.litresPerVePct),
    litresPerVePctStop: num(x.litresPerVePctStop),
  };
}

/** The session doc's `slices` block (tools/sessions/cornerSlices.mjs). */
export type SlicePointer = {
  /** Names the files; under it a slice never changes (docs/API.md). */
  hash: string;
  /** Corner numbers that have a file. */
  corners: number[];
};

function toSlicePointer(raw: unknown): SlicePointer | null {
  const x = obj(raw);
  if (typeof x.hash !== 'string' || x.hash === '') return null;
  const corners = Array.isArray(x.corners)
    ? x.corners.filter((n): n is number => typeof n === 'number')
    : [];
  return {hash: x.hash, corners};
}

/**
 * Session doc `classLaps` (src/analysis/classLaps.ts, analysis version 17):
 * the pace of every class in this session's field. `kind` is the session kind
 * the numbers were computed for; `classes` is null when no class had enough
 * laps, and always for qualifying.
 */
export type SessionClassLaps = {
  kind: ClassLapsKind;
  classes: ClassLaps | null;
  /** Races, from CLASS_LAPS_VERSION 2: seconds each class's first and last car crossed the line before the player; null otherwise. */
  startGapsS: Partial<Record<PaceClass, StartGap>> | null;
};

const PACE_CLASSES: PaceClass[] = ['hypercar', 'lmp2', 'gt3', 'gte', 'other'];

function toClassStats(v: unknown): ClassLapStats | null {
  const x = obj(v);
  const [cars, laps, medianS, p10S, p90S] = [
    num(x.cars),
    num(x.laps),
    num(x.medianS),
    num(x.p10S),
    num(x.p90S),
  ];
  if (
    cars == null ||
    laps == null ||
    medianS == null ||
    p10S == null ||
    p90S == null
  )
    return null;
  return {cars, laps, medianS, p10S, p90S};
}

/** Null when the session has no field or the uploader is older than version 17. */
export function toClassLaps(v: unknown): SessionClassLaps | null {
  if (v == null || typeof v !== 'object') return null;
  const x = obj(v);
  const kind = x.kind;
  if (kind !== 'race' && kind !== 'practice' && kind !== 'qualify') return null;
  const classes: ClassLaps = {};
  for (const key of PACE_CLASSES) {
    const stats = toClassStats(obj(x.classes)[key]);
    if (stats) classes[key] = stats;
  }
  const gaps: Partial<Record<PaceClass, StartGap>> = {};
  for (const key of PACE_CLASSES) {
    const g = obj(obj(x.startGapsS)[key]);
    const [firstS, lastS] = [num(g.firstS), num(g.lastS)];
    if (firstS != null && lastS != null) gaps[key] = {firstS, lastS};
  }
  return {
    kind,
    classes: Object.keys(classes).length > 0 ? classes : null,
    startGapsS: Object.keys(gaps).length > 0 ? gaps : null,
  };
}

/** Null when the session has no traffic block (no field, or not yet resynced). */
export function toSessionTraffic(v: unknown): SessionTraffic | null {
  if (v == null || typeof v !== 'object') return null;
  const x = obj(v);
  const set = (w: unknown): LapSet | null => {
    const laps = num(obj(w).laps);
    return laps == null ? null : {laps, medianS: num(obj(w).medianS)};
  };
  const [clean, traffic] = [set(x.clean), set(x.traffic)];
  if (!clean || !traffic) return null;
  return {v: num(x.v) ?? 0, clean, traffic};
}

export type SessionDetail = SessionSummary & {
  trackVariant: string;
  /** Null on sessions analysed before the fuel facts. */
  fuel: SessionFuel | null;
  stints: Stint[];
  /** The stored field of every car (src/data/field), or null without one. */
  field: FieldPointer | null;
  /** Every class's lap times in this race, or null without a field. */
  classLaps: SessionClassLaps | null;
  /** Median of the clean laps and of the traffic laps; null without a field. */
  traffic: SessionTraffic | null;
  /** The per-corner trace slices the uploader wrote (analysis version 13 and
   *  later), or null for a session not yet resynced. */
  slices: SlicePointer | null;
};

export function toSessionDetail(raw: RawSession): SessionDetail {
  const stints = Array.isArray(raw.stints) ? raw.stints : [];
  const consistencyStints = obj(raw.consistency).stints;
  const trendByStint = new Map<number, number | null>(
    (Array.isArray(consistencyStints) ? consistencyStints : []).map(s => [
      num(obj(s).n) ?? 0,
      num(obj(s).trendPerLap),
    ]),
  );
  return {
    ...toSessionSummary(raw),
    trackVariant: str(obj(raw.track).variant),
    field: toFieldPointer(raw.field),
    classLaps: toClassLaps(raw.classLaps),
    traffic: toSessionTraffic(raw.traffic),
    slices: toSlicePointer(raw.slices),
    fuel: toSessionFuel(raw.fuel),
    stints: stints.map(s => {
      const x = obj(s);
      return {
        n: num(x.n) ?? 0,
        lapCount: num(x.laps) ?? 0,
        comparableCount: num(x.comparable) ?? 0,
        bestTimeS: num(x.bestLapTime),
        medianTimeS: num(x.medianLapTime),
        stdevS: num(x.stdevLapTime),
        trendSPerLap: trendByStint.get(num(x.n) ?? 0) ?? null,
        greenLaps: num(x.greenLaps) ?? 0,
        medianFuelL: num(x.medianFuelL),
        fuelSpreadL: num(x.fuelSpreadL),
        medianVePct: num(x.medianVePct),
        veSpreadPct: num(x.veSpreadPct),
      };
    }),
  };
}

// --- laps -----------------------------------------------------------------

/** Why a lap is not comparable, as the uploader codes it. */
export type LapReason =
  | 'pit-in'
  | 'pit-out'
  | 'partial'
  | 'untimed'
  | 'slow'
  | (string & {});

export type Lap = {
  id: string;
  /** Position in driving order, from 1. Lap numbers restart per recording. */
  lapIndex: number;
  /** The game's laps-completed count when the lap began (0 is the first
   *  lap of a race); matches Field's lap counter. Null on old lap docs. */
  lapNumber: number | null;
  timeS: number | null;
  sectorsS: (number | null)[];
  stint: number;
  comparable: boolean;
  reasons: LapReason[];
  pitIn: boolean;
  pitOut: boolean;
  partial: boolean;
  /**
   * Why it is partial: 'grid' is a parked start and the roll to the line (a
   * race's lap 0 on the grid, or a start from the garage), 'file' a stretch cut by a recording boundary. Absent on
   * laps analysed before the grid rule (blockVersions.gridLap).
   */
  partialWhy?: 'grid' | 'file' | null;
  /** The recording file the lap came from; a new file mid-stint is a reset
   *  or a server drop, not a continuous run. */
  recordingId: string | null;
  /** The lap a reset to the garage cut short (tools/sessions/fileChange,
   *  PR #68); absent before the resync, read as false. */
  endedInReset: boolean;
  offTrackS: number;
  /** Contact on this lap. LMU records a flag, not a magnitude. */
  hadImpact: boolean;
  /** Per-section facts in track order, precomputed by the uploader. */
  sections: SectionFacts[];
  /** The start straight, and the boundaries the windows were cut at; null before the windows. */
  startStraight: StartStraightFacts | null;
  cornerBoundaries: BoundaryStamp | null;
  /** The cars around the player on this lap; null when the session has no field. */
  traffic: LapTraffic | null;
  /** Null on laps analysed before the fuel facts, or without the channels. */
  fuel: LapFuel | null;
  /** The pit stop entered on this lap, if any. */
  pitStop: PitStop | null;
  /** Per-wheel tyre facts (tools/sessions/tyres.mjs); null before the resync or without the channels. */
  tyres: LapTyres | null;
  /**
   * The first lap on new tyres (`freshTyres` in src/analysis/tyres.ts, from
   * the lap before): a pit stop that changed any wheel ended in it, or it
   * ended in a reset to the garage. Cold whatever the temperature says, and
   * not a fair reference.
   */
  newTyres: boolean;
};

/**
 * Lap doc `fuel` (tools/sessions/fuelFacts.mjs). used = start - end + added in
 * the pits, so a lap with a stop is not negative. `green` is the uploader's
 * clean-lap rule (timed, whole, not the first lap, no pit in or out, no
 * full-course yellow, not cut short by a reset): the same laps its stint
 * medians use.
 */
export type LapFuel = {
  startL: number | null;
  endL: number | null;
  usedL: number | null;
  addedL: number | null;
  veStartPct: number | null;
  veEndPct: number | null;
  veUsedPct: number | null;
  veAddedPct: number | null;
  /** The end level over the stint's median use; null without a median. */
  lapsLeftFuel: number | null;
  lapsLeftVe: number | null;
  green: boolean;
};

export type Wheel = 'FL' | 'FR' | 'RL' | 'RR';
const WHEELS: readonly Wheel[] = ['FL', 'FR', 'RL', 'RR'];

/**
 * The wheels whose wear reading stepped up inside the stop (tools/sessions/
 * fuelFacts.mjs): a new tyre on each. `wheels` is empty when none changed.
 */
export type PitTyres = {
  changed: boolean;
  wheels: Wheel[];
  /** Wear (%) of each wheel at pit entry and at pit exit; null before the resync, and `exitPct` when the session ended in the pits. */
  entryPct: Record<Wheel, number | null> | null;
  exitPct: Record<Wheel, number | null> | null;
};

/** A pit stop: what was left at pit entry, what was added, how long. */
export type PitStop = {
  atEntry: {fuelL: number | null; vePct: number | null};
  /** 0 for a drive-through or a penalty. */
  added: {fuelL: number | null; vePct: number | null};
  inPitS: number | null;
  lapsLeftAtEntry: {fuel: number | null; ve: number | null};
  /** Null on sessions analysed before analysisVersion 15, or without a wear channel. */
  tyres: PitTyres | null;
};

/**
 * Lap doc `traffic` (tools/sessions/fieldTags.mjs), seconds and counts from
 * the field, never a verdict. Draft: within 30 m behind a car in the same
 * lane above 200 km/h. Traffic: a car within 1 s on the road. Passes and
 * battle count the player's class; the All counts take every car.
 */
export type LapTraffic = {
  draftS: number;
  trafficAheadS: number;
  trafficBehindS: number;
  /** Seconds the player had the blue flag. */
  blueFlagS: number;
  /** Own-class passes on the road, made and suffered; includes lapped and lapping cars of the same class, so not a place change. */
  passesMade: number;
  passesSuffered: number;
  passesMadeAll: number;
  passesSufferedAll: number;
  /** Seconds within 1 s of a car of the player's class, ahead or behind. */
  battleS: number;
};

/** One pass through a corner or section (lap doc `corners[]` / `parts[]`). */
export type CornerFacts = {
  segTimeS: number | null;
  minSpeedKph: number | null;
  brakeAtM: number | null;
  fullThrottleAtM: number | null;
  /** How far apart the pedal samples around each point were, metres (#52). */
  brakeAtResM: number | null;
  fullThrottleAtResM: number | null;
  /** The minimum fell on the corner's edge (#82): a boundary value. */
  minSpeedAtEdge: boolean;
  /** Full throttle fell on the search's start edge: flat through the turn. */
  fullThrottleAtEdge: boolean;
  /** Speed at the apex sample, km/h (#82). */
  apexSpeedKph: number | null;
  offTrackS: number;
  /**
   * The corner window (pit-wall thread 45): boundary to the next boundary in
   * the map's frame, with `segTimeS` its time, split at the lap's own onset
   * and where full throttle is held. Null on a lap cut before the windows.
   */
  window: CornerWindowFacts | null;
};

/** What a lap did inside one corner window; the three times add up to `segTimeS`. */
export type CornerWindowFacts = {
  fromM: number;
  toM: number;
  runInS: number | null;
  cornerS: number | null;
  exitS: number | null;
  /** The lap's own brake (or lift) onset for the section; null if taken flat. */
  onsetM: number | null;
  /** Four speeds that tell the story without the trace, km/h. */
  onsetSpeedKph: number | null;
  fullThrottleSpeedKph: number | null;
  endSpeedKph: number | null;
  minSpeedAtM: number | null;
  /** The part the slowest point fell in; null for a single corner. */
  minSpeedPart: number | null;
  /** The pit lane overlaps this window, so only this window is not comparable. */
  pit: boolean;
};

/** One brake application in a section's window, by the corner braked for. */
export type BrakeApp = {onsetM: number; peakPct: number; part: number | null};

export type SectionFacts = CornerFacts & {
  parts: CornerFacts[];
  /** Sections only; empty on a lap cut before the windows. */
  brakeApps: BrakeApp[];
};

/** A lap's start straight: the line to the first section's window. */
export type StartStraightFacts = {
  segTimeS: number | null;
  fromM: number;
  toM: number;
  offTrackS: number;
  localYellowS: number;
  pit: boolean;
};

/** The version and revision of the boundaries a lap's windows were cut at. */
export type BoundaryStamp = {v: number; rev: number};

function toBoundaryStamp(raw: unknown): BoundaryStamp | null {
  if (raw == null || typeof raw !== 'object') return null;
  const x = obj(raw);
  const v = num(x.v);
  const rev = num(x.rev);
  return v == null || rev == null ? null : {v, rev};
}

/** Rounding of three stored times to 3 decimals stays well inside this. */
const SPLIT_TOLERANCE_S = 0.01;

function toWindowFacts(x: Record<string, unknown>): CornerWindowFacts | null {
  const fromM = num(x.fromM);
  const toM = num(x.toM);
  if (fromM == null || toM == null) return null;
  // The split adds up to the window's time (segTime) by construction; one that
  // does not is a stored-data fault, so the window is dropped (the lap reads
  // re-analysis pending) and the field is named, not shown as a wrong row.
  const [segTime, runInS, cornerS, exitS] = [
    x.segTime,
    x.runInS,
    x.cornerS,
    x.exitS,
  ].map(num);
  if (
    segTime != null &&
    runInS != null &&
    cornerS != null &&
    exitS != null &&
    Math.abs(runInS + cornerS + exitS - segTime) >= SPLIT_TOLERANCE_S
  ) {
    console.warn(
      `corner window: runInS + cornerS + exitS (${
        runInS + cornerS + exitS
      }) does not add up to segTime (${segTime})`,
    );
    return null;
  }
  return {
    fromM,
    toM,
    runInS: num(x.runInS),
    cornerS: num(x.cornerS),
    exitS: num(x.exitS),
    onsetM: num(x.onsetM),
    onsetSpeedKph: num(x.onsetSpeedKmh),
    fullThrottleSpeedKph: num(x.fullThrottleSpeedKmh),
    endSpeedKph: num(x.endSpeedKmh),
    minSpeedAtM: num(x.minSpeedAtM),
    minSpeedPart: num(x.minSpeedPart),
    pit: x.pit === true,
  };
}

function toBrakeApps(raw: unknown): BrakeApp[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(a => {
    const x = obj(a);
    const onsetM = num(x.onsetM);
    const peakPct = num(x.peakPct);
    return onsetM == null || peakPct == null
      ? []
      : [{onsetM, peakPct, part: num(x.part)}];
  });
}

function toStartStraight(raw: unknown): StartStraightFacts | null {
  if (raw == null || typeof raw !== 'object') return null;
  const x = obj(raw);
  const fromM = num(x.fromM);
  const toM = num(x.toM);
  if (fromM == null || toM == null) return null;
  return {
    segTimeS: num(x.segTime),
    fromM,
    toM,
    offTrackS: num(x.offTrackSec) ?? 0,
    localYellowS: num(x.localYellowSec) ?? 0,
    pit: x.pit === true,
  };
}

function toCornerFacts(raw: unknown): CornerFacts {
  const x = obj(raw);
  return {
    segTimeS: num(x.segTime),
    minSpeedKph: num(x.minSpeedKmh),
    brakeAtM: num(x.brakeAtM),
    fullThrottleAtM: num(x.fullThrottleAtM),
    brakeAtResM: num(x.brakeAtResM),
    fullThrottleAtResM: num(x.fullThrottleAtResM),
    minSpeedAtEdge: x.minSpeedAtEdge === true,
    fullThrottleAtEdge: x.fullThrottleAtEdge === true,
    apexSpeedKph: num(x.apexSpeedKmh),
    offTrackS: num(x.offTrackSec) ?? 0,
    window: toWindowFacts(x),
  };
}

export type SessionLapsResponse = {items: Record<string, unknown>[]};

function toLapFuel(v: unknown): LapFuel | null {
  if (v == null || typeof v !== 'object') return null;
  const x = obj(v);
  return {
    startL: num(x.startL),
    endL: num(x.endL),
    usedL: num(x.usedL),
    addedL: num(x.addedL),
    veStartPct: num(x.veStartPct),
    veEndPct: num(x.veEndPct),
    veUsedPct: num(x.veUsedPct),
    veAddedPct: num(x.veAddedPct),
    lapsLeftFuel: num(x.lapsLeftFuel),
    lapsLeftVe: num(x.lapsLeftVe),
    green: x.green === true,
  };
}

function toWheelNumbers(v: unknown): Record<Wheel, number | null> | null {
  if (v == null || typeof v !== 'object') return null;
  const x = obj(v);
  return {FL: num(x.FL), FR: num(x.FR), RL: num(x.RL), RR: num(x.RR)};
}

function toPitTyres(v: unknown): PitTyres | null {
  if (v == null || typeof v !== 'object') return null;
  const x = obj(v);
  const list = Array.isArray(x.wheels) ? x.wheels : [];
  const wheels = WHEELS.filter(w => list.includes(w));
  return {
    changed: x.changed === true && wheels.length > 0,
    wheels,
    entryPct: toWheelNumbers(x.entryPct),
    exitPct: toWheelNumbers(x.exitPct),
  };
}

function toPitStop(v: unknown): PitStop | null {
  if (v == null || typeof v !== 'object') return null;
  const x = obj(v);
  const at = obj(x.atEntry);
  const added = obj(x.added);
  const left = obj(x.lapsLeftAtEntry);
  return {
    atEntry: {fuelL: num(at.fuelL), vePct: num(at.vePct)},
    added: {fuelL: num(added.fuelL), vePct: num(added.vePct)},
    inPitS: num(x.inPitS),
    lapsLeftAtEntry: {fuel: num(left.fuel), ve: num(left.ve)},
    tyres: toPitTyres(x.tyres),
  };
}

function toTraffic(v: unknown): LapTraffic | null {
  if (v == null || typeof v !== 'object') return null;
  const x = obj(v);
  return {
    draftS: num(x.draftS) ?? 0,
    trafficAheadS: num(x.trafficAheadS) ?? 0,
    trafficBehindS: num(x.trafficBehindS) ?? 0,
    blueFlagS: num(x.blueFlagS) ?? 0,
    passesMade: num(x.passesMade) ?? 0,
    passesSuffered: num(x.passesSuffered) ?? 0,
    passesMadeAll: num(x.passesMadeAll) ?? 0,
    passesSufferedAll: num(x.passesSufferedAll) ?? 0,
    battleS: num(x.battleS) ?? 0,
  };
}

function toPartialWhy(v: unknown): Lap['partialWhy'] {
  return v === 'grid' || v === 'file' ? v : null;
}

export function toLaps(items: Record<string, unknown>[]): Lap[] {
  const laps = items.map((raw, i) => ({
    id: str(raw.id),
    lapIndex: i + 1,
    lapNumber: num(raw.lapNumber),
    recordingId: str(raw.recordingId) || null,
    timeS: raw.timed === false ? null : num(raw.lapTime),
    sectorsS: Array.isArray(raw.sectors) ? raw.sectors.map(num) : [],
    stint: num(raw.stint) ?? 1,
    comparable: raw.comparable === true,
    reasons: Array.isArray(raw.reasons) ? raw.reasons.map(r => str(r)) : [],
    pitIn: raw.pitIn === true,
    pitOut: raw.pitOut === true,
    endedInReset: raw.endedInReset === true,
    partial: raw.partial === true || raw.incomplete === true,
    partialWhy: toPartialWhy(raw.partialWhy),
    offTrackS: num(raw.offTrackSec) ?? 0,
    hadImpact: (num(raw.impactMax) ?? 0) > 0,
    sections: (Array.isArray(raw.corners) ? raw.corners : []).map(c => ({
      ...toCornerFacts(c),
      brakeApps: toBrakeApps(obj(c).brakeApps),
      parts: (Array.isArray(obj(c).parts)
        ? (obj(c).parts as unknown[])
        : []
      ).map(toCornerFacts),
    })),
    startStraight: toStartStraight(raw.startStraight),
    cornerBoundaries: toBoundaryStamp(raw.cornerBoundaries),
    traffic: toTraffic(raw.traffic),
    fuel: toLapFuel(raw.fuel),
    pitStop: toPitStop(raw.pitStop),
    tyres: toLapTyres(raw.tyres),
    newTyres: false,
  }));
  return laps.map((lap, i) =>
    freshTyres(laps[i - 1]) ? {...lap, newTyres: true} : lap,
  );
}

// --- band (GET /sessions/{id}/band) ----------------------------------------

export type BandChannel = {p10: number[]; p50: number[]; p90: number[]};

/** p10/p50/p90 over the comparable laps, every stepM metres from the line. */
export type SessionBand = {
  stepM: number;
  lengthM: number;
  lapCount: number;
  speedKph: BandChannel;
  throttlePct: BandChannel;
  brakePct: BandChannel;
};

function toBandChannel(raw: unknown): BandChannel {
  const x = obj(raw);
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(n => num(n) ?? 0) : []);
  return {p10: arr(x.p10), p50: arr(x.p50), p90: arr(x.p90)};
}

export function toSessionBand(raw: Record<string, unknown>): SessionBand {
  return {
    stepM: num(raw.stepM) ?? 5,
    lengthM: num(raw.lengthM) ?? 0,
    lapCount: num(raw.laps) ?? 0,
    speedKph: toBandChannel(raw.speed),
    throttlePct: toBandChannel(raw.throttle),
    brakePct: toBandChannel(raw.brake),
  };
}

// --- track map (GET /sessions/{id}/map) ------------------------------------

export type MapCorner = {
  /** Corner number as drawn on the badge. */
  n: number;
  /** The circuit's official label when it differs from the app's number
   *  ("T10a"); shown by design/format turnLabel in place of "T{n}". */
  official?: string;
  entryM: number;
  apexM: number;
  exitM: number;
};

export type MapSection = MapCorner & {parts: MapCorner[]};

export type TrackMapQuality = 'good' | 'fair' | 'poor';

/** One window of the layout's boundaries; they tile 0 to the map's length. */
export type BoundaryWindow = {
  kind: 'start-straight' | 'section';
  /** The section's number; null for the start straight. */
  section: number | null;
  fromM: number;
  toM: number;
  /** The parts of a compound section, tiling it; empty for one corner. */
  parts: {n: number; turnInM: number; fromM: number; toM: number}[];
};

/** The layout's corner boundaries (stored with the map), in the map's frame. */
export type MapBoundaries = BoundaryStamp & {windows: BoundaryWindow[]};

/** Null when the map has no boundaries yet (not resynced) or a malformed block. */
export function toMapBoundaries(raw: unknown): MapBoundaries | null {
  const stamp = toBoundaryStamp(raw);
  if (!stamp || !Array.isArray(obj(raw).windows)) return null;
  const windows: BoundaryWindow[] = [];
  for (const w of obj(raw).windows as unknown[]) {
    const x = obj(w);
    const fromM = num(x.fromM);
    const toM = num(x.toM);
    if (fromM == null || toM == null) return null;
    const parts = (Array.isArray(x.parts) ? x.parts : []).flatMap(p => {
      const y = obj(p);
      const [n, turnInM, pf, pt] = [y.n, y.turnInM, y.fromM, y.toM].map(num);
      return n == null || turnInM == null || pf == null || pt == null
        ? []
        : [{n, turnInM, fromM: pf, toM: pt}];
    });
    windows.push({
      kind: x.kind === 'start-straight' ? 'start-straight' : 'section',
      section: num(x.section),
      fromM,
      toM,
      parts,
    });
  }
  return {...stamp, windows};
}

export type TrackMapData = {
  lengthM: number;
  sections: MapSection[];
  /** The corner windows that tile the lap; null until the track is resynced. */
  boundaries: MapBoundaries | null;
  quality: TrackMapQuality | null;
  georef: {
    rotationDeg: number;
    mirror: number;
    originLat: number;
    originLon: number;
  } | null;
  /** OSM track lines as [lon, lat] pairs; pit lanes excluded. */
  outline: [number, number][][];
  /** The OSM kind of each outline line, in the same order ('track', or another road kind). */
  outlineKinds: string[];
  /** OSM pit lane lines as [lon, lat] pairs. */
  pitLane: [number, number][][];
  attribution: string | null;
};

// The kind of each LineString lineStrings returns for the same filter, in the
// same order, so a line can be told from another by what the mapper called it.
function lineKinds(
  features: unknown[],
  wanted: (kind: unknown) => boolean,
): string[] {
  return features
    .map(obj)
    .filter(ft => wanted(obj(ft.properties).kind))
    .filter(ft => {
      const geom = obj(ft.geometry);
      return geom.type === 'LineString' && Array.isArray(geom.coordinates);
    })
    .map(ft => str(obj(ft.properties).kind));
}

// GeoJSON LineStrings of the kinds wanted, as [lon, lat] pairs.
function lineStrings(
  features: unknown[],
  wanted: (kind: unknown) => boolean,
): [number, number][][] {
  return features
    .map(obj)
    .filter(ft => wanted(obj(ft.properties).kind))
    .map(ft => obj(ft.geometry))
    .filter(
      geom => geom.type === 'LineString' && Array.isArray(geom.coordinates),
    )
    .map(geom =>
      (geom.coordinates as unknown[]).map(p => {
        const q = Array.isArray(p) ? p : [];
        return [num(q[0]) ?? 0, num(q[1]) ?? 0] as [number, number];
      }),
    );
}

function toMapCorner(raw: unknown, labels: Record<number, string>): MapCorner {
  const x = obj(raw);
  const n = num(x.n) ?? 0;
  return {
    n,
    ...(labels[n] ? {official: labels[n]} : {}),
    entryM: num(x.entryM) ?? 0,
    apexM: num(x.apexM) ?? 0,
    exitM: num(x.exitM) ?? 0,
  };
}

export function toTrackMap(raw: Record<string, unknown>): TrackMapData {
  const g = obj(raw.georef);
  const quality = str(raw.quality);
  const labels = turnLabelsOf(str(raw.trackId) ?? '');
  const features = Array.isArray(obj(raw.outline).features)
    ? (obj(raw.outline).features as unknown[])
    : [];
  return {
    lengthM: num(raw.lengthM) ?? 0,
    sections: (Array.isArray(raw.corners) ? raw.corners : []).map(c => ({
      ...toMapCorner(c, labels),
      parts: (Array.isArray(obj(c).parts)
        ? (obj(c).parts as unknown[])
        : []
      ).map(p => toMapCorner(p, labels)),
    })),
    boundaries: toMapBoundaries(raw.boundaries),
    quality:
      quality === 'good' || quality === 'fair' || quality === 'poor'
        ? quality
        : null,
    georef:
      num(g.originLat) != null && num(g.originLon) != null
        ? {
            rotationDeg: num(g.rotationDeg) ?? 0,
            mirror: num(g.mirror) ?? 1,
            originLat: num(g.originLat) as number,
            originLon: num(g.originLon) as number,
          }
        : null,
    outline: lineStrings(features, kind => kind !== 'pit'),
    outlineKinds: lineKinds(features, kind => kind !== 'pit'),
    pitLane: lineStrings(features, kind => kind === 'pit'),
    attribution: str(raw.attribution) || null,
  };
}

/**
 * The track's measured surface (GET /sessions/{id}/surface, written by
 * tools/sessions/surface.mjs): per 10 m bin sums the app turns into the centre
 * path and edges (src/analysis/trackSurface.ts). Null for a file that is not
 * this format or whose bins are not numbers, so a bad file draws nothing
 * rather than something wrong.
 */
export function toTrackSurface(
  raw: Record<string, unknown>,
): TrackSurface | null {
  const stepM = num(raw.stepM);
  const lengthM = num(raw.lengthM);
  if (raw.v !== 1 || stepM == null || lengthM == null || stepM <= 0)
    return null;
  if (!Array.isArray(raw.bins)) return null;
  const bins: TrackSurface['bins'] = [];
  for (const b of raw.bins) {
    const o = obj(b);
    const f = (k: string) => num(o[k]);
    const values = {
      laps: f('laps'),
      n: f('n'),
      sx: f('sx'),
      sy: f('sy'),
      lapsL: f('lapsL'),
      nL: f('nL'),
      sL: f('sL'),
      lapsR: f('lapsR'),
      nR: f('nR'),
      sR: f('sR'),
    };
    if (Object.values(values).some(v => v == null)) return null;
    bins.push(values as TrackSurface['bins'][number]);
  }
  if (bins.length !== Math.ceil(lengthM / stepM)) return null;
  return {
    v: 1,
    stepM,
    lengthM,
    sessions: Array.isArray(raw.sessions) ? raw.sessions.map(String) : [],
    bins,
  };
}
