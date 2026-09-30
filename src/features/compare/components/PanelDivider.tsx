import {useEffect, useRef, useState} from 'react';
import {PanResponder, StyleSheet, View, type ViewStyle} from 'react-native';

import {useTheme} from '@/src/design';

// The draggable divider between the charts and the right column (desktop
// Compare). Dragging left widens the right column. The caller clamps and
// remembers the width; this only reports it.

const HIT_W = 10;
// react-native-web applies `cursor` to any view; RN's types only know it on
// some.
const RESIZE_CURSOR = {cursor: 'col-resize'} as unknown as ViewStyle;

export function PanelDivider({
  width,
  onResize,
}: {
  /** The right column's current width, points. */
  width: number;
  onResize: (width: number) => void;
}) {
  const {color} = useTheme();
  const [active, setActive] = useState(false);
  // PanResponder reads its handlers once: keep the latest in refs.
  const latest = useRef({width, onResize});
  useEffect(() => {
    latest.current = {width, onResize};
  });
  const start = useRef(width);
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        start.current = latest.current.width;
        setActive(true);
      },
      onPanResponderMove: (_, g) =>
        latest.current.onResize(start.current - g.dx),
      onPanResponderRelease: () => setActive(false),
      onPanResponderTerminate: () => setActive(false),
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
  hit: {width: HIT_W, alignItems: 'center'},
  line: {width: 1, flex: 1},
});
