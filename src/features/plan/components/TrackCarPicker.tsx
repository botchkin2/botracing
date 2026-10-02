import {type ReactNode, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {hitBox, shortTrackName, space, useTheme} from '@/src/design';
import {Chip, Sheet, Text} from '@/src/ui';

import {type Combo} from '../model';

type Pick = 'track' | 'car';

/**
 * The track and the car as two dropdown chips (D6a, 07a), each opening a list
 * in a sheet. A track keeps the current car where it has driven it there, and
 * else takes the newest car; a car is one of the cars driven at this track.
 * `combos` are newest first, so the first of a track is its newest.
 */
export function TrackCarPicker({
  combos,
  current,
  onPick,
  children,
}: {
  combos: Combo[];
  current: Combo;
  onPick: (key: string) => void;
  /** More chips for the same row (the phone's Rules chip). */
  children?: ReactNode;
}) {
  const {color} = useTheme();
  const [open, setOpen] = useState<Pick | null>(null);
  const tracks = combos.filter(
    (c, i) => combos.findIndex(o => o.trackId === c.trackId) === i,
  );
  const cars = combos.filter(c => c.trackId === current.trackId);
  const choose = (key: string) => {
    setOpen(null);
    onPick(key);
  };
  const row = (key: string, label: string, selected: boolean) => (
    <Pressable
      key={key}
      accessibilityRole='button'
      accessibilityState={{selected}}
      onPress={() => choose(key)}
      style={[
        hitBox.link,
        styles.row,
        {borderColor: selected ? color.accent : color.line},
      ]}>
      <Text variant='dataStrong' tone={selected ? 'accentInk' : 'text'}>
        {label}
      </Text>
    </Pressable>
  );
  return (
    <>
      <View style={styles.chips}>
        <Chip
          label={`${shortTrackName(current.track)} ▾`}
          onPress={() => setOpen('track')}
        />
        <Chip label={`${current.car} ▾`} onPress={() => setOpen('car')} />
        {children}
      </View>
      <Sheet
        visible={open != null}
        title={open === 'car' ? 'Car' : 'Track'}
        onClose={() => setOpen(null)}>
        {open === 'track'
          ? tracks.map(t => {
              // The current car there if he has driven it, else the newest.
              const same = combos.find(
                c => c.trackId === t.trackId && c.car === current.car,
              );
              return row(
                (same ?? t).key,
                shortTrackName(t.track),
                t.trackId === current.trackId,
              );
            })
          : cars.map(c => row(c.key, c.car, c.key === current.key))}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  chips: {flexDirection: 'row', flexWrap: 'wrap', columnGap: space.sm},
  row: {borderBottomWidth: 1},
});
