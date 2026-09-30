// The lap trace CSV that the app parses. Run: node --test tools/sessions/
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceCsv} from './analyze.mjs';

// 31 ticks at 100 Hz. Lateral and edge are logged at 10 Hz, held in between.
function recording(withLateral) {
  const n = 31;
  const held = f => Array.from({length: n}, (_, i) => f(Math.floor((i + 9) / 10)));
  const s = {
    t: Array.from({length: n}, (_, i) => i / 100),
    speed_kmh: Array.from({length: n}, () => 180),
    rpm: Array.from({length: n}, () => 8000),
    steer_pct: Array.from({length: n}, () => 10),
  };
  const hz = {speed_kmh: 100};
  if (withLateral) {
    // Held values: sample k is the value from tick ceil(k * 10).
    s.path_lateral_m = held(k => -1.5 + k);
    s.track_edge_m = held(() => -6.25);
    hz.path_lateral_m = 10;
    hz.track_edge_m = 10;
  }
  const lap = {
    i0: 0,
    i1: n - 1,
    dist: Array.from({length: n}, (_, i) => i * 0.5),
    off: Array.from({length: n}, () => 0),
  };
  return {rec: {s, hz, baseHz: 100, events: {}}, lap};
}

const rows = csv => csv.split('\n').map(l => l.split(','));

test('the trace CSV ends with PathLateral and TrackEdge', () => {
  const {rec, lap} = recording(true);
  const [header] = rows(traceCsv(rec, lap));
  assert.deepEqual(header.slice(-3), ['OffAsphalt', 'PathLateral', 'TrackEdge']);
  // The columns the app already reads keep their place.
  assert.deepEqual(header.slice(0, 4), ['Speed', 'LapDistPct', 'Lat', 'Lon']);
});

test('lateral and edge are written only on their recorded ticks, signed, in metres', () => {
  const {rec, lap} = recording(true);
  const [, ...data] = rows(traceCsv(rec, lap));
  const lateral = data.map(r => r[r.length - 2]);
  const edge = data.map(r => r[r.length - 1]);
  // Ticks 0, 10, 20 and 30 are real samples; the rows between are empty.
  const filled = lateral.map((v, i) => (v === '' ? null : i)).filter(i => i != null);
  assert.deepEqual(filled, [0, 10, 20, 30]);
  assert.equal(lateral[10], '-0.50');
  assert.equal(edge[0], '-6.25');
  assert.equal(edge[5], '');
});

test('a recording without the channels writes empty cells, never zero', () => {
  const {rec, lap} = recording(false);
  const [, ...data] = rows(traceCsv(rec, lap));
  assert.ok(data.every(r => r[r.length - 2] === '' && r[r.length - 1] === ''));
});
