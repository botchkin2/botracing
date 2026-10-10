// The session doc's `plan` block: what the Plan screen reads of a session, so
// it needs one small projection per session instead of every lap doc (pit wall
// thread 1 #3485). A lap doc carries corners, traffic spans, tyres, hybrid and
// pit visits; the Plan reads five numbers from each green lap.
//
// The numbers are the ones src/features/plan/model.ts greenLapsOf, veRatioOf
// and eventLoad read, computed once here. The series week is not stored: it
// depends on the viewer's time zone and is worked out from startedAt.

/**
 * Bump when the rules below change: it goes into analyze.mjs's blockVersions,
 * so every session is re-analysed once and the block is written again.
 */
export const PLAN_VERSION = 1;

const finite = x => (Number.isFinite(x) ? x : null);

/**
 * A green lap of the plan, as greenLapsOf keeps it: fuel used above zero and a
 * timed lap. Everything else (a lap in the pits, under yellow, partial) is not
 * in the block.
 */
function planLap(lap, n) {
  const f = lap.fuel;
  const timeS = lap.timed === false ? null : finite(lap.lapTime);
  if (!f || !f.green || !(f.usedL > 0) || timeS == null) return null;
  const t = lap.traffic;
  return {
    n,
    usedL: f.usedL,
    veUsedPct: finite(f.veUsedPct),
    timeS,
    comparable: lap.comparable === true,
    // Counts only: the overtakes' places stay in the lap doc.
    traffic: t
      ? {
          aheadS: finite(t.trafficAheadS) ?? 0,
          passes: finite(t.passesSufferedAll) ?? 0,
          blueS: finite(t.blueFlagS) ?? 0,
          battleS: finite(t.battleS) ?? 0,
          overtakes: Array.isArray(t.overtakes) ? t.overtakes.length : 0,
        }
      : null,
  };
}

/**
 * `fuel`: the session's fuel block (analyze.mjs); `laps`: the session's lap
 * docs in driving order (`n` is the 1-based position, the app's `lapIndex`).
 */
export function planBlock({fuel, laps}) {
  return {
    v: PLAN_VERSION,
    fuel: {
      fillLimitL: finite(fuel?.fillLimitL),
      startL: finite(fuel?.startL),
      tankL: finite(fuel?.tankL),
      litresPerVePct: finite(fuel?.litresPerVePct),
    },
    laps: laps.map((lap, i) => planLap(lap, i + 1)).filter(Boolean),
  };
}
