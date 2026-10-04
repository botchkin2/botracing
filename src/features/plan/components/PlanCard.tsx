import {type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';

import {radius, space, useTheme} from '@/src/design';
import {Text} from '@/src/ui';

/** A titled block of the Plan: the label, then its content. */
export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text variant='label' tone='textMuted'>
        {title}
      </Text>
      {children}
    </View>
  );
}

/** A card: the title and the content in a surface box. */
export function PlanCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const {color} = useTheme();
  return (
    <Section title={title}>
      <View
        style={[
          styles.card,
          {backgroundColor: color.surface, borderColor: color.lineHeader},
        ]}>
        {children}
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  section: {gap: space.sm},
  card: {
    gap: space.lg,
    padding: space.lg,
    borderWidth: 1,
    borderRadius: radius.md,
  },
});
