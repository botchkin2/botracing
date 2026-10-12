// How GET /laps/{id}/csv answers (pit-wall thread 1 #4568, #4583). A trace is
// stored gzip-encoded, 64 KB against 403 KB of text, and the route used to
// gunzip it and send the text: 8 MB to open Compare on 20 laps. It now sends
// the stored bytes with Content-Encoding: gzip, like the field and band routes.
// The path of a trace does not change when it is rewritten (a new analysis
// writes the same traces/{owner}/{lapId}/v2.csv.gz), so it is not immutable:
// it carries the stored object's md5 as an ETag and revalidates, and an
// unchanged lap costs a 304 and no download.
// Plain TypeScript with erasable syntax only, so the route's rules are tested
// without Firebase.

export interface TraceMeta {
  /** The stored object's md5 (base64), as Cloud Storage reports it. */
  md5Hash?: string;
  contentEncoding?: string;
}

export type TraceDelivery = {
  etag: string | null;
  send: 'not-modified' | 'gzip' | 'text';
};

export const traceEtag = (md5Hash: string | undefined): string | null =>
  md5Hash ? `"t-${md5Hash}"` : null;

/** What to send for a stored trace, given the client's If-None-Match. */
export function traceDelivery(
  meta: TraceMeta,
  ifNoneMatch: unknown,
): TraceDelivery {
  const etag = traceEtag(meta.md5Hash);
  if (etag && typeof ifNoneMatch === 'string') {
    const held = ifNoneMatch.split(',').map(v => v.trim().replace(/^W\//, ''));
    if (held.includes('*') || held.includes(etag))
      return {etag, send: 'not-modified'};
  }
  // An object stored without gzip encoding is plain text: send it as it is.
  return {
    etag,
    send: meta.contentEncoding === 'gzip' ? 'gzip' : 'text',
  };
}

/** A lap id as the uploader names it: 16 hex of the session, then the lap index. */
export const traceIdOk = (lapId: string): boolean =>
  /^[0-9a-f]{16}-\d{3}$/.test(lapId);
