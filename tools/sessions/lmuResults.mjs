// The game's track-limit verdicts, read from LMU's results files (pit-wall
// thread 70, design #5521).
//
// LMU writes UserData\Log\Results\<date>-<id><P|Q|R><n>.xml when a session
// ends. Each strike is one row:
//   <TrackLimits Driver="Name" ID="1" Lap="10" WarningPoints="0.25"
//     CurrentPoints="0.25" Resolution="4" et="1390.7">Warning</TrackLimits>
// `et` is the session's elapsed seconds, the same clock as the game file's.
// Resolution is the game's ruling. The file also rules every session for every
// driver, and writes many drivers' rows twice in a row (38,972 of 92,373 rows
// on his PC on 2026-10-14; none of his own), so a row identical to the one
// before it, et included, is dropped: two real strikes always differ in et.
//
// A driver's laps: `<Lap num="n" et="…">`, where `et` is the lap's START (plank,
// thread 70 #5632: et[n+1] - et[n] is lap n's own time on 2529 of 2529 timed
// laps in his 458 files). So lap n is [et_n, et_n+1); the last lap has no end
// and its strikes are unplaced. Our lapNumber is num - 1 (the 0-based `Lap` of
// a strike row).
//
// "Our driver" is matched by name from the recording (the game file's
// DriverName, the capture's playerName), never by the file's isPlayer, which
// marks every human in an online session. Names are never stored.
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {resolve} from 'node:path';

export const defaultResultsFolder =
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Le Mans Ultimate\\UserData\\Log\\Results';

// The ruling, from the Resolution code.
export const OUTCOMES = {
  0: 'disqualified',
  1: 'stopGo',
  2: 'driveThrough',
  3: 'timePenalty',
  4: 'warning',
  5: 'invalidCut',
  6: 'invalidOff',
  7: 'none',
};

// The game's own words for each ruling (the Resolution text of its strike rows).
export const RULINGS = {
  0: 'Disqualify',
  1: 'Stop Go',
  2: 'Drive Through',
  3: 'Time Penalty',
  4: 'Warning',
  5: 'Invalid Lap Cut Track',
  6: 'Invalid Lap Off Track',
  7: 'No Further Action',
};

/**
 * The Resolutions that delete the lap they land in (the lap reads `--.----`):
 * 4 Warning, 5 Invalid Lap Cut Track, 6 Invalid Lap Off Track. Measured over
 * his 458 results files (2026-10-15, thread 70 #5632 and #5634): of 315 strikes
 * placed on a lap of his that is neither lap 1, a pit lap nor an out-lap, 315
 * are in a deleted lap (P: Cut 197, Off 23; Q: Cut 11; R: Warning 84), none in
 * a timed one. Resolution 7 No Further Action does not delete: 30.0 % (P),
 * 10.5 % (Q) and 7.3 % (R) of its laps read `--.----`, the base rate of each
 * session type. Re-run it with tools/dev/trackLimitsTable.mjs when LMU changes
 * its rules.
 */
export const DELETING_RESOLUTIONS = new Set([4, 5, 6]);

const ROW = /<TrackLimits ([^>]*)>/g;
const ATTR = /(\w+)="([^"]*)"/g;
const text = (xml, tag) =>
  xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1] ?? '';

const attrsOf = s => {
  const out = {};
  for (const [, k, v] of s.matchAll(ATTR)) out[k] = decode(v);
  return out;
};

// A name comes from a user profile: &amp; and the like are XML's, the rest
// (accents, a trailing space) is kept exactly, so the match is exact.
const decode = v =>
  v
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/**
 * One driver's laps as the file lists them: `num` (1-based), `start` (the lap's
 * `et`) and `end` (the next lap's start; null for the last lap, which has none).
 */
export function lapSpansOf(xml, driverName) {
  const block = xml
    .split('<Driver>')
    .slice(1)
    .find(b => decode(text(b, 'Name')) === driverName);
  if (!block) return [];
  const laps = [...block.matchAll(/<Lap num="(\d+)"([^>]*)>/g)].map(m => ({
    num: Number(m[1]),
    start: Number(attrsOf(m[2]).et),
  }));
  return laps.map((l, i) => ({
    ...l,
    end: i + 1 < laps.length ? laps[i + 1].start : null,
  }));
}

/** The lap a strike's `et` falls in, or null: after his laps, in the last lap, or in none (a re-report). */
export function lapOfStrike(spans, et) {
  return spans.find(s => s.end != null && et >= s.start && et < s.end) ?? null;
}

