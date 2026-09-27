import {RacingCard} from '@/src/components';
import {RacingTheme} from '@/src/theme';
import React from 'react';
import {Text, View} from 'react-native';

interface OptimalSectorData {
  sector: number;
  time: number;
}

interface OptimalSectorAnalysisProps {
  optimalSectors: OptimalSectorData[];
  optimalLapTime: number;
  meanSectors?: OptimalSectorData[];
  meanLapTime?: number;
  isMobile: boolean;
}

const OptimalSectorAnalysis: React.FC<OptimalSectorAnalysisProps> = ({
  optimalSectors,
  optimalLapTime,
  meanSectors = [],
  meanLapTime,
  isMobile,
}) => {
  const getMeanForSector = (sectorNum: number) =>
    meanSectors.find(m => m.sector === sectorNum)?.time;
  const formatLapTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = (seconds % 60).toFixed(3);
    return `${minutes}:${remainingSeconds.padStart(6, '0')}`;
  };

  if (optimalSectors.length === 0) {
    return null;
  }

  return (
    <View
      style={[styles.optimalSection, isMobile && styles.optimalSectionMobile]}>
      <Text style={styles.sectionTitle}>OPTIMAL LAP ANALYSIS</Text>

      <View
        style={[
          isMobile
            ? styles.optimalCombinedRowMobile
            : styles.optimalCombinedRow,
          isMobile && styles.optimalCombinedRowMobileExtra,
        ]}>
        {/* Theoretical Optimal Lap */}
        <RacingCard
          style={[
            styles.optimalLapCard,
            isMobile
              ? styles.optimalLapCardMobile
              : styles.optimalLapCardDesktop,
          ]}>
          <Text style={styles.optimalLapTitle}>Optimal Lap</Text>
          <Text style={styles.optimalLapTime}>
            {formatLapTime(optimalLapTime)}
          </Text>
          <Text style={styles.optimalLapLabel}>Best sectors combined</Text>
        </RacingCard>

        {/* Mean Lap (when mean sector data available) */}
        {meanLapTime != null && meanSectors.length > 0 && (
          <RacingCard
            style={[
              styles.optimalLapCard,
              isMobile
                ? styles.optimalLapCardMobile
                : styles.optimalLapCardDesktop,
            ]}>
            <Text style={styles.optimalLapTitle}>MEAN LAP</Text>
            <Text style={styles.optimalLapTime}>
              {formatLapTime(meanLapTime)}
            </Text>
            <Text style={styles.optimalLapLabel}>Mean sectors combined</Text>
          </RacingCard>
        )}

        {/* Optimal Sector Times */}
        <View
          style={[
            styles.sectorsContainer,
            isMobile && styles.sectorsContainerMobile,
          ]}>
          <Text style={styles.sectorsTitle}>BEST SECTOR TIMES</Text>
          {isMobile ? (
            <View style={styles.mobileSectorsList}>
              {optimalSectors.map(sector => {
                const meanTime = getMeanForSector(sector.sector);
                return (
                  <View key={sector.sector} style={styles.mobileSectorItem}>
                    <View style={styles.mobileSectorHeader}>
                      <Text style={styles.mobileSectorNumber}>
                        S{sector.sector + 1}
                      </Text>
                      <View>
                        <Text style={styles.mobileSectorTime}>
                          {formatLapTime(sector.time)}
                        </Text>
                        {meanTime != null && (
                          <Text style={styles.mobileSectorMean}>
                            Mean: {formatLapTime(meanTime)}
                          </Text>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={styles.desktopSectorsGrid}>
              {optimalSectors.map(sector => {
                const meanTime = getMeanForSector(sector.sector);
                return (
                  <View key={sector.sector} style={styles.desktopSectorCard}>
                    <Text style={styles.desktopSectorNumber}>
                      S{sector.sector + 1}
                    </Text>
                    <Text style={styles.desktopSectorTime}>
                      {formatLapTime(sector.time)}
                    </Text>
                    {meanTime != null && (
                      <Text style={styles.desktopSectorMean}>
                        Mean: {formatLapTime(meanTime)}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </View>
    </View>
  );
};

const styles = {
  optimalSection: {
    marginBottom: RacingTheme.spacing.lg,
  },
  optimalSectionMobile: {
    marginBottom: RacingTheme.spacing.xxl,
  },
  sectionTitle: {
    fontSize: RacingTheme.typography.h4,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.text,
    marginBottom: RacingTheme.spacing.md,
    letterSpacing: 1,
  },
  optimalCombinedRow: {
    flexDirection: 'row' as const,
    gap: RacingTheme.spacing.md,
    alignItems: 'flex-start',
  },
  optimalCombinedRowMobile: {
    flexDirection: 'column' as const,
    gap: RacingTheme.spacing.md,
  },
  optimalCombinedRowMobileExtra: {
    flexShrink: 0,
  },
  optimalLapCard: {
    alignItems: 'center',
    padding: RacingTheme.spacing.lg,
  },
  optimalLapCardDesktop: {
    flex: 1,
  },
  optimalLapCardMobile: {},
  optimalLapTitle: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    marginBottom: RacingTheme.spacing.sm,
  },
  optimalLapTime: {
    fontSize: RacingTheme.typography.h2,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.secondary,
    fontFamily: RacingTheme.typography.mono,
    marginBottom: RacingTheme.spacing.xs,
  },
  optimalLapLabel: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.textTertiary,
  },
  sectorsContainer: {
    flex: 2,
  },
  sectorsTitle: {
    fontSize: RacingTheme.typography.small,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: RacingTheme.spacing.sm,
  },
  // Mobile Sector Styles
  mobileSectorsList: {
    backgroundColor: RacingTheme.colors.surface,
    borderRadius: RacingTheme.borderRadius.md,
    padding: RacingTheme.spacing.md,
    paddingBottom: RacingTheme.spacing.lg,
    borderWidth: 1,
    borderColor: RacingTheme.colors.surfaceElevated,
  },
  mobileSectorItem: {
    paddingVertical: RacingTheme.spacing.sm,
  },
  mobileSectorHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  mobileSectorNumber: {
    fontSize: RacingTheme.typography.body,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.primary,
    fontFamily: RacingTheme.typography.mono,
  },
  mobileSectorTime: {
    fontSize: RacingTheme.typography.body,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.text,
    fontFamily: RacingTheme.typography.mono,
  },
  mobileSectorMean: {
    fontSize: RacingTheme.typography.small,
    color: RacingTheme.colors.text,
    fontFamily: RacingTheme.typography.mono,
    marginTop: RacingTheme.spacing.xs,
  },
  // Desktop Sector Styles
  desktopSectorsGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: RacingTheme.spacing.sm,
  },
  desktopSectorCard: {
    backgroundColor: RacingTheme.colors.surface,
    borderRadius: RacingTheme.borderRadius.md,
    padding: RacingTheme.spacing.lg,
    borderWidth: 1,
    borderColor: RacingTheme.colors.surfaceElevated,
    alignItems: 'center',
    minWidth: 120,
    flex: 1,
  },
  desktopSectorNumber: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: RacingTheme.spacing.xs,
  },
  desktopSectorTime: {
    fontSize: RacingTheme.typography.h3,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.primary,
    fontFamily: RacingTheme.typography.mono,
  },
  desktopSectorMean: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.text,
    fontFamily: RacingTheme.typography.mono,
    marginTop: RacingTheme.spacing.xs,
  },
};

export default OptimalSectorAnalysis;
