// The numbers audit (pit-wall thread 1 #4835): for one session, the headline
// numbers the Session screen shows, computed with the app's own model
// functions, against an independent recompute from the stored laps. It reports
//   mismatch   a shown number that differs from the recompute
//   set        a number computed on another set of laps than its label says
//   zero       a 0 shown where a value is missing (a spread of one lap)
//   selection  the opening selection is not "every comparable lap" (decision
//              2026-10-11 point 3)
// Pure: the runner (numbersAudit.test.ts) fetches, this checks. The recompute
// below deliberately shares no code with src/analysis/setStats.ts.
import {formatLapTime} from '@/src/design';
import {
  type Lap,
  type SessionDetail,
  type TrackMapData,
} from '@/src/data/sessions/adapters';
import {openingLapIds, defaultSessionOf} from '@/src/data/sessions/defaultLaps';
import {segmentTimesFor} from '@/src/data/sessions/segments';
import {buildSessionModel} from '@/src/features/session/model';
import {buildStintTable} from '@/src/features/session/desktopModel';
import {sessionGrid} from '@/src/features/session/grid';

export type FindingType = 'mismatch' | 'set' | 'zero' | 'selection';

export type Finding = {
  type: FindingType;
  /** What is checked: "head.median", "stint 2 median", "grid T4 spread". */
  what: string;
  shown: string;
  expected: string;
  note?: string;
};

// -- independent maths: sort, interpolate, nothing shared with the app --------

const finite = (xs: readonly (number | null | undefined)[]): number[] =>
  xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));

function q(sortedAsc: number[], p: number): number {
  const pos = (sortedAsc.length - 1) * p;
  const lo = Math.floor(pos);
  const frac = pos - lo;
  return lo + 1 < sortedAsc.length
    ? sortedAsc[lo] * (1 - frac) + sortedAsc[lo + 1] * frac
    : sortedAsc[lo];
}

export function stats(xs: readonly (number | null | undefined)[]) {
  const s = finite(xs).sort((a, b) => a - b);
  if (s.length === 0) return {n: 0, median: null, best: null, iqr: null};
  return {
    n: s.length,
    median: q(s, 0.5),
    best: s[0],
    iqr: s.length < 2 ? null : q(s, 0.75) - q(s, 0.25),
  };
}

// 1 ms: the app prints 3 decimals; a difference below half a thousandth is rounding.
const TOL_S = 0.0006;
const same = (a: number | null, b: number | null) =>
  a == null || b == null ? a === b : Math.abs(a - b) <= TOL_S;

const lapText = (v: number | null) => (v == null ? '—' : formatLapTime(v));
const num = (v: number | null, d = 3) => (v == null ? '—' : v.toFixed(d));

