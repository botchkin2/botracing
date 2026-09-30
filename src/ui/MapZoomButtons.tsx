import {Pressable, StyleSheet, View} from 'react-native';

import {radius, size, space, useTheme} from '@/src/design';

import {hitFor} from './hitArea';
import {Text} from './Text';

const BUTTON = 28;
/** Width of the pair, for what is drawn beside them (the scale bar). */
// The gap is what lets each button grow 44 pt wide without overlapping the
// other (hitFor: at most half the gap).
const GAP = size.hit - BUTTON;
export const MAP_ZOOM_BUTTONS_W = 2 * BUTTON + GAP;
/** Room for the range between the buttons ("120 m"), when the caller gives one. */
export const MAP_ZOOM_LABEL_W = 48;

/**
 * "−" and "+" over a Follow map, bottom left. The caller owns the zoom steps.
 * Each button is 28 pt drawn and 44 pt to hit both ways.
 */
export function MapZoomButtons({
  canOut,
  canIn,
  onOut,
  onIn,
  rangeLabel,
}: {
  canOut: boolean;
  canIn: boolean;
  onOut: () => void;
  onIn: () => void;
  /** The distance across the view, between the buttons: "120 m". */
  rangeLabel?: string;
}) {
  return (
    <View style={styles.row}>
      <ZoomButton
        label='−'
        hint='Zoom the map out'
        disabled={!canOut}
        onPress={onOut}
      />
      {rangeLabel ? (
        <View style={styles.range}>
          <Text variant='dataSmall' tone='textSecondary'>
            {rangeLabel}
          </Text>
        </View>
      ) : null}
      <ZoomButton
        label='+'
        hint='Zoom the map in'
        disabled={!canIn}
        onPress={onIn}
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
  const hit = hitFor(GAP / 2, (size.hit - BUTTON) / 2);
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={hint}
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={onPress}
      hitSlop={hit.hitSlop}
      style={hit.style}>
      <View
        style={[
          styles.button,
          {
            borderColor: color.lineStrong,
            backgroundColor: color.surfaceOverlay,
            opacity: disabled ? 0.4 : 1,
          },
        ]}>
        <Text variant='dataStrong'>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    position: 'absolute',
    left: space.xs,
    bottom: space.xs,
    flexDirection: 'row',
    gap: GAP,
  },
  range: {
    width: MAP_ZOOM_LABEL_W,
    height: BUTTON,
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: {
    width: BUTTON,
    height: BUTTON,
    borderWidth: 1,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
