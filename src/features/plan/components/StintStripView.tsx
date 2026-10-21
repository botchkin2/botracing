import {useState} from 'react';
import {StyleSheet, View} from 'react-native';

import {hitBox, radius, space, useTheme} from '@/src/design';
import {Pressable, Text} from '@/src/ui';

import {type StripCell} from '../stintStrip';

/**
 * The race's laps as one bar (thread 99, UX note #6729): the formation a
 * narrow cell with no number, each stint a block named by its laps, divided
 * where the stops are. A tap on a block opens its numbers under the bar
 * (gauge #6730: the phone keeps what the desktop table shows); a second tap
 * closes them.
 */
export function StintStripView({
  cells,
  label,
}: {
  cells: StripCell[];
  label: string;
}) {
  const {color} = useTheme();
  const [open, setOpen] = useState<string | null>(null);
  const shown = cells.find(c => c.key === open) ?? null;
  return (
    <View style={styles.box}>
      <View style={styles.bar} accessibilityLabel={label}>
        {cells.map(c =>
          c.formation ? (
            <View
              key={c.key}
              accessibilityLabel='Formation'
              style={[
                styles.cell,
                styles.formation,
                {flexGrow: c.share, backgroundColor: color.trackFill},
              ]}
            />
          ) : (
            <Pressable
              key={c.key}
              accessibilityRole='button'
              accessibilityLabel={`${c.label}: ${c.detail.join(', ')}`}
              onPress={() => setOpen(open === c.key ? null : c.key)}
              style={[
                styles.cell,
                {
                  flexGrow: c.share,
                  backgroundColor:
                    open === c.key ? color.accentTint : color.surfaceRaised,
                  borderColor: open === c.key ? color.accent : color.lineStrong,
                },
              ]}>
              <Text variant='dataSmall' numberOfLines={1}>
                {c.label}
              </Text>
            </Pressable>
          ),
        )}
      </View>
      {shown ? (
        <View style={styles.detail}>
          <Text variant='dataStrong'>{shown.label}</Text>
          <Text variant='dataSmall' tone='textSecondary'>
            {shown.detail.join(' · ')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {gap: space.sm},
  bar: {flexDirection: 'row', gap: space.xxs},
  cell: {
    flexBasis: 0,
    minWidth: space.md,
    minHeight: hitBox.link.minHeight,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  formation: {borderWidth: 0},
  detail: {gap: space.xxs},
});
