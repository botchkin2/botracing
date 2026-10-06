// The store for a machine with no Admin credentials: the primitives of
// store.mjs (see the backend list there) over HTTP, to the upload function.
//
// Wire format, all under LAP_API (default https://botracing-61.web.app/api/upload):
//   every request carries `Authorization: Bearer <Firebase ID token>`. The
//   server takes the user only from that token and builds every path itself.
//   GET    /me                      -> {ownerKey}   the key this user's data lives under
//   GET    /doc/{coll}/{id}         -> the document, 404 when absent
//   POST   /docs/write              {ops}           -> 204; the same ops as writeDocs
//   POST   /docs/update             {ops}           -> {failed: string[]}
//   GET    /laps?sessionId=         -> {ids: string[]}
//   GET    /file/md5?dest=          -> {md5: base64 | null}
//   POST   /file/upload-url         {dest, contentType, gzip, size} -> {url, headers}
//                                   a short-lived signed Storage URL for the path the
//                                   server builds from dest; the client then PUTs the
//                                   bytes there (gzipped by the client when gzip), with
//                                   those headers and no bearer token. Function
//                                   requests cap at 32 MB; a parquet can be more.
//   GET    /file?dest=              the stored bytes, 404 when absent
//   DELETE /file?dest=              -> 204
//   GET    /files?prefix=           -> {names: string[]}
// A 5xx or a dropped connection is retried (netRetry.mjs); a 4xx is not.
import {readFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {Buffer} from 'node:buffer';
import {guardedWriter} from './docShape.mjs';
import {createStore} from './store.mjs';
import {withNetRetry} from './netRetry.mjs';

export const defaultApi = 'https://botracing-61.web.app/api/upload';

class HttpError extends Error {
  constructor(status, method, path, text) {
    super(`${method} ${path}: ${status} ${text.slice(0, 200)}`);
    this.status = status;
    // netRetry.mjs retries only what carries a network error code, so a
    // server fault is given one.
    this.code = status >= 500 ? 'ECONNRESET' : undefined;
  }
}

// token: () => string | Promise<string>, called per request so a refreshed
// token is picked up. fetch is injectable for tests.
export function httpBackend({
  api = defaultApi,
  token,
  fetch = globalThis.fetch,
}) {
  const call = async (method, path, {query, json, body, headers} = {}) => {
    const url = new URL(`${api}${path}`);
    for (const [k, v] of Object.entries(query ?? {}))
      url.searchParams.set(k, v);
    return withNetRetry(async () => {
      const res = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${await token()}`,
          ...(json === undefined ? {} : {'content-type': 'application/json'}),
          ...headers,
        },
        body: json === undefined ? body : JSON.stringify(json),
      });
      if (res.status === 404 && method === 'GET') return null;
      if (!res.ok)
        throw new HttpError(res.status, method, path, await res.text());
      return res;
    });
  };
  const jsonOf = async (path, options) => {
    const res = await call('GET', path, options);
    return res ? res.json() : null;
  };
  return {
    me: () => jsonOf('/me'),
    getDoc: (coll, id) =>
      jsonOf(`/doc/${encodeURIComponent(coll)}/${encodeURIComponent(id)}`),
    async writeDocs(ops) {
      // The same shape check as the Admin path, before anything is sent.
      const writer = guardedWriter({
        set() {},
        delete() {},
        close: async () => {},
      });
      for (const {op, coll, id, data} of ops) {
        if (op === 'delete') writer.delete({path: `${coll}/${id}`});
        else writer.set({path: `${coll}/${id}`}, data);
      }
      await writer.close();
      await call('POST', '/docs/write', {json: {ops}});
    },
    async updateDocs(ops) {
      const res = await call('POST', '/docs/update', {json: {ops}});
      return (await res.json()).failed;
    },
    async sessionLapIds(sessionId) {
      return (await jsonOf('/laps', {query: {sessionId}})).ids;
    },
    async fileMd5(dest) {
      return (await jsonOf('/file/md5', {query: {dest}})).md5;
    },
    async putFile(dest, source, {contentType, gzip}) {
      const raw = source.localPath
        ? readFileSync(source.localPath)
        : source.body;
      const body = gzip ? gzipSync(raw, {level: 9}) : raw;
      const res = await call('POST', '/file/upload-url', {
        json: {dest, contentType, gzip: !!gzip, size: body.length},
      });
      const {url, headers} = await res.json();
      // The signed URL carries its own authority: no bearer token.
      await withNetRetry(async () => {
        const put = await fetch(url, {method: 'PUT', headers, body});
        if (!put.ok)
          throw new HttpError(
            put.status,
            'PUT',
            'signed url',
            await put.text(),
          );
      });
    },
    async getFile(dest) {
      const res = await call('GET', '/file', {query: {dest}});
      return res ? Buffer.from(await res.arrayBuffer()) : null;
    },
    async deleteFile(dest) {
      await call('DELETE', '/file', {query: {dest}});
    },
    async listFiles(prefix) {
      return (await jsonOf('/files', {query: {prefix}})).names;
    },
  };
}

// The user id inside a Firebase ID token. Not verified here (the server does
// that); only to catch a sync run for a different user than the token's.
export function uidOfToken(idToken) {
  const payload = idToken.split('.')[1];
  if (!payload) throw new Error('not an ID token');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  const uid = claims.user_id ?? claims.sub;
  if (!uid) throw new Error('the ID token has no user id');
  return uid;
}

export function httpStore(options) {
  const backend = httpBackend(options);
  return {...createStore(backend), me: backend.me};
}
