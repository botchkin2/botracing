import {describe, expect, it, jest} from '@jest/globals';
import {act, create} from 'react-test-renderer';

import {ThemeProvider} from '@/src/design/theme';

import {CornerGrid} from './CornerGrid';

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
        rows={[{key: 'a', label: 'L1', cells: [0.1, -0.2]}]}
        openCorner={null}
        onPressCorner={onPressCorner}
        onJumpSection={onJumpSection}
      />
    </ThemeProvider>,
  );

describe('CornerGrid on the phone', () => {
  it('a section header tap jumps playback to that section (not the corner page)', () => {
    const jump = jest.fn<(n: number) => void>();
    const corner = jest.fn<(n: number) => void>();
    let r: ReturnType<typeof grid> | undefined;
    act(() => {
      r = grid(jump, corner);
    });
    const head = r!.root.findByProps({accessibilityLabel: 'Jump to S2'});
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
