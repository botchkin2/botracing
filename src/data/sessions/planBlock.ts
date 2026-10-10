// The Plan's data: the `plan` block each session doc carries (the uploader's
// tools/sessions/planBlock.mjs) as GET /plan returns it, in the app's types.
// Raw documents stop here (docs/CODE_STANDARDS.md): nothing else sees a raw
// response. A session uploaded before the block existed has `plan: null`: no
// data, never zero.
import type {SessionFuel, SessionType} from './adapters';

export type PlanTraffic = {
  aheadS: number;
  passes: number;
  blueS: number;
  battleS: number;
  /** How many faster-class cars passed; the places stay in the lap doc. */
  overtakes: number;
};

/** A green lap with fuel used above zero and a time. `n` is the app's `lapIndex`. */
export type PlanLap = {
  n: number;
  usedL: number;
  veUsedPct: number | null;
  timeS: number;
  comparable: boolean;
  traffic: PlanTraffic | null;
};

export type PlanStop = {
  lapIndex: number;
  fuelL: number | null;
  vePct: number | null;
  /** Litres added in the stop. */
  addedL: number | null;
  /** The stop's lane loss in seconds, or null when the pit lane base leaves it out. */
  lossS: number | null;
};

/** The race side: what "plan vs what happened" and the formation burn read. */
export type PlanRace = {
  raceLaps: number;
  minutes: number | null;
  leftEarly: boolean;
  playerLapsDone: number | null;
  classLeaderLapsDone: number | null;
  startVePct: number | null;
  /** The first lap's burn, the formation procedure. */
  formationL: number | null;
  ownUse: {fuelL: number | null; vePct: number | null};
  end: {lapIndex: number; fuelL: number | null; vePct: number | null};
  stops: PlanStop[];
};

export type PlanBlock = {
  v: number;
  fuel: SessionFuel;
  /** Null for a session past the newest few: its fuel limits and race side still count. */
  laps: PlanLap[] | null;
  race: PlanRace | null;
};

export type PlanSession = {
  id: string;
  startedAt: string;
  sessionType: SessionType;
  plan: PlanBlock | null;
};

/** The same reading as adapters.ts (a type is 'R', 'Q' or else 'P'); not imported, adapters imports this file. */
function toSessionType(v: unknown): SessionType {
  const t = typeof v === 'string' ? v.toLowerCase() : '';
  if (t.startsWith('r')) return 'R';
  if (t.startsWith('q')) return 'Q';
  return 'P';
}

const obj = (v: unknown): Record<string, unknown> =>
  v != null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

function toTraffic(v: unknown): PlanTraffic | null {
  if (v == null || typeof v !== 'object') return null;
  const t = obj(v);
  return {
    aheadS: num(t.aheadS) ?? 0,
    passes: num(t.passes) ?? 0,
    blueS: num(t.blueS) ?? 0,
    battleS: num(t.battleS) ?? 0,
    overtakes: num(t.overtakes) ?? 0,
  };
}

function toLap(v: unknown): PlanLap | null {
  const l = obj(v);
  const [n, usedL, timeS] = [num(l.n), num(l.usedL), num(l.timeS)];
  if (n == null || usedL == null || timeS == null) return null;
  return {
    n,
    usedL,
    veUsedPct: num(l.veUsedPct),
    timeS,
    comparable: l.comparable === true,
    traffic: toTraffic(l.traffic),
  };
}

function toStop(v: unknown): PlanStop | null {
  const s = obj(v);
  const lapIndex = num(s.lapIndex);
  if (lapIndex == null) return null;
  return {
    lapIndex,
    fuelL: num(s.fuelL),
    vePct: num(s.vePct),
    addedL: num(s.addedL),
    lossS: num(s.lossS),
  };
}

function toRace(v: unknown): PlanRace | null {
  if (v == null || typeof v !== 'object') return null;
  const r = obj(v);
  const raceLaps = num(r.raceLaps);
  const end = obj(r.end);
  const endLap = num(end.lapIndex);
  if (raceLaps == null || endLap == null) return null;
  const own = obj(r.ownUse);
  return {
    raceLaps,
    minutes: num(r.minutes),
    leftEarly: r.leftEarly === true,
    playerLapsDone: num(r.playerLapsDone),
    classLeaderLapsDone: num(r.classLeaderLapsDone),
    startVePct: num(r.startVePct),
    formationL: num(r.formationL),
    ownUse: {fuelL: num(own.fuelL), vePct: num(own.vePct)},
    end: {lapIndex: endLap, fuelL: num(end.fuelL), vePct: num(end.vePct)},
    stops: (Array.isArray(r.stops) ? r.stops : []).flatMap(s => {
      const stop = toStop(s);
      return stop ? [stop] : [];
    }),
  };
}

export function toPlanBlock(v: unknown): PlanBlock | null {
  if (v == null || typeof v !== 'object') return null;
  const p = obj(v);
  const fuel = obj(p.fuel);
  return {
    v: num(p.v) ?? 0,
    fuel: {
      startL: num(fuel.startL),
      fillLimitL: num(fuel.fillLimitL),
      tankL: num(fuel.tankL),
      litresPerVePct: num(fuel.litresPerVePct),
      // Only the sessions' own doc carries the stop cross-check.
      litresPerVePctStop: null,
    },
    laps: Array.isArray(p.laps)
      ? p.laps.flatMap(l => {
          const lap = toLap(l);
          return lap ? [lap] : [];
        })
      : null,
    race: toRace(p.race),
  };
}

/** The response of GET /plan: sessions newest first, and whether the cap cut it. */
export function toPlanSessions(raw: unknown): {
  items: PlanSession[];
  truncated: boolean;
} {
  const body = obj(raw);
  const items = Array.isArray(body.items) ? body.items : [];
  return {
    items: items.flatMap(i => {
      const x = obj(i);
      if (typeof x.id !== 'string' || typeof x.startedAt !== 'string') return [];
      return [
        {
          id: x.id,
          startedAt: x.startedAt,
          sessionType: toSessionType(x.sessionType),
          plan: toPlanBlock(x.plan),
        },
      ];
    }),
    truncated: body.truncated === true,
  };
}
