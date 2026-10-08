import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  LEGACY_OWNER,
  hash16,
  invert,
  makeMaps,
  mapLap,
  mapPath,
  mapRecording,
  mapSession,
  mapSliceText,
  recordingId,
  residual,
  sessionId,
  sliceHash,
} from './ownerCopy.mjs';

const FROM = LEGACY_OWNER;
const TO = 'LwTNOO0lF7QnEx847fvEGr4EKRF3';

// One session of two recordings with two laps each, built the way sync.mjs
// builds its documents (the same hash, the same inputs).
function data(owner = FROM) {
  const info = (source, recordedAt) => ({
    sim: 'lmu',
    source,
    recordedAt,
    layout: 'Road Atlanta',
    car: 'Porsche 911 GT3 R',
    sessionType: 'practice',
  });
  const recordings = ['a', 'b'].map((n, i) => {
    const base = info(
      `Road Atlanta_P_${n}.duckdb`,
      `2026-09-2${i}T00:00:00.000Z`,
    );
    return {
      ...base,
      id: recordingId(owner, base),
      ownerId: owner,
      event: {series: 'Botkin Cup', eventId: 'e1'},
    };
  });
  const sid = sessionId(owner, recordings[0]);
  for (const r of recordings) {
    r.sessionId = sid;
    const prefix = `archive/lmu/${sid}/${r.id}`;
    r.archive = {
      samples: `${prefix}/samples.parquet`,
      events: `${prefix}/events.parquet`,
      bytes: 10,
    };
  }
  const laps = recordings.flatMap(r =>
    [1, 2].map(n => {
      const id = `${r.id}-${String(n).padStart(3, '0')}`;
      return {
        id,
        ownerId: owner,
        sessionId: sid,
        recordingId: r.id,
        lapNumber: n,
        trace: {path: `traces/${owner}/${id}/v2.csv.gz`, rows: 5},
      };
    }),
  );
  const session = {
    id: sid,
    ownerId: owner,
    recordingIds: recordings.map(r => r.id),
    bestLapId: laps[1].id,
    series: 'Botkin Cup',
    car: {name: 'Porsche Botkin Edition'},
    consistency: {
      stints: [{n: 1, lapIds: laps.map(l => l.id)}],
      overview: 'ok',
    },
    lapTable: laps.map(l => ({id: l.id, lapNumber: l.lapNumber})),
    band: {path: `bands/${owner}/${sid}/v1.json.gz`, laps: 4},
    field: {
      path: `field/${owner}/${sid}/abc123def456.json.gz`,
      hash: 'abc123def456',
    },
    slices: null,
  };
  return {recordings, laps, sessions: [session]};
}

const slicesFor = (laps, m) => {
  const files = [1, 2].map(n => ({
    n,
    text: JSON.stringify({
      v: 1,
      corner: n,
      laps: laps.map(l => ({id: l.id, x: [1, 2]})),
    }),
  }));
  return files;
};

test('the new ids are the ones the uploader derives for the new owner', () => {
  const d = data();
  const {maps, problems} = makeMaps(FROM, TO, d);
  assert.deepEqual(problems, []);
  const fresh = data(TO);
  assert.deepEqual(
    [...maps.rec.values()],
    fresh.recordings.map(r => r.id),
  );
  assert.deepEqual(
    [...maps.ses.values()],
    fresh.sessions.map(s => s.id),
  );
  assert.deepEqual(
    [...maps.lap.values()],
    fresh.laps.map(l => l.id),
  );
  // The hash is the uploader's: 16 hex, sha1 of the joined parts.
  assert.equal(hash16('a', 'b'), hash16('a|b'));
  assert.match(maps.rec.values().next().value, /^[0-9a-f]{16}$/);
});

test('an old id the uploader would not derive stops the copy and names the document', () => {
  const d = data();
  d.recordings[1].source = 'renamed.duckdb';
  const {problems} = makeMaps(FROM, TO, d);
  assert.ok(
    problems.some(p =>
      p.startsWith(
        `recording ${d.recordings[1].id}: the uploader would derive`,
      ),
    ),
    problems.join('\n'),
  );
  const e = data();
  e.sessions[0].id = '0123456789abcdef';
  e.laps.forEach(l => (l.sessionId = '0123456789abcdef'));
  e.recordings.forEach(r => (r.sessionId = '0123456789abcdef'));
  assert.ok(
    makeMaps(FROM, TO, e).problems.some(p =>
      p.startsWith('session 0123456789abcdef: the uploader would derive'),
    ),
  );
  const f = data();
  f.laps[0].ownerId = 'someone';
  assert.ok(
    makeMaps(FROM, TO, f).problems.some(p => p.includes('ownerId is someone')),
  );
});

