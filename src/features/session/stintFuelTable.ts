// The fuel card as one table (pit-wall thread 121, decisions/lap/2026-10-27-
// stint-fuel-card.md): a row per stint with the use a lap, the coast seconds a
// lap and the lap time, each with its difference from the first stint; a race
// adds how each stint ended. Strings only: the card draws them.
import {formatGap, formatLapTime} from '@/src/design';

import {MIN_STINT_LAPS, type FuelUse, type FuelUseStint} from './fuelUse';
import type {StintTarget} from './stintTarget';

/** A figure and, under it, its difference or its second figure. */
export type TableCell = {value: string; note: string | null};

export type StintFuelRow = {
  key: string;
  stint: TableCell;
  /** Races only: how the stint ended. */
  end: TableCell | null;
  use: TableCell;
  coast: TableCell;
  time: TableCell;
};

export type StintFuelTable = {
  /** "VE %/lap" or "L/lap". */
  useHead: string;
  coastHead: string;
  timeHead: string;
  /** Null outside a race. */
  endHead: string | null;
  /** The stint the differences are against: "vs stint 1"; null when no row has one. */
  against: string | null;
  rows: StintFuelRow[];
};

const NONE: TableCell = {value: '—', note: null};

const twoDecimals = (v: number) => v.toFixed(2);
const oneDecimalOf = (v: number) => v.toFixed(1);

function endCell(
  t: StintTarget | null,
  unit: FuelUse['unit'],
): TableCell | null {
  if (!t) return NONE;
  const level = (v: number) =>
    unit === 've' ? `${oneDecimalOf(v)} %` : `${twoDecimals(v)} L`;
  return t.kind === 'stop'
    ? {value: `left ${level(t.left)}`, note: null}
    : {
        value: `need ${twoDecimals(t.needed)}`,
        note: `flag ${level(t.atFlag)}`,
      };
}

function rowOf(s: FuelUseStint, fu: FuelUse): StintFuelRow {
  const stint = {
    value: `Stint ${s.n}`,
    note: `${s.laps} lap${s.laps === 1 ? '' : 's'}`,
  };
  const end = fu.race ? endCell(s.target, fu.unit) : null;
  const per = fu.unit === 've' ? s.medianVePct : s.medianFuelL;
  if (s.medianFuelL == null || per == null)
    return {
      key: String(s.n),
      stint: {...stint, note: `${stint.note} · under ${MIN_STINT_LAPS}`},
      end,
      use: NONE,
      coast: NONE,
      time: NONE,
    };
  const v = s.vsFirst;
  const useDelta = fu.unit === 've' ? v?.vePct : v?.fuelL;
  return {
    key: String(s.n),
    stint,
    end,
    use: {
      value: twoDecimals(per),
      note: useDelta != null ? formatGap(useDelta, 2) : null,
    },
    coast:
      s.medianCoastS != null
        ? {
            value: oneDecimalOf(s.medianCoastS),
            note: v?.coastS != null ? formatGap(v.coastS, 1) : null,
          }
        : NONE,
    time:
      s.medianTimeS != null
        ? {
            value: formatLapTime(s.medianTimeS),
            note: v ? formatGap(v.timeS) : null,
          }
        : NONE,
  };
}

export function stintFuelTable(fu: FuelUse): StintFuelTable {
  const rows = fu.stints.map(s => rowOf(s, fu));
  const vs = fu.stints.find(s => s.vsFirst)?.vsFirst;
  return {
    useHead: fu.unit === 've' ? 'VE %/lap' : 'L/lap',
    coastHead: 'Coast s/lap',
    timeHead: 'Lap time',
    endHead: fu.race ? 'Stint end' : null,
    against: vs ? `vs stint ${vs.against}` : null,
    rows,
  };
}
