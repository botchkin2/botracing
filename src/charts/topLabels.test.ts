import {describe, expect, it} from '@jest/globals';

import {
  LABEL_CHAR_W,
  LABEL_ROW,
  type PlacedLabel,
  labelsBottom,
  placeTopLabels,
} from './topLabels';

const box = (l: PlacedLabel) => {
  const w = l.text.length * LABEL_CHAR_W;
  const left = l.anchor === 'end' ? l.x - w : l.x;
  return {left, right: left + w, row: l.row};
};

// Two labels overlap when they share a row and their spans touch, or sit in
// rows closer than a text line.
function overlaps(placed: PlacedLabel[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < placed.length; i++)
    for (let j = i + 1; j < placed.length; j++) {
      const a = box(placed[i]);
      const b = box(placed[j]);
      const rowGap = Math.abs(a.row - b.row) * LABEL_ROW;
      if (rowGap < 11 && a.left < b.right && b.left < a.right)
        out.push(`${placed[i].text} x ${placed[j].text}`);
    }
  return out;
}

const label = (key: string, x: number, text: string) => ({
  key,
  x,
  text,
  color: '#fff',
});

describe('placeTopLabels', () => {
  // The 1 Oct Road Atlanta race: stops after laps 10 and 11, so two stint
  // labels one bar apart, each saying why it began.
  for (const [width, slot] of [
    [375, 14],
    [640, 29],
    [1440, 60],
  ] as const) {
    it(`two stops a lap apart stack at ${width} wide, never overlapping`, () => {
      const placed = placeTopLabels(
        [
          label('s2', 11 * slot + 3, 'STINT 2 · PIT'),
          label('s3', 12 * slot + 3, 'STINT 3 · PIT'),
        ],
        width,
      );
      expect(overlaps(placed)).toEqual([]);
      expect(placed.map(l => l.row)).toEqual(
        slot < 40 ? [0, 1] : placed.map(l => l.row),
      );
    });
  }

  it('rows are further apart than the text is tall', () => {
    expect(LABEL_ROW).toBeGreaterThan(11);
  });

  it('keeps every label apart when stops and resets crowd the chart', () => {
    // Every combination of label positions over three widths: a stint label
    // every bar and a pit label between them.
    for (const width of [320, 375, 768, 1440]) {
      for (const step of [1, 2, 3, 5]) {
        const labels = [];
        for (let i = 0; i < 12; i++) {
          labels.push(
            label(`s${i}`, (i * step + 1) * 14 + 3, `STINT ${i + 2} · PIT`),
          );
          labels.push(label(`p${i}`, (i * step + 1) * 14 + 9, 'PIT'));
        }
        expect(overlaps(placeTopLabels(labels, width))).toEqual([]);
      }
    }
  });

  it('flips a label that would run past the right edge and still clears the one before', () => {
    const placed = placeTopLabels(
      [label('a', 300, 'STINT 3 · PIT'), label('b', 340, 'STINT 4 · RESET')],
      375,
    );
    expect(placed.some(l => l.anchor === 'end')).toBe(true);
    expect(overlaps(placed)).toEqual([]);
  });

  it('plots below the last row, and reserves nothing with no labels', () => {
    expect(labelsBottom([])).toBe(0);
    const placed = placeTopLabels(
      [label('a', 10, 'STINT 2 · PIT'), label('b', 20, 'STINT 3 · PIT')],
      400,
    );
    expect(labelsBottom(placed)).toBeGreaterThan(
      labelsBottom(placed.slice(0, 1)),
    );
  });
});
