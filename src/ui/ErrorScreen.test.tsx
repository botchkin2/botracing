import {expect, it, jest} from '@jest/globals';
import {act, create} from 'react-test-renderer';

import {ThemeProvider} from '@/src/design/theme';

import {ErrorScreen} from './ErrorScreen';

// Ticket 87: a route that threw shows this, not a blank window.
const screen = (
  onRetry = jest.fn(),
  onLeave: (() => void) | undefined = undefined,
) =>
  create(
    <ThemeProvider>
      <ErrorScreen
        error={new Error('bad shape')}
        where='session/[id]'
        onRetry={onRetry}
        onLeave={onLeave}
      />
    </ThemeProvider>,
  );

const text = (r: ReturnType<typeof create>) =>
  r.root
    .findAll(n => n.props.variant === 'bodyStrong')
    .map(n => n.props.children);

it('says something went wrong, offers Reload, and logs the error with the route', () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  const onRetry = jest.fn();
  let r!: ReturnType<typeof create>;
  act(() => {
    r = screen(onRetry);
  });
  expect(text(r)).toContain('Something went wrong');
  const reload = r.root.findAll(n => n.props.accessibilityRole === 'button');
  expect(reload.length).toBeGreaterThan(0);
  act(() => reload[0].props.onPress());
  expect(onRetry).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledWith(
    'render error in session/[id]',
    expect.any(Error),
  );
  log.mockRestore();
});

it('offers Sessions only when there is somewhere to go', () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  let without!: ReturnType<typeof create>;
  let withLeave!: ReturnType<typeof create>;
  act(() => {
    without = screen();
    withLeave = screen(jest.fn(), jest.fn());
  });
  const buttons = (r: ReturnType<typeof create>) =>
    r.root.findAll(n => n.props.accessibilityRole === 'button').length;
  expect(buttons(withLeave)).toBeGreaterThan(buttons(without));
  log.mockRestore();
});
