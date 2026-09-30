import {type FieldPointer, toFieldPointer} from '../field/adapters';
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
   * Fuel and Virtual Energy per green lap (tools/sessions/fuelFacts.mjs):
   * the median and spread over `greenLaps` laps, null under 3.
   */
  greenLaps: number;
  medianFuelL: number | null;
  fuelSpreadL: number | null;
  medianVePct: number | null;
  veSpreadPct: number | null;
};

/** The session's fuel: what it started with and the event's limits. */
export type SessionFuel = {
  startL: number | null;
  /** The most fuel the event lets the car take; VE 100 % is this full load. */
  fillLimitL: number | null;
  /** The physical tank, when the setup says. */
  tankL: number | null;
};

export type SessionDetail = SessionSummary & {
  trackVariant: string;
  stints: Stint[];
  /** The stored field of every car (src/data/field), or null without one. */
  field: FieldPointer | null;
  fuel: SessionFuel | null;
};

function toSessionFuel(v: unknown): SessionFuel | null {
  if (v == null || typeof v !== 'object') return null;
  const x = obj(v);
  return {
    startL: num(x.startL),
    fillLimitL: num(x.fillLimitL),
    tankL: num(x.tankL),
  };
}

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
  /** The cars around the player on this lap; null when the session has no field. */
  traffic: LapTraffic | null;
  /** Fuel and Virtual Energy on the lap; null without the channels. */
  fuel: LapFuel | null;
  /** The pit stop entered on this lap, if any. */
  pitStop: PitStop | null;
};

/**
 * Lap doc `fuel` (tools/sessions/fuelFacts.mjs). Used is start minus end plus
 * what was added in the pits. Laps left is the end level over the stint's
 * median use, null without a median (under 3 green laps).
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
  lapsLeftFuel: number | null;
  lapsLeftVe: number | null;
  green: boolean;
};

/** A pit stop: what was left at pit entry, what was added, how long. */
export type PitStop = {
  atEntry: {fuelL: number | null; vePct: number | null};
  /** 0 for a drive-through or a penalty. */
  added: {fuelL: number | null; vePct: number | null};
  inPitS: number | null;
  lapsLeftAtEntry: {fuel: number | null; ve: number | null};
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
};

export type SectionFacts = CornerFacts & {parts: CornerFacts[]};

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
  };
}

export type SessionLapsResponse = {items: Record<string, unknown>[]};

function toFuel(v: unknown): LapFuel | null {
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

export function toLaps(items: Record<string, unknown>[]): Lap[] {
  return items.map((raw, i) => ({
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
    offTrackS: num(raw.offTrackSec) ?? 0,
    hadImpact: (num(raw.impactMax) ?? 0) > 0,
    sections: (Array.isArray(raw.corners) ? raw.corners : []).map(c => ({
      ...toCornerFacts(c),
      parts: (Array.isArray(obj(c).parts)
        ? (obj(c).parts as unknown[])
        : []
      ).map(toCornerFacts),
    })),
    traffic: toTraffic(raw.traffic),
    fuel: toFuel(raw.fuel),
    pitStop: toPitStop(raw.pitStop),
  }));
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

export type TrackMapData = {
  lengthM: number;
  sections: MapSection[];
  quality: TrackMapQuality | null;
  georef: {
    rotationDeg: number;
    mirror: number;
    originLat: number;
    originLon: number;
  } | null;
  /** OSM track lines as [lon, lat] pairs; pit lanes excluded. */
  outline: [number, number][][];
  /** OSM pit lane lines as [lon, lat] pairs. */
  pitLane: [number, number][][];
  attribution: string | null;
};

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
    pitLane: lineStrings(features, kind => kind === 'pit'),
    attribution: str(raw.attribution) || null,
  };
}
