// GET /sessions/{id}/field/{hash} (docs/API.md): the raw file → Field.
// Raw shapes stop here. A file that does not match throws, naming the field
// that was wrong, instead of returning a field with holes.
import {ABSENT, type Field, type FieldCar} from '@/src/analysis/field';

export type FieldPointer = {
  hash: string;
  hz: number;
  cars: number;
  durationS: number;
};

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

/** The session doc's `field` block, or null when the session has none. */
export function toFieldPointer(raw: unknown): FieldPointer | null {
  const x = obj(raw);
  if (typeof x.hash !== 'string' || x.hash === '') return null;
  const n = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : 0);
  return {
    hash: x.hash,
    hz: n(x.hz),
    cars: n(x.cars),
    durationS: n(x.durationS),
  };
}

function fail(what: string): never {
  throw new Error(`field: ${what}`);
}

// Decodes one car's row of one channel in a single pass: checks each value,
// sums the deltas and scales, straight into a typed array. `absent` marks a
// null (the encoder's "car not there"; the running sum carries on past it).
function decodeRow(
  row: unknown,
  what: string,
  updates: number,
  out: {[i: number]: number; length: number},
  absent: number,
  unit: number,
  deltaEncoded: boolean,
): void {
  if (!Array.isArray(row) || row.length !== updates)
    fail(`${what} needs ${updates} updates`);
  let sum = 0;
  for (let u = 0; u < updates; u++) {
    const v: unknown = row[u];
    if (v === null) {
      out[u] = absent;
    } else if (typeof v === 'number' && isFinite(v)) {
      if (deltaEncoded) {
        sum += v;
        out[u] = sum * unit;
      } else {
        out[u] = v;
      }
    } else {
      fail(`${what}[${u}] is not a number`);
    }
  }
}

function rowsOf(raw: Record<string, unknown>, key: string, cars: number) {
  const rows = raw[key];
  if (!Array.isArray(rows) || rows.length !== cars)
    fail(`${key} needs one array per car (${cars})`);
  return rows as unknown[];
}

function floatChannel(
  raw: Record<string, unknown>,
  key: string,
  car: number,
  cars: number,
  updates: number,
  unit: number,
): Float32Array {
  const out = new Float32Array(updates);
  decodeRow(
    rowsOf(raw, key, cars)[car],
    `${key}[${car}]`,
    updates,
    out,
    NaN,
    unit,
    true,
  );
  return out;
}

function intChannel<T extends Int16Array | Int8Array>(
  raw: Record<string, unknown>,
  key: string,
  car: number,
  cars: number,
  updates: number,
  out: T,
): T {
  decodeRow(
    rowsOf(raw, key, cars)[car],
    `${key}[${car}]`,
    updates,
    out,
    ABSENT,
    1,
    false,
  );
  return out;
}

const DM = 0.1;
const CRAD = 0.01;

export function toField(rawInput: unknown): Field {
  const raw = obj(rawInput);
  const version = raw.v;
  if (typeof version !== 'number') fail('v is missing');
  const hz = raw.hz;
  const et0 = raw.et0;
  if (typeof hz !== 'number' || typeof et0 !== 'number')
    fail('hz and et0 are needed');
  const tDs = raw.tDs;
  if (!Array.isArray(tDs)) fail('tDs is missing');
  const updates = tDs.length;
  const carDocs = raw.cars;
  if (!Array.isArray(carDocs)) fail('cars is missing');
  const n = carDocs.length;
  const hasYaw = raw.yawCrad !== undefined;

  const timeS = new Float64Array(updates);
  for (let u = 0; u < updates; u++) {
    const d: unknown = tDs[u];
    if (typeof d !== 'number') fail(`tDs[${u}] is not a number`);
    timeS[u] = d / 10;
  }
  const cars: FieldCar[] = carDocs.map((doc: unknown, car) => {
    const c = obj(doc);
    return {
      index: car,
      carClass: typeof c.class === 'string' ? c.class : '',
      vehicle: typeof c.vehicle === 'string' ? c.vehicle : null,
      player: c.player === true,
      lapDistM: floatChannel(raw, 'lapDistDm', car, n, updates, DM),
      pathLateralM: floatChannel(raw, 'pathLateralDm', car, n, updates, DM),
      xM: floatChannel(raw, 'xDm', car, n, updates, DM),
      zM: floatChannel(raw, 'zDm', car, n, updates, DM),
      yawRad: hasYaw
        ? floatChannel(raw, 'yawCrad', car, n, updates, CRAD)
        : null,
      place: intChannel(raw, 'place', car, n, updates, new Int16Array(updates)),
      lapsDone: intChannel(
        raw,
        'laps',
        car,
        n,
        updates,
        new Int16Array(updates),
      ),
      inPits: intChannel(
        raw,
        'inPits',
        car,
        n,
        updates,
        new Int8Array(updates),
      ),
      flag: intChannel(raw, 'flag', car, n, updates, new Int16Array(updates)),
    };
  });
  return {version, hz, startEtS: et0, timeS, cars};
}
