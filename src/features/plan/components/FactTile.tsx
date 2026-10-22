import {StyleSheet, View} from 'react-native';

import {radius, space, useTheme} from '@/src/design';
import {Text} from '@/src/ui';

/**
 * One number of a Plan card as a raised tile (thread 99, UX note #6729): the
 * label, the value in the fact size, a muted line under it. Tiles in a row
 * give the card depth instead of rows of text.
 */
export function FactTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string | null;
}) {
  const {color} = useTheme();
  return (
    <View style={[styles.tile, {backgroundColor: color.surfaceRaised}]}>
      <Text variant='label' tone='textMuted'>
        {label}
      </Text>
      <Text variant='factValue'>{value}</Text>
      {sub ? (
        <Text variant='dataSmall' tone='textMuted'>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

/** Tiles side by side, sharing the width. */
export function TileRow({children}: {children: React.ReactNode}) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: space.md},
  tile: {
    flex: 1,
    minWidth: 0,
    gap: space.xxs,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
  },
});
