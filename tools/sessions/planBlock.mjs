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

const MIN_OWN_LAPS = 3;

function median(values) {
  if (values.length < MIN_OWN_LAPS) return null;
  const v = [...values].sort((x, y) => x - y);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * The race's side, for "plan vs what happened" and the formation burn
 * (src/data/sessions/raceFacts.ts reads the same from the lap docs): null for
 * anything but a race with a whole lap to end on. The ending lap is the last
 * one that was not cut short and has a fuel level; lap numbers count from the
 * first racing lap (the formation lap is 0), so the ending lap's position
 * minus one is the racing laps.
 */
function raceBlock({laps, race, result}) {
  let end = -1;
  laps.forEach((lap, i) => {
    if (!(lap.reasons ?? []).includes('partial') && lap.fuel?.endL != null)
      end = i;
  });
  if (end < 0) return null;
  const fuelOf = lap => lap.fuel ?? {};
  const green = laps.filter(l => l.fuel?.green && (l.fuel.usedL ?? 0) > 0);
  const finish = result?.finish ?? null;
  const first = fuelOf(laps[0]);
  return {
    raceLaps: Math.max(0, end),
    minutes: finite(race?.minutes),
    leftEarly: finish?.leftEarly === true,
    playerLapsDone: finite(finish?.lapsDone),
    classLeaderLapsDone: finite(finish?.classLeaderLapsDone),
    // What the car started the race on, and the first lap's burn (the
    // formation procedure burns more than a green lap).
    startVePct: finite(first.veStartPct),
    formationL: first.usedL > 0 ? first.usedL : null,
    ownUse: {
      fuelL: median(green.map(l => l.fuel.usedL)),
      vePct: median(
        green.map(l => l.fuel.veUsedPct).filter(v => v != null && v > 0),
      ),
    },
    end: {
      lapIndex: end + 1,
      fuelL: finite(fuelOf(laps[end]).endL),
      vePct: finite(fuelOf(laps[end]).veEndPct),
    },
    // The service before the start is not a stop: a pit window on the first
    // lap counts only when the lap ends in the pit lane.
    stops: laps.flatMap((lap, i) =>
      lap.pitStop != null && (i !== 0 || lap.pitIn)
        ? [
            {
              lapIndex: i + 1,
              fuelL: finite(lap.pitStop.atEntry?.fuelL),
              vePct: finite(lap.pitStop.atEntry?.vePct),
            },
          ]
        : [],
    ),
  };
}

/**
 * `sessionType`, `fuel`, `race` and `result` are the session doc's own fields;
 * `laps` its lap docs in driving order (`n` is the 1-based position, the app's
 * `lapIndex`). `race` is null outside a race.
 */
export function planBlock({sessionType, fuel, laps, race = null, result = null}) {
  return {
    v: PLAN_VERSION,
    fuel: {
      fillLimitL: finite(fuel?.fillLimitL),
      startL: finite(fuel?.startL),
      tankL: finite(fuel?.tankL),
      litresPerVePct: finite(fuel?.litresPerVePct),
    },
    laps: laps.map((lap, i) => planLap(lap, i + 1)).filter(Boolean),
    // 'Race' (iRacing, LMU), the same test sync.mjs uses for the race length.
    race: /^r/i.test(sessionType ?? '') ? raceBlock({laps, race, result}) : null,
  };
}
