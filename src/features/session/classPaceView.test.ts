import {describe, expect, it} from '@jest/globals';

import qualifying from '@/src/analysis/__fixtures__/classPaceQ.json';
import race from '@/src/analysis/__fixtures__/classPaceR.json';
import {
  classPaceDoc,
  medianVsClass,
  type ResultsDriver,
  type ResultsLap,
} from '@/src/analysis/classPace';
import {cornerCell} from '@/src/design';

import {classMedianFacts} from './classMedianFact';
import {
  CAP_ROWS,
  classPaceView,
  cutRows,
  NEAR_YOU,
  TOP_ROWS,
} from './classPaceView';

const driversOf = (f: {drivers: unknown}) => f.drivers as ResultsDriver[];
const qDoc = classPaceDoc(driversOf(qualifying));
const rDoc = classPaceDoc(driversOf(race));

type Sectors = [number, number, number];

const lap = (t: number, s: Sectors): ResultsLap => ({
  t,
  s1: s[0],
  s2: s[1],
  s3: s[2],
  pit: false,
});
const car = (
  o: Partial<ResultsDriver> & {t: number; s: Sectors},
): ResultsDriver => ({
  player: false,
  cls: 'GT3',
  car: 'BMW M4 LMGT3',
  pos: null,
  laps: [lap(o.t, o.s), lap(o.t, o.s), lap(o.t, o.s)],
  ...o,
});

// design/tokens.ts cornerCell: a positive difference is the red cell (white text), a negative one the green (dark text).
const isRed = (d: number) => d > 0 && cornerCell(d).fg === '#f2f4f6';
const isGreen = (d: number) => d < 0 && cornerCell(d).fg === '#0d0f12';

describe('the sign: + is where he is slower, in the top line, in a driver cell and in the head', () => {
  // His real qualifying (Sebring 10-21): his S2 median is slower than the top cars' and than the Ford P2's.
  it('a sector where his median is slower is positive, never green, in the top line, and red in that driver cell', () => {
    const v = classPaceView(qDoc, null, false)!;
    expect(v.topLine!.label).toBe('You vs top 5');
    const s2 = v.topLine!.sectorsS[1]!;
    // +0.03 s is under cornerCell's 0.1 s neutral band: positive, drawn neutral, never green
    expect(s2).toBeGreaterThan(0);
    expect(isGreen(s2)).toBe(false);
    // S1 he is faster: negative, green
    const s1 = v.topLine!.sectorsS[0]!;
    expect(s1).toBeLessThan(0);
    expect(isGreen(s1)).toBe(true);
    const ford = v.rows.find(r => r.pos === '2')!;
    expect(ford.cellsS![1]).toBeGreaterThan(0.2);
    expect(isRed(ford.cellsS![1]!)).toBe(true);
    // the tap's numbers are the ones behind the cell: his median minus theirs
    expect(ford.detail!.youS[1]! - ford.detail!.medianS[1]!).toBeCloseTo(
      ford.cellsS![1]!,
      9,
    );
  });

  it('the head: a median slower than the class gives a positive delta, a faster one a negative', () => {
    const slow = classPaceDoc([
      car({player: true, t: 102, s: [41, 30, 31]}),
      car({t: 100, s: [40, 30, 30]}),
      car({t: 101, s: [40, 30, 31]}),
    ]);
    expect(medianVsClass(slow)!.deltaS).toBeCloseTo(1.5, 9);
    expect(classMedianFacts({sessionType: 'R', classPace: slow})[0].basis).toBe(
      'you +1.500 · 2 cars',
    );
    const fast = classPaceDoc([
      car({player: true, t: 98, s: [39, 29, 30]}),
      car({t: 100, s: [40, 30, 30]}),
      car({t: 101, s: [40, 30, 31]}),
    ]);
    expect(medianVsClass(fast)!.deltaS).toBeLessThan(0);
    expect(
      classMedianFacts({sessionType: 'R', classPace: fast})[0].basis,
    ).toMatch(/^you −/);
  });

  it('a cell is his sector median minus theirs, exactly, on his real race', () => {
    const v = classPaceView(rDoc, null, false)!;
    const you = rDoc!.drivers.find(d => d.you)!;
    for (const r of v.rows.filter(x => x.cellsS)) {
      const d = rDoc!.drivers.find(
        x => !x.you && x.cls === you.cls && String(x.pos) === r.pos,
      )!;
      r.cellsS!.forEach((c, i) =>
        expect(c).toBeCloseTo(you.sectors[i].median! - d.sectors[i].median!, 9),
      );
    }
  });
});

