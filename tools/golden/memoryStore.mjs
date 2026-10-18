// A store backend in memory (store.mjs's primitives), for running the real
// upload and analysis code with no Firestore or bucket: the parity gate.
import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';

// The upload API's ownership rule (functions/src/uploadCore.ts writeDocs): a
// set on an owned collection, a merge included, names its owner, and never
// another owner's document. The whole request is refused before any write.
const OWNED = ['recordings', 'sessions', 'laps'];

/** Throws as the API answers when any op breaks the rule; docs: path -> doc. */
export function refuseUnowned(ops, docs) {
  for (const o of ops) {
    if (o.op === 'delete' || !OWNED.includes(o.coll)) continue;
    const existing = docs.get(`${o.coll}/${o.id}`);
    if (!o.data?.ownerId || (existing && existing.ownerId !== o.data.ownerId))
      throw new Error(
        `POST /docs/write: 403 document ownerId is not yours (${o.coll}/${o.id})`,
      );
  }
}

export function memoryStore(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const files = new Map();
  const key = (coll, id) => `${coll}/${id}`;
  return {
    docs,
    files,
    async getDoc(coll, id) {
      const d = docs.get(key(coll, id));
      return d ? structuredClone(d) : null;
    },
    async writeDocs(ops) {
      refuseUnowned(ops, docs);
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
      const b = files.get(dest);
      return b ? createHash('md5').update(b).digest('base64') : null;
    },
    async putFile(dest, source, {gzip} = {}) {
      const bytes = source.localPath
        ? readFileSync(source.localPath)
        : Buffer.from(source.body);
      files.set(dest, gzip && !source.localPath ? gzipSync(bytes) : bytes);
    },
    async getFile(dest) {
      return files.get(dest) ?? null;
    },
    async deleteFile(dest) {
      files.delete(dest);
    },
    async listFiles(prefix) {
      return [...files.keys()].filter(k => k.startsWith(prefix));
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
