import {createContext, type ReactNode, useContext} from 'react';
import {useWindowDimensions} from 'react-native';
import {SafeAreaInsetsContext} from 'react-native-safe-area-context';

import {type LayoutMetrics, layoutMetrics} from './layoutMetrics';

export type Layout = LayoutMetrics;

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
  // The context (not the hook) so a tree without a provider reads no insets.
  const safe = useContext(SafeAreaInsetsContext);
  return layoutMetrics(
    window.width,
    window.height,
    inset,
    safe?.left ?? 0,
    safe?.right ?? 0,
  );
}
