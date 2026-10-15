// The game's track-limit verdicts, read from LMU's results files (pit-wall
// thread 70, design #5521).
//
// LMU writes UserData\Log\Results\<date>-<id><P|Q|R><n>.xml when a session
// ends. Each strike is one row:
//   <TrackLimits Driver="Name" ID="1" Lap="10" WarningPoints="0.25"
//     CurrentPoints="0.25" Resolution="4" et="1390.7">Warning</TrackLimits>
// `et` is the session's elapsed seconds, the same clock as the game file's
// (XML lap 26 at et 7028.6399 is the game file's L25 crossing). Resolution is
// the game's ruling; the file also rules every session for every driver, and
// writes many drivers' rows twice in a row (38,972 of 92,373 rows on his PC on
// 2026-10-14; none of his own), so a row identical to the one before it, et
// included, is dropped: two real strikes always differ in et.
//
// "Our driver" is matched by name from the recording (the game file's
// DriverName, the capture's playerName), never by the file's isPlayer, which
// marks every human in an online session. Names are never stored.
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';

export const defaultResultsFolder =
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Le Mans Ultimate\\UserData\\Log\\Results';

// The ruling, from the Resolution code (counts over his 458 files, 2026-10-14).
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

const ROW = /<TrackLimits ([^>]*)>/g;
const ATTR = /(\w+)="([^"]*)"/g;
const text = (xml, tag) => xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1] ?? '';

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
 * The strikes of one driver in the session a recording belongs to, or
 * {absent: reason}. span is {startedAt, endedAt} (ISO, the recording's wall
 * clock); trackCourse is the game's layout name when known ('' skips the check).
 */
export function resultsFor({span, driverName, trackCourse = '', folder = defaultResultsFolder}) {
  if (!driverName) return {absent: 'no driver name'};
  if (!existsSync(folder)) return {absent: 'no results folder'};
  const from = Date.parse(span.startedAt);
  const to = Date.parse(span.endedAt);
  let best = null;
  for (const name of readdirSync(folder)) {
    if (!name.endsWith('.xml')) continue;
    const file = parseResults(readFileSync(resolve(folder, name), 'utf8'));
    if (file.startedAtMs == null) continue;
    // The file begins with the session and ends after its last row.
    const endsAtMs = file.startedAtMs + file.lastEt * 1000;
    if (file.startedAtMs > to || endsAtMs < from) continue;
    if (trackCourse && file.trackCourse && file.trackCourse !== trackCourse) continue;
    const overlap = Math.min(to, endsAtMs) - Math.max(from, file.startedAtMs);
    if (!best || overlap > best.overlap) best = {overlap, file, name};
  }
  if (!best) return {absent: 'no results file covers the session'};
  const strikes = best.file.rows
    .filter(r => r.driver === driverName)
    .map(({et, lap, points, outcome}) => ({et, lap, points, outcome}));
  return {strikes};
}
