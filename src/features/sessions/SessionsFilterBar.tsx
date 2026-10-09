import {ScrollView, StyleSheet, View} from 'react-native';

import {space} from '@/src/design';
import {Chip, Text} from '@/src/ui';

import {type FilterOptions, type SessionsFilter} from './filter';

// Game and Track chips for the Sessions list. A row scrolls sideways inside
// itself when it is longer than the screen; the page never does.
export function SessionsFilterBar({
  filter,
  options,
  onChange,
}: {
  filter: SessionsFilter;
  options: FilterOptions;
  onChange: (next: SessionsFilter) => void;
}) {
  return (
    <View style={styles.bar}>
      {options.games.length > 1 && (
        <ChipRow label='Game'>
          <Chip
            label='All'
            selected={!filter.game}
            onPress={() => onChange({game: null, track: null})}
          />
          {options.games.map(g => (
            <Chip
              key={g.key}
              label={g.label}
              selected={filter.game === g.key}
              // A track the new game does not have is dropped by effectiveFilter.
              onPress={() => onChange({game: g.key, track: filter.track})}
            />
          ))}
        </ChipRow>
      )}
      {options.tracks.length > 1 && (
        <ChipRow label='Track'>
          <Chip
            label='All'
            selected={!filter.track}
            onPress={() => onChange({...filter, track: null})}
          />
          {options.tracks.map(t => (
            <Chip
              key={t.key}
              label={t.label}
              selected={filter.track === t.key}
              onPress={() => onChange({...filter, track: t.key})}
            />
          ))}
        </ChipRow>
      )}
    </View>
  );
}

function ChipRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.rowWrap}>
      <Text variant='tableHeader' tone='textMuted' style={styles.rowLabel}>
        {label}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={styles.chips}>
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {gap: space.xs, paddingBottom: space.sm},
  rowWrap: {flexDirection: 'row', alignItems: 'center', gap: space.md},
  rowLabel: {width: 40},
  scroll: {flex: 1},
  chips: {flexDirection: 'row', alignItems: 'center', gap: space.sm},
});
