// The upload API over an in-memory Firestore and bucket, shared by the
// upload and heartbeat tests.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {handleUpload} from '../src/uploadCore.ts';

// In-memory Firestore and bucket, behind the interfaces uploadApi.ts binds to
// Firebase. users/{uid} holds the owner-key mapping and the usage counters.
export function world(
  tokens = {'tok-a': 'uidA', 'tok-b': 'uidB', 'tok-k': 'uidK'},
) {
  const docs = new Map([['users/uidK', {ownerKey: 'botkin'}]]);
  const files = new Map();
  const usage = new Map();
  const signed = new Map();
  const deps = {
    verifyToken: async t => {
      if (!tokens[t]) throw new Error('bad');
      return {uid: tokens[t]};
    },
    docs: {
      get: async p => docs.get(p) ?? null,
      lapIds: async (_c, sessionId, ownerKey) =>
        [...docs]
          .filter(
            ([p, d]) =>
              p.startsWith('laps/') &&
              d.sessionId === sessionId &&
              d.ownerId === ownerKey,
          )
          .map(([p]) => p.slice(5)),
      commit: async writes => {
        for (const w of writes) {
          if (w.op === 'delete') docs.delete(w.path);
          else if (w.op === 'update') {
            assert.ok(docs.has(w.path), 'update of a missing doc');
            docs.set(w.path, {...docs.get(w.path), ...w.data});
          } else
            docs.set(
              w.path,
              w.merge ? {...(docs.get(w.path) ?? {}), ...w.data} : w.data,
            );
        }
      },
      addUsage: async (uid, d) => {
        const u = usage.get(uid) ?? {
          docs: 0,
          docBytes: 0,
          files: 0,
          fileBytes: 0,
          heartbeats: 0,
        };
        for (const k of Object.keys(u)) u[k] += d[k] ?? 0;
        usage.set(uid, u);
      },
    },
    files: {
      stat: async p =>
        files.has(p)
          ? {
              md5Hash: createHash('md5')
                .update(files.get(p).bytes)
                .digest('base64'),
              size: files.get(p).bytes.length,
            }
          : null,
      // What Storage would do with the signed URL; the test's put() below plays
      // the client's PUT against it.
      signedUpload: async (p, opts) => {
        signed.set(`fake://${p}`, {path: p, ...opts});
        // As uploadApi.ts answers in production: a PUT to Storage.
        return {
          method: 'PUT',
          url: `fake://${p}`,
          headers: {
            'Content-Type': opts.contentType,
            'x-goog-content-length-range': `0,${opts.maxBytes}`,
          },
        };
      },
      read: async p => files.get(p)?.bytes ?? null,
      remove: async p => files.delete(p),
      list: async prefix => [...files.keys()].filter(k => k.startsWith(prefix)),
    },
  };
  return {deps, docs, files, usage, signed};
}

export const call = (w, token, method, path, rest = {}) =>
  handleUpload(w.deps, {
    method,
    path,
    query: {},
    authorization: token ? `Bearer ${token}` : undefined,
    ...rest,
  });
