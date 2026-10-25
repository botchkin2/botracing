import {StyleSheet, View} from 'react-native';

import {space} from '@/src/design';
import {Text} from '@/src/ui';

import {type ChecksText} from '../planChecksText';

/**
 * The Plan's facts under the per-lap line: max fuel, fuel and VE a lap, each
 * with whether two of LMU's own sources agree, then the notes (a VE that does
 * not match LMU's setup, the offline practice's comparison). One fact a line.
 */
export function PlanChecksView({text}: {text: ChecksText}) {
  return (
    <View style={styles.box}>
      <View style={styles.facts}>
        {text.facts.map(f => (
          <View key={f.text} style={styles.fact}>
            <Text variant='dataSmall' tone={f.flag ? 'text' : 'textSecondary'}>
              {f.text}
            </Text>
            {f.status ? (
              <Text variant='dataSmall' tone={f.flag ? 'text' : 'textMuted'}>
                {f.status}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
      {text.notes.map(n => (
        <Text key={n} variant='dataSmall' tone='textSecondary'>
          {n}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {gap: space.xs},
  facts: {gap: space.xxs},
  fact: {flexDirection: 'row', alignItems: 'baseline', columnGap: space.md},
});
