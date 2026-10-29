import {
  type ClassPaceDoc,
  type DriverPace,
  sectorGapS,
  topVsYou,
} from '@/src/analysis/classPace';
import {classOfCar} from '@/src/analysis/fieldClasses';

import {fieldCarName} from './classTable';

// The Session's Class pace block as rows (ticket 20, livery's layout in pit-wall
// thread 111 #7653, chassis #7656): the top line, the class chips, one row per
// driver of the chosen class, what a tap opens. Every number is signed here,
// from his side (+ = he loses time there, the sign of every "vs" on the
// screens), so the view only draws: it never subtracts a pace field.
// No names and no car numbers: a row is "P3 · Ford Mustang". Pure.

/** A class of up to this many cars shows every row. */
export const CAP_ROWS = 12;
/** Over the cap: the fastest TOP_ROWS, and him with NEAR_YOU rows each side. */
export const TOP_ROWS = 5;
export const NEAR_YOU = 2;

export const SECTOR_HEADS = ['S1', 'S2', 'S3'] as const;

type Sectors = [number | null, number | null, number | null];

export type PaceRow = {
  key: string;
  /** The place the file gives, "" without one. */
  pos: string;
  car: string;
  you: boolean;
  bestS: number | null;
  /** Null under 3 valid laps. */
  medianS: number | null;
  /** His median sector minus theirs, S1 to S3: red where they gain on him. Null for his own row and for another class. */
  cellsS: Sectors | null;
  /** What a tap opens: their best and median sectors beside his medians. Null where there is no comparison. */
  detail: {bestS: Sectors; medianS: Sectors; youS: Sectors} | null;
};

export type ClassPaceView = {
  /** 'qualifying' when every row is one best lap from qualifying: the block names it and has no Median or sector columns. */
  basis: 'qualifying' | null;
  /** "You vs top 5" ("top 3" in a class of four): his median sector minus theirs; null without his medians. */
  topLine: {label: string; sectorsS: Sectors} | null;
  /** More than one class; his own first. Empty with one. */
  chips: {cls: string; label: string}[];
  selected: string;
  /** Whether the rows carry sector cells: his own class is selected. Their heads (S1 S2 S3) are drawn only then. */
  cells: boolean;
  /** The rows to draw, by place. */
  rows: PaceRow[];
  /** Rows left behind "All N ›". */
  hidden: number;
  total: number;
};

const labelOf = (cls: string) =>
  classOfCar({carClass: cls, classId: null, classLabel: null}).label;

const sectors = (pick: (i: 0 | 1 | 2) => number | null): Sectors => [
  pick(0),
  pick(1),
  pick(2),
];

/**
 * The rows to show of a class: all of them up to `cap`, else the top TOP_ROWS,
 * him and the NEAR_YOU either side, and how many that leaves out. `youAt` is his
 * index in `rows`, -1 when he is not in them.
 */
export function cutRows<T>(
  rows: readonly T[],
  youAt: number,
  cap = CAP_ROWS,
): {shown: T[]; hidden: number} {
  if (rows.length <= cap) return {shown: [...rows], hidden: 0};
  const keep = new Set<number>();
  for (let i = 0; i < TOP_ROWS; i++) keep.add(i);
  if (youAt >= 0)
    for (let i = youAt - NEAR_YOU; i <= youAt + NEAR_YOU; i++)
      if (i >= 0 && i < rows.length) keep.add(i);
  const shown = [...keep].sort((a, b) => a - b).map(i => rows[i]);
  return {shown, hidden: rows.length - shown.length};
}

const byPlace = (a: DriverPace, b: DriverPace) =>
  (a.pos ?? Infinity) - (b.pos ?? Infinity) ||
  (a.best ?? Infinity) - (b.best ?? Infinity);

/**
 * The block, or null without `classPace`. `selected` is the class chip in force
 * (his own class by default, or the first when he is not in the file), `all` the
 * "All N ›" tap.
 */
export function classPaceView(
  doc: ClassPaceDoc | null,
  selected: string | null,
  all: boolean,
): ClassPaceView | null {
  if (!doc) return null;
  const you = doc.drivers.find(d => d.you);
  const classes = [...new Set(doc.drivers.map(d => d.cls))];
  if (you)
    classes.sort((a, b) => Number(b === you.cls) - Number(a === you.cls));
  const cls = selected && classes.includes(selected) ? selected : classes[0];
  const mine = you !== undefined && you.cls === cls;
  const inClass = doc.drivers.filter(d => d.cls === cls).sort(byPlace);
  const classRows = inClass.map((d, i): PaceRow => {
    const compare = mine && you !== undefined && !d.you && d.median !== null;
    const delta = (s: 0 | 1 | 2): number | null =>
      you ? sectorGapS(you, d, s) : null;
    return {
      key: `${cls}:${i}`,
      pos: d.pos === null ? '' : String(d.pos),
      car: fieldCarName(d.car),
      you: d.you,
      bestS: d.best,
      medianS: d.median,
      cellsS: mine && !d.you ? sectors(delta) : null,
      detail:
        compare && you
          ? {
              bestS: sectors(j => d.sectors[j].best),
              medianS: sectors(j => d.sectors[j].median),
              youS: sectors(j => you.sectors[j].median),
            }
          : null,
    };
  });
  const cut = all
    ? {shown: classRows, hidden: 0}
    : cutRows(
        classRows,
        classRows.findIndex(r => r.you),
      );
  const top = topVsYou(doc);
  return {
    basis: doc.basis ?? null,
    topLine:
      top && top.sectorsS.some(s => s !== null)
        ? {label: `You vs top ${top.cars}`, sectorsS: top.sectorsS}
        : null,
    chips:
      classes.length > 1 ? classes.map(c => ({cls: c, label: labelOf(c)})) : [],
    selected: cls,
    cells: mine,
    rows: cut.shown,
    hidden: cut.hidden,
    total: classRows.length,
  };
}
