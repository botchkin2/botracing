import {type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';

import {fonts, radius, space, useTheme} from '@/src/design';
import {Button, Text} from '@/src/ui';

import {type DetailModel} from '../model';

const ACTION_LABEL = {
  add: 'Add to compare',
  remove: 'Remove from compare',
  reference: 'Reference',
} as const;

export function LapDetail({
  detail,
  onAction,
  extra,
}: {
  detail: DetailModel;
  onAction: () => void;
  /** Below the lap's facts, above the action (reference candidates). */
  extra?: ReactNode;
}) {
  const {color} = useTheme();
  return (
    <View
      style={[
        styles.panel,
        {
          backgroundColor: color.surfaceDetail,
          borderColor: `${color.accent}80`,
        },
      ]}>
      <Text variant='dataStrong' style={styles.title}>
        {detail.title}
      </Text>
      <Text
        variant='dataSmall'
        tone={detail.excluded ? 'accentInk' : 'textSecondary'}>
        {detail.status}
      </Text>
      {detail.fuel.map(line => (
        <Text key={line} variant='dataSmall' tone='textSecondary'>
          {line}
        </Text>
      ))}
      {detail.traffic && (
        <View style={styles.traffic}>
          <Text variant='label' tone='textMuted'>
            Traffic on this lap
          </Text>
          {detail.traffic.map(r => (
            <View key={r.label}>
              <View style={styles.row}>
                <Text variant='dataSmall' tone='textSecondary'>
                  {r.label}
                </Text>
                <Text variant='dataSmall'>{r.value}</Text>
              </View>
              {r.note ? (
                <Text variant='dataSmall' tone='textMuted'>
                  {r.note}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      )}
      {extra}
      <View style={styles.action}>
        <Button
          label={ACTION_LABEL[detail.action]}
          kind={detail.action === 'add' ? 'primary' : 'outline'}
          disabled={detail.action === 'reference'}
          onPress={onAction}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.xs,
  },
  title: {fontSize: 14, fontFamily: fonts.monoBold},
  traffic: {gap: space.xs, marginTop: space.sm},
  row: {flexDirection: 'row', justifyContent: 'space-between', gap: space.md},
  action: {alignSelf: 'flex-start', marginTop: space.sm},
});
