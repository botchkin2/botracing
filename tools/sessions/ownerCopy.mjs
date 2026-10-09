// Copying one owner's data to another owner key (pit wall thread 2, #140 to
// #147): the pure part. No Firebase, no files: ids, references, paths and the
// checks that everything that named the old owner was rewritten.
//
// The new ids are the ones the uploader derives for the new owner (sync.mjs:
// the same hash and the same inputs), so a later sync from the signed-in tray
// overwrites the copies instead of making a second set next to them. Before
// anything is copied, every OLD id is recomputed from the stored inputs and
// must equal the stored id: if the derivation has changed since a document was
// written, the copy stops and says which one.
import {createHash} from 'node:crypto';

// The owner key whose archive and track files are not in a per-owner folder
// (functions/src/uploadCore.ts LEGACY_OWNER).
export const LEGACY_OWNER = 'botkin';

// sync.mjs hash(): sha1 of the parts joined by '|', first 16 hex.
export const hash16 = (...parts) =>
  createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);

// cornerSlices.mjs: sha1 over the corner files' texts in order, first 12 hex.
export function sliceHash(texts) {
  const h = createHash('sha1');
  for (const text of texts) h.update(text);
  return h.digest('hex').slice(0, 12);
}

// sync.mjs: a recording's id, and a session's id from its first recording.
export const recordingId = (owner, rec) =>
  hash16(owner, rec.sim, rec.source, rec.recordedAt);
export const sessionId = (owner, first) =>
  hash16(
    [owner, first.sim, first.layout, first.car, first.sessionType].join('|'),
    first.recordedAt,
  );

const invertMap = map => new Map([...map].map(([k, v]) => [v, k]));

/**
 * The id maps from `from` to `to`, and every reason they cannot be trusted.
 * recordings, sessions, laps: the stored documents of `from`.
 */
export function makeMaps(from, to, {recordings, sessions, laps}) {
  const problems = [];
  const rec = new Map();
  const ses = new Map();
  const lap = new Map();
  const byId = new Map(recordings.map(r => [r.id, r]));
  const ownedBy = (kind, doc) => {
    if (doc.ownerId !== from)
      problems.push(
        `${kind} ${doc.id}: ownerId is ${doc.ownerId}, not ${from}`,
      );
  };
  for (const r of recordings) {
    ownedBy('recording', r);
    const expected = recordingId(from, r);
    if (expected !== r.id)
      problems.push(
        `recording ${r.id}: the uploader would derive ${expected} for it, so its id cannot be reproduced for the new owner`,
      );
    rec.set(r.id, recordingId(to, r));
  }
  for (const s of sessions) {
    ownedBy('session', s);
    const first = byId.get((s.recordingIds ?? [])[0]);
    if (!first) {
      problems.push(
        `session ${s.id}: its first recording is not among the copied recordings`,
      );
      continue;
    }
    const expected = sessionId(from, first);
    if (expected !== s.id)
      problems.push(
        `session ${s.id}: the uploader would derive ${expected} for it, so its id cannot be reproduced for the new owner`,
      );
    ses.set(s.id, sessionId(to, first));
    for (const rid of s.recordingIds ?? [])
      if (!rec.has(rid))
        problems.push(`session ${s.id}: recording ${rid} is missing`);
  }
  for (const l of laps) {
    ownedBy('lap', l);
    const prefix = `${l.recordingId}-`;
    if (!l.id.startsWith(prefix) || !rec.has(l.recordingId)) {
      problems.push(
        `lap ${l.id}: not "<recordingId>-<n>" of a copied recording`,
      );
      continue;
    }
    lap.set(l.id, rec.get(l.recordingId) + l.id.slice(l.recordingId.length));
    if (!ses.has(l.sessionId))
      problems.push(`lap ${l.id}: its session ${l.sessionId} is not copied`);
  }
  // Distinct old ids must stay distinct.
  for (const [name, map] of [
    ['recording', rec],
    ['session', ses],
    ['lap', lap],
  ]) {
    if (new Set(map.values()).size !== map.size)
      problems.push(`two ${name}s would get the same new id`);
  }
  // sliceHash: sessionId -> {from, to}, filled as slice files are rewritten.
  return {maps: {from, to, rec, ses, lap, slice: new Map()}, problems};
}

