import {StyleSheet, View} from 'react-native';

import {size, useTheme} from '@/src/design';

/**
 * A small to-scale bar in two neutral inks (no colour: colour has one meaning
 * each, CODE_STANDARDS section 4): `parts` are shares of `total`, drawn left
 * to right, in a bright and a dim ink. The Pit stops card's VE out (what was left, then
 * what the stop added, of a full load) and pit lane (refuelling inside the
 * lane time) bars, and the Fuel card's used and left.
 */
export function SplitBar({
  parts,
  total = 1,
  width,
  label,
}: {
  parts: {value: number; ink: 'bright' | 'dim'}[];
  /** What the bar's full width stands for, in the parts' unit. */
  total?: number;
  /** Bar width in points. */
  width: number;
  /** For a screen reader: what the bar says. */
  label: string;
}) {
  const {color} = useTheme();
  const scale = total > 0 ? width / total : 0;
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[
        styles.track,
        {width, height: size.pitBar, backgroundColor: color.line},
      ]}>
      {parts.map((p, i) => (
        <View
          key={i}
          style={{
            width: Math.max(0, Math.min(width, p.value * scale)),
            height: size.pitBar,
            backgroundColor:
              p.ink === 'bright' ? color.textSecondary : color.textFaint,
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {flexDirection: 'row', borderRadius: 1, overflow: 'hidden'},
});
