// Real tray/API payloads (contract/README.md): the only bodies a test of the
// tray/API line may send. Loading checks the scrub rule, so a payload with a
// user path, an email or a real PC's id cannot be committed by accident.

import {readdirSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), 'payloads');

// The scrub rule: these values replace the real ones, nothing else changes.
export const SCRUBBED = {
  hostId: 'deadbeef',
  label: 'Test PC',
  playerName: 'seat-test',
};

// What a payload may never carry (apex #5114 2): a Windows or home user
// folder, an email, a Firebase uid other than seat-test's (28 base62
// characters), a JWT.
const FORBIDDEN = [
  [/[A-Za-z]:[\\/]+Users[\\/]+(?!~)/i, 'a Windows user folder'],
  [/\/(home|Users)\/[^/\s"]+/, 'a home folder'],
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/, 'an email'],
  [/\b[A-Za-z0-9]{28}\b/, 'a Firebase uid'],
  [/eyJ[\w-]+\.[\w-]+\.[\w-]+/, 'a token'],
];

/**
 * A real heartbeat made into a payload as contract/README.md says: the
 * SCRUBBED fields replaced, the session id blanked, no lastSeenAt. Null when
 * the beat still breaks the scrub rule (a path in an error, say): pick another.
 */
export function scrubBeat(beat) {
  const out = {...beat};
  for (const [k, v] of Object.entries(SCRUBBED)) if (k in out) out[k] = v;
  if (out.lastSessionId) out.lastSessionId = 'aaaaaaaaaaaaaaaa';
  delete out.lastSeenAt;
  return scrubProblem(JSON.stringify(out)) ? null : out;
}

/**
 * From a heartbeat.jsonl (one beat a line), the newest beat with no error or
 * problem, scrubbed; null when none scrubs clean.
 */
export function newestCleanBeat(jsonl) {
  for (const line of jsonl.trim().split('\n').reverse()) {
    let beat;
    try {
      beat = JSON.parse(line);
    } catch {
      continue;
    }
    if (beat.lastError || beat.problems?.length) continue;
    const clean = scrubBeat(beat);
    if (clean) return clean;
  }
  return null;
}

/** Why a payload's text breaks the scrub rule, or null. */
export function scrubProblem(text) {
  for (const [re, what] of FORBIDDEN) if (re.test(text)) return what;
  return null;
}

/**
 * Every payload of one message: [{name, body}], sorted by name. `message` is
 * a folder of contract/payloads (heartbeat, recorder-status, capture-meta).
 * Throws on a payload that breaks the scrub rule.
 */
export function loadPayloads(message) {
  const dir = join(root, message);
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => {
      const text = readFileSync(join(dir, f), 'utf8');
      const problem = scrubProblem(text);
      if (problem) throw new Error(`${message}/${f}: carries ${problem}`);
      const body = JSON.parse(text);
      for (const [k, v] of Object.entries(SCRUBBED))
        if (k in body && body[k] !== v)
          throw new Error(`${message}/${f}: ${k} is not scrubbed to ${v}`);
      return {name: f.replace(/\.json$/, ''), body};
    });
}

/** One payload by name. */
export function payload(message, name) {
  const found = loadPayloads(message).find(p => p.name === name);
  if (!found) throw new Error(`no payload ${message}/${name}`);
  return found.body;
}

/**
 * A copy of a real payload with one field changed: the only way a test makes
 * a negative case (torsion #5115 7). `path` is dotted ('recorder.gameVersion');
 * `undefined` removes the field.
 */
export function mutate(body, path, value) {
  const copy = structuredClone(body);
  const keys = path.split('.');
  let at = copy;
  for (const k of keys.slice(0, -1)) {
    if (typeof at[k] !== 'object' || at[k] === null)
      throw new Error(`mutate: ${path} is not in the payload`);
    at = at[k];
  }
  const last = keys.at(-1);
  if (!(last in at)) throw new Error(`mutate: ${path} is not in the payload`);
  if (value === undefined) delete at[last];
  else at[last] = value;
  return copy;
}

/**
 * The shape of a JSON value: sorted "path:type" entries, values ignored
 * (torsion #5115 6), so a new key or a new type shows and a new value of a
 * known type does not. Array items share the path `[]`; integers and other
 * numbers are both `number`.
 */
export function shapeOf(value, path = '') {
  if (value === null) return [`${path}:null`];
  if (Array.isArray(value))
    return [`${path}:array`, ...value.flatMap(v => shapeOf(v, `${path}[]`))];
  if (typeof value === 'object')
    return [
      `${path}:object`,
      ...Object.keys(value)
        .sort()
        .flatMap(k => shapeOf(value[k], `${path}.${k}`)),
    ];
  return [`${path}:${typeof value}`];
}

/** Every "path:type" the payloads of one message have, as a Set. */
export function knownShape(message) {
  return new Set(loadPayloads(message).flatMap(p => shapeOf(p.body)));
}

/** The entries of `value`'s shape that no payload of `message` has. */
export function newShape(message, value) {
  const known = knownShape(message);
  return [...new Set(shapeOf(value))].filter(s => !known.has(s));
}
