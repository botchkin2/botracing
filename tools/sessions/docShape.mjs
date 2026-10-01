// What Firestore refuses, checked before anything is written (apex, pit-wall
// thread 44 #1770): an array directly inside an array (#219's [fromM, toM, s]
// spans failed every session of a resync), an undefined value, a number that is
// not finite, a name that is empty or reserved, a nesting past 20 levels, and
// a document past the size limit. A problem names its field path, so the fix is
// where the message points. Plain JavaScript, no imports.

/** Firestore's limit is 1 MiB; this leaves room for the field names it counts too. */
export const MAX_DOC_BYTES = 900_000;
const MAX_DEPTH = 20;
const MAX_PROBLEMS = 10;

/** The problems of one document value, each "path: what", at most MAX_PROBLEMS. */
export function docProblems(value, path = '') {
  const problems = [];
  const walk = (v, at, depth) => {
    if (problems.length >= MAX_PROBLEMS) return;
    if (depth > MAX_DEPTH) {
      problems.push(`${at || '(doc)'}: nested deeper than ${MAX_DEPTH} levels`);
      return;
    }
    if (v === undefined) {
      problems.push(`${at || '(doc)'}: undefined`);
    } else if (typeof v === 'number' && !Number.isFinite(v)) {
      problems.push(`${at || '(doc)'}: ${v} is not a finite number`);
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => {
        if (Array.isArray(x)) {
          problems.push(`${at}[${i}]: an array directly inside an array`);
        } else walk(x, `${at}[${i}]`, depth + 1);
      });
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (k === '' || /^__.*__$/.test(k)) {
          problems.push(
            `${at ? `${at}.` : ''}${
              k || '(empty name)'
            }: a name Firestore reserves`,
          );
        }
        walk(x, at ? `${at}.${k}` : k, depth + 1);
      }
    }
  };
  walk(value, path, 0);
  return problems.slice(0, MAX_PROBLEMS);
}

/** Throws, naming the document and every problem, when `data` cannot be written. */
export function checkDoc(path, data) {
  const problems = docProblems(data);
  const bytes = Buffer.byteLength(JSON.stringify(data) ?? '', 'utf8');
  if (bytes > MAX_DOC_BYTES) {
    problems.push(`(doc): ${bytes} bytes, over the ${MAX_DOC_BYTES} limit`);
  }
  if (problems.length > 0) {
    throw new Error(
      `${path} cannot be written to Firestore: ${problems.join('; ')}`,
    );
  }
}

/**
 * A writer that holds every set until close, checks them all, and only then
 * hands them to the real writer: a session with one bad document writes none
 * of its documents, and fails by itself, not the run. `writer` is anything
 * with set(ref, data, options), delete(ref) and close() (a Firestore
 * bulkWriter).
 */
export function guardedWriter(writer) {
  const held = [];
  return {
    set(ref, data, options) {
      held.push({op: 'set', ref, data, options});
    },
    // Held too: a delete must not go out ahead of a write that is then refused.
    delete(ref) {
      held.push({op: 'delete', ref});
    },
    async close() {
      const bad = [];
      for (const {op, ref, data} of held) {
        if (op !== 'set') continue;
        try {
          checkDoc(ref.path, data);
        } catch (error) {
          bad.push(error.message);
        }
      }
      if (bad.length > 0) {
        throw new Error(
          bad.length === 1
            ? bad[0]
            : `${bad.length} documents cannot be written to Firestore: ${bad
                .slice(0, 3)
                .join(' | ')}`,
        );
      }
      for (const {op, ref, data, options} of held) {
        if (op === 'set') writer.set(ref, data, options);
        else writer.delete(ref);
      }
      await writer.close();
    },
  };
}
