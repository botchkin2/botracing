import {type ReactNode, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {hitBox, space, useTheme} from '@/src/design';
import {Chip, Sheet, Text} from '@/src/ui';

import {type Choice} from '../model';

type Pick = 'track' | 'car';

/**
 * The track and the car as two dropdown chips (D6a, 07a), each opening a list
 * in a sheet. A track keeps the current car where it has driven it there, and
 * else takes the newest car; a car is one of the cars driven at this track.
 * `combos` are newest first, so the first of a track is its newest.
 */
export function TrackCarPicker({
  track,
  car,
  tracks,
  cars,
  onPick,
  children,
}: {
  /** The chips' text: the track and the car in force. */
  track: string;
  car: string;
  /** The lists the chips open (`trackChoices`, `carChoices`). */
  tracks: Choice[];
  cars: Choice[];
  onPick: (key: string) => void;
  /** More chips for the same row (the phone's Rules chip). */
  children?: ReactNode;
}) {
  const {color} = useTheme();
  const [open, setOpen] = useState<Pick | null>(null);
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
        <Chip label={`${track} ▾`} onPress={() => setOpen('track')} />
        <Chip label={`${car} ▾`} onPress={() => setOpen('car')} />
        {children}
      </View>
      <Sheet
        visible={open != null}
        title={open === 'car' ? 'Car' : 'Track'}
        onClose={() => setOpen(null)}>
        {(open === 'track' ? tracks : cars).map(c =>
          row(c.key, c.label, c.selected),
        )}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  // Row gap 2 x the chips' 8 pt vertical hit growth, so wrapped rows never overlap.
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: space.sm,
    rowGap: space.xl,
  },
  row: {borderBottomWidth: 1},
});
