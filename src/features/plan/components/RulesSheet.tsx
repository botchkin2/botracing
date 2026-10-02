import {useState} from 'react';
import {StyleSheet, View} from 'react-native';

import {space} from '@/src/design';
import {
  freshId,
  type FuelPreset,
  newPreset,
  type RaceLength,
} from '@/src/state/fuelPresets';
import {Button, Chip, Sheet, StatusBanner, Text} from '@/src/ui';

import {RulesEditor} from '../RulesEditor';

/**
 * The event rules (round 5, frame 1): a chip on the screen and this sheet
 * behind it, a bottom sheet on the phone and a right-side sheet on desktop.
 * The rule sets, the line saying what is in force, the stale warning, and the
 * editor for a new or existing set. Choosing one changes the plan under the
 * sheet and leaves it open, so the change can be seen.
 */
export function RulesSheet({
  visible,
  onClose,
  presets,
  activeId,
  preset,
  rulesLine,
  stale,
  length,
  lastFillLimitL,
  lastVeRatio,
  events,
  onEvent,
  onSelect,
  onSave,
  onRemove,
}: {
  visible: boolean;
  onClose: () => void;
  presets: FuelPreset[];
  activeId: string | null;
  preset: FuelPreset | null;
  /** What the rules in force say ("Rules: ELMS 2 h · set 26 Sep"); null while there is no plan. */
  rulesLine: string | null;
  stale: string | null;
  /** The race length in force, kept with a saved rule set. */
  length: RaceLength;
  lastFillLimitL: number | null;
  lastVeRatio: number | null;
  /** The events at this track and car, newest first: the rules come from the one picked (its load, its L per %). */
  events: {week: string; label: string; selected: boolean}[];
  onEvent: (week: string) => void;
  onSelect: (id: string | null) => void;
  onSave: (preset: FuelPreset) => void;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState<'new' | 'edit' | null>(null);
  const close = () => {
    setEditing(null);
    onClose();
  };
  return (
    <Sheet
      visible={visible}
      title='Rules'
      onClose={close}
      bodyStyle={styles.body}>
      <View style={styles.chips}>
        {events.map(e => (
          <Chip
            key={e.week}
            label={e.label}
            selected={e.selected}
            onPress={() => {
              onEvent(e.week);
              setEditing(null);
            }}
          />
        ))}
        {presets.map(p => (
          <Chip
            key={p.id}
            label={p.name}
            selected={p.id === activeId}
            onPress={() => {
              onSelect(p.id);
              setEditing(null);
            }}
          />
        ))}
        <Chip label='+ New' dashed onPress={() => setEditing('new')} />
      </View>
      {rulesLine ? (
        <Text variant='dataSmall' tone='textSecondary'>
          {rulesLine}
        </Text>
      ) : null}
      {stale ? (
        <StatusBanner dot='idle' text={`This preset may be stale: ${stale}.`} />
      ) : null}
      {preset && editing == null ? (
        <View style={styles.actions}>
          <Button
            label='Edit'
            kind='outline'
            onPress={() => setEditing('edit')}
          />
          <Button
            label='Delete'
            kind='tertiary'
            onPress={() => onRemove(preset.id)}
          />
        </View>
      ) : null}
      {editing ? (
        <RulesEditor
          key={editing === 'edit' && preset ? preset.id : 'new'}
          preset={editing === 'edit' ? preset : null}
          lastFillLimitL={lastFillLimitL}
          lastVeRatio={lastVeRatio}
          onCancel={() => setEditing(null)}
          onSave={fields => {
            const base: FuelPreset =
              editing === 'edit' && preset
                ? preset
                : newPreset(
                    fields.name,
                    {},
                    freshId(presets, presets.length + 1),
                    new Date().toISOString(),
                  );
            onSave({
              ...base,
              ...fields,
              length,
              savedAt: new Date().toISOString(),
            });
            setEditing(null);
          }}
        />
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {gap: space.lg},
  // Row gap 2 x the chips' 8 pt vertical hit growth, so wrapped rows never overlap.
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: space.sm,
    rowGap: space.xl,
  },
  actions: {flexDirection: 'row', gap: space.md},
});