describe('classPaceView', () => {
  it('is null without classPace', () => {
    expect(classPaceView(null, null, false)).toBeNull();
  });

  it('opens on his own class, with the classes as chips, his first; one class has none', () => {
    const v = classPaceView(rDoc, null, false)!;
    expect(v.selected).toBe('GT3');
    expect(v.chips.map(c => c.cls)).toEqual(['GT3', 'LMP2_ELMS']);
    expect(v.chips.map(c => c.label)).toEqual(['GT3', 'LMP2']);
    const one = classPaceDoc([
      car({player: true, t: 100, s: [40, 30, 30]}),
      car({t: 101, s: [40, 30, 31]}),
    ]);
    expect(classPaceView(one, null, false)!.chips).toEqual([]);
  });

  it('lists the class by place, his row marked, with no name and no number', () => {
    const v = classPaceView(rDoc, null, false)!;
    expect(v.rows.map(r => r.pos)).toEqual(['1', '2', '3', '6']);
    expect(v.rows.find(r => r.you)!.pos).toBe('1');
    expect(v.rows.map(r => r.car)).toEqual([
      'Porsche 911 GT3 R',
      'Ford Mustang',
      'Porsche 911 GT3 R',
      'BMW M4',
    ]);
    for (const r of v.rows)
      expect(Object.keys(r).sort()).toEqual([
        'bestS',
        'car',
        'cellsS',
        'detail',
        'key',
        'medianS',
        'pos',
        'you',
      ]);
  });

  it('his row has no cells and does not open; another class has no cells and does not open either', () => {
    const v = classPaceView(rDoc, null, false)!;
    expect(v.rows.find(r => r.you)!.cellsS).toBeNull();
    expect(v.rows.find(r => r.you)!.detail).toBeNull();
    const lmp = classPaceView(rDoc, 'LMP2_ELMS', false)!;
    expect(lmp.selected).toBe('LMP2_ELMS');
    expect(lmp.rows.every(r => r.cellsS === null && r.detail === null)).toBe(
      true,
    );
    expect(lmp.rows.every(r => r.bestS !== null)).toBe(true);
  });

  it('a driver under 3 valid laps has a best, no median, empty cells and does not open', () => {
    const few: ResultsDriver = {
      player: false,
      cls: 'GT3',
      car: 'x',
      pos: 2,
      laps: [lap(100, [40, 30, 30]), lap(101, [40, 30, 31])],
    };
    const doc = classPaceDoc([
      car({player: true, pos: 1, t: 100, s: [40, 30, 30]}),
      few,
    ])!;
    const row = classPaceView(doc, null, false)!.rows.find(r => !r.you)!;
    expect(row.bestS).toBe(100);
    expect(row.medianS).toBeNull();
    expect(row.cellsS).toEqual([null, null, null]);
    expect(row.detail).toBeNull();
  });

  it('under 3 valid laps of his own there is no top line', () => {
    const doc = classPaceDoc([
      {
        player: true,
        cls: 'GT3',
        car: 'x',
        pos: 1,
        laps: [lap(100, [40, 30, 30])],
      },
      car({t: 101, s: [40, 30, 31]}),
    ]);
    expect(classPaceView(doc, null, false)!.topLine).toBeNull();
  });

  it('names the count in a small class: "You vs top 3"', () => {
    expect(classPaceView(rDoc, null, false)!.topLine!.label).toBe(
      'You vs top 3',
    );
  });
});

describe('cutRows: the top five, him and two each side, "All N ›" for the rest', () => {
  const rows = Array.from({length: 30}, (_, i) => i);

  it(`a class of ${CAP_ROWS} or fewer shows every row`, () => {
    expect(cutRows(rows.slice(0, CAP_ROWS), 6)).toEqual({
      shown: rows.slice(0, CAP_ROWS),
      hidden: 0,
    });
  });

  it('over it: the first five, him and the two either side of him, and the count left out', () => {
    const {shown, hidden} = cutRows(rows, 17);
    expect(shown).toEqual([0, 1, 2, 3, 4, 15, 16, 17, 18, 19]);
    expect(hidden).toBe(30 - shown.length);
    expect(TOP_ROWS + 2 * NEAR_YOU + 1).toBe(shown.length);
  });

  it('him inside the top five, or at an edge, does not repeat or go past the rows', () => {
    expect(cutRows(rows, 2).shown).toEqual([0, 1, 2, 3, 4]);
    expect(cutRows(rows, 29).shown).toEqual([0, 1, 2, 3, 4, 27, 28, 29]);
    expect(cutRows(rows, -1).shown).toEqual([0, 1, 2, 3, 4]);
  });

  it('the view applies it to a class over the cap, and All shows the rest', () => {
    const many = [
      car({player: true, pos: 14, t: 100, s: [40, 30, 30]}),
      ...Array.from({length: 20}, (_, i) =>
        car({pos: i < 13 ? i + 1 : i + 2, t: 99 + i * 0.1, s: [40, 30, 30]}),
      ),
    ];
    const doc = classPaceDoc(many)!;
    const cut = classPaceView(doc, null, false)!;
    expect(cut.total).toBe(21);
    expect(cut.rows.length).toBe(10);
    expect(cut.hidden).toBe(11);
    expect(cut.rows.some(r => r.you)).toBe(true);
    const everyone = classPaceView(doc, null, true)!;
    expect(everyone.rows.length).toBe(21);
    expect(everyone.hidden).toBe(0);
  });
});
