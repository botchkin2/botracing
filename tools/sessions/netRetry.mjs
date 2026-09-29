// Retry a storage call that failed on a network blip. A reset in the middle of
// a 20 MB samples.parquet upload failed the whole session (apex #760); the
// session's own backoff is 30 min, far too long for a blip.

const TRANSIENT = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ECONNABORTED',
  'EAI_AGAIN',
]);

// The error, or its cause: node-fetch wraps the socket error in a FetchError
// whose `code` is the system code, and the storage client wraps that again.
export function isTransient(error) {
  for (let e = error, depth = 0; e && depth < 4; e = e.cause, depth++) {
    if (TRANSIENT.has(e.code) || TRANSIENT.has(e.errno)) return true;
    if (/\b(ECONNRESET|ETIMEDOUT|EPIPE|socket hang up)\b/.test(e.message ?? ''))
      return true;
  }
  return false;
}

// Up to `tries` attempts, waiting 1 s, 2 s, 4 s between them. Anything that
// is not a network blip throws at once.
export async function withNetRetry(
  call,
  {tries = 4, waitMs = ms => new Promise(done => setTimeout(done, ms))} = {},
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (attempt >= tries || !isTransient(error)) throw error;
      await waitMs(1000 * 2 ** (attempt - 1));
    }
  }
}
