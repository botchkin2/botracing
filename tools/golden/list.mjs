// Lists local sessions as the golden manifest names them: sim, the first
// recording's start time, type and the car. `node tools/golden/list.mjs lmu --since 2026-10-01`
import {findSessions} from '../curate/loader.mjs';
import {adapter, telemetryFolder} from '../sessions/sims.mjs';

const [sim = 'lmu', ...rest] = process.argv.slice(2);
const since = rest[rest.indexOf('--since') + 1] ?? '';
const a = adapter(sim);
const sessions = findSessions({adapter: a, folder: telemetryFolder(sim), ownerId: 'golden', log: () => {}});
for (const s of sessions) {
  const i = s.files[0].info;
  if (since && i.recordedAt < since) continue;
  console.log([i.recordedAt, i.sessionType, i.track, i.car, `${s.files.length} file(s)`].join(' | '));
}
