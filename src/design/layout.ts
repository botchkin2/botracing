import {useWindowDimensions} from 'react-native';

import {size} from './tokens';

export type Layout = {
  width: number;
  /** ≥900: two-column layouts. */
  isDesktop: boolean;
  /** ≥1280: the three-column desktop workspaces. */
  isWide: boolean;
  contentWidth: number;
};

/** The one breakpoint check. Components never read Dimensions directly. */
export function useLayout(): Layout {
  const {width} = useWindowDimensions();
  const isDesktop = width >= size.desktopBreakpoint;
  const isWide = width >= size.wideBreakpoint;
  const contentWidth = Math.min(width, size.maxContent) - size.gutter * 2;
  return {width, isDesktop, isWide, contentWidth};
}
