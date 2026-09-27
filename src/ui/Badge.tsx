import {StyleSheet, View} from 'react-native';

import {radius, useTheme} from '@/src/design';

import {Text} from './Text';

/** Session type badge: R, Q or P in a 22×22 outlined square. */
export function Badge({label}: {label: string}) {
  const {color} = useTheme();
  return (
    <View style={[styles.badge, {borderColor: color.lineStrong}]}>
      <Text variant='dataStrong' tone='textSecondary'>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: 22,
    height: 22,
    borderWidth: 1,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
