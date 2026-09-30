import {Pressable, StyleSheet, View} from 'react-native';

import {radius, space, useTheme} from '@/src/design';
import {Text} from '@/src/ui';

/**
 * − / + on a Follow map, bottom left: `zoom` is the step index out of
 * `steps`, 0 the most zoomed in, so − shows more track. `bottom` lifts them clear of the map's own scale bar where needed.
 */
export function MapZoomButtons({
  zoom,
  steps,
  onZoom,
  bottom = space.xs,
}: {
  zoom: number;
  steps: number;
  onZoom: (zoom: number) => void;
  bottom?: number;
}) {
  const last = steps - 1;
  return (
    <View style={[styles.zoom, {bottom}]}>
      <ZoomButton
        label='−'
        hint='Zoom the map out'
        disabled={zoom === last}
        onPress={() => onZoom(zoom + 1)}
      />
      <ZoomButton
        label='+'
        hint='Zoom the map in'
        disabled={zoom === 0}
        onPress={() => onZoom(zoom - 1)}
      />
    </View>
  );
}

function ZoomButton({
  label,
  hint,
  disabled,
  onPress,
}: {
  label: string;
  hint: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const {color} = useTheme();
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={hint}
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={onPress}
      hitSlop={space.sm}
      style={[
        styles.zoomButton,
        {
          borderColor: color.lineStrong,
          backgroundColor: color.surfaceOverlay,
          opacity: disabled ? 0.4 : 1,
        },
      ]}>
      <Text variant='dataStrong'>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  zoom: {
    position: 'absolute',
    left: space.xs,
    flexDirection: 'row',
    gap: space.xs,
  },
  zoomButton: {
    width: 28,
    height: 28,
    borderWidth: 1,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
