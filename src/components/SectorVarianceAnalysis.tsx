import {RacingCard, RacingDivider} from '@/src/components';
import {RacingTheme} from '@/src/theme';
import React from 'react';
import {Text, View} from 'react-native';

interface SectorVariance {
  sector: number;
  mean: number;
  variance: number;
  stdDev: number;
  coefficientOfVariation: number;
  scaledInconsistency?: number; // New scaled metric (0.5s stdDev = 100%)
  bestTime: number;
  spread: number;
  lapCount: number;
  times: number[];
  potentialImprovement: number;
}

interface SectorVarianceAnalysisProps {
  sectorVariances: SectorVariance[];
  isMobile: boolean;
}

const SectorVarianceAnalysis: React.FC<SectorVarianceAnalysisProps> = ({
  sectorVariances,
  isMobile,
}) => {
  const formatLapTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = (seconds % 60).toFixed(3);
    return `${minutes}:${remainingSeconds.padStart(6, '0')}`;
  };

  if (sectorVariances.length === 0) {
    return null;
  }

  return (
    <View style={styles.varianceSection}>
      <Text style={styles.sectionTitle}>SECTOR CONSISTENCY ANALYSIS</Text>

      <View style={styles.varianceContent}>
        {/* Most Inconsistent Sector Highlight */}
        {sectorVariances.length > 0 && (
          <RacingCard style={styles.varianceHighlightCard}>
            <Text style={styles.varianceHighlightTitle}>
              FOCUS ON THIS SECTOR
            </Text>
            <View style={styles.varianceHighlightContent}>
              <View style={styles.varianceSectorBadge}>
                <Text style={styles.varianceSectorNumber}>
                  S{sectorVariances[0].sector + 1}
                </Text>
              </View>
              <View style={styles.varianceHighlightStats}>
                <Text style={styles.varianceHighlightValue}>
                  {(
                    sectorVariances[0].scaledInconsistency ||
                    sectorVariances[0].coefficientOfVariation * 100
                  ).toFixed(1)}
                  %
                </Text>
                <Text style={styles.varianceHighlightLabel}>
                  INCONSISTENCY SCORE
                </Text>
                <Text style={styles.variancePotentialImpact}>
                  {sectorVariances[0].potentialImprovement.toFixed(3)}s
                </Text>
                <Text style={styles.variancePotentialLabel}>
                  POTENTIAL TIME SAVINGS
                </Text>
              </View>
            </View>
          </RacingCard>
        )}

        {/* Sector Variance Rankings */}
        <View style={styles.varianceRankings}>
          <Text style={styles.varianceRankingsTitle}>
            SECTOR CONSISTENCY RANKINGS
          </Text>
          <Text style={styles.varianceRankingsSubtitle}>
            Lower % = more consistent • Higher % = where to focus
          </Text>

          {isMobile ? (
            <View style={styles.mobileVarianceList}>
              {sectorVariances.map((sector, index) => (
                <View
                  key={sector.sector}
                  style={[
                    styles.mobileVarianceItem,
                    index === 0 && styles.mobileVarianceItemWorst,
                  ]}>
                  <View style={styles.mobileVarianceHeader}>
                    <Text style={styles.mobileVarianceRank}>#{index + 1}</Text>
                    <Text style={styles.mobileVarianceSector}>
                      S{sector.sector + 1}
                    </Text>
                    <Text style={styles.mobileVarianceValue}>
                      {(
                        sector.scaledInconsistency ||
                        sector.coefficientOfVariation * 100
                      ).toFixed(1)}
                      %
                    </Text>
                  </View>
                  <View style={styles.mobileVarianceDetails}>
                    <Text style={styles.mobileVarianceDetail}>
                      Spread: {sector.spread.toFixed(3)}s
                    </Text>
                    <Text style={styles.mobileVarianceDetail}>
                      Mean: {formatLapTime(sector.mean)}
                    </Text>
                    <Text style={styles.mobileVarianceDetail}>
                      Potential: {sector.potentialImprovement.toFixed(3)}s
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <RacingCard style={styles.desktopVarianceTable}>
              <View style={styles.varianceTableHeader}>
                <Text style={styles.varianceTableHeaderCell}>RANK</Text>
                <Text style={styles.varianceTableHeaderCell}>SECTOR</Text>
                <Text style={styles.varianceTableHeaderCell}>
                  INCONSISTENCY
                </Text>
                <Text style={styles.varianceTableHeaderCell}>SPREAD</Text>
                <Text style={styles.varianceTableHeaderCell}>MEAN TIME</Text>
                <Text style={styles.varianceTableHeaderCell}>TIME SAVINGS</Text>
              </View>
              <RacingDivider />
              {sectorVariances.map((sector, index) => (
                <View key={sector.sector}>
                  <View
                    style={[
                      styles.varianceTableRow,
                      index === 0 && styles.varianceTableRowWorst,
                    ]}>
                    <Text
                      style={[
                        styles.varianceTableCell,
                        index === 0 && styles.varianceTableCellWorst,
                      ]}>
                      #{index + 1}
                    </Text>
                    <Text
                      style={[
                        styles.varianceTableCell,
                        index === 0 && styles.varianceTableCellWorst,
                      ]}>
                      S{sector.sector + 1}
                    </Text>
                    <Text
                      style={[
                        styles.varianceTableCell,
                        index === 0 && styles.varianceTableCellWorst,
                      ]}>
                      {(
                        sector.scaledInconsistency ||
                        sector.coefficientOfVariation * 100
                      ).toFixed(1)}
                      %
                    </Text>
                    <Text
                      style={[
                        styles.varianceTableCell,
                        index === 0 && styles.varianceTableCellWorst,
                      ]}>
                      {sector.spread.toFixed(3)}s
                    </Text>
                    <Text
                      style={[
                        styles.varianceTableCell,
                        index === 0 && styles.varianceTableCellWorst,
                      ]}>
                      {formatLapTime(sector.mean)}
                    </Text>
                    <Text
                      style={[
                        styles.varianceTableCell,
                        index === 0 && styles.varianceTableCellWorst,
                      ]}>
                      {sector.potentialImprovement.toFixed(3)}s
                    </Text>
                  </View>
                  {index < sectorVariances.length - 1 && <RacingDivider />}
                </View>
              ))}
            </RacingCard>
          )}
        </View>
      </View>
    </View>
  );
};

const styles = {
  varianceSection: {
    marginBottom: RacingTheme.spacing.lg,
  },
  sectionTitle: {
    fontSize: RacingTheme.typography.h4,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.text,
    marginBottom: RacingTheme.spacing.md,
    letterSpacing: 1,
  },
  varianceContent: {
    gap: RacingTheme.spacing.md,
  },
  varianceHighlightCard: {
    padding: RacingTheme.spacing.lg,
    alignItems: 'center',
  },
  varianceHighlightTitle: {
    fontSize: RacingTheme.typography.small,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.warning,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: RacingTheme.spacing.md,
    textAlign: 'center' as const,
  },
  varianceHighlightContent: {
    flexDirection: 'row' as const,
    alignItems: 'center',
    gap: RacingTheme.spacing.lg,
  },
  varianceSectorBadge: {
    backgroundColor: RacingTheme.colors.warning,
    borderRadius: RacingTheme.borderRadius.md,
    paddingHorizontal: RacingTheme.spacing.lg,
    paddingVertical: RacingTheme.spacing.md,
    alignItems: 'center',
    minWidth: 80,
  },
  varianceSectorNumber: {
    fontSize: RacingTheme.typography.h2,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.surface,
    fontFamily: RacingTheme.typography.mono,
  },
  varianceHighlightStats: {
    flex: 1,
    alignItems: 'center',
  },
  varianceHighlightValue: {
    fontSize: RacingTheme.typography.h1,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.warning,
    fontFamily: RacingTheme.typography.mono,
    marginBottom: RacingTheme.spacing.xs,
  },
  varianceHighlightLabel: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    textAlign: 'center' as const,
    marginBottom: RacingTheme.spacing.sm,
  },
  variancePotentialImpact: {
    fontSize: RacingTheme.typography.h3,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.error,
    fontFamily: RacingTheme.typography.mono,
    marginBottom: RacingTheme.spacing.xs,
  },
  variancePotentialLabel: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    textAlign: 'center' as const,
  },
  varianceRankings: {
    flex: 1,
  },
  varianceRankingsTitle: {
    fontSize: RacingTheme.typography.small,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: RacingTheme.spacing.xs,
  },
  varianceRankingsSubtitle: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.textTertiary,
    marginBottom: RacingTheme.spacing.md,
    fontStyle: 'italic',
  },
  // Mobile Variance Styles
  mobileVarianceList: {
    gap: RacingTheme.spacing.sm,
  },
  mobileVarianceItem: {
    backgroundColor: RacingTheme.colors.surface,
    borderRadius: RacingTheme.borderRadius.md,
    padding: RacingTheme.spacing.md,
    borderWidth: 1,
    borderColor: RacingTheme.colors.surfaceElevated,
  },
  mobileVarianceItemWorst: {
    borderColor: RacingTheme.colors.warning,
    borderWidth: 2,
  },
  mobileVarianceHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: RacingTheme.spacing.sm,
  },
  mobileVarianceRank: {
    fontSize: RacingTheme.typography.body,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.primary,
    fontFamily: RacingTheme.typography.mono,
  },
  mobileVarianceSector: {
    fontSize: RacingTheme.typography.h4,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.text,
  },
  mobileVarianceValue: {
    fontSize: RacingTheme.typography.body,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.warning,
    fontFamily: RacingTheme.typography.mono,
  },
  mobileVarianceDetails: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  mobileVarianceDetail: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.textSecondary,
    textAlign: 'center' as const,
    flex: 1,
  },
  // Desktop Variance Table Styles
  desktopVarianceTable: {
    padding: RacingTheme.spacing.md,
  },
  varianceTableHeader: {
    flexDirection: 'row' as const,
    paddingVertical: RacingTheme.spacing.sm,
  },
  varianceTableHeaderCell: {
    flex: 1,
    fontSize: RacingTheme.typography.small,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    textAlign: 'center' as const,
  },
  varianceTableRow: {
    flexDirection: 'row' as const,
    alignItems: 'center',
    paddingVertical: RacingTheme.spacing.sm,
  },
  varianceTableRowWorst: {
    backgroundColor: RacingTheme.colors.surfaceElevated,
  },
  varianceTableCell: {
    flex: 1,
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.textSecondary,
    textAlign: 'center' as const,
  },
  varianceTableCellWorst: {
    color: RacingTheme.colors.warning,
    fontWeight: RacingTheme.typography.bold as any,
  },
};

export default SectorVarianceAnalysis;
