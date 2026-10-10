import {describe, expect, it, jest} from '@jest/globals';
import {act, create} from 'react-test-renderer';

import {SessionWorkspace} from './SessionWorkspace';

// The wide layout's centre: the grid must mount here, not only in the phone
// list header (SessionScreen returns this component on wide layouts).

jest.mock('expo-router', () => ({useRouter: () => ({push: () => {}})}));

jest.mock('@/src/design', () => ({
  space: {xs: 4, sm: 8, md: 12, lg: 16, xl: 24},
  useLayout: () => ({width: 1440}),
  useTheme: () => ({color: {bg: '#000', surface: '#111', text: '#fff'}}),
}));

jest.mock('@/src/nav/routes', () => ({trackHref: () => '/track'}));

jest.mock('@/src/ui', () => ({
  PANEL_DIVIDER_W: 0,
  PanelDivider: () => null,
  Text: ({children}: {children: unknown}) => children,
}));

jest.mock('../desktopModel', () => ({useSessionDesktopModel: () => null}));

jest.mock('./EnergyLineRow', () => ({EnergyLineRow: () => null}));
jest.mock('./LapTableRow', () => ({
  LapTableHeader: () => null,
  SectionFooter: () => null,
  WIDE_ROW_H: 40,
}));
jest.mock('./StintCornerBars', () => ({StintCornerBars: () => null}));
jest.mock('./StintsPanel', () => ({StintsPanel: () => null}));
jest.mock('./SessionGrid', () => {
  const {createElement} = require('react');
  const {Text} = require('react-native');
  return {
    SessionGrid: ({id}: {id: string}) =>
      createElement(Text, {testID: 'grid'}, `grid:${id}`),
  };
});

describe('SessionWorkspace', () => {
  it('mounts the session grid in the wide centre', () => {
    const model = {
      trackId: null,
      facts: [],
      energy: null,
      optimum: [],
      rows: [],
      sections: null,
      detail: null,
    } as unknown as Parameters<typeof SessionWorkspace>[0]['model'];
    const noop = () => {};
    let tree: ReturnType<typeof create> | undefined;
    act(() => {
      tree = create(
        <SessionWorkspace
          sessionId='s1'
          model={model}
          selection={{laps: [], hl: null} as never}
          onSelectionChange={noop}
          colorOf={() => '#fff'}
          onHighlight={noop}
          scrollToLapId={null}
          chart={() => null}
          detail={null}
          tray={null}
          cards={null}
          renderRow={() => null}
          tagKey=''
          pitFocus={null}
          side={{width: 0, onResize: noop, onCommit: noop, reset: noop}}
        />,
      );
    });
    expect(tree!.root.findByProps({testID: 'grid'}).props.children).toBe(
      'grid:s1',
    );
  });
});
