import {type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';

import {space} from '@/src/design';
import {Text} from '@/src/ui';

import {type RaceCard} from '../planCards';
import {FactTile, TileRow} from './FactTile';

/**
 * The Race card as three tiles (thread 99, PLN): the laps (and the late flag's
 * count), the stops (and where the full-tank strategy puts them), the start
 * load. The median lap the count comes from stays as one small line.
 */
export function RaceCardView({
  card,
  startNote,
  startField,
}: {
  card: RaceCard;
  /** What the plan assumes the car starts with, and whether he set it (`startNote.ts`). */
  startNote: string | null;
  /** The phone's one control that sets it. */
  startField?: ReactNode;
}) {
  return (
    <View style={styles.box}>
      {startNote ? (
        <Text variant='dataSmall' tone='textSecondary'>
          {startNote}
        </Text>
      ) : null}
      {startField}
      <TileRow>
        <FactTile
          label='Laps'
          value={card.laps == null ? '—' : String(card.laps)}
          sub={card.oneMore == null ? null : `late flag ${card.oneMore}`}
        />
        <FactTile
          label='Stops'
          value={card.stops == null ? '—' : String(card.stops)}
          sub={
            card.stopAfter.length > 0
              ? `after ${card.stopAfter.join(', ')}`
              : null
          }
        />
        {card.startLoad ? (
          <FactTile
            label='Start with'
            value={card.startLoad.hero}
            sub={card.startLoad.covers}
          />
        ) : null}
      </TileRow>
      {card.medianNote ? (
        <Text variant='dataSmall' tone='textSecondary'>
          {card.medianNote}
        </Text>
      ) : null}
      {card.working ? (
        <Text variant='dataSmall' tone='textMuted'>
          {card.working}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {gap: space.md},
});
