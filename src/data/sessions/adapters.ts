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
  sessionType: SessionType;
  startedAt: string;
  lapCount: number;
  comparableCount: number;
  bestTimeS: number | null;
  medianTimeS: number | null;
  bestLapId: string | null;
  series: string | null;
  eventId: string | null;
  updatedAt: string;
};

export type SessionListResponse = {items: RawSession[]; total: number};

type RawSession = Record<string, unknown> & {id: string};

const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : fallback;
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** Track and car arrive as {name, ...} objects. */
const name = (v: unknown): string =>
  typeof v === 'string'
    ? v
    : v && typeof v === 'object' && 'name' in v
    ? str((v as {name: unknown}).name)
    : '';

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
    sessionType: toSessionType(raw.sessionType),
    startedAt: str(raw.startedAt),
    lapCount: num(raw.lapCount) ?? 0,
    comparableCount: num(raw.comparableCount) ?? 0,
    bestTimeS: num(raw.bestLapTime),
    medianTimeS: num(raw.medianLapTime),
    bestLapId: str(raw.bestLapId) || null,
    series: str(raw.series) || null,
    eventId: str(raw.eventId) || null,
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
};

export type SessionDetail = SessionSummary & {
  trackVariant: string;
  stints: Stint[];
};

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

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
  timeS: number | null;
  sectorsS: (number | null)[];
  stint: number;
  comparable: boolean;
  reasons: LapReason[];
  pitIn: boolean;
  pitOut: boolean;
  partial: boolean;
  offTrackS: number;
  /** Contact on this lap. LMU records a flag, not a magnitude. */
  hadImpact: boolean;
  /** Per-section facts in track order, precomputed by the uploader. */
  sections: SectionFacts[];
};

/** One pass through a corner or section (lap doc `corners[]` / `parts[]`). */
export type CornerFacts = {
  segTimeS: number | null;
  minSpeedKph: number | null;
  brakeAtM: number | null;
  fullThrottleAtM: number | null;
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
    offTrackS: num(x.offTrackSec) ?? 0,
  };
}

export type SessionLapsResponse = {items: Record<string, unknown>[]};

export function toLaps(items: Record<string, unknown>[]): Lap[] {
  return items.map((raw, i) => ({
    id: str(raw.id),
    lapIndex: i + 1,
    timeS: raw.timed === false ? null : num(raw.lapTime),
    sectorsS: Array.isArray(raw.sectors) ? raw.sectors.map(num) : [],
    stint: num(raw.stint) ?? 1,
    comparable: raw.comparable === true,
    reasons: Array.isArray(raw.reasons) ? raw.reasons.map(r => str(r)) : [],
    pitIn: raw.pitIn === true,
    pitOut: raw.pitOut === true,
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

function toMapCorner(raw: unknown): MapCorner {
  const x = obj(raw);
  return {
    n: num(x.n) ?? 0,
    entryM: num(x.entryM) ?? 0,
    apexM: num(x.apexM) ?? 0,
    exitM: num(x.exitM) ?? 0,
  };
}

export function toTrackMap(raw: Record<string, unknown>): TrackMapData {
  const g = obj(raw.georef);
  const quality = str(raw.quality);
  const features = Array.isArray(obj(raw.outline).features)
    ? (obj(raw.outline).features as unknown[])
    : [];
  return {
    lengthM: num(raw.lengthM) ?? 0,
    sections: (Array.isArray(raw.corners) ? raw.corners : []).map(c => ({
      ...toMapCorner(c),
      parts: (Array.isArray(obj(c).parts)
        ? (obj(c).parts as unknown[])
        : []
      ).map(toMapCorner),
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
