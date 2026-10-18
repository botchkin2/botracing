// What a live session needs from the capture beside its laps (roadmap row 0a,
// pit wall #5298): the field (every car, field.mjs) and the capture extract
// (damage and LMU race length, captureExtract.mjs). The game-file sync makes
// both from the same capture (sync.mjs), but it skips a session live laps
// cover (sync.mjs liveCover), and cloud analysis can only keep a stored field,
// never make one (analyzeStored.mjs). So the live path makes them, from the
// capture it just read, every time it uploads a lap: the field grows with the
// session and is named by its content, so a new lap replaces it.
import {createHash} from 'node:crypto';
import {dirname} from 'node:path';
import {captureExtract} from './captureExtract.mjs';
import * as duck from './duck.mjs';
import {fieldFor} from './field.mjs';
import {onlineFor} from './gameMode.mjs';
import {damageFor} from './playerDamage.mjs';
import {raceLengthFor} from './raceLength.mjs';
import {resultsForSpan} from './lmuResults.mjs';
import {resultsInput} from './resultsInput.mjs';

/** The session's capture window, as sync.mjs spanOf: tracks and wall times. */
export function spanOfLive(files) {
  const first = files[0].info;
  const last = files[files.length - 1].info;
  return {
    tracks: [first.track, first.layout],
    startMs: Date.parse(first.recordedAt),
    endMs: Date.parse(last.recordedAt) + (last.endT - last.startT) * 1000,
  };
}

/** The player's clock and lap distance of one recording, from its parts. */
function liteOf(samplePaths) {
  if (samplePaths.length === 0) return null;
  const list = samplePaths.map(p => duck.sqlPath(p)).join(', ');
  const c = duck.columns(
    ':memory:',
    `SELECT t, lap_dist_m FROM read_parquet([${list}]) ORDER BY t`,
  );
  if (!c.t?.length) return null;
  return {t: c.t, lapDist: c.lap_dist_m};
}

/**
 * The field and the capture extract for a live session, or nulls with the
 * reason. `recordings`: [{info, samplePaths}] in order. Only LMU: an iRacing
 * live capture's field needs the .ibt's classes (irField.mjs) and stays with
 * the game-file sync for now.
 */
export function liveInputs({
  captureDir,
  ownerId,
  sessionId,
  files,
  recordings,
  // The game's results folder; the parity gate points it at a fixture.
  resultsFolder = undefined,
}) {
  const root = dirname(captureDir);
  const span = spanOfLive(files);
  const first = files[0].info;
  const extract = captureExtract({
    damage: damageFor(root, span),
    raceLength:
      first.sim === 'lmu' && /^r/i.test(first.sessionType ?? '')
        ? raceLengthFor(root, span)
        : null,
    online: first.sim === 'lmu' ? onlineFor(root, span) : null,
  });
  // The game's rulings: its results file exists once the session has ended, so
  // a lap during the drive finds none and the run at the close finds it.
  const results =
    first.sim === 'lmu'
      ? resultsInput(
          resultsForSpan(span, first.driver, first.sessionType, resultsFolder),
        )
      : null;
  if (first.sim !== 'lmu')
    return {
      field: null,
      fieldText: null,
      fieldReason: 'iRacing: from the game file',
      extract,
      resultsInput: results,
    };
  const lite = recordings.map(r => liteOf(r.samplePaths)).filter(Boolean);
  if (lite.length === 0)
    return {
      field: null,
      fieldText: null,
      fieldReason: 'no samples',
      extract,
      resultsInput: results,
    };
  const out = fieldFor(root, span, lite);
  if (!out.field)
    return {
      field: null,
      fieldText: null,
      fieldReason: out.reason,
      extract,
      resultsInput: results,
    };
  // Named by its content, as analyzeFromArchive.mjs does (pitlane #680).
  const fieldText = JSON.stringify(out.field);
  const hash = createHash('sha1').update(fieldText).digest('hex').slice(0, 12);
  return {
    field: {
      path: `field/${ownerId}/${sessionId}/${hash}.json.gz`,
      hash,
      ...out.meta,
    },
    fieldText,
    fieldReason: null,
    extract,
    resultsInput: results,
  };
}
