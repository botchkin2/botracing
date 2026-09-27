import {MetricCard} from '@src/components';
import {RacingTheme} from '@src/theme';
import {Lap} from '@src/types';
import React from 'react';
import {View} from 'react-native';

interface SummaryMetricsProps {
  selectedLaps: Lap[];
}

const SummaryMetrics: React.FC<SummaryMetricsProps> = ({selectedLaps}) => {
  const formatLapTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = (seconds % 60).toFixed(3);
    return `${minutes}:${remainingSeconds.padStart(6, '0')}`;
  };

  // Partial and untimed laps are not lap times; leave them out of both numbers.
  const timed = selectedLaps.filter(l => l.lapTime > 0 && !l.incomplete);

  return (
    <View style={styles.metricsGrid}>
      <MetricCard
        title='BEST LAP'
        value={
          timed.length > 0
            ? formatLapTime(Math.min(...timed.map(l => l.lapTime)))
            : '--:--.---'
        }
        style={styles.metricCard}
      />
      <MetricCard
        title='AVG LAP'
        value={
          timed.length > 0
            ? formatLapTime(
                timed.reduce((sum, l) => sum + l.lapTime, 0) / timed.length,
              )
            : '--:--.---'
        }
        style={styles.metricCard}
      />
    </View>
  );
};

const styles = {
  metricsGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    justifyContent: 'space-between',
    marginBottom: RacingTheme.spacing.lg,
  },
  metricCard: {
    width: '48%',
    marginBottom: RacingTheme.spacing.md,
  },
};

export default SummaryMetrics;
