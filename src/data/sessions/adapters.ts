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
};

export type SessionDetail = SessionSummary & {
  trackVariant: string;
  stints: Stint[];
};

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

export function toSessionDetail(raw: RawSession): SessionDetail {
  const stints = Array.isArray(raw.stints) ? raw.stints : [];
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
  impact: number;
};

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
    impact: num(raw.impactMax) ?? 0,
  }));
}
