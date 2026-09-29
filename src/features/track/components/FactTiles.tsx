import {StyleSheet, View} from 'react-native';

import {space} from '@/src/design';
import {Text} from '@/src/ui';

import {type TrackFact} from '../model';

// Fact tiles (handoff T1 title strip; phone 2-column grid). A missing fact
// has no tile at all.
export function FactTiles({
  facts,
  layout,
}: {
  facts: TrackFact[];
  layout: 'row' | 'grid';
}) {
  return (
    <View style={layout === 'row' ? styles.row : styles.grid}>
      {facts.map(f => (
        <View
          key={f.label}
          style={layout === 'row' ? styles.rowTile : styles.gridTile}>
          <Text variant='tableHeader' tone='textMuted'>
            {f.label}
          </Text>
          <Text variant='factValue' numberOfLines={1}>
            {f.value}
          </Text>
          {f.sub ? (
            <Text variant='explainer' tone='textMuted' numberOfLines={1}>
              {f.sub}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const TILE_MAX_W = 200;

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: space.xxl + space.xs},
  rowTile: {maxWidth: TILE_MAX_W, minWidth: 0, gap: space.xxs},
  grid: {flexDirection: 'row', flexWrap: 'wrap', rowGap: space.lg + 2},
  gridTile: {width: '50%', paddingRight: space.lg, gap: space.xxs},
});