/** The id maps as plain JSON, to keep: which new id is which old one. */
export function idMapJson(m) {
  return {
    from: m.from,
    to: m.to,
    sessions: Object.fromEntries(m.ses),
    recordings: Object.fromEntries(m.rec),
    laps: Object.fromEntries(m.lap),
  };
}

/** The same maps read backwards (new -> old), for verification. */
export function invert(m) {
  return {
    from: m.to,
    to: m.from,
    rec: invertMap(m.rec),
    ses: invertMap(m.ses),
    lap: invertMap(m.lap),
    slice: new Map(
      [...m.slice].map(([sid, h]) => [
        m.ses.get(sid),
        {from: h.to, to: h.from},
      ]),
    ),
  };
}

const scopedArchive = owner => owner !== LEGACY_OWNER;

function need(map, key, what) {
  const value = map.get(key);
  if (value === undefined) throw new Error(`no new ${what} for ${key}`);
  return value;
}

/**
 * A bucket path of the old owner as the new owner's. Archive files sit
 * unscoped for the legacy owner and under the owner key for everyone else
 * (uploadCore.ts); the rest carry the owner as segment 2. Track data (maps,
 * surface, outline) is shared app data, not an owner's: it is not copied
 * (Botkin, pit wall thread 2 #149).
 */
export function mapPath(path, m) {
  const s = path.split('/');
  const folder = s[0];
  if (folder === 'traces' && s.length >= 4) {
    if (s[1] !== m.from) throw new Error(`${path}: not ${m.from}'s`);
    return ['traces', m.to, need(m.lap, s[2], 'lap'), ...s.slice(3)].join('/');
  }
  if ((folder === 'bands' || folder === 'field') && s.length >= 4) {
    if (s[1] !== m.from) throw new Error(`${path}: not ${m.from}'s`);
    return [folder, m.to, need(m.ses, s[2], 'session'), ...s.slice(3)].join(
      '/',
    );
  }
  if (folder === 'slices' && s.length >= 5) {
    if (s[1] !== m.from) throw new Error(`${path}: not ${m.from}'s`);
    const h = m.slice.get(s[2]);
    if (!h || h.from !== s[3])
      throw new Error(`${path}: slice hash not mapped`);
    return [
      'slices',
      m.to,
      need(m.ses, s[2], 'session'),
      h.to,
      ...s.slice(4),
    ].join('/');
  }
  if (folder === 'archive') {
    let rest = s.slice(1);
    if (scopedArchive(m.from)) {
      if (rest[0] !== m.from) throw new Error(`${path}: not ${m.from}'s`);
      rest = rest.slice(1);
    }
    // rest: sim, sessionId, recordingId, file
    if (rest.length < 4) throw new Error(`${path}: not an archive file path`);
    const [sim, sid, rid, ...file] = rest;
    const mapped = [
      sim,
      need(m.ses, sid, 'session'),
      need(m.rec, rid, 'recording'),
      ...file,
    ];
    return ['archive', ...(scopedArchive(m.to) ? [m.to] : []), ...mapped].join(
      '/',
    );
  }
  throw new Error(`${path}: a folder the copy does not know`);
}

const mapOrNull = (path, m) =>
  typeof path === 'string' ? mapPath(path, m) : path;

/** A copy of the document with the owner and every reference rewritten. */
export function mapRecording(doc, m) {
  return {
    ...doc,
    id: need(m.rec, doc.id, 'recording'),
    ownerId: m.to,
    sessionId: need(m.ses, doc.sessionId, 'session'),
    archive: doc.archive
      ? {
          ...doc.archive,
          samples: mapOrNull(doc.archive.samples, m),
          events: mapOrNull(doc.archive.events, m),
        }
      : doc.archive,
  };
}

