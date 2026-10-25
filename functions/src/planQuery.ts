// The pure parts of GET /plan (pit wall thread 1 #3485, #3487): which query
// parameters name a combo, and how the stored `plan` blocks are shaped into the
// one response the Plan screen reads. No Firebase here, so node tests import it
// directly.

/** The most sessions one combo reads; the response says when it cut. */
export const PLAN_MAX_SESSIONS = 500;
/** The newest sessions that keep their lap rows; older ones keep fuel and the race side. */
export const PLAN_LAP_SESSIONS = 8;
/** The only fields the query reads of a session doc (a projection, never lap docs). */
export const PLAN_FIELDS = [
  'startedAt',
  'endedAt',
  'sessionType',
  'plan',
  // The opening set's lap times, for the track progression (thread 88, S5).
  'paceSet',
  // The litres per 1 % VE the stops added (his setup's fuel ratio), read from
  // the session's own fuel: the plan block does not carry it, and a block
  // change would re-analyse every session (thread 104).
  'fuel.litresPerVePctStop',
  // LMU's own VE expectation from the car setup: the Plan's VE check (ticket
  // 47). Same reason: not in the block.
  'fuel.setupVePct',
  'fuel.setupVePerLapPct',
] as const;

export type PlanCombo = {sim: string; trackId: string; carModel: string};

const SIMS = new Set(['lmu', 'iracing']);
const NAME = /^[^\u0000-\u001f\u007f]{1,200}$/;

/** The combo a request names, or the sentence that says what is wrong. */
export function parsePlanQuery(
  query: Record<string, unknown>,
): {ok: true; combo: PlanCombo; lapSessions: number} | {ok: false; error: string} {
  const one = (k: string) => (typeof query[k] === 'string' ? (query[k] as string) : '');
  const sim = one('sim');
  const trackId = one('trackId');
  const carModel = one('car');
  if (!SIMS.has(sim)) return {ok: false, error: 'sim must be lmu or iracing'};
  if (!NAME.test(trackId)) return {ok: false, error: 'trackId is required'};
  if (!NAME.test(carModel)) return {ok: false, error: 'car is required'};
  const asked =
    typeof query.laps === 'string' && query.laps !== ''
      ? Number(query.laps)
      : NaN;
  const lapSessions =
    Number.isInteger(asked) && asked >= 0 && asked <= PLAN_MAX_SESSIONS
      ? asked
      : PLAN_LAP_SESSIONS;
  return {ok: true, combo: {sim, trackId, carModel}, lapSessions};
}

export type PlanRow = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  sessionType: string | null;
  /** The opening set's lap times; null before the session re-analysed with it. */
  paceSet: {v: number; lapTimesS: number[]} | null;
  /** Null for a session uploaded before the block existed: no data, not zero. */
  plan: {
    v: number;
    fuel: unknown;
    /** Only the newest sessions carry their lap rows; the rest read null. */
    laps: unknown[] | null;
    race: unknown;
  } | null;
};

/**
 * Rows from the query's documents, newest first as read. Laps are kept for the
 * first `lapSessions` rows only, so a 100-session combo costs the fuel and race
 * side of 92 sessions and the full rows of 8, not 100 full blocks.
 */
export function planRows(
  docs: {id: string; data: () => Record<string, any>}[],
  lapSessions: number,
): PlanRow[] {
  return docs.map((doc, i) => {
    const d = doc.data();
    const p = d.plan;
    const own = (k: string) =>
      typeof d.fuel?.[k] === 'number' ? (d.fuel[k] as number) : null;
    const fuel =
      p?.fuel && typeof p.fuel === 'object'
        ? {
            ...p.fuel,
            litresPerVePctStop: own('litresPerVePctStop'),
            setupVePct: own('setupVePct'),
            setupVePerLapPct: own('setupVePerLapPct'),
          }
        : p?.fuel ?? null;
    return {
      id: doc.id,
      startedAt: String(d.startedAt ?? ''),
      endedAt: typeof d.endedAt === 'string' ? d.endedAt : null,
      sessionType: typeof d.sessionType === 'string' ? d.sessionType : null,
      paceSet:
        d.paceSet && Array.isArray(d.paceSet.lapTimesS)
          ? {v: d.paceSet.v, lapTimesS: d.paceSet.lapTimesS}
          : null,
      plan:
        p && typeof p === 'object'
          ? {
              v: p.v,
              fuel,
              laps: i < lapSessions && Array.isArray(p.laps) ? p.laps : null,
              race: p.race ?? null,
            }
          : null,
    };
  });
}
