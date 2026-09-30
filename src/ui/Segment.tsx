import {Pressable, StyleSheet, View} from 'react-native';

import {radius, size, space, useTheme} from '@/src/design';

import {hitFor} from './hitArea';
import {Text} from './Text';

/** Two or three mutually exclusive options, e.g. Stack / One chart. */
export function Segment<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly {value: T; label: string}[];
  value: T;
  onChange: (value: T) => void;
}) {
  const {color} = useTheme();
  // The row's 1 pt border sits outside the options.
  const slop = (size.hit - (size.chip - 2)) / 2;
  return (
    <View
      accessibilityRole='tablist'
      style={[styles.row, {borderColor: color.lineStrong}]}>
      {options.map(option => {
        const on = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole='tab'
            accessibilityState={{selected: on}}
            onPress={() => onChange(option.value)}
            {...hitFor(0, slop)}>
            <View
              style={[
                styles.option,
                on && {backgroundColor: color.accentTint},
              ]}>
              <Text variant='dataStrong' tone={on ? 'accentInk' : 'textMuted'}>
                {option.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: radius.sm,
  },
  option: {
    height: size.chip - 2,
    minWidth: size.hit,
    alignItems: 'center',
    borderRadius: radius.xs,
    paddingHorizontal: space.md,
    justifyContent: 'center',
  },
});
