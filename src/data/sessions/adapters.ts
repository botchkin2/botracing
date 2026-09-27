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
