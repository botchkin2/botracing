import {useWindowDimensions} from 'react-native';

import {size} from './tokens';

export type Layout = {width: number; isDesktop: boolean; contentWidth: number};

/** The one breakpoint check. Components never read Dimensions directly. */
export function useLayout(): Layout {
  const {width} = useWindowDimensions();
  const isDesktop = width >= size.desktopBreakpoint;
  const contentWidth = Math.min(width, size.maxContent) - size.gutter * 2;
  return {width, isDesktop, contentWidth};
}
