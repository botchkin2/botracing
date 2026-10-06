// A small but complete owner for the copy tests: two sessions on one track,
// with the documents and the bucket files sync.mjs would have written, and an
// in-memory backend for ownerCopyRun.mjs.
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {recordingId, sessionId, sliceHash} from './ownerCopy.mjs';

const CACHE = 'private, max-age=31536000';
export const TRACE_META = {
  contentType: 'text/csv',
  contentEncoding: 'gzip',
  cacheControl: CACHE,
};
export const JSON_META = {
  contentType: 'application/json',
  contentEncoding: 'gzip',
  cacheControl: CACHE,
};
export const PARQUET_META = {
  contentType: 'application/vnd.apache.parquet',
  contentEncoding: null,
  cacheControl: CACHE,
};

const gz = text => gzipSync(Buffer.from(text, 'utf8'), {level: 9});

/** Documents and files of `owner`, as {docs: Map(path -> data), files: Map(path -> {bytes, meta})}. */
export function ownerData(owner) {
  const docs = new Map();
  const files = new Map();
  const put = (path, bytes, meta) => files.set(path, {bytes, meta});
  const trackId = 'lmu-road-atlanta';
  const sessionIds = [];

  for (const [k, startDay] of [
    [0, '20'],
    [1, '23'],
  ]) {
    const recs = ['a', 'b'].map((n, i) => {
      const base = {
        sim: 'lmu',
        source: `Road Atlanta_P_${k}${n}.duckdb`,
        recordedAt: `2026-09-${startDay}T0${i}:00:00.000Z`,
        layout: 'Road Atlanta',
        car: k === 0 ? 'Porsche 911 GT3 R' : 'Ferrari 296 GT3',
        sessionType: 'practice',
      };
      return {
        ...base,
        id: recordingId(owner, base),
        ownerId: owner,
        event: {series: 'Botkin Cup', eventId: `e${k}`},
      };
    });
    const sid = sessionId(owner, recs[0]);
    sessionIds.push(sid);
    for (const r of recs) {
      r.sessionId = sid;
      const prefix = `archive/${
        owner === 'botkin' ? '' : `${owner}/`
      }lmu/${sid}/${r.id}`;
      r.archive = {
        samples: `${prefix}/samples.parquet`,
        events: `${prefix}/events.parquet`,
        bytes: 8,
      };
      put(r.archive.samples, Buffer.from(`samples-${r.source}`), PARQUET_META);
      put(r.archive.events, Buffer.from(`events-${r.source}`), PARQUET_META);
      docs.set(`recordings/${r.id}`, r);
    }
    const laps = recs.flatMap(r =>
      [1, 2, 3].map(n => {
        const id = `${r.id}-${String(n).padStart(3, '0')}`;
        const lap = {
          id,
          ownerId: owner,
          sessionId: sid,
          recordingId: r.id,
          trackId,
          lapNumber: n,
          lapTime: 90 + n,
          trace: {path: `traces/${owner}/${id}/v2.csv.gz`, rows: 3},
        };
        put(lap.trace.path, gz(`a,b\n${n},2\n`), TRACE_META);
        docs.set(`laps/${id}`, lap);
        return lap;
      }),
    );
    // The corner files: laps listed by id, folder named by content.
    const texts = [1, 2].map(n =>
      JSON.stringify({
        v: 1,
        corner: n,
        laps: laps.map(l => ({id: l.id, x: [n, 1]})),
      }),
    );
    const hash = sliceHash(texts);
    const prefix = `slices/${owner}/${sid}/${hash}`;
    texts.forEach((t, i) =>
      put(`${prefix}/c${i + 1}.json.gz`, gz(t), JSON_META),
    );
    const fieldText = JSON.stringify({cars: [{n: 1}], title: 'Botkin Cup'});
    const fieldHash = createHash('sha1')
      .update(fieldText)
      .digest('hex')
      .slice(0, 12);
    const session = {
      id: sid,
      ownerId: owner,
      trackId,
      track: {name: 'Road Atlanta', variant: 'Road Atlanta'},
      car: {name: recs[0].car},
      startedAt: recs[0].recordedAt,
      recordingIds: recs.map(r => r.id),
      bestLapId: laps[1].id,
      series: 'Botkin Cup',
      consistency: {stints: [{n: 1, lapIds: laps.map(l => l.id)}]},
      lapTable: laps.map(l => ({id: l.id, lapNumber: l.lapNumber})),
      band: {path: `bands/${owner}/${sid}/v1.json.gz`, laps: laps.length},
      field: {
        path: `field/${owner}/${sid}/${fieldHash}.json.gz`,
        hash: fieldHash,
      },
      slices: {format: 1, hash, prefix, corners: [1, 2]},
    };
    put(session.band.path, gz('{"stepM":5}'), JSON_META);
    put(session.field.path, gz(fieldText), JSON_META);
    docs.set(`sessions/${sid}`, session);
  }

  // The shared track documents and files (the legacy owner's), when owner is it.
  if (owner === 'botkin') {
    docs.set(`tracks/${trackId}`, {
      id: trackId,
      ownerId: owner,
      name: 'Road Atlanta',
      source: {sessionId: sessionIds[0], builtAt: '2026-09-20T00:00:00Z'},
      surface: {path: `surface/${trackId}/v1.json.gz`, sessions: 2},
      outline: {path: `outline/${trackId}.json`},
    });
    docs.set(`trackBoundaries/${trackId}`, {
      v: 2,
      rev: 1,
      sessions: Object.fromEntries(sessionIds.map(id => [id, [{laps: 3}]])),
    });
    put(
      `surface/${trackId}/v1.json.gz`,
      gz(JSON.stringify({bins: [1, 2], sessions: sessionIds})),
      JSON_META,
    );
    put(`outline/${trackId}.json`, Buffer.from('{"points":[1,2,3]}'), {
      contentType: 'application/json',
      contentEncoding: null,
      cacheControl: CACHE,
    });
  }
  return {docs, files, sessionIds, trackId};
}

