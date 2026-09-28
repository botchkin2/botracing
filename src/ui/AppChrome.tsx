import {type ReactNode} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {radius, size, space, useTheme} from '@/src/design';

import {Text} from './Text';

export type WorkspaceTab = 'session' | 'compare' | 'corner';

export type ChromeTab = {
  key: WorkspaceTab;
  label: string;
  /** Absent when the tab has nowhere to go yet (no open session, no route). */
  onPress?: () => void;
};

/**
 * Desktop (≥1280) app bar from the handoff: logo, workspace tabs, context
 * label, and a right-side slot. Data-free; the route layout feeds it.
 */
export function AppChrome({
  tabs,
  active,
  context,
  right,
}: {
  tabs: ChromeTab[];
  active: WorkspaceTab | null;
  context?: string;
  right?: ReactNode;
}) {
  const {color} = useTheme();
  return (
    <View
      accessibilityRole='header'
      style={[
        styles.bar,
        {backgroundColor: color.chrome, borderColor: color.lineHeader},
      ]}>
      <View style={[styles.logo, {backgroundColor: color.text}]} />
      <View style={styles.tabs} accessibilityRole='tablist'>
        {tabs.map(tab => {
          const selected = tab.key === active;
          return (
            <Pressable
              key={tab.key}
              accessibilityRole='tab'
              accessibilityState={{selected, disabled: !tab.onPress}}
              disabled={!tab.onPress}
              onPress={tab.onPress}
              style={({pressed}) => [
                styles.tab,
                (selected || pressed) && {backgroundColor: color.tabActive},
              ]}>
              <Text
                variant={selected ? 'bodyStrong' : 'body'}
                tone={
                  selected ? 'text' : tab.onPress ? 'textMuted' : 'textFaint'
                }
                style={styles.tabLabel}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {context ? (
        <View style={[styles.context, {borderColor: color.lineStrong}]}>
          <Text variant='dataSmall' numberOfLines={1}>
            {context}
          </Text>
        </View>
      ) : null}
      <View style={styles.right}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: size.chromeBar,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xl,
    paddingHorizontal: space.xl,
    borderBottomWidth: 1,
  },
  logo: {width: size.logo, height: size.logo, borderRadius: radius.sm},
  tabs: {flexDirection: 'row', gap: space.xxs},
  tab: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
  },
  tabLabel: {fontSize: 13, lineHeight: 16},
  context: {
    flexShrink: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderWidth: 1,
    borderRadius: radius.sm,
  },
  right: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
  },
});
