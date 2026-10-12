import {describe, expect, it} from '@jest/globals';

import {type SeriesLinesProps, sameLines} from './SeriesLines';

const base: SeriesLinesProps = {
  ds: [
    {k: 3, d: 'M0,0L10,10'},
    {k: 4, d: 'M10,10L20,5'},
  ],
  wraps: [],
  color: '#fff',
  width: 1.5,
  opacity: 1,
  base: 100,
};
// What the chart builds again every frame: new arrays, same strings.
const rebuilt = (over: Partial<SeriesLinesProps> = {}): SeriesLinesProps => ({
  ...base,
  ds: base.ds.map(c => ({...c})),
  wraps: [],
  ...over,
});

describe('sameLines', () => {
  it('is true for the arrays rebuilt with the same chunks and style', () => {
    expect(sameLines(base, rebuilt())).toBe(true);
  });

  it('is false when a chunk path, a chunk key or the chunk count changes', () => {
    expect(
      sameLines(base, rebuilt({ds: [base.ds[0], {k: 4, d: 'M10,10L20,6'}]})),
    ).toBe(false);
    expect(
      sameLines(base, rebuilt({ds: [{k: 2, d: base.ds[0].d}, base.ds[1]]})),
    ).toBe(false);
    expect(sameLines(base, rebuilt({ds: [base.ds[0]]}))).toBe(false);
  });

  it('is false when the wrap chunks, colour, width, opacity, dash, fill or baseline change', () => {
    expect(
      sameLines(base, rebuilt({wraps: [{k: 'w0-1', d: 'M0,0L1,1'}]})),
    ).toBe(false);
    expect(sameLines(base, rebuilt({color: '#000'}))).toBe(false);
    expect(sameLines(base, rebuilt({width: 2}))).toBe(false);
    expect(sameLines(base, rebuilt({opacity: 0.5}))).toBe(false);
    expect(sameLines(base, rebuilt({dash: '4 2'}))).toBe(false);
    expect(sameLines(base, rebuilt({fill: 0.2}))).toBe(false);
    expect(sameLines(base, rebuilt({base: 90}))).toBe(false);
  });
});
