import {useEffect, useRef, useState} from 'react';
import {
  PanResponder,
  Platform,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';

import {useTheme} from '@/src/design';

// The draggable divider beside a side column on the desktop pages (Compare,
// Session, Race, Corner). `anchor` says which column the width belongs to:
// dragging left widens a right column, dragging right widens a left one. A
// quick second tap (a double click) asks for the default width. The caller
// clamps and remembers the width; this only reports it.

/** The divider's width, points; the workspace lays out around it. */
export const PANEL_DIVIDER_W = 10;
/** Two taps within this many ms, with no drag between, are a double click. */
const DOUBLE_TAP_MS = 350;
/** A pointer that moved less than this many points did not drag. */
const TAP_SLOP = 3;
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
  onReset,
  anchor = 'right',
  label = 'Resize the side panel',
}: {
  /** The column's current width, points. */
  width: number;
  /** Which column the width is: 'right' (the default) or 'left'. */
  anchor?: 'left' | 'right';
  /** Spoken name; the default says "side panel". */
  label?: string;
  /** A double click: back to the default width. */
  onReset?: () => void;
  /** While dragging: the width the pointer asks for. */
  onResize: (width: number) => void;
  /** On release: the last width asked for, to remember. */
  onCommit: (width: number) => void;
}) {
  const {color} = useTheme();
  const [active, setActive] = useState(false);
  // PanResponder reads its handlers once: keep the latest in refs.
  const latest = useRef({width, onResize, onCommit, onReset, anchor});
  useEffect(() => {
    latest.current = {width, onResize, onCommit, onReset, anchor};
  });
  const lastTapAt = useRef(0);
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
        const dx = latest.current.anchor === 'left' ? g.dx : -g.dx;
        last.current = start.current + dx;
        latest.current.onResize(last.current);
      },
      onPanResponderRelease: (_, g) => {
        holdSelection(false);
        setActive(false);
        const tapped = Math.abs(g.dx) < TAP_SLOP;
        const now = Date.now();
        if (tapped && now - lastTapAt.current < DOUBLE_TAP_MS) {
          lastTapAt.current = 0;
          latest.current.onReset?.();
          return;
        }
        lastTapAt.current = tapped ? now : 0;
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
      accessibilityLabel={label}
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
