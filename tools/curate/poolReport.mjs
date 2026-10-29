// What a pooled add (`plan-add --pool`) read, in the dry run's own words: how
// many laps each session gave the map, and which iRacing TrackVersions they
// came from. A track rescan under one TrackID can move a kerb, so a version
// whose laps are a different length from the rest is named before any apply
// (pit wall thread 125 #8388).
import {openIbt, yamlField} from '../sessions/ibt.mjs';

// A version whose median lap is more than this fraction of the main version's
// median away is named. 0.1% (4 m on a 4 km lap) is the curator's pick, well
// inside the plan's own 1% lap-length check, so a moved kerb shows up here first.
const VERSION_GAP_FRACTION = 0.001;

/** The iRacing TrackVersion of one .ibt ('' when the file does not say). */
export function trackVersionOf(path) {
  const ibt = openIbt(path);
  try {
    return yamlField(ibt.yaml, 'TrackVersion');
  } finally {
    ibt.close();
  }
}

export function median(values) {
  const v = [...values].sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * Lines for a dry run. `perSession` is [{id, laps, lapLengthsM, versions}]:
 * the laps the map was built from, their lengths, and the TrackVersions of the
 * session's files (empty for a sim that has none).
 */
export function poolLines(perSession) {
  const lines = [];
  for (const s of perSession)
    lines.push(
      `  ${s.id}: ${s.laps} lap(s) used${
        s.versions.length ? `, TrackVersion ${s.versions.join(' + ')}` : ''
      }`,
    );
  const total = perSession.reduce((n, s) => n + s.laps, 0);
  lines.push(`  ${total} lap(s) from ${perSession.length} session(s)`);

  for (const s of perSession)
    if (s.versions.length > 1)
      lines.push(
        `warning: session ${s.id} spans TrackVersions ${s.versions.join(', ')}`,
      );

  const byVersion = new Map();
  for (const s of perSession) {
    if (s.versions.length !== 1) continue;
    const key = s.versions[0];
    byVersion.set(key, [...(byVersion.get(key) ?? []), ...s.lapLengthsM]);
  }
  let main = null;
  for (const [version, lengths] of byVersion)
    if (main === null || lengths.length > byVersion.get(main).length)
      main = version;
  const mainMedian = main === null ? null : median(byVersion.get(main));
  for (const [version, lengths] of byVersion) {
    const m = median(lengths);
    lines.push(
      `  TrackVersion ${version}: ${lengths.length} lap(s), median ${m.toFixed(
        1,
      )} m`,
    );
    if (
      version !== main &&
      Math.abs(m - mainMedian) > mainMedian * VERSION_GAP_FRACTION
    )
      lines.push(
        `warning: TrackVersion ${version} laps are ${Math.abs(
          m - mainMedian,
        ).toFixed(1)} m ${
          m < mainMedian ? 'shorter' : 'longer'
        } than TrackVersion ${main}'s (${mainMedian.toFixed(
          1,
        )} m), the one with most laps: the track may have been rescanned between versions`,
      );
  }
  return lines;
}