const md5 = bytes => createHash('md5').update(bytes).digest('base64');

/**
 * A backend over maps. It has no delete of any kind. `failAfter(n)` makes the
 * n+1th write throw, to test a run that is cut short.
 */
export function memoryBackend({docs, files}) {
  let writes = 0;
  let limit = Infinity;
  const log = [];
  const guard = what => {
    if (writes >= limit) throw new Error(`interrupted before ${what}`);
    writes++;
    log.push(what);
  };
  const backend = {
    docs,
    files,
    log,
    failAfter(n) {
      limit = writes + n;
    },
    noLimit() {
      limit = Infinity;
    },
    get writes() {
      return writes;
    },
    async listDocs(coll, ownerId) {
      return [...docs]
        .filter(
          ([path, data]) =>
            path.startsWith(`${coll}/`) && data.ownerId === ownerId,
        )
        .map(([path, data]) => ({
          id: path.slice(coll.length + 1),
          data: structuredClone(data),
        }));
    },
    async getDoc(path) {
      return docs.has(path) ? structuredClone(docs.get(path)) : null;
    },
    async setDoc(path, data) {
      guard(`doc ${path}`);
      docs.set(path, structuredClone(data));
    },
    async statFile(path) {
      const f = files.get(path);
      return f ? {size: f.bytes.length, md5: md5(f.bytes), ...f.meta} : null;
    },
    async readFile(path) {
      const f = files.get(path);
      return f ? {bytes: Buffer.from(f.bytes), meta: {...f.meta}} : null;
    },
    async writeFile(path, bytes, meta) {
      guard(`file ${path}`);
      files.set(path, {bytes: Buffer.from(bytes), meta: {...meta}});
    },
    async copyFile(from, to) {
      guard(`file ${to}`);
      const f = files.get(from);
      if (!f) throw new Error(`${from} does not exist`);
      files.set(to, {bytes: Buffer.from(f.bytes), meta: {...f.meta}});
    },
  };
  return backend;
}

/** A copy of the maps, to compare before and after. */
export const snapshot = ({docs, files}) => ({
  docs: new Map([...docs].map(([k, v]) => [k, structuredClone(v)])),
  files: new Map(
    [...files].map(([k, v]) => [
      k,
      {bytes: Buffer.from(v.bytes), meta: {...v.meta}},
    ]),
  ),
});