/** The file's session: when it began, its track layout, every strike row. */
export function parseResults(xml) {
  const startedAt = Number(text(xml, 'DateTime'));
  const rows = [];
  let previous = null;
  for (const [, raw] of xml.matchAll(ROW)) {
    if (raw === previous) continue;
    previous = raw;
    const a = attrsOf(raw);
    const outcome = OUTCOMES[a.Resolution];
    if (!outcome) continue;
    rows.push({
      driver: a.Driver ?? '',
      et: Number(a.et),
      lap: Number(a.Lap),
      points: Number(a.WarningPoints),
      outcome,
      resolution: Number(a.Resolution),
    });
  }
  const ets = rows.map(r => r.et);
  return {
    startedAtMs: Number.isFinite(startedAt) ? startedAt * 1000 : null,
    trackCourse: text(xml, 'TrackCourse'),
    lastEt: ets.length ? Math.max(...ets) : 0,
    rows,
  };
}

/**
 * One driver's strikes of a results file, placed on his laps:
 *   strikes: [{et, lapNumber, points, outcome, ruling}], the ones that land in a lap of his
 *   unplaced: how many did not (after his laps, in his last lap, or a re-report)
 *   deletedLaps: the lapNumbers a strike of a deleting Resolution lands in, ascending
 */
export function strikesOf(xml, driverName) {
  const file = parseResults(xml);
  const spans = lapSpansOf(xml, driverName);
  const placed = [];
  let unplaced = 0;
  for (const r of file.rows.filter(row => row.driver === driverName)) {
    const lap = lapOfStrike(spans, r.et);
    if (!lap) {
      unplaced++;
      continue;
    }
    placed.push({
      et: r.et,
      lapNumber: lap.num - 1,
      points: r.points,
      outcome: r.outcome,
      ruling: RULINGS[r.resolution],
      deletes: DELETING_RESOLUTIONS.has(r.resolution),
    });
  }
  const deletedLaps = [
    ...new Set(placed.filter(s => s.deletes).map(s => s.lapNumber)),
  ].sort((a, b) => a - b);
  return {
    strikes: placed.map(({deletes: _d, ...s}) => s),
    unplaced,
    deletedLaps,
  };
}

/**
 * `resultsFor` for a session's wall-clock window in ms ({startMs, endMs}, as
 * sync.mjs spanOf): what the builders and the live path hold. The layout name
 * is not asked: the session letter and the file's write time already pick the
 * one file, and the game file's layout name is not always the results file's.
 */
export function resultsForSpan(
  span,
  driverName,
  sessionType,
  folder = defaultResultsFolder,
) {
  return resultsFor({
    span: {
      startedAt: new Date(span.startMs).toISOString(),
      endedAt: new Date(span.endMs).toISOString(),
    },
    driverName,
    sessionType,
    folder,
  });
}

// The session letter in the file name: `2026_10_14_22_14_53-60R1.xml` is a race.
const typeOfFile = name =>
  /-\d+([A-Z])\d*\.xml$/i.exec(name)?.[1].toUpperCase() ?? null;
const typeLetter = sessionType =>
  String(sessionType ?? '')
    .trim()[0]
    ?.toUpperCase() ?? null;

/** How soon after a recording's end the game's file may have been written, ms. */
export const WRITE_WINDOW_MS = 30 * 60_000;

/**
 * The strikes of one driver in the session a recording belongs to, or
 * {absent: reason}. span is {startedAt, endedAt} (ISO, the recording's wall
 * clock); sessionType is the recording's ('Practice', 'Qualify', 'Race').
 *
 * The file is picked by two keys the file system gives (plank, thread 70
 * #5638), not by the header's DateTime, which is the EVENT's start and the same
 * in a weekend's practice, qualifying and race files:
 *  1. the session letter in the file name (P, Q, R) is the recording's;
 *  2. of those, the first one written at or after the recording's end (within
 *     30 min): the game writes it when its session ends.
 * One older than the recording's end cannot be its session, so it is skipped
 * unread (the live path asks at every lap, and the folder holds hundreds).
 * The header's start must still precede the recording's end, and the layout
 * name, when asked and in both, must agree.
 */
export function resultsFor({
  span,
  driverName,
  sessionType,
  trackCourse = '',
  folder = defaultResultsFolder,
}) {
  if (!driverName) return {absent: 'no driver name'};
  if (!existsSync(folder)) return {absent: 'no results folder'};
  const letter = typeLetter(sessionType);
  if (!letter) return {absent: 'no session type'};
  const to = Date.parse(span.endedAt);
  let best = null;
  for (const name of readdirSync(folder)) {
    if (typeOfFile(name) !== letter) continue;
    const written = statSync(resolve(folder, name)).mtimeMs;
    if (written < to - 60_000 || written > to + WRITE_WINDOW_MS) continue;
    if (best && written >= best.written) continue;
    const xml = readFileSync(resolve(folder, name), 'utf8');
    const file = parseResults(xml);
    if (file.startedAtMs == null || file.startedAtMs > to) continue;
    if (trackCourse && file.trackCourse && file.trackCourse !== trackCourse)
      continue;
    best = {written, xml};
  }
  if (!best) return {absent: 'no results file covers the session'};
  return strikesOf(best.xml, driverName);
}
