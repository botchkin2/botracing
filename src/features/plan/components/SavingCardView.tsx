import {StyleSheet, View} from 'react-native';

import {space} from '@/src/design';
import {Text} from '@/src/ui';

import {type Saving, savingText} from '../saving';
import {FactTile, TileRow} from './FactTile';

/**
 * The Saving card (thread 99, #6684 item 4): three numbers side by side and
 * the lap time they cost, no verdict and no colour.
 */
export function SavingCardView({saving}: {saving: Saving}) {
  const t = savingText(saving);
  return (
    <View style={styles.box}>
      <TileRow>
        <FactTile label='Needs' value={t.target} sub='a lap' />
        <FactTile label='Your laps' value={t.atOrUnder} sub='at or under' />
        <FactTile label='Best stint' value={t.bestStint} sub={t.bestSub} />
      </TileRow>
      {t.lapTimes ? (
        <Text variant='dataSmall' tone='textSecondary'>
          {t.lapTimes}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {gap: space.md},
});
