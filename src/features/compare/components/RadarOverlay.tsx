import {useMemo} from 'react';
import {StyleSheet, View} from 'react-native';

import {type Field} from '@/src/analysis/field';
import {raceClock} from '@/src/analysis/raceClock';
import {RADAR_RANGE_M} from '@/src/analysis/radar';
import {Radar} from '@/src/charts';
import {space} from '@/src/design';

import {radarAtCursor, radarHasCars} from '../radarModel';

/** The radar over a chart on the phone: the size Race gives it there (R2). */
export const RADAR_OVERLAY_W = 72;
export const RADAR_OVERLAY_H = 108;

/**
 * The field radar at Compare's cursor, top right of the chart it is drawn
 * over. Only there while a car is in range: the chart keeps the whole width,
 * and the radar comes and goes over it. It does not take touches, so the
 * chart still scrubs underneath.
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
        overlay
        width={RADAR_OVERLAY_W}
        height={RADAR_OVERLAY_H}
        rangeM={RADAR_RANGE_M}
        radar={view.radar}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  at: {position: 'absolute', top: space.xs, right: space.xs},
});
