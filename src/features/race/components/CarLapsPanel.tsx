import {ScrollView, StyleSheet, View} from 'react-native';

import {size, space, useTheme} from '@/src/design';
import {Text} from '@/src/ui';

import {type CarLapsView} from '../carLapsView';

// Six rows show; more scroll inside the panel, so the board does not jump.
const VISIBLE_ROWS = 6;
const LAP_W = 30;
const TIME_W = 80;

/** One car's laps, approximate, under its leaderboard row (roadmap D55). */
export function CarLapsPanel({view, rowH}: {view: CarLapsView; rowH: number}) {
  const {color} = useTheme();
  return (
    <View style={[styles.panel, {borderColor: color.line}]}>
      <Text variant='tableHeader' tone='textMuted' style={styles.title}>
        {view.title}
      </Text>
      <ScrollView nestedScrollEnabled style={{maxHeight: rowH * VISIBLE_ROWS}}>
        {view.rows.map(r => (
          <View key={r.key} style={[styles.row, {height: rowH}]}>
            <Text variant='data' tone='textMuted' style={styles.lap}>
              {r.lap}
            </Text>
            <Text variant='data' tone='text' style={styles.time}>
              {r.time}
            </Text>
            <Text variant='dataSmall' tone='accentInk'>
              {r.tag}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginHorizontal: size.gutter,
    marginBottom: space.sm,
    borderLeftWidth: 1,
    paddingLeft: space.md,
  },
  title: {paddingVertical: space.xs},
  row: {flexDirection: 'row', alignItems: 'center', gap: space.sm},
  lap: {width: LAP_W, textAlign: 'right'},
  time: {width: TIME_W, textAlign: 'right'},
});