/** "1:21.938" back to seconds; null for anything else. */
function parseLap(text: string): number | null {
  const m = text.match(/^(\d+):(\d{2}\.\d{3})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function auditSession(
  session: SessionDetail,
  laps: Lap[],
  map: TrackMapData | null,
): Finding[] {
  const out: Finding[] = [];
  const add = (f: Finding) => out.push(f);

  // The selection the screen opens on, and the basis it reads.
  const opening = openingLapIds(laps, defaultSessionOf(session));
  const comparable = laps.filter(l => l.comparable && l.timeS != null);
  const ticked = new Set(opening);
  const basis = (
    ticked.size ? laps.filter(l => ticked.has(l.id)) : comparable
  ).filter(l => l.timeS != null);
  const all = stats(comparable.map(l => l.timeS));
  const sel = stats(basis.map(l => l.timeS));

  // selection: decision 2026-10-11 point 3, the default is every comparable lap.
  const comparableIds = new Set(comparable.map(l => l.id));
  if (
    opening.length !== comparableIds.size ||
    opening.some(id => !comparableIds.has(id))
  ) {
    add({
      type: 'selection',
      what: 'opening selection',
      shown: `${opening.length} laps`,
      expected: `${comparableIds.size} comparable laps`,
      note: 'default is not "every comparable lap"',
    });
  }

  const model = buildSessionModel(
    session,
    laps,
    {laps: opening, hl: null},
    map,
  );
  const fact = (label: string) =>
    model.facts.find(f => f.label === label)?.value ?? null;

  // Counts.
  if (fact('Laps') !== String(laps.length))
    add({
      type: 'mismatch',
      what: 'head.laps',
      shown: String(fact('Laps')),
      expected: String(laps.length),
    });
  if (fact('Comparable') !== String(laps.filter(l => l.comparable).length))
    add({
      type: 'mismatch',
      what: 'head.comparable',
      shown: String(fact('Comparable')),
      expected: String(laps.filter(l => l.comparable).length),
    });

  // Best: the session's fact (a comparable lap's time, else the doc's).
  const bestShown = parseLap(fact('Best') ?? '');
  if (!same(bestShown, all.best ?? session.bestTimeS ?? null))
    add({
      type: 'mismatch',
      what: 'head.best',
      shown: fact('Best') ?? '—',
      expected: lapText(all.best ?? session.bestTimeS ?? null),
    });
  if (all.best != null && sel.best != null && !same(all.best, sel.best))
    add({
      type: 'set',
      what: 'head.best',
      shown: `${lapText(all.best)} (all comparable)`,
      expected: `${lapText(sel.best)} (selection of ${sel.n})`,
      note: 'the head best is a lap outside the selection',
    });

  // Median: a comparison, so the selection's (decision 2026-10-11). Shown as the
  // median of all comparable laps while the selection is smaller is a 'set'
  // finding (the set is not the one the screen compares by); anything else that
  // differs is a plain mismatch.
  const medShown = parseLap(fact('Median') ?? '');
  if (sel.n > 0 && !same(medShown, sel.median)) {
    const ofAll = same(medShown, all.median);
    add({
      type: ofAll ? 'set' : 'mismatch',
      what: 'head.median',
      shown: ofAll
        ? `${fact('Median')} (all ${all.n} comparable)`
        : String(fact('Median') ?? '—'),
      expected: `${lapText(sel.median)} (selection of ${sel.n})`,
      note: ofAll ? "a median is a comparison: the selection's" : undefined,
    });
  }

  // Lap rows: gap = time - selection median.
  for (const row of model.rows) {
    if (row.kind !== 'lap' || row.gap == null) continue;
    const lap = laps.find(l => l.id === row.lapId);
    if (!lap || lap.timeS == null || sel.median == null) continue;
    const expected = lap.timeS - sel.median;
    const shown = Number(row.gap.replace('−', '-').replace('±', ''));
    if (Math.abs(shown - expected) > TOL_S)
      add({
        type: 'mismatch',
        what: `row ${row.label} gap`,
        shown: row.gap,
        expected: num(expected),
      });
  }

  // Stint table.
  for (const row of buildStintTable(session, laps, ticked)) {
    const picked = (
      ticked.size ? laps.filter(l => ticked.has(l.id)) : comparable
    ).filter(l => l.stint === row.n && l.timeS != null);
    const s = stats(picked.map(l => l.timeS));
    if (!same(parseLap(row.median), s.median))
      add({
        type: 'mismatch',
        what: `stint ${row.n} median`,
        shown: row.median,
        expected: lapText(s.median),
      });
    if (!same(parseLap(row.best), s.best))
      add({
        type: 'mismatch',
        what: `stint ${row.n} best`,
        shown: row.best,
        expected: lapText(s.best),
      });
    const spread = row.spread === '—' ? null : Number(row.spread);
    if (
      s.iqr == null
        ? spread != null
        : spread == null || Math.abs(spread - s.iqr) > 0.0051
    )
      add({
        type: 'mismatch',
        what: `stint ${row.n} IQR`,
        shown: row.spread,
        expected: num(s.iqr, 2),
      });
  }

  // Grid columns: median, best, spread over the basis laps, per segment.
  const times = segmentTimesFor('turns', laps, map);
  if (times) {
    const grid = sessionGrid(times, ticked);
    const gridBasis = new Set(
      (ticked.size
        ? times.laps.filter(l => ticked.has(l.id))
        : times.laps.filter(l => l.comparable)
      ).map(l => l.id),
    );
    const picked = times.laps.filter(l => gridBasis.has(l.id));
    grid.columns.forEach((col, i) => {
      const s = stats(picked.map(l => l.timesS[i] ?? null));
      const label = `grid ${col.head}`;
      if (!same(col.medianS, s.median))
        add({
          type: 'mismatch',
          what: `${label} median`,
          shown: num(col.medianS),
          expected: num(s.median),
        });
      if (!same(col.bestS, s.best))
        add({
          type: 'mismatch',
          what: `${label} best`,
          shown: num(col.bestS),
          expected: num(s.best),
        });
      if (col.spreadS === 0 && s.n < 2) {
        // reported below as a zero
      } else if (!same(col.spreadS, s.iqr))
        add({
          type: 'mismatch',
          what: `${label} spread`,
          shown: num(col.spreadS),
          expected: num(s.iqr),
        });
      if (col.spreadS === 0 && s.n < 2)
        add({
          type: 'zero',
          what: `${label} spread`,
          shown: '0',
          expected: '—',
          note: `spread of ${s.n} value`,
        });
    });
  }

  // The stat row under the desktop table: IQR printed as 0.00 for one lap.
  const iqrRow = model.sections?.footer.find(f => f.label === 'IQR');
  if (iqrRow && sel.n === 1) {
    iqrRow.cells.forEach((cell, i) => {
      if (
        /^[0.]+$/.test(cell.replace(/[^0-9.]/g, '')) &&
        cell !== '—' &&
        cell !== ''
      )
        add({
          type: 'zero',
          what: `section footer IQR ${model.sections?.heads[i] ?? i}`,
          shown: cell,
          expected: '—',
          note: 'spread of one lap',
        });
    });
  }

  // Optimal, Median and Inconsistency per stint, with their "of N": the stint's
  // basis laps (the selection's), 5 or more for an Optimal (selectionStats.ts).
  const stintCount = session.stints.length;
  for (const stintN of new Set(laps.map(l => l.stint))) {
    const where = stintCount > 1 ? ` · stint ${stintN}` : '';
    const factOf = (name: string) =>
      model.optimum.find(f => f.label === `${name}${where}`)?.value ?? null;
    const lapsOf = basis.filter(l => l.stint === stintN);
    let optimal: number | null = null;
    if (times && lapsOf.length >= 5) {
      const ids = new Set(lapsOf.map(l => l.id));
      const inStint = times.laps.filter(l => ids.has(l.id));
      // Every segment needs 5 timed laps in the stint (selectionStats.ts, sectionOptimum.ts).
      const per = times.segments.map((_, i) =>
        stats(inStint.map(l => l.timesS[i] ?? null)),
      );
      optimal = per.every(p => p.n >= 5 && p.best != null)
        ? per.reduce((x, p) => x + (p.best as number), 0)
        : null;
    }
    const optimalShown = factOf('Optimal');
    if (optimal == null) {
      if (optimalShown != null)
        add({
          type: 'mismatch',
          what: `stint ${stintN} optimal`,
          shown: optimalShown,
          expected: 'none (under 5 laps or a segment untimed)',
        });
      continue;
    }
    if (optimalShown == null) {
      add({
        type: 'mismatch',
        what: `stint ${stintN} optimal`,
        shown: 'none',
        expected: lapText(optimal),
      });
      continue;
    }
    const nShown = Number(String(optimalShown).match(/of (\d+)/)?.[1]);
    if (nShown !== lapsOf.length)
      add({
        type: 'set',
        what: `stint ${stintN} optimal "of N"`,
        shown: `of ${nShown}`,
        expected: `of ${lapsOf.length}`,
      });
    if (!same(parseLap(String(optimalShown).split(' ')[0]), optimal))
      add({
        type: 'mismatch',
        what: `stint ${stintN} optimal`,
        shown: String(optimalShown),
        expected: lapText(optimal),
      });
    const st = stats(lapsOf.map(l => l.timeS));
    const medShownFact = factOf('Median');
    if (
      medShownFact != null &&
      !same(parseLap(String(medShownFact).split(' ')[0]), st.median)
    )
      add({
        type: 'mismatch',
        what: `stint ${stintN} median line`,
        shown: String(medShownFact),
        expected: lapText(st.median),
      });
    const incShown = factOf('Inconsistency');
    if (incShown != null && st.median != null) {
      const shown = Number(
        String(incShown).split(' ')[0].replace('−', '-').replace('±', ''),
      );
      if (Math.abs(shown - (st.median - optimal)) > TOL_S)
        add({
          type: 'mismatch',
          what: `stint ${stintN} inconsistency`,
          shown: String(incShown),
          expected: num(st.median - optimal),
        });
    }
  }

  // "of N" on each stint line of the lap table, and "n/m" in the stint table.
  for (const row of model.rows) {
    if (row.kind !== 'stint') continue;
    const stintN = Number(row.key.replace('stint-', ''));
    const n = basis.filter(l => l.stint === stintN).length;
    const of = Number(row.label.match(/of (\d+)/)?.[1]);
    if (!Number.isNaN(of) && of !== n)
      add({
        type: 'set',
        what: `stint ${stintN} line "of N"`,
        shown: `of ${of}`,
        expected: `of ${n}`,
      });
  }

  return out;
}

/** Counts per finding type and the worst examples, for the runner's report. */
export function summarise(
  perSession: {id: string; label: string; findings: Finding[]}[],
) {
  const counts: Record<FindingType, number> = {
    mismatch: 0,
    set: 0,
    zero: 0,
    selection: 0,
  };
  const sessionsWith: Record<FindingType, number> = {
    mismatch: 0,
    set: 0,
    zero: 0,
    selection: 0,
  };
  const byWhat = new Map<string, number>();
  for (const s of perSession) {
    const seen = new Set<FindingType>();
    for (const f of s.findings) {
      counts[f.type]++;
      seen.add(f.type);
      const key = `${f.type} · ${f.what.replace(/d+/g, 'N')}`;
      byWhat.set(key, (byWhat.get(key) ?? 0) + 1);
    }
    for (const t of seen) sessionsWith[t]++;
  }
  const worst = [...perSession]
    .sort((a, b) => b.findings.length - a.findings.length)
    .slice(0, 10)
    .map(s => ({
      id: s.id,
      label: s.label,
      n: s.findings.length,
      first: s.findings.slice(0, 3),
    }));
  return {
    sessions: perSession.length,
    counts,
    sessionsWith,
    byWhat: [...byWhat].sort((a, b) => b[1] - a[1]),
    worst,
  };
}
