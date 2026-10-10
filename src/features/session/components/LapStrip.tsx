import {useMemo, useState} from 'react';
import {PanResponder, StyleSheet, View} from 'react-native';

import {space, useTheme} from '@/src/design';

import {type StripLap, stripBars} from '../lapStrip';

// The lap strip (Botkin's loop, #3585): one bar per lap, its height the lap's
// delta to the median of the ticked laps. A tap ticks one lap; a drag over
// the strip replaces the selection with the laps it crosses.

const HEIGHT = 56;
const MOVE_PT = 6;

export function LapStrip({
  laps,
  ticked,
  onTap,
  onDrag,
}: {
  laps: StripLap[];
  ticked: string[];
  onTap: (lapId: string) => void;
  /** The laps the drag crosses; the selection becomes exactly these. */
  onDrag: (lapIds: string[]) => void;
}) {
  const {color} = useTheme();
  const [width, setWidth] = useState(0);
  const {bars} = useMemo(() => stripBars(laps, ticked), [laps, ticked]);
  const maxAbs = Math.max(1e-9, ...bars.map(b => Math.abs(b.deltaS ?? 0)));
  const barW = laps.length ? width / laps.length : 0;
  const indexAt = (x: number) =>
    Math.min(laps.length - 1, Math.max(0, Math.floor(x / Math.max(barW, 1))));
  // The gesture's anchor: where it started, and whether it moved (a short
  // move is a tap).
  const [gesture, setGesture] = useState({start: 0, moved: false});

  // A fresh responder each render: its handlers read the current laps and
  // callbacks, and the gesture's start lives in `drag`, touched only in events.
  const responder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: e => {
      setGesture({start: e.nativeEvent.locationX, moved: false});
    },
    onPanResponderMove: (_e, g) => {
      if (Math.abs(g.dx) < MOVE_PT) return;
      setGesture({start: gesture.start, moved: true});
      const a = indexAt(gesture.start);
      const b = indexAt(gesture.start + g.dx);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      onDrag(laps.slice(lo, hi + 1).map(l => l.id));
    },
    onPanResponderRelease: () => {
      if (!gesture.moved && laps.length) onTap(laps[indexAt(gesture.start)].id);
    },
  });

  return (
    <View
      style={styles.strip}
      onLayout={e => setWidth(e.nativeEvent.layout.width)}
      {...responder.panHandlers}>
      {bars.map((b, i) => {
        const h =
          b.deltaS == null
            ? 4
            : 4 + (Math.abs(b.deltaS) / maxAbs) * (HEIGHT - 4);
        return (
          <View
            key={b.lapId}
            accessibilityLabel={`Lap ${laps[i].id}`}
            style={[
              styles.bar,
              {
                width: Math.max(2, barW - 2),
                height: h,
                backgroundColor: b.ticked ? color.accent : color.lineStrong,
                opacity: b.comparable ? 1 : 0.4,
                marginLeft:
                  laps[i].stint !== laps[i - 1]?.stint && i > 0 ? 6 : 0,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    height: HEIGHT,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 0,
    paddingVertical: space.xs,
  },
  bar: {borderRadius: 2},
});
