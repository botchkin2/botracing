import {Pressable, StyleSheet, View} from 'react-native';

import {radius, size, space, useTheme} from '@/src/design';

import {AppMark} from './AppMark';
import {hitFor} from './hitArea';
import {Segment} from './Segment';
import {Text} from './Text';

// 18 pt mark grown to a 44 pt target (round 3 N1, review by pace).
export const MARK_SLOP = (size.hit - size.logo) / 2;

export type ChromeTab<T extends string = string> = {key: T; label: string};

export type ChromeSession<T extends string = string> = {
  /** R, Q or P. */
  badge: string;
  track: string;
  /** "Porsche 911 GT3 R · Manthey #91 · 14 Sep"; hidden when compact. */
  detail: string;
  tabs: readonly ChromeTab<T>[];
  activeTab: T | null;
  onTab: (key: T) => void;
  /** The selected laps in lap colours, reference first. */
  laps: readonly {label: string; color: string}[];
  onClose: () => void;
};

/**
 * Desktop (≥900) app bar, round 6 frame 1: Sessions | the open session in a
 * box (badge, track, car, its four tabs, the selected laps, ×) | Plan with the
 * pair it will open, Settings. The box is left out with no session open.
 * Data-free; `workspace/DesktopChrome` feeds it.
 */
export function AppChrome<T extends string>({
  session,
  compact,
  onHome,
  onSessions,
  planPair,
  planActive,
  onPlan,
  settingsActive,
  onSettings,
}: {
  session: ChromeSession<T> | null;
  /** Below 1280: car, team and date leave the box and the swatches become a count. */
  compact: boolean;
  /** The logo is the way back to the sessions list from any workspace. */
  onHome: () => void;
  onSessions: () => void;
  /** "Le Mans · 911 GT3 R", or null while there is nothing to open. */
  planPair: string | null;
  planActive: boolean;
  onPlan: () => void;
  settingsActive: boolean;
  onSettings: () => void;
}) {
  const {color} = useTheme();
  return (
    <View
      accessibilityRole='header'
      style={[
        styles.bar,
        {backgroundColor: color.surface, borderColor: color.lineStrong},
      ]}>
      <Pressable
        accessibilityRole='link'
        accessibilityLabel='Sessions'
        onPress={onHome}
        {...hitFor(MARK_SLOP, MARK_SLOP)}>
        <AppMark />
      </Pressable>
      <Item label='Sessions' onPress={onSessions} active={false} />
      {session && (
        <View
          style={[
            styles.box,
            {backgroundColor: color.bg, borderColor: color.lineStrong},
          ]}>
          <View style={[styles.badge, {borderColor: color.textSecondary}]}>
            <Text variant='dataSmall'>{session.badge}</Text>
          </View>
          <Text variant='bodyStrong' numberOfLines={1}>
            {session.track}
          </Text>
          {!compact && (
            <Text variant='body' tone='textSecondary' numberOfLines={1}>
              {session.detail}
            </Text>
          )}
          <Divider />
          <Segment
            options={session.tabs.map(t => ({value: t.key, label: t.label}))}
            value={session.activeTab as T}
            onChange={session.onTab}
          />
          {session.laps.length > 0 && (
            <>
              <Divider />
              <Laps laps={session.laps} compact={compact} />
            </>
          )}
          <Pressable
            accessibilityRole='button'
            accessibilityLabel='Close session'
            onPress={session.onClose}
            style={styles.close}>
            <Text variant='body' tone='textMuted'>
              ×
            </Text>
          </Pressable>
        </View>
      )}
      <View style={styles.right}>
        <Item
          label='Plan'
          pair={planPair}
          active={planActive}
          onPress={onPlan}
        />
        <Item label='Settings' active={settingsActive} onPress={onSettings} />
      </View>
    </View>
  );
}

function Item({
  label,
  pair,
  active,
  onPress,
}: {
  label: string;
  pair?: string | null;
  active: boolean;
  onPress: () => void;
}) {
  const {color} = useTheme();
  return (
    <Pressable
      accessibilityRole='link'
      accessibilityState={{selected: active}}
      onPress={onPress}
      style={[styles.item, active && {backgroundColor: color.tabActive}]}>
      <Text
        variant={active ? 'bodyStrong' : 'body'}
        tone={active ? 'text' : 'textSecondary'}>
        {label}
      </Text>
      {pair ? (
        <Text variant='dataSmall' tone='textMuted' numberOfLines={1}>
          {pair}
        </Text>
      ) : null}
    </Pressable>
  );
}

function Divider() {
  const {color} = useTheme();
  return <View style={[styles.divider, {backgroundColor: color.lineStrong}]} />;
}

function Laps({
  laps,
  compact,
}: {
  laps: readonly {label: string; color: string}[];
  compact: boolean;
}) {
  if (compact) {
    return (
      <Text variant='dataSmall'>
        {laps.length} {laps.length === 1 ? 'lap' : 'laps'}
      </Text>
    );
  }
  return (
    <View style={styles.laps}>
      {laps.map(lap => (
        <View key={lap.label} style={styles.lap}>
          <View style={[styles.swatch, {backgroundColor: lap.color}]} />
          <Text variant='dataSmall'>{lap.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: size.chromeBar,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingHorizontal: space.xl,
    borderBottomWidth: 1,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
  },
  box: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    height: size.chromeBox,
    paddingLeft: space.md,
    paddingRight: space.xs,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  badge: {
    width: size.logo,
    height: size.logo,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radius.xs,
  },
  divider: {width: 1, height: size.logo},
  laps: {flexDirection: 'row', alignItems: 'center', gap: space.lg},
  lap: {flexDirection: 'row', alignItems: 'center', gap: space.xs},
  swatch: {width: 10, height: 3, borderRadius: 1},
  close: {
    width: size.chromeClose,
    height: size.chromeClose,
    alignItems: 'center',
    justifyContent: 'center',
  },
  right: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
});
