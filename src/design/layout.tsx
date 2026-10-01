import {createContext, type ReactNode, useContext} from 'react';
import {useWindowDimensions} from 'react-native';

import {size} from './tokens';

export type Layout = {
  /** Width available to this screen: the window minus any content inset. */
  width: number;
  /** ≥900 (window): two-column layouts. */
  isDesktop: boolean;
  /** ≥1280 (window): the three-column desktop workspaces. */
  isWide: boolean;
  contentWidth: number;
};

// Space a route gives to something beside the screen (the desktop sessions
// rail), so screens never need to know what sits next to them.
const InsetContext = createContext(0);

export function ContentInset({
  width,
  children,
}: {
  width: number;
  children: ReactNode;
}) {
  const outer = useContext(InsetContext);
  return (
    <InsetContext.Provider value={outer + width}>
      {children}
    </InsetContext.Provider>
  );
}

/** The one breakpoint check. Components never read Dimensions directly. */
export function useLayout(): Layout {
  const window = useWindowDimensions();
  const inset = useContext(InsetContext);
  // Breakpoints follow the window, so the desktop workspace does not drop to
  // the tablet layout just because a rail takes 280 pt.
  const isDesktop = window.width >= size.desktopBreakpoint;
  const isWide = window.width >= size.wideBreakpoint;
  const width = Math.max(0, window.width - inset);
  // Never negative: a window not measured yet reports width 0, and an SVG
  // with a negative width logs an error.
  const contentWidth = Math.max(
    0,
    Math.min(width, size.maxContent) - size.gutter * 2,
  );
  return {width, isDesktop, isWide, contentWidth};
}
