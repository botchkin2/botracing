import {type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';

import {radius, space, stroke, useTheme} from '@/src/design';
import {Text} from '@/src/ui';

import {type StopPanel} from '../stopPanels';

/**
 * One stop (thread 99, UX note #6729, gauge #6730): the stop and its lap, the
 * slider, the number he sets in the pit menu as the hero in accent ink (the
 * warning tone when the stint after it runs dry at p90, with no badge on
 * top), the arrival and the fill under it, and a bar from the arrival to the
 * level. `slider` is the stop's StopSlider.
 */
export function StopPanelView({
  panel,
  slider,
  half,
}: {
  panel: StopPanel;
  slider: ReactNode;
  half: boolean;
}) {
  const {color} = useTheme();
  return (
    <View
      style={[
        styles.panel,
        half && styles.half,
        {backgroundColor: color.surfaceRaised},
      ]}>
      <View style={styles.head}>
        <Text variant='label' tone='textMuted'>
          {`Stop ${panel.stop}`}
        </Text>
        <Text variant='dataStrong'>{panel.after}</Text>
      </View>
      {slider}
      <View style={styles.hero}>
        <Text
          variant='dataHero'
          tone={panel.dryAtP90 ? 'slower' : 'accentInk'}
          accessibilityLabel={`Stop ${panel.stop}: ${panel.value}`}>
          {panel.value}
        </Text>
        {panel.tags.map(t => (
          <View key={t} style={[styles.tag, {borderColor: color.lineStrong}]}>
            <Text variant='dataSmall' tone='textSecondary'>
              {t}
            </Text>
          </View>
        ))}
      </View>
      {panel.fill ? <FillBar fill={panel.fill} /> : null}
      {panel.line ? (
        <Text variant='dataSmall' tone='textSecondary'>
          {panel.line}
        </Text>
      ) : null}
    </View>
  );
}

/** A full load as a track: what the car arrives with, then what the stop adds up to the level, edged in accent at the level. */
function FillBar({fill}: {fill: {arrive: number; set: number}}) {
  const {color} = useTheme();
  const arrive = Math.min(fill.arrive, fill.set);
  return (
    <View style={[styles.track, {backgroundColor: color.trackFill}]}>
      <View
        style={[
          styles.part,
          {width: `${arrive * 100}%`, backgroundColor: color.barNeutral},
        ]}
      />
      <View
        style={[
          styles.part,
          {
            width: `${Math.max(0, fill.set - arrive) * 100}%`,
            backgroundColor: color.accentTint,
            borderRightColor: color.accent,
          },
          styles.added,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.md,
  },
  half: {flexBasis: 0, flexGrow: 1, minWidth: 0},
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  hero: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.md,
  },
  tag: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.xxs,
  },
  track: {
    flexDirection: 'row',
    height: space.md,
    borderRadius: radius.xs,
    overflow: 'hidden',
  },
  part: {height: '100%'},
  added: {borderRightWidth: stroke.ref},
});
