import {describe, expect, it} from '@jest/globals';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import qualifying from '@/src/analysis/__fixtures__/classPaceQ.json';
import {classPaceDoc, type ResultsDriver} from '@/src/analysis/classPace';
import {ThemeProvider} from '@/src/design/theme';

import {ClassPaceBlock} from './ClassPaceBlock';

// His real qualifying (Sebring 10-21), cut to him and a few cars of each class
// (src/analysis/__fixtures__/classPaceQ.json): GT3 and LMP2.
const doc = classPaceDoc(qualifying.drivers as ResultsDriver[])!;

const texts = (r: ReactTestRenderer): string[] =>
  r.root
    .findAll(n => (n.type as unknown) === 'Text')
    .map(n => n.children.join(''));

function mount(): ReactTestRenderer {
  let r: ReactTestRenderer | undefined;
  act(() => {
    r = create(
      <ThemeProvider>
        <ClassPaceBlock doc={doc} />
      </ThemeProvider>,
    );
  });
  return r!;
}

// The same cars with one lap each, as an iRacing input of qualifying bests folds (tools/sessions/irResults.mjs).
const qualifyingDoc = classPaceDoc(
  (qualifying.drivers as ResultsDriver[]).map(d => ({
    ...d,
    laps: d.laps
      .filter(l => l.t !== null)
      .slice(0, 1)
      .map(l => ({...l, s1: null, s2: null, s3: null})),
  })),
  'qualifying',
)!;

function mountDoc(d: typeof doc): ReactTestRenderer {
  let r: ReactTestRenderer | undefined;
  act(() => {
    r = create(
      <ThemeProvider>
        <ClassPaceBlock doc={d} />
      </ThemeProvider>,
    );
  });
  return r!;
}

describe('ClassPaceBlock on qualifying bests (iRacing, thread 123 #8381)', () => {
  it('names its basis once, heads the place Q, and has no Median or sector columns', () => {
    const t = texts(mountDoc(qualifyingDoc));
    expect(t).toContain('Class pace · qualifying best');
    expect(t).not.toContain('Class pace · all timed laps');
    expect(t).toContain('Q');
    expect(t).not.toContain('Pos');
    expect(t).toContain('Best');
    expect(t).not.toContain('Median');
    expect(t.filter(x => x === 'S1' || x === 'S2' || x === 'S3')).toEqual([]);
    expect(t).toContain('You');
  });

  it('has no top line and no row that opens', () => {
    const r = mountDoc(qualifyingDoc);
    expect(texts(r).some(x => /^You vs top/.test(x))).toBe(false);
    expect(
      r.root.findAll(
        n =>
          typeof n.props?.accessibilityLabel === 'string' &&
          /sectors against yours/.test(n.props.accessibilityLabel),
      ),
    ).toEqual([]);
  });

  it('a race result block is as it was: all timed laps, Pos, Median', () => {
    const t = texts(mount());
    expect(t).toContain('Pos');
    expect(t).toContain('Median');
    expect(t).not.toContain('Q');
  });
});

describe('ClassPaceBlock', () => {
  it('the top line, signed from his side, then his class by place with him as You', () => {
    const t = texts(mount());
    expect(t).toContain('Class pace · all timed laps');
    expect(t).toContain('You vs top 5');
    // his S1 is faster than the top cars' (−), his S2 slower (+): U+2212 for the minus
    expect(t.some(x => /^S1 −0\.31$/.test(x))).toBe(true);
    expect(t.some(x => /^S2 \+0\.03$/.test(x))).toBe(true);
    expect(t).toContain('You');
    expect(t).toContain('Ford Mustang');
    // no name, no number: only models
    expect(t.some(x => /Botkin/.test(x))).toBe(false);
  });

  it('his class is the first chip and the other class has times only, no cells and no tap', () => {
    const r = mount();
    const before = r.root.findAll(
      n =>
        typeof n.props?.accessibilityLabel === 'string' &&
        /sectors against yours/.test(n.props.accessibilityLabel),
    );
    // five other GT3 cars with medians can be opened
    expect(before.length).toBeGreaterThanOrEqual(4);
    // switch to LMP2: no row can be opened
    const chip = r.root.findAll(
      n =>
        typeof n.props?.onPress === 'function' &&
        n.findAll(
          c => (c.type as unknown) === 'Text' && c.children.join('') === 'LMP2',
        ).length > 0,
    )[0];
    act(() => chip.props.onPress());
    const after = r.root.findAll(
      n =>
        typeof n.props?.accessibilityLabel === 'string' &&
        /sectors against yours/.test(n.props.accessibilityLabel),
    );
    expect(after.length).toBe(0);
    expect(texts(r)).toContain('Oreca 07');
  });

  it('the sector heads are S1 S2 S3 over his class, and there are none over another class', () => {
    const r = mount();
    expect(texts(r)).toEqual(expect.arrayContaining(['S1', 'S2', 'S3']));
    const chip = r.root.findAll(
      n =>
        typeof n.props?.onPress === 'function' &&
        n.findAll(
          c => (c.type as unknown) === 'Text' && c.children.join('') === 'LMP2',
        ).length > 0,
    )[0];
    act(() => chip.props.onPress());
    // the top line's three chips still say S1 S2 S3 as "S1 −0.31"; the column heads are gone
    expect(
      texts(r).filter(x => x === 'S1' || x === 'S2' || x === 'S3'),
    ).toEqual([]);
  });

  it('a tap on a row opens their best and median sectors beside his medians, a second tap closes it', () => {
    const r = mount();
    const row = r.root.findAll(
      n =>
        typeof n.props?.accessibilityLabel === 'string' &&
        /sectors against yours/.test(n.props.accessibilityLabel),
    )[0];
    // the column head says Median once; an open row says it again
    const count = (word: string) => texts(r).filter(x => x === word).length;
    expect(count('Median')).toBe(1);
    act(() => row.props.onPress());
    expect(count('Median')).toBe(2);
    expect(texts(r)).toEqual(
      expect.arrayContaining(['S1', 'S2', 'S3', 'Best', 'You']),
    );
    act(() => row.props.onPress());
    expect(count('Median')).toBe(1);
  });
});
