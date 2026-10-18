// Road Atlanta through both lap sources. Not part of `node --test tools/curate`:
// it reads the local iRacing folder. Run:
//   node --test tools/curate/buildFromLaps.golden.mjs
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {analyzeSession, loadRecording} from '../sessions/analyze.mjs';
import {adapter as simAdapter, telemetryFolder} from '../sessions/sims.mjs';
import {buildFromLaps, buildFromSession, findSessions} from './loader.mjs';

const LAYOUT = '127-full_course';

test('Road Atlanta iRacing: buildFromSession and buildFromLaps match', t => {
  const settings = join(
    process.env.LOCALAPPDATA ?? '',
    'BotRacing',
    'settings.json',
  );
  let folder = '';
  try {
    folder = telemetryFolder('iracing', process.env);
  } catch {
    folder = '';
  }
  if (!folder || !existsSync(folder) || !existsSync(settings)) {
    t.skip('no local iRacing telemetry or BotRacing settings');
    return;
  }
  const ownerId = JSON.parse(readFileSync(settings, 'utf8')).confirmedUid;
  const adapter = simAdapter('iracing');
  const sessions = findSessions({
    adapter,
    folder,
    ownerId,
    log() {},
  }).filter(s => s.files[0].info.layout === LAYOUT);
  assert.ok(sessions.length > 0, `no local session on ${LAYOUT}`);
  const session = sessions.reduce((a, b) => (bytes(b) > bytes(a) ? b : a));
  const workDir = mkdtempSync(join(tmpdir(), 'map-laps-'));
  try {
    const fromSession = buildFromSession({adapter, session, workDir});
    const recs = session.files.map(f =>
      loadRecording(
        f.info,
        join(workDir, session.id, `${f.id}.samples.parquet`),
        join(workDir, session.id, `${f.id}.events.parquet`),
      ),
    );
    const first = session.files[0].info;
    const analyzed = analyzeSession(recs, {
      sessionId: session.id,
      sessionType: first.sessionType,
    });
    const mapIds = new Set(analyzed.trackMapLapIds ?? []);
    const boundIds = new Set(analyzed.boundaryLapIds ?? []);
    const laps = analyzed.laps.map((lap, i) => {
      const id = String(i);
      return {
        ...lap,
        comparable: mapIds.has(id) || boundIds.has(id),
        clean: boundIds.has(id),
      };
    });
    const fromLaps = buildFromLaps({
      laps,
      sim: first.sim,
      track: {name: first.track, variant: first.layout},
      sessions: [{id: session.id, laps}],
    });
    assert.equal(fromLaps.gps, fromSession.gps);
    assert.equal(fromLaps.lapsUsed, fromSession.lapsUsed);
    assert.deepEqual(fromLaps.map, fromSession.map);
    assert.deepEqual(fromLaps.boundaries, fromSession.boundaries);
  } finally {
    rmSync(workDir, {recursive: true, force: true});
  }
});

function bytes(session) {
  return session.files.reduce((n, f) => n + statSync(f.path).size, 0);
}
