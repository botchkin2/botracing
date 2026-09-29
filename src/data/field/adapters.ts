// GET /sessions/{id}/field/{hash} (docs/API.md): the raw file → Field.
// Raw shapes stop here. A file that does not match throws, naming the field
// that was wrong, instead of returning a field with holes.
import {type Field, type FieldCar, undelta} from '@/src/analysis/field';

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

function numberOrNull(v: unknown, what: string): number | null {
  if (v === null) return null;
  if (typeof v !== 'number' || !isFinite(v)) fail(`${what} is not a number`);
  return v;
}

function column(
  raw: Record<string, unknown>,
  key: string,
  cars: number,
  updates: number,
): (number | null)[][] {
  const rows = raw[key];
  if (!Array.isArray(rows) || rows.length !== cars)
    fail(`${key} needs one array per car (${cars})`);
  return rows.map((row: unknown, car) => {
    if (!Array.isArray(row) || row.length !== updates)
      fail(`${key}[${car}] needs ${updates} updates`);
    return (row as unknown[]).map((v, u) =>
      numberOrNull(v, `${key}[${car}][${u}]`),
    );
  });
}

const DM = 0.1;
const CRAD = 0.01;
const scaled = (values: (number | null)[], unit: number) =>
  values.map(v => (v === null ? null : v * unit));

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

  const lapDist = column(raw, 'lapDistDm', n, updates);
  const lateral = column(raw, 'pathLateralDm', n, updates);
  const x = column(raw, 'xDm', n, updates);
  const z = column(raw, 'zDm', n, updates);
  const yaw =
    raw.yawCrad === undefined ? null : column(raw, 'yawCrad', n, updates);
  const place = column(raw, 'place', n, updates);
  const laps = column(raw, 'laps', n, updates);
  const pits = column(raw, 'inPits', n, updates);
  const flag = column(raw, 'flag', n, updates);

  const cars: FieldCar[] = carDocs.map((doc: unknown, car) => {
    const c = obj(doc);
    return {
      index: car,
      carClass: typeof c.class === 'string' ? c.class : '',
      vehicle: typeof c.vehicle === 'string' ? c.vehicle : null,
      player: c.player === true,
      lapDistM: scaled(undelta(lapDist[car]), DM),
      pathLateralM: scaled(undelta(lateral[car]), DM),
      xM: scaled(undelta(x[car]), DM),
      zM: scaled(undelta(z[car]), DM),
      yawRad: yaw ? scaled(undelta(yaw[car]), CRAD) : null,
      place: place[car],
      lapsDone: laps[car],
      inPits: pits[car].map(v => (v === null ? null : v === 1)),
      flag: flag[car],
    };
  });
  return {
    version,
    hz,
    startEtS: et0,
    timeS: tDs.map((d: unknown, u) => {
      if (typeof d !== 'number') fail(`tDs[${u}] is not a number`);
      return d / 10;
    }),
    cars,
  };
}
