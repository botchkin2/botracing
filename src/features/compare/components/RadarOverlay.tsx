import {useMemo} from 'react';
import {StyleSheet, View} from 'react-native';

import {type Field} from '@/src/analysis/field';
import {raceClock} from '@/src/analysis/raceClock';
import {RADAR_RANGE_M} from '@/src/analysis/radar';
import {FOLLOW_INSET_BOTTOM, Radar} from '@/src/charts';
import {space} from '@/src/design';

import {radarAtCursor, radarHasCars} from '../radarModel';

/** The radar on the phone's Follow map: the size Race gives it there (R2). */
export const RADAR_OVERLAY_W = 72;
export const RADAR_OVERLAY_H = 108;

/**
 * The field radar at Compare's cursor, top right of the Follow map under the
 * whole-lap inset, opaque: it covers no trace (round 7, 2C: the 72 % overlay
 * on the chart hid the lines under the car blocks). Only there while a car is
 * in range. It does not take touches.
 */
export function RadarOverlay({
  field,
  lapNumber,
  cursorM,
}: {
  field: Field;
  lapNumber: number;
  cursorM: number;
}) {
  // Built once per field: it scans every update.
  const clock = useMemo(() => raceClock(field), [field]);
  const view = radarAtCursor(
    field,
    clock,
    lapNumber,
    cursorM,
    RADAR_OVERLAY_W,
    RADAR_OVERLAY_H,
  );
  if (!radarHasCars(view)) return null;
  return (
    <View style={styles.at} pointerEvents='none'>
      <Radar
        solid
        width={RADAR_OVERLAY_W}
        height={RADAR_OVERLAY_H}
        rangeM={RADAR_RANGE_M}
        radar={view.radar}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  at: {
    position: 'absolute',
    top: FOLLOW_INSET_BOTTOM + space.xs,
    right: space.xs,
  },
});
