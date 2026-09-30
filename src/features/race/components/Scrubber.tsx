import {useState} from 'react';
import {type GestureResponderEvent, StyleSheet, View} from 'react-native';

import {size, useTheme} from '@/src/design';

const LINE_H = 4;
const HEAD_W = 2;

/**
 * The race's time line: tap or drag to set the clock. `value` is 0 to 1.
 * Touch and mouse both report `locationX` inside this view.
 */
export function Scrubber({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const {color} = useTheme();
  const [width, setWidth] = useState(0);
  const at = (e: GestureResponderEvent) => {
    if (width <= 0) return;
    onChange(Math.min(1, Math.max(0, e.nativeEvent.locationX / width)));
  };
  return (
    <View
      accessibilityRole='adjustable'
      accessibilityLabel='Race time'
      accessibilityValue={{min: 0, max: 100, now: Math.round(value * 100)}}
      onLayout={e => setWidth(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={at}
      onResponderMove={at}
      style={styles.hit}>
      <View style={[styles.line, {backgroundColor: color.lineStrong}]} />
      <View
        style={[
          styles.head,
          {backgroundColor: color.accent, left: value * width - HEAD_W / 2},
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hit: {height: size.hit, justifyContent: 'center'},
  line: {height: LINE_H},
  head: {position: 'absolute', top: '25%', bottom: '25%', width: HEAD_W},
});
