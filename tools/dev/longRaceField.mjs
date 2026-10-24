// A long race's stored field, made from a real one: the real field's rows are
// repeated in time and its cars cloned, so the synthetic body has the real
// one's shape and number density at 2 h and 60 cars (pit wall thread 102, #39).
// The wire format is src/data/field/adapters.ts: per car per channel one row
// of integers; the float channels are deltas (first value absolute), place,
// laps, inPits and flag are plain values; `tDs` is the time step in 0.1 s.
import {gzipSync} from 'node:zlib';

const DELTA_CHANNELS = ['lapDistDm', 'pathLateralDm', 'xDm', 'zDm', 'yawCrad'];
const PLAIN_CHANNELS = ['place', 'laps', 'inPits', 'flag'];

const sum = row => row.reduce((a, v) => a + (v ?? 0), 0);

/** One delta row repeated to `updates` values; each repeat starts with the jump back to the row's start, so the path stays where the real one was. */
function repeatDeltas(row, updates) {
  const total = sum(row);
  const out = new Array(updates);
  for (let u = 0; u < updates; u++) {
    const i = u % row.length;
    out[u] = i === 0 && u > 0 ? (row[0] ?? 0) - total : row[i];
  }
  return out;
}

/** A plain row repeated; `lapsStep` is added to a laps row on every repeat so a car keeps counting laps. */
function repeatPlain(row, updates, lapsStep) {
  const out = new Array(updates);
  for (let u = 0; u < updates; u++) {
    const v = row[u % row.length];
    out[u] = lapsStep === 0 || v === null ? v : v + lapsStep * Math.floor(u / row.length);
  }
  return out;
}

/**
 * `field` is a real field document (the JSON of /sessions/<id>/field/<hash>).
 * Returns a document of `seconds` of race with `cars` cars, same version, rate and car docs (extra cars clone the first ones, with new `i`).
 */
export function longRaceField(field, {seconds = 7200, cars = 60} = {}) {
  const updates = Math.round(seconds * field.hz);
  const real = field.cars.length;
  const lapsPerRepeat = Math.max(
    1,
    ...field.laps.map(r => Math.max(...r.filter(v => v !== null)) - Math.min(...r.filter(v => v !== null))),
  );
  const out = {
    v: field.v,
    hz: field.hz,
    et0: field.et0,
    tDs: repeatPlain(field.tDs, updates, 0),
    cars: Array.from({length: cars}, (_, car) => ({...field.cars[car % real], i: car})),
  };
  for (const key of DELTA_CHANNELS) {
    if (field[key] === undefined) continue;
    out[key] = Array.from({length: cars}, (_, car) => repeatDeltas(field[key][car % real], updates));
  }
  for (const key of PLAIN_CHANNELS) {
    if (field[key] === undefined) continue;
    out[key] = Array.from({length: cars}, (_, car) =>
      // a cloned car runs at the back of the field: its own place, never a real car's
      key === 'place' && car >= real
        ? new Array(updates).fill(car + 1)
        : repeatPlain(field[key][car % real], updates, key === 'laps' ? lapsPerRepeat : 0),
    );
  }
  return out;
}

/** The body the API sends: gzipped JSON. */
export const gzipped = field => gzipSync(Buffer.from(JSON.stringify(field)));
