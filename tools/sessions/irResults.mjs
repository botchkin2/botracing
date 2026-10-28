// Every car's best qualifying lap in an iRacing session, as the same results input the LMU results file makes
// (resultsInput.mjs v2 `drivers`), so one reader folds both into the session's `classPace` (src/analysis/classPace.ts;
// pit-wall thread 123, ticket 61 item 4). The source is the .ibt's session-info YAML: its `Sessions[]` carry the results
// of the weekend's earlier sessions, and the QUALIFY one holds every car's FastestTime. A race file's own results are only
// a snapshot near its start (21-08-42: 5 laps of 34), so they are not read; a qualifying result is the one complete
// answer the file has about the other cars.
//
// A driver is {player, cls, car, pos, laps: [{t: fastest}]}: one lap, so classPace quotes the best and no median. There is
// no `overall` and no `status`: a qualifying place is not a finish, and `finishOf` reads the race's result only from a
// driver who has them. No names and no car numbers leave this file: the YAML's UserName and TeamName are never read.
import {carClasses, driversOfYaml} from './irClasses.mjs';
import {IBT_QUALIFYING_SOURCE} from './resultsInput.mjs';

const QUALIFY = /qualify/i;

/** The session blocks of the YAML's SessionInfo, each as its text. */
function sessionBlocks(yaml) {
  const at = (yaml ?? '').indexOf('SessionInfo:');
  if (at < 0) return [];
  const section = yaml.slice(at).split(/\n(?=\S)/)[0];
  return section.split(/\n\s*- SessionNum:/).slice(1);
}

/** One block's results rows: [{carIdx, classPosition, fastestS}], fastestS null for a car with no timed lap. */
function resultRows(block) {
  const results = block.split(/\n\s*ResultsPositions:[ \t]*\n/)[1];
  if (!results) return [];
  // the rows end where the session's next key (ResultsOfficial, ResultsFastestLap...) starts, one indent level out
  const list = results.split(/\n(?=\s{0,3}[A-Za-z])/)[0];
  const rows = [];
  // the first row has no newline before it: the text after ResultsPositions: starts on it
  for (const row of ('\n' + list).split(/\n\s*- Position:/).slice(1)) {
    const pick = key => {
      const m = row.match(new RegExp(`\\n\\s*${key}:[ \\t]*(-?[\\d.]+)`));
      return m ? Number(m[1]) : null;
    };
    const carIdx = pick('CarIdx');
    const fastest = pick('FastestTime');
    if (carIdx == null) continue;
    rows.push({
      carIdx,
      classPosition: pick('ClassPosition'),
      fastestS: fastest != null && fastest > 0 ? fastest : null,
    });
  }
  return rows;
}

/** The player's car index in the YAML (DriverInfo.DriverCarIdx), or null. */
function playerCarIdx(yaml) {
  const m = (yaml ?? '').match(/DriverCarIdx:[ \t]*(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * The results input for an iRacing session from its .ibt's YAML, or null when the file holds no qualifying result with
 * a timed lap (a practice-only drive, an offline session that skipped qualifying).
 */
export function iracingResultsInput(yaml) {
  const sessions = sessionBlocks(yaml)
    .filter(b =>
      QUALIFY.test((b.match(/SessionType:[ \t]*(.*)/) ?? [])[1] ?? ''),
    )
    .map(resultRows)
    .filter(rows => rows.some(r => r.fastestS != null));
  // The weekend's last qualifying session with a timed lap is its grid.
  const rows = sessions[sessions.length - 1];
  if (!rows) return null;
  const cars = driversOfYaml(yaml);
  const classes = carClasses([], cars);
  const me = playerCarIdx(yaml);
  const drivers = [];
  for (const r of rows) {
    const car = cars.find(c => c.carIdx === r.carIdx);
    if (!car || r.fastestS == null) continue;
    drivers.push({
      player: r.carIdx === me,
      cls: classes.get(r.carIdx)?.classLabel ?? '',
      car: car.carName,
      pos: r.classPosition == null ? null : r.classPosition + 1,
      laps: [{t: r.fastestS, s1: null, s2: null, s3: null, pit: false}],
    });
  }
  if (drivers.length === 0) return null;
  return {
    v: 2,
    source: IBT_QUALIFYING_SOURCE,
    strikes: [],
    unplaced: 0,
    coveredFrom: null,
    coveredTo: null,
    drivers,
  };
}