test('paths of every folder map to the new owner and back', () => {
  const {maps: m} = makeMaps(FROM, TO, data());
  const d = data();
  const sid = d.sessions[0].id;
  const rid = d.recordings[0].id;
  m.slice.set(sid, {from: 'aaaaaaaaaaaa', to: 'bbbbbbbbbbbb'});
  const cases = [
    [
      `traces/${FROM}/${rid}-001/v2.csv.gz`,
      `traces/${TO}/${m.lap.get(`${rid}-001`)}/v2.csv.gz`,
    ],
    [
      `bands/${FROM}/${sid}/v1.json.gz`,
      `bands/${TO}/${m.ses.get(sid)}/v1.json.gz`,
    ],
    [
      `field/${FROM}/${sid}/abc123def456.json.gz`,
      `field/${TO}/${m.ses.get(sid)}/abc123def456.json.gz`,
    ],
    [
      `slices/${FROM}/${sid}/aaaaaaaaaaaa/c3.json.gz`,
      `slices/${TO}/${m.ses.get(sid)}/bbbbbbbbbbbb/c3.json.gz`,
    ],
    [
      `archive/lmu/${sid}/${rid}/samples.parquet`,
      `archive/${TO}/lmu/${m.ses.get(sid)}/${m.rec.get(rid)}/samples.parquet`,
    ],
  ];
  const back = invert(m);
  for (const [old, next] of cases) {
    assert.equal(mapPath(old, m), next, old);
    assert.equal(mapPath(next, back), old, `${next} back`);
  }
  assert.throws(
    () => mapPath(`traces/someone/${rid}-001/v2.csv.gz`, m),
    /not botkin's/,
  );
  assert.throws(() => mapPath('uploaders/x', m), /does not know/);
  // Track data is shared app data, not an owner's: the copy does not move it.
  assert.throws(
    () => mapPath('surface/lmu-road-atlanta/v1.json.gz', m),
    /does not know/,
  );
  assert.throws(
    () => mapPath('outline/lmu-road-atlanta.json', m),
    /does not know/,
  );
});

test('a copied session, its recordings and laps keep nothing of the old ids or owner, and map back exactly', () => {
  const d = data();
  const {maps: m, problems} = makeMaps(FROM, TO, d);
  assert.deepEqual(problems, []);
  const files = slicesFor(d.laps, m);
  const texts = files.map(f => mapSliceText(f.text, m));
  m.slice.set(d.sessions[0].id, {from: 'aaaaaaaaaaaa', to: sliceHash(texts)});
  d.sessions[0].slices = {
    format: 1,
    hash: 'aaaaaaaaaaaa',
    prefix: `slices/${FROM}/${d.sessions[0].id}/aaaaaaaaaaaa`,
    corners: [1, 2],
  };

  const recs = d.recordings.map(r => mapRecording(r, m));
  const laps = d.laps.map(l => mapLap(l, m));
  const [session] = d.sessions.map(s => mapSession(s, m));
  for (const [what, doc] of [
    ['recording', recs[0]],
    ['lap', laps[0]],
    ['session', session],
  ]) {
    assert.deepEqual(
      residual(doc, m),
      [],
      `${what} still names the old owner or ids`,
    );
  }
  assert.equal(session.ownerId, TO);
  assert.equal(
    session.slices.prefix,
    `slices/${TO}/${m.ses.get(d.sessions[0].id)}/${sliceHash(texts)}`,
  );
  // The word in names stays: an event title and a car called Botkin.
  assert.equal(session.series, 'Botkin Cup');
  assert.equal(session.car.name, 'Porsche Botkin Edition');
  assert.equal(recs[0].event.series, 'Botkin Cup');

  // Mapped back with the inverse maps, every document is the original.
  const back = invert(m);
  assert.deepEqual(
    recs.map(r => mapRecording(r, back)),
    d.recordings,
  );
  assert.deepEqual(
    laps.map(l => mapLap(l, back)),
    d.laps,
  );
  assert.deepEqual(mapSession(session, back), d.sessions[0]);
});

test('the residual scan finds an old id, an old owner and an old path wherever they hide', () => {
  const d = data();
  const {maps: m} = makeMaps(FROM, TO, d);
  const rid = d.recordings[0].id;
  const sid = d.sessions[0].id;
  assert.deepEqual(
    residual({title: 'Botkin Cup', note: 'driver botkin', car: 'Botkin'}, m),
    [],
  );
  const bad = residual(
    {
      a: {b: [`see ${sid} here`]},
      ownerId: FROM,
      p: `traces/${FROM}/x/y`,
      q: `archive/${FROM}/lmu`,
    },
    m,
  );
  assert.equal(bad.length >= 3, true, bad.join('\n'));
  assert.ok(bad.some(x => x.includes(`old id ${sid}`)));
  assert.ok(bad.some(x => x.includes('ownerId is still')));
  assert.ok(bad.some(x => x.includes('path in botkin')));
  // An id used as a key, and inside a lap id.
  assert.ok(residual({[rid]: 1}, m).some(x => x.includes('<key>')));
  assert.ok(residual({lap: `${rid}-001`}, m).length === 1);
  // Legacy archive paths have no owner segment, so only the ids give them away.
  assert.equal(residual({p: `archive/lmu/${sid}/${rid}/x`}, m).length, 2);
});

test('slice files get new lap ids and a new content hash, and map back byte for byte', () => {
  const d = data();
  const {maps: m} = makeMaps(FROM, TO, d);
  const files = slicesFor(d.laps, m);
  const rewritten = files.map(f => mapSliceText(f.text, m));
  assert.notEqual(sliceHash(rewritten), sliceHash(files.map(f => f.text)));
  assert.ok(rewritten.every(t => !t.includes(d.laps[0].id)));
  m.slice.set(d.sessions[0].id, {
    from: sliceHash(files.map(f => f.text)),
    to: sliceHash(rewritten),
  });
  const back = invert(m);
  assert.deepEqual(
    rewritten.map(t => mapSliceText(t, back)),
    files.map(f => f.text),
  );
  assert.throws(
    () => mapSliceText(JSON.stringify({laps: [{id: 'unknown-001'}]}), m),
    /no new lap/,
  );
});