export function mapLap(doc, m) {
  return {
    ...doc,
    id: need(m.lap, doc.id, 'lap'),
    ownerId: m.to,
    sessionId: need(m.ses, doc.sessionId, 'session'),
    recordingId: need(m.rec, doc.recordingId, 'recording'),
    trace: doc.trace
      ? {...doc.trace, path: mapOrNull(doc.trace.path, m)}
      : doc.trace,
  };
}

const mapLapId = (id, m) => (id == null ? id : need(m.lap, id, 'lap'));

export function mapSession(doc, m) {
  const slice = m.slice.get(doc.id);
  if (doc.slices && !slice)
    throw new Error(`session ${doc.id} has slices but no rewritten slice set`);
  const stints = doc.consistency?.stints;
  return {
    ...doc,
    id: need(m.ses, doc.id, 'session'),
    ownerId: m.to,
    recordingIds: (doc.recordingIds ?? []).map(id =>
      need(m.rec, id, 'recording'),
    ),
    bestLapId: mapLapId(doc.bestLapId, m),
    consistency: doc.consistency
      ? {
          ...doc.consistency,
          ...(stints
            ? {
                stints: stints.map(st => ({
                  ...st,
                  lapIds: (st.lapIds ?? []).map(id => mapLapId(id, m)),
                })),
              }
            : {}),
        }
      : doc.consistency,
    lapTable: doc.lapTable
      ? doc.lapTable.map(row => ({...row, id: mapLapId(row.id, m)}))
      : doc.lapTable,
    band: doc.band
      ? {...doc.band, path: mapOrNull(doc.band.path, m)}
      : doc.band,
    field: doc.field
      ? {...doc.field, path: mapOrNull(doc.field.path, m)}
      : doc.field,
    slices: doc.slices
      ? {
          ...doc.slices,
          hash: slice.to,
          prefix: [
            'slices',
            m.to,
            need(m.ses, doc.id, 'session'),
            slice.to,
          ].join('/'),
        }
      : doc.slices,
  };
}

/**
 * One corner file's text with its lap ids remapped. The files list the laps by
 * id (cornerSlices.mjs lapSlice), and the set's folder is named by a hash of
 * the texts, so the caller recomputes that hash from what this returns.
 */
export function mapSliceText(text, m) {
  const obj = JSON.parse(text);
  if (Array.isArray(obj.laps))
    obj.laps = obj.laps.map(l => ({...l, id: need(m.lap, l.id, 'lap')}));
  return JSON.stringify(obj);
}

const HEX16 = /[0-9a-f]{16}/g;
const OWNER_FOLDERS = new Set(['traces', 'bands', 'field', 'slices']);

/**
 * What is left of the old owner in a value (a document, or the parsed JSON of a
 * file): any of the old ids anywhere, in a key or a string, an `ownerId` still
 * the old owner, and a bucket path with the old owner as its owner segment.
 * The word itself elsewhere (a driver name, an event title) is not a leftover.
 */
export function residual(value, m, where = '$') {
  // m.oldIds: every old id of the owner (the copy runs a session at a time and
  // hands in the whole set); else just the ones in these maps.
  const oldIds = m.oldIds ?? new Set([...m.rec.keys(), ...m.ses.keys()]);
  const found = [];
  const check = (text, at) => {
    for (const token of text.match(HEX16) ?? []) {
      if (oldIds.has(token)) found.push(`${at}: old id ${token}`);
    }
    const s = text.split('/');
    if (OWNER_FOLDERS.has(s[0]) && s[1] === m.from)
      found.push(`${at}: path in ${m.from}'s folder`);
    if (s[0] === 'archive' && scopedArchive(m.from) && s[1] === m.from)
      found.push(`${at}: path in ${m.from}'s folder`);
  };
  const walk = (v, at, key) => {
    if (typeof v === 'string') {
      if (key === 'ownerId' && v === m.from)
        found.push(`${at}: ownerId is still ${m.from}`);
      check(v, at);
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${at}[${i}]`));
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        check(k, `${at}.<key>`);
        walk(x, `${at}.${k}`, k);
      }
    }
  };
  walk(value, where);
  return found;
}
