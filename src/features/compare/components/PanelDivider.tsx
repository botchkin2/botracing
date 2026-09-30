import {useEffect, useRef, useState} from 'react';
import {
  PanResponder,
  Platform,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';

import {useTheme} from '@/src/design';

// The draggable divider between the charts and the right column (desktop
// Compare). Dragging left widens the right column. The caller clamps and
// remembers the width; this only reports it.

/** The divider's width, points; the workspace lays out around it. */
export const PANEL_DIVIDER_W = 10;
// react-native-web applies `cursor` to any view; RN's types only know it on
// some.
const RESIZE_CURSOR = {cursor: 'col-resize'} as unknown as ViewStyle;

// Web: a mouse drag across the charts would select their text (the labels
// turn blue). Selection is off for the page while the handle is held.
function holdSelection(hold: boolean) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  document.body.style.userSelect = hold ? 'none' : '';
}

export function PanelDivider({
  width,
  onResize,
  onCommit,
}: {
  /** The right column's current width, points. */
  width: number;
  /** While dragging: the width the pointer asks for. */
  onResize: (width: number) => void;
  /** On release: the last width asked for, to remember. */
  onCommit: (width: number) => void;
}) {
  const {color} = useTheme();
  const [active, setActive] = useState(false);
  // PanResponder reads its handlers once: keep the latest in refs.
  const latest = useRef({width, onResize, onCommit});
  useEffect(() => {
    latest.current = {width, onResize, onCommit};
  });
  const start = useRef(width);
  const last = useRef(width);
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        start.current = latest.current.width;
        last.current = start.current;
        holdSelection(true);
        setActive(true);
      },
      onPanResponderMove: (_, g) => {
        last.current = start.current - g.dx;
        latest.current.onResize(last.current);
      },
      onPanResponderRelease: () => {
        holdSelection(false);
        setActive(false);
        latest.current.onCommit(last.current);
      },
      onPanResponderTerminate: () => {
        holdSelection(false);
        setActive(false);
        latest.current.onCommit(last.current);
      },
    }),
  );
  return (
    <View
      accessibilityRole='adjustable'
      accessibilityLabel='Resize the right panel'
      {...responder.panHandlers}
      style={[styles.hit, RESIZE_CURSOR]}>
      <View
        style={[
          styles.line,
          {backgroundColor: active ? color.accent : color.lineHeader},
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hit: {width: PANEL_DIVIDER_W, alignItems: 'center'},
  line: {width: 1, flex: 1},
});
