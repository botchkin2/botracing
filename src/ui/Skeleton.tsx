import {StyleSheet, View} from 'react-native';

import {radius, useTheme} from '@/src/design';

/**
 * A quiet placeholder at the real size of what will replace it, so nothing
 * moves when data lands (round 3 R4c). No shimmer: the handoff has no motion.
 */
export function Skeleton({
  height,
  width = '100%',
  strong,
}: {
  height: number;
  width?: number | `${number}%`;
  /** The lighter fill, for rows on a raised surface. */
  strong?: boolean;
}) {
  const {color} = useTheme();
  return (
    <View
      accessibilityLabel='Loading'
      style={[
        styles.block,
        {
          height,
          width,
          backgroundColor: strong ? color.gridNeutral : color.surfaceRaised,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({block: {borderRadius: radius.xs}});
