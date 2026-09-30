import {type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';

import {type Field} from '@/src/analysis/field';
import {space} from '@/src/design';
import {useHowToRead} from '@/src/ui';

import {RADAR_HELP} from '../chartHelp';
import {RadarDock} from './RadarDock';

/** A chart with the radar docked beside it on the phone (R2b), and the radar's "?" under it. */
export function DockedChart({
  chart,
  chartW,
  field,
  lapNumber,
  cursorM,
}: {
  chart: ReactNode;
  chartW: number;
  field: Field;
  lapNumber: number;
  cursorM: number;
}) {
  const help = useHowToRead('the radar', RADAR_HELP);
  return (
    <View style={styles.block}>
      <View style={styles.docked}>
        {/* Fixed width: the explainer's long line must wrap, not push the radar out. */}
        <View style={{width: chartW}}>{chart}</View>
        <RadarDock
          field={field}
          lapNumber={lapNumber}
          cursorM={cursorM}
          footer={help.button}
        />
      </View>
      {help.panel}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {gap: space.xs},
  docked: {flexDirection: 'row', gap: space.md},
});
