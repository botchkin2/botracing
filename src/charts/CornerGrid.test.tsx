import {describe, expect, it, jest} from '@jest/globals';
import {act, create} from 'react-test-renderer';

import {ThemeProvider} from '@/src/design/theme';
import {Text} from '@/src/ui';

import {CornerCells, CornerGrid} from './CornerGrid';

// The phone's section grid: a header tap jumps playback to the section start
// (the same helper as the desktop grid, D28), a cell tap opens the corner.
const grid = (
  onJumpSection: (n: number) => void,
  onPressCorner = jest.fn<(n: number) => void>(),
) =>
  create(
    <ThemeProvider>
      <CornerGrid
        width={360}
        corners={[1, 2]}
        heads={['T1', 'T2–5']}
        rows={[{key: 'a', label: 'L1', cells: [0.1, -0.2]}]}
        openCorner={null}
        onPressCorner={onPressCorner}
        onJumpSection={onJumpSection}
      />
    </ThemeProvider>,
  );

describe('CornerCells: a cell with no gap says why', () => {
  const texts = (r: ReturnType<typeof create>): (string | undefined)[] =>
    r.root
      .findAll(
        n =>
          typeof n.type === 'string' &&
          n.props.accessibilityLabel !== undefined,
      )
      .map(n => n.props.accessibilityLabel);

  it('wheels off reads off, a missing time reads a dash, in the label at any width and on the cell where it fits', () => {
    const cells = [0.2, {absent: 'off' as const}, {absent: 'none' as const}];
    let wide: ReturnType<typeof create> | undefined;
    let narrow: ReturnType<typeof create> | undefined;
    act(() => {
      wide = create(
        <ThemeProvider>
          <CornerCells cells={cells} cellW={40} labels={['T1', 'T2', 'T3']} />
        </ThemeProvider>,
      );
      narrow = create(
        <ThemeProvider>
          <CornerCells
            cells={cells}
            cellW={16}
            showValue={false}
            labels={['T1', 'T2', 'T3']}
          />
        </ThemeProvider>,
      );
    });
    expect(texts(wide!)).toEqual(['T1 +.20', 'T2 off', 'T3 —']);
    expect(texts(narrow!)).toEqual(['T1 +.20', 'T2 off', 'T3 —']);
    const shown = (r: ReturnType<typeof create>) =>
      r.root.findAllByType(Text).map(t => t.props.children);
    expect(shown(wide!)).toEqual(['+.20', 'off', '—']);
    // Narrow: no numbers, but the wheels-off cell still draws its mark.
    expect(shown(narrow!)).toEqual(['×']);
  });
});

describe('CornerGrid on the phone', () => {
  it('a section header tap jumps playback to that section (not the corner page)', () => {
    const jump = jest.fn<(n: number) => void>();
    const corner = jest.fn<(n: number) => void>();
    let r: ReturnType<typeof grid> | undefined;
    act(() => {
      r = grid(jump, corner);
    });
    const head = r!.root.findByProps({accessibilityLabel: 'Jump to T2–5'});
    act(() => head.props.onPress());
    expect(jump).toHaveBeenCalledWith(2);
    expect(corner).not.toHaveBeenCalled();
  });

  it('a lap cell still opens that corner', () => {
    const jump = jest.fn<(n: number) => void>();
    const corner = jest.fn<(n: number) => void>();
    let r: ReturnType<typeof grid> | undefined;
    act(() => {
      r = grid(jump, corner);
    });
    // The lap cells are the Pressables without a label (the headers have one).
    const cell = r!.root.findAll(
      n =>
        typeof n.props.onPress === 'function' &&
        n.props.accessibilityLabel === undefined,
    )[0];
    act(() => cell.props.onPress());
    expect(corner).toHaveBeenCalled();
    expect(jump).not.toHaveBeenCalled();
  });
});
