import {RacingButton} from '@/src/components';
import {RacingTheme} from '@/src/theme';
import {Lap} from '@/src/types';
import React from 'react';
import {Text, View} from 'react-native';

interface LapSelectionControlsProps {
  laps: Lap[];
  selectedLaps: Lap[];
  onSelectAllLaps: () => void;
  onSelectCleanLaps: () => void;
  onClearSelection: () => void;
  onMultiLapComparison?: (selectedLapIds: Set<string>) => void;
}

const LapSelectionControls: React.FC<LapSelectionControlsProps> = ({
  laps,
  selectedLaps,
  onSelectAllLaps,
  onSelectCleanLaps,
  onClearSelection,
  onMultiLapComparison,
}) => {
  const hasCompare = !!onMultiLapComparison && selectedLaps.length > 0;

  return (
    <View style={styles.selectionSection}>
      <Text style={styles.sectionTitle}>LAP SELECTION</Text>
      <View style={styles.selectionControls}>
        <View style={styles.selectionRow}>
          <RacingButton
            title='SELECT ALL'
            onPress={onSelectAllLaps}
            style={[styles.selectionButton, styles.gridCell]}
          />
          <RacingButton
            title='CLEAN LAPS'
            onPress={onSelectCleanLaps}
            style={[styles.selectionButton, styles.gridCell]}
          />
        </View>
        <View style={styles.selectionRow}>
          <RacingButton
            title='CLEAR ALL'
            onPress={onClearSelection}
            style={[styles.selectionButton, styles.gridCell]}
          />
          {hasCompare && (
            <RacingButton
              title='📊 COMPARE'
              onPress={() =>
                onMultiLapComparison!(new Set(selectedLaps.map(lap => lap.id)))
              }
              style={
                [
                  styles.selectionButton,
                  styles.compareButton,
                  styles.gridCell,
                ] as any
              }
            />
          )}
        </View>
      </View>
      <Text style={styles.selectionInfo}>
        {selectedLaps.length} of {laps.length} laps selected for analysis
      </Text>
    </View>
  );
};

const styles = {
  selectionSection: {
    marginBottom: RacingTheme.spacing.lg,
  },
  sectionTitle: {
    fontSize: RacingTheme.typography.h4,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.text,
    marginBottom: RacingTheme.spacing.sm,
    letterSpacing: 1,
  },
  selectionControls: {
    flexDirection: 'column' as const,
    gap: RacingTheme.spacing.xs,
    marginBottom: RacingTheme.spacing.md,
  },
  selectionRow: {
    flexDirection: 'row' as const,
    gap: RacingTheme.spacing.sm,
  },
  selectionButton: {
    flex: 1,
    minWidth: 0,
    paddingVertical: RacingTheme.spacing.xs,
  },
  gridCell: {
    flex: 1,
    minWidth: 0,
  },
  selectionInfo: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.textSecondary,
    textAlign: 'center' as const,
    fontStyle: 'italic',
  },
  compareButton: {
    backgroundColor: RacingTheme.colors.secondary,
  },
};

export default LapSelectionControls;
