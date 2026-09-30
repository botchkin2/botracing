import {useMemo} from 'react';

import {type Field} from '@/src/analysis/field';
import {raceClock} from '@/src/analysis/raceClock';
import {RADAR_RANGE_M} from '@/src/analysis/radar';
import {Radar} from '@/src/charts';

import {radarAtCursor} from '../radarModel';

/** Docked beside a chart on the phone (round 3 R2b): 98 × 148. */
export const RADAR_DOCK_W = 98;
export const RADAR_DOCK_H = 148;

/** The field radar at Compare's cursor; nothing where the field does not cover the lap. */
export function RadarDock({
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
    RADAR_DOCK_W,
    RADAR_DOCK_H,
  );
  if (!view) return null;
  return (
    <Radar
      width={RADAR_DOCK_W}
      height={RADAR_DOCK_H}
      rangeM={RADAR_RANGE_M}
      radar={view.radar}
      sampleLabel={view.sampleLabel}
    />
  );
}
