// Where the audit's sessions come from besides the live API (allSessions.ts):
//   AUDIT_NDJSON  a dump: dumpSessions.test.ts (adapted) or adminDump.cjs (raw docs)
//   AUDIT_LOCAL   a `node tools/sessions/sync.mjs --local --work <dir>` folder: the
//                 stored docs of every local recording, analysed by this tree's code
// Both yield what walkSessions yields, so the same checks run on any of them.
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';

import {
  toLaps,
  toSessionDetail,
  toTrackMap,
  type Lap,
  type SessionDetail,
  type TrackMapData,
} from '@/src/data/sessions/adapters';

export type LoadedSession = {
  session: SessionDetail;
  laps: Lap[];
  map: TrackMapData | null;
};

type Doc = Record<string, unknown>;

const readJson = (file: string): unknown =>
  JSON.parse(readFileSync(file, 'utf8'));

function adaptRaw(raw: Doc, laps: unknown[], map: Doc | null): LoadedSession {
  return {
    session: toSessionDetail(raw as Doc & {id: string}),
    laps: toLaps(laps as Doc[]),
    map: map ? toTrackMap(map) : null,
  };
}

export function* fromNdjson(file: string): Generator<LoadedSession> {
  for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(line);
    if (row.rawSession)
      yield adaptRaw(row.rawSession, row.rawLaps ?? [], row.rawMap ?? null);
    else yield {session: row.session, laps: row.laps, map: row.map ?? null};
  }
}

export function* fromLocalWork(dir: string): Generator<LoadedSession> {
  const out = join(dir, 'out');
  for (const id of readdirSync(out)) {
    const sessionFile = join(out, id, 'session.json');
    const lapsFile = join(out, id, 'laps.json');
    if (!existsSync(sessionFile) || !existsSync(lapsFile)) continue;
    const session = readJson(sessionFile) as Doc;
    const lapsDoc = readJson(lapsFile);
    const laps = Array.isArray(lapsDoc)
      ? lapsDoc
      : Object.values(lapsDoc as Doc);
    const mapFile = join(dir, 'tracks', `${String(session.trackId)}.json`);
    yield adaptRaw(
      session,
      laps,
      existsSync(mapFile) ? (readJson(mapFile) as Doc) : null,
    );
  }
}
