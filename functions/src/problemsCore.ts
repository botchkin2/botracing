// Function errors in one place (pit-wall thread 1 #3326 to #3328): every
// function's catch-all calls reportError. Pure apart from the deps it is
// given, so the tests run anywhere; problems.ts wires it to the logger and
// Firestore.
//
// - Every error is logged, masked, so Cloud Error Reporting groups it.
// - A 5xx is also counted in `problems/{fingerprint}`: one doc per kind of
//   error (where + route + masked message), so repeats count instead of piling
//   up. Writes are throttled per instance and kind, so a storm cannot hot-spot
//   a doc. The doc expires 30 days after its last error (a Firestore TTL on
//   `expiresAt`). A 4xx is the caller's mistake and is not stored.
// - What is stored and logged is masked text, never the raw message: an error
//   can echo a request body or a token, and the admin view must never show one.
// - Reporting never fails the request: its own errors are logged and dropped.
import {createHash} from 'node:crypto';

export const PROBLEM_TTL_MS = 30 * 24 * 3600_000;
export const WRITE_EVERY_MS = 10_000;
const MAX_MESSAGE = 300;

/**
 * Tokens, emails, ids and numbers out of a message, in this order (rake
 * #3328): JWT-like strings, emails, UUIDs and hex runs of 8 or more, then
 * digit runs. What is left names the kind of error, not the instance.
 */
export function maskMessage(text: string): string {
  return text
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<token>')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>')
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      '<id>',
    )
    .replace(/\b[0-9a-f]{8,}\b/gi, '<id>')
    .replace(/\d+/g, '#');
}

/** The masked first line of an error: `Name: message`, at most 300 characters. */
export function problemMessage(error: unknown): string {
  const e = error instanceof Error ? error : null;
  const text = e ? `${e.name}: ${e.message}` : String(error);
  return maskMessage(text.split('\n')[0]).slice(0, MAX_MESSAGE);
}

export function fingerprintOf(where: string, route: string, message: string) {
  return createHash('sha1')
    .update(`${where}\n${route}\n${message}`)
    .digest('hex')
    .slice(0, 20);
}

/** One write: add `count` errors of this kind, the last one at `at`. */
export interface ProblemWrite {
  id: string;
  where: string;
  route: string;
  status: number;
  message: string;
  count: number;
  at: number;
  expiresAt: number;
}

/**
 * `problems/{id}` after a write, from what is stored now (undefined when it
 * is new): the count adds up, firstAt stays, the rest is the latest. Dates
 * are Dates, so Firestore stores Timestamps (the TTL policy needs one).
 */
export function problemDoc(
  existing: Record<string, unknown> | undefined,
  w: ProblemWrite,
) {
  return {
    where: w.where,
    route: w.route,
    status: w.status,
    message: w.message,
    count: (Number(existing?.count) || 0) + w.count,
    firstAt: existing?.firstAt ?? new Date(w.at),
    lastAt: new Date(w.at),
    expiresAt: new Date(w.expiresAt),
  };
}

export interface ProblemDeps {
  /** Adds to `problems/{id}` (count += write.count; firstAt on create). */
  write: (w: ProblemWrite) => Promise<void>;
  log: (message: string, fields: Record<string, unknown>) => void;
  now: () => number;
}

export interface ProblemContext {
  /** The request path, masked before it is stored. */
  route: string;
  /** The status the request answered with; 500 if not given. */
  status?: number;
}

export function makeReporter(deps: ProblemDeps) {
  // Per kind: when it was last written, and errors seen since then.
  const seen = new Map<string, {writtenAt: number; pending: number}>();
  return async function reportError(
    where: string,
    error: unknown,
    ctx: ProblemContext,
  ): Promise<void> {
    const status = ctx.status ?? 500;
    const route = maskMessage(ctx.route.split('?')[0]);
    const message = problemMessage(error);
    const stack =
      error instanceof Error && error.stack
        ? maskMessage(error.stack)
        : message;
    try {
      deps.log(stack, {where, route, status});
      if (status < 500) return;
      const id = fingerprintOf(where, route, message);
      const now = deps.now();
      const s = seen.get(id) ?? {writtenAt: -Infinity, pending: 0};
      s.pending += 1;
      seen.set(id, s);
      if (now - s.writtenAt < WRITE_EVERY_MS) return;
      const count = s.pending;
      s.writtenAt = now;
      s.pending = 0;
      await deps.write({
        id,
        where,
        route,
        status,
        message,
        count,
        at: now,
        expiresAt: now + PROBLEM_TTL_MS,
      });
    } catch (failure) {
      try {
        deps.log(`reportError failed: ${problemMessage(failure)}`, {where});
      } catch {
        // Nothing left to tell; the request still answers.
      }
    }
  };
}
