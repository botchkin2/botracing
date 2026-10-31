// A store backend in memory (store.mjs's primitives), for running the real
// upload and analysis code with no Firestore or bucket: the parity gate.
import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';

import {
  TRACK_DATA,
  isTheirs,
  namesOwner,
} from '../../functions/src/contract/ownership.ts';

// The API's answer, as storeClient's HttpError words it.
const refused = text => {
  throw new Error(`POST /docs/write: 403 {"error":"${text}"}`);
};

/**
 * Refuses a request as the upload API does (functions/src/uploadCore.ts
 * writeDocs, the shared rule in functions/src/contract/ownership.ts): any op
 * refused, nothing written. docs: path -> doc.
 */
export function refuseAsApi(ops, docs, ownerKey) {
  for (const o of ops) {
    if (TRACK_DATA.includes(o.coll))
      refused('track data is curated, not uploaded');
    if (isTheirs(docs.get(`${o.coll}/${o.id}`) ?? null, ownerKey, o.coll))
      refused('document belongs to another owner');
    if (o.op !== 'delete' && !namesOwner(o.coll, o.data ?? {}, ownerKey))
      refused('document ownerId is not yours');
  }
}

/** ownerKey: the signed-in user's, as the API knows it (GET /me). */
export function memoryStore(seed = {}, {ownerKey}) {
  const docs = new Map(Object.entries(seed));
  const files = new Map();
  const key = (coll, id) => `${coll}/${id}`;
  // As the upload API stores a client's archive/{sim}/... name
  // (uploadCore.ts filePath, clientName): under the owner's folder. Analysis
  // reads an archive only there (analyzeStored.mjs archivePath).
  const stored = dest =>
    /^archive\/(lmu|iracing)\//.test(dest)
      ? `archive/${ownerKey}/${dest.slice('archive/'.length)}`
      : dest;
  const clientName = name =>
    name.startsWith(`archive/${ownerKey}/`)
      ? `archive/${name.slice(`archive/${ownerKey}/`.length)}`
      : name;
  return {
    docs,
    files,
    async getDoc(coll, id) {
      const d = docs.get(key(coll, id));
      return d ? structuredClone(d) : null;
    },
    async writeDocs(ops) {
      refuseAsApi(ops, docs, ownerKey);
      for (const o of ops) {
        const k = key(o.coll, o.id);
        if (o.op === 'delete') docs.delete(k);
        else
          docs.set(
            k,
            structuredClone(
              o.merge ? {...(docs.get(k) ?? {}), ...o.data} : o.data,
            ),
          );
      }
    },
    async updateDocs(ops) {
      const failed = [];
      for (const o of ops) {
        const k = key(o.coll, o.id);
        if (isTheirs(docs.get(k) ?? null, ownerKey, o.coll))
          refused('document belongs to another owner');
        if (!docs.has(k)) failed.push(`${k}: missing`);
        else docs.set(k, {...docs.get(k), ...structuredClone(o.data)});
      }
      return failed;
    },
    async sessionLapIds(sessionId) {
      return [...docs]
        .filter(
          ([k, d]) =>
            k.startsWith('laps/') &&
            d.sessionId === sessionId &&
            !d.supersededBy,
        )
        .map(([k]) => k.slice(5));
    },
    async fileMd5(dest) {
      const b = files.get(stored(dest));
      return b ? createHash('md5').update(b).digest('base64') : null;
    },
    async putFile(dest, source, {gzip} = {}) {
      const bytes = source.localPath
        ? readFileSync(source.localPath)
        : Buffer.from(source.body);
      files.set(
        stored(dest),
        gzip && !source.localPath ? gzipSync(bytes) : bytes,
      );
    },
    async getFile(dest) {
      return files.get(stored(dest)) ?? null;
    },
    async deleteFile(dest) {
      files.delete(stored(dest));
    },
    async listFiles(prefix) {
      return [...files.keys()]
        .filter(k => k.startsWith(stored(prefix)))
        .map(clientName);
    },
  };
}

/** The session doc and its lap docs (by lap number) as a backend holds them. */
export function sessionOf(store, sessionId) {
  const session = store.docs.get(`sessions/${sessionId}`) ?? null;
  const laps = [...store.docs]
    .filter(([k, d]) => k.startsWith('laps/') && d.sessionId === sessionId)
    .map(([, d]) => d)
    .sort((a, b) => a.lapNumber - b.lapNumber);
  return {session, laps};
}
