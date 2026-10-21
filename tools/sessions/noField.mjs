// Sessions this PC uploaded without a field, for the heartbeat's Problems list
// (pit wall thread 95: the Sebring practice had none and nothing said so).
// The work folder's noField.json: {sessionId: {endMs, why}}. A session that
// has a field leaves it. Only a drive from the last NO_FIELD_DAYS shows: older
// sessions never had a capture, which is expected, not a fault.
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {replaceFile} from './replaceFile.mjs';

export const NO_FIELD_DAYS = 14;
const FILE = 'noField.json';

export function readNoField(work) {
  const path = resolve(work, FILE);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

// `session`: the stored doc's id, endedAt and fieldMissing (null with a field).
export function noteNoField(work, session, nowMs) {
  const map = readNoField(work);
  const endMs = Date.parse(session.endedAt);
  const keep = nowMs - NO_FIELD_DAYS * 86400 * 1000;
  for (const [id, e] of Object.entries(map)) if (e.endMs < keep) delete map[id];
  if (session.fieldMissing && endMs >= keep)
    map[session.id] = {endMs, why: session.fieldMissing};
  else delete map[session.id];
  replaceFile(resolve(work, FILE), JSON.stringify(map));
}
