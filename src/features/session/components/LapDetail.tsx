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
}: {
  detail: DetailModel;
  onAction: () => void;
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
      {detail.why && (
        <Text variant='explainer' tone='textMuted'>
          {detail.why}
        </Text>
      )}
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
  action: {alignSelf: 'flex-start', marginTop: space.sm},
});
