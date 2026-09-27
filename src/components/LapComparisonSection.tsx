import {LapTime, RacingCard, RacingDivider} from '@/src/components';
import {RacingTheme} from '@/src/theme';
import {Lap} from '@/src/types';
import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';

interface SectorData {
  sectorTime: number;
  incomplete: boolean;
}

interface LapWithSectors extends Lap {
  sectors?: SectorData[];
}

interface GroupedLaps {
  sessionType: string;
  sessionId: number;
  laps: LapWithSectors[];
}

interface LapComparisonSectionProps {
  lapsSectionExpanded: boolean;
  setLapsSectionExpanded: (expanded: boolean) => void;
  sortBy: 'time' | 'lapNumber';
  sortDirection: 'asc' | 'desc';
  handleSortChange: (newSortBy: 'time' | 'lapNumber') => void;
  expandedLaps: Set<string>;
  toggleLapExpansion: (lapId: string) => void;
  selectedLapIds: Set<string>;
  toggleLapSelection: (lapId: string) => void;
  groupedLaps: GroupedLaps[];
  optimalSectors: {sector: number; time: number}[];
  optimalLapTime: number;
  isMobile: boolean;
  laps: LapWithSectors[];
}

const LapComparisonSection: React.FC<LapComparisonSectionProps> = ({
  lapsSectionExpanded,
  setLapsSectionExpanded,
  sortBy,
  sortDirection,
  handleSortChange,
  expandedLaps,
  toggleLapExpansion,
  selectedLapIds,
  toggleLapSelection,
  groupedLaps,
  optimalSectors,
  optimalLapTime,
  isMobile,
  laps,
}) => {
  const formatLapDelta = (delta: number): string => {
    if (delta === 0) {
      return '±0.000';
    }
    const sign = delta > 0 ? '+' : '';
    return `${sign}${delta.toFixed(3)}`;
  };

  const getDeltaColor = (delta: number) => {
    if (delta < 0) {
      return RacingTheme.colors.success;
    } // Faster than optimal
    if (delta > 0) {
      return RacingTheme.colors.error;
    } // Slower than optimal
    return RacingTheme.colors.textSecondary; // Equal to optimal
  };

  const getLapStatusBadges = (lap: LapWithSectors) => {
    const badges: {text: string; style: any}[] = [];

    // Clean/Off-track status
    if (lap.clean) {
      badges.push({
        text: '✓ CLEAN',
        style: styles.cleanBadge,
      });
    } else {
      badges.push({
        text: '⚠ OFF-TRACK',
        style: styles.uncleanBadge,
      });
    }

    // Pit status
    if (lap.pitIn) {
      badges.push({
        text: '↗ PIT IN',
        style: styles.pitBadge,
      });
    }

    if (lap.pitOut) {
      badges.push({
        text: '↙ PIT OUT',
        style: styles.pitBadge,
      });
    }

    return badges;
  };

  return (
    <View style={styles.comparisonSection}>
      <TouchableOpacity
        style={styles.collapsibleHeader}
        onPress={() => setLapsSectionExpanded(!lapsSectionExpanded)}
        activeOpacity={0.7}>
        <Text style={styles.sectionTitle}>
          LAP COMPARISON ({laps.length} LAPS)
        </Text>
        <Text style={styles.collapseIcon}>
          {lapsSectionExpanded ? '▼' : '▶'}
        </Text>
      </TouchableOpacity>

      {lapsSectionExpanded && (
        <>
          {/* Sort Controls */}
          <View style={styles.sortControls}>
            <Text style={styles.sortLabel}>SORT BY:</Text>
            <View style={styles.sortButtons}>
              <TouchableOpacity
                style={[
                  styles.sortButton,
                  sortBy === 'time' && styles.sortButtonActive,
                ]}
                onPress={() => handleSortChange('time')}>
                <Text
                  style={[
                    styles.sortButtonText,
                    sortBy === 'time' && styles.sortButtonTextActive,
                  ]}>
                  TIME{' '}
                  {sortBy === 'time' && (sortDirection === 'asc' ? '↑' : '↓')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.sortButton,
                  sortBy === 'lapNumber' && styles.sortButtonActive,
                ]}
                onPress={() => handleSortChange('lapNumber')}>
                <Text
                  style={[
                    styles.sortButtonText,
                    sortBy === 'lapNumber' && styles.sortButtonTextActive,
                  ]}>
                  LAP #{' '}
                  {sortBy === 'lapNumber' &&
                    (sortDirection === 'asc' ? '↑' : '↓')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {isMobile ? (
            /* Mobile Card Layout */
            <View style={styles.mobileLapsContainer}>
              {(() => {
                // Display grouped laps by session type
                return groupedLaps.map((group, groupIndex) => (
                  <View key={`${group.sessionType}-${group.sessionId}`}>
                    {/* Session Group Header */}
                    <View style={styles.sessionGroupHeader}>
                      <Text style={styles.sessionGroupTitle}>
                        {group.sessionType}
                        {groupedLaps.length > 1 &&
                          ` - Session ${group.sessionId + 1}`}
                      </Text>
                      <Text style={styles.sessionGroupCount}>
                        ({group.laps.length} laps)
                      </Text>
                    </View>

                    {/* Sort laps within group based on current sort settings */}
                    {(() => {
                      const sortedLaps = [...group.laps].sort((a, b) => {
                        let comparison = 0;

                        if (sortBy === 'time') {
                          comparison = a.lapTime - b.lapTime;
                        } else if (sortBy === 'lapNumber') {
                          comparison = a.lapNumber - b.lapNumber;
                        }

                        return sortDirection === 'asc'
                          ? comparison
                          : -comparison;
                      });

                      return sortedLaps.map((lap, index) => {
                        const isSelected = selectedLapIds.has(lap.id);
                        const isExpanded = expandedLaps.has(lap.id);
                        const lapDelta =
                          optimalLapTime > 0 ? lap.lapTime - optimalLapTime : 0;
                        return (
                          <View key={lap.id}>
                            <TouchableOpacity
                              onPress={() => toggleLapSelection(lap.id)}
                              activeOpacity={0.7}>
                              <RacingCard
                                style={
                                  isSelected
                                    ? {
                                        ...styles.mobileLapCard,
                                        ...styles.mobileLapCardSelected,
                                      }
                                    : styles.mobileLapCard
                                }>
                                <View style={styles.mobileLapHeader}>
                                  <View
                                    style={[
                                      styles.mobileLapRank,
                                      isSelected &&
                                        styles.mobileLapRankSelected,
                                    ]}>
                                    <Text
                                      style={[
                                        styles.mobileLapRankText,
                                        isSelected &&
                                          styles.mobileLapRankTextSelected,
                                      ]}>
                                      #{index + 1}
                                    </Text>
                                  </View>
                                  <View style={styles.mobileLapStatus}>
                                    {getLapStatusBadges(lap).map(
                                      (badge, badgeIndex) => (
                                        <Text
                                          key={badgeIndex}
                                          style={[
                                            styles.mobileStatusBadge,
                                            badge.style,
                                          ]}>
                                          {badge.text}
                                        </Text>
                                      ),
                                    )}
                                  </View>
                                </View>

                                <View style={styles.mobileLapDetails}>
                                  <View style={styles.mobileLapDetail}>
                                    <Text style={styles.mobileLapDetailLabel}>
                                      LAP NUMBER
                                    </Text>
                                    <Text style={styles.mobileLapDetailValue}>
                                      {lap.lapNumber + 1}
                                    </Text>
                                  </View>
                                  <View style={styles.mobileLapDetail}>
                                    <Text style={styles.mobileLapDetailLabel}>
                                      LAP TIME
                                    </Text>
                                    <TouchableOpacity
                                      style={styles.mobileLapTimeRow}
                                      onPress={() => toggleLapExpansion(lap.id)}
                                      activeOpacity={0.7}>
                                      <Text
                                        style={[
                                          styles.mobileLapTimeExpandIcon,
                                          isExpanded &&
                                            styles.mobileLapTimeExpandIconActive,
                                        ]}>
                                        {isExpanded ? '▼' : '▶'}
                                      </Text>
                                      <LapTime
                                        time={lap.lapTime}
                                        isBest={index === 0}
                                      />
                                      {optimalLapTime > 0 && (
                                        <Text
                                          style={[
                                            styles.mobileLapDelta,
                                            {
                                              color: getDeltaColor(lapDelta),
                                            },
                                          ]}>
                                          {formatLapDelta(lapDelta)}
                                        </Text>
                                      )}
                                    </TouchableOpacity>
                                  </View>
                                </View>
                              </RacingCard>
                            </TouchableOpacity>

                            {/* Expanded Sector Details */}
                            {isExpanded && (
                              <RacingCard style={styles.mobileExpandedCard}>
                                <Text style={styles.mobileExpandedTitle}>
                                  SECTOR BREAKDOWN
                                </Text>
                                {lap.sectors &&
                                Array.isArray(lap.sectors) &&
                                lap.sectors.length > 0 ? (
                                  <View style={styles.mobileSectorBreakdown}>
                                    {lap.sectors.map(
                                      (sector: any, sectorIndex: number) => {
                                        if (
                                          !sector ||
                                          typeof sector.sectorTime !==
                                            'number' ||
                                          sector.incomplete
                                        ) {
                                          return null;
                                        }

                                        const sectorNum = sectorIndex; // Use array index as sector number
                                        const optimalSector =
                                          optimalSectors.find(
                                            s => s.sector === sectorNum,
                                          );
                                        const sectorDelta = optimalSector
                                          ? sector.sectorTime -
                                            optimalSector.time
                                          : 0;

                                        return (
                                          <View
                                            key={sectorNum}
                                            style={styles.mobileSectorRow}>
                                            <Text
                                              style={styles.mobileSectorLabel}>
                                              S{sectorNum + 1}
                                            </Text>
                                            <Text
                                              style={styles.mobileSectorTime}>
                                              {(() => {
                                                const minutes = Math.floor(
                                                  sector.sectorTime / 60,
                                                );
                                                const remainingSeconds = (
                                                  sector.sectorTime % 60
                                                ).toFixed(3);
                                                return `${minutes}:${remainingSeconds.padStart(
                                                  6,
                                                  '0',
                                                )}`;
                                              })()}
                                            </Text>
                                            {optimalSector && (
                                              <Text
                                                style={[
                                                  styles.mobileSectorDelta,
                                                  {
                                                    color:
                                                      getDeltaColor(
                                                        sectorDelta,
                                                      ),
                                                  },
                                                ]}>
                                                {formatLapDelta(sectorDelta)}
                                              </Text>
                                            )}
                                          </View>
                                        );
                                      },
                                    )}
                                  </View>
                                ) : (
                                  <Text style={styles.mobileNoData}>
                                    No sector data available
                                  </Text>
                                )}

                                {/* Fuel Information */}
                                {(lap.fuelLevel !== undefined ||
                                  lap.fuelUsed !== undefined ||
                                  (lap.fuelAdded !== undefined &&
                                    lap.fuelAdded > 0)) && (
                                  <View style={styles.mobileFuelBreakdown}>
                                    <Text style={styles.mobileExpandedTitle}>
                                      FUEL INFORMATION
                                    </Text>
                                    {lap.fuelLevel !== undefined && (
                                      <View style={styles.mobileFuelRow}>
                                        <Text style={styles.mobileFuelLabel}>
                                          FUEL LEVEL
                                        </Text>
                                        <Text style={styles.mobileFuelValue}>
                                          {lap.fuelLevel.toFixed(3)}L
                                        </Text>
                                      </View>
                                    )}
                                    {lap.fuelUsed !== undefined && (
                                      <View style={styles.mobileFuelRow}>
                                        <Text style={styles.mobileFuelLabel}>
                                          FUEL USED
                                        </Text>
                                        <Text style={styles.mobileFuelValue}>
                                          {lap.fuelUsed.toFixed(3)}L
                                        </Text>
                                      </View>
                                    )}
                                    {lap.fuelAdded !== undefined &&
                                      lap.fuelAdded > 0 && (
                                        <View style={styles.mobileFuelRow}>
                                          <Text style={styles.mobileFuelLabel}>
                                            FUEL ADDED
                                          </Text>
                                          <Text style={styles.mobileFuelValue}>
                                            +{lap.fuelAdded.toFixed(3)}L
                                          </Text>
                                        </View>
                                      )}
                                  </View>
                                )}
                              </RacingCard>
                            )}
                          </View>
                        );
                      });
                    })()}
                  </View>
                ));
              })()}
            </View>
          ) : (
            /* Desktop Table Layout */
            <RacingCard style={styles.tableCard}>
              {/* Comparison Table Header */}
              <View style={styles.tableHeader}>
                <Text style={styles.headerCell}>RANK</Text>
                <TouchableOpacity
                  style={styles.headerCellTouchable}
                  onPress={() => handleSortChange('lapNumber')}>
                  <Text
                    style={[
                      styles.headerCell,
                      sortBy === 'lapNumber' && styles.headerCellActive,
                    ]}>
                    LAP #{' '}
                    {sortBy === 'lapNumber' &&
                      (sortDirection === 'asc' ? '↑' : '↓')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.headerCellTouchable}
                  onPress={() => handleSortChange('time')}>
                  <Text
                    style={[
                      styles.headerCell,
                      sortBy === 'time' && styles.headerCellActive,
                    ]}>
                    LAP TIME{' '}
                    {sortBy === 'time' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.headerCell}>STATUS</Text>
              </View>

              <RacingDivider />

              {/* Comparison Table Rows */}
              {(() => {
                // Display grouped laps by session type
                return groupedLaps.map((group, groupIndex) => (
                  <View key={`${group.sessionType}-${group.sessionId}`}>
                    {/* Session Group Header in Table */}
                    <View style={styles.tableGroupHeader}>
                      <Text style={styles.tableGroupTitle}>
                        {group.sessionType}
                        {groupedLaps.length > 1 &&
                          ` - Session ${group.sessionId + 1}`}
                      </Text>
                      <Text style={styles.tableGroupCount}>
                        ({group.laps.length} laps)
                      </Text>
                    </View>

                    {/* Sort laps within group based on current sort settings */}
                    {(() => {
                      const sortedLaps = [...group.laps].sort((a, b) => {
                        let comparison = 0;

                        if (sortBy === 'time') {
                          comparison = a.lapTime - b.lapTime;
                        } else if (sortBy === 'lapNumber') {
                          comparison = a.lapNumber - b.lapNumber;
                        }

                        return sortDirection === 'asc'
                          ? comparison
                          : -comparison;
                      });

                      return sortedLaps.map((lap, index) => {
                        const isSelected = selectedLapIds.has(lap.id);
                        const isExpanded = expandedLaps.has(lap.id);
                        const lapDelta =
                          optimalLapTime > 0 ? lap.lapTime - optimalLapTime : 0;
                        return (
                          <View key={lap.id}>
                            <View
                              style={
                                isSelected
                                  ? {
                                      ...styles.tableRow,
                                      ...styles.tableRowSelected,
                                    }
                                  : styles.tableRow
                              }>
                              <TouchableOpacity
                                style={styles.cell}
                                onPress={() => toggleLapSelection(lap.id)}
                                activeOpacity={0.7}>
                                <Text
                                  style={[
                                    styles.cell,
                                    isSelected && styles.cellSelected,
                                  ]}>
                                  #{index + 1}
                                </Text>
                              </TouchableOpacity>
                              <Text
                                style={[
                                  styles.cell,
                                  isSelected && styles.cellSelected,
                                ]}>
                                {lap.lapNumber + 1}
                              </Text>
                              <TouchableOpacity
                                style={[
                                  styles.tableTimeCell,
                                  isExpanded && styles.tableTimeCellExpanded,
                                ]}
                                onPress={() => toggleLapExpansion(lap.id)}
                                activeOpacity={0.7}>
                                <LapTime
                                  time={lap.lapTime}
                                  isBest={index === 0}
                                />
                                {optimalLapTime > 0 && (
                                  <Text
                                    style={[
                                      styles.cellDelta,
                                      isSelected && styles.cellSelected,
                                      {color: getDeltaColor(lapDelta)},
                                    ]}>
                                    {formatLapDelta(lapDelta)}
                                  </Text>
                                )}
                                <Text
                                  style={[
                                    styles.expandIcon,
                                    isExpanded && styles.expandIconExpanded,
                                  ]}>
                                  {isExpanded ? '▼' : '▶'}
                                </Text>
                              </TouchableOpacity>
                              <View style={styles.cell}>
                                {getLapStatusBadges(lap).map(
                                  (badge, badgeIndex) => (
                                    <Text
                                      key={badgeIndex}
                                      style={[styles.statusBadge, badge.style]}>
                                      {badge.text}
                                    </Text>
                                  ),
                                )}
                              </View>
                            </View>

                            {/* Expanded Sector Details for Desktop */}
                            {isExpanded && (
                              <View style={styles.expandedSectorRow}>
                                <RacingDivider />
                                <View style={styles.expandedSectorContent}>
                                  <Text style={styles.expandedSectorTitle}>
                                    SECTOR BREAKDOWN
                                  </Text>
                                  {lap.sectors &&
                                  Array.isArray(lap.sectors) &&
                                  lap.sectors.length > 0 ? (
                                    <View style={styles.expandedSectorGrid}>
                                      {lap.sectors.map(
                                        (sector: any, sectorIndex: number) => {
                                          if (
                                            !sector ||
                                            typeof sector.sectorTime !==
                                              'number' ||
                                            sector.incomplete
                                          ) {
                                            return null;
                                          }

                                          const sectorNum = sectorIndex; // Use array index as sector number
                                          const optimalSector =
                                            optimalSectors.find(
                                              s => s.sector === sectorNum,
                                            );
                                          const sectorDelta = optimalSector
                                            ? sector.sectorTime -
                                              optimalSector.time
                                            : 0;

                                          return (
                                            <View
                                              key={sectorNum}
                                              style={styles.expandedSectorItem}>
                                              <Text
                                                style={
                                                  styles.expandedSectorLabel
                                                }>
                                                S{sectorNum + 1}
                                              </Text>
                                              <Text
                                                style={
                                                  styles.expandedSectorTime
                                                }>
                                                {(() => {
                                                  const minutes = Math.floor(
                                                    sector.sectorTime / 60,
                                                  );
                                                  const remainingSeconds = (
                                                    sector.sectorTime % 60
                                                  ).toFixed(3);
                                                  return `${minutes}:${remainingSeconds.padStart(
                                                    6,
                                                    '0',
                                                  )}`;
                                                })()}
                                              </Text>
                                              {optimalSector && (
                                                <Text
                                                  style={[
                                                    styles.expandedSectorDelta,
                                                    {
                                                      color:
                                                        getDeltaColor(
                                                          sectorDelta,
                                                        ),
                                                    },
                                                  ]}>
                                                  {formatLapDelta(sectorDelta)}
                                                </Text>
                                              )}
                                            </View>
                                          );
                                        },
                                      )}
                                    </View>
                                  ) : (
                                    <Text style={styles.expandedNoData}>
                                      No sector data available
                                    </Text>
                                  )}
                                </View>

                                {/* Fuel Information for Desktop */}
                                {(lap.fuelLevel !== undefined ||
                                  lap.fuelUsed !== undefined ||
                                  (lap.fuelAdded !== undefined &&
                                    lap.fuelAdded > 0)) && (
                                  <View style={styles.expandedFuelSection}>
                                    <Text style={styles.expandedSectorTitle}>
                                      FUEL INFORMATION
                                    </Text>
                                    <View style={styles.expandedFuelGrid}>
                                      {lap.fuelLevel !== undefined && (
                                        <View style={styles.expandedFuelItem}>
                                          <Text
                                            style={styles.expandedFuelLabel}>
                                            FUEL LEVEL
                                          </Text>
                                          <Text
                                            style={styles.expandedFuelValue}>
                                            {lap.fuelLevel.toFixed(3)}L
                                          </Text>
                                        </View>
                                      )}
                                      {lap.fuelUsed !== undefined && (
                                        <View style={styles.expandedFuelItem}>
                                          <Text
                                            style={styles.expandedFuelLabel}>
                                            FUEL USED
                                          </Text>
                                          <Text
                                            style={styles.expandedFuelValue}>
                                            {lap.fuelUsed.toFixed(3)}L
                                          </Text>
                                        </View>
                                      )}
                                      {lap.fuelAdded !== undefined &&
                                        lap.fuelAdded > 0 && (
                                          <View style={styles.expandedFuelItem}>
                                            <Text
                                              style={styles.expandedFuelLabel}>
                                              FUEL ADDED
                                            </Text>
                                            <Text
                                              style={styles.expandedFuelValue}>
                                              +{lap.fuelAdded.toFixed(3)}L
                                            </Text>
                                          </View>
                                        )}
                                    </View>
                                  </View>
                                )}
                              </View>
                            )}

                            {index < sortedLaps.length - 1 && <RacingDivider />}
                          </View>
                        );
                      });
                    })()}
                  </View>
                ));
              })()}
            </RacingCard>
          )}
        </>
      )}
    </View>
  );
};

const styles = {
  comparisonSection: {
    marginBottom: RacingTheme.spacing.lg,
  },
  sectionTitle: {
    fontSize: RacingTheme.typography.h4,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.text,
    marginBottom: RacingTheme.spacing.md,
    letterSpacing: 1,
  },
  collapsibleHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: RacingTheme.spacing.sm,
  },
  collapseIcon: {
    fontSize: RacingTheme.typography.h3,
    color: RacingTheme.colors.primary,
    fontWeight: RacingTheme.typography.bold as any,
  },
  tableCard: {
    padding: RacingTheme.spacing.md,
  },
  tableHeader: {
    flexDirection: 'row' as const,
    paddingVertical: RacingTheme.spacing.sm,
  },
  headerCell: {
    flex: 1,
    fontSize: RacingTheme.typography.small,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    textAlign: 'center' as const,
  },
  headerCellTouchable: {
    flex: 1,
  },
  headerCellActive: {
    color: RacingTheme.colors.primary,
  },
  tableRow: {
    flexDirection: 'row' as const,
    alignItems: 'center',
    paddingVertical: RacingTheme.spacing.sm,
  },
  cell: {
    flex: 1,
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.textSecondary,
    textAlign: 'center' as const,
  },
  statusBadge: {
    fontSize: RacingTheme.typography.caption,
    fontWeight: RacingTheme.typography.medium as any,
    textAlign: 'center' as const,
    paddingHorizontal: RacingTheme.spacing.xs,
    paddingVertical: RacingTheme.spacing.xs,
    borderRadius: RacingTheme.borderRadius.sm,
    marginBottom: RacingTheme.spacing.xs,
  },
  cleanBadge: {
    backgroundColor: RacingTheme.colors.success,
    color: RacingTheme.colors.surface,
  },
  uncleanBadge: {
    backgroundColor: RacingTheme.colors.warning,
    color: RacingTheme.colors.surface,
  },
  pitBadge: {
    backgroundColor: RacingTheme.colors.secondary,
    color: RacingTheme.colors.surface,
  },
  mobileLapsContainer: {
    gap: RacingTheme.spacing.md,
  },
  mobileLapCard: {
    padding: RacingTheme.spacing.md,
  },
  mobileLapHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: RacingTheme.spacing.md,
  },
  mobileLapRank: {
    backgroundColor: RacingTheme.colors.primary,
    borderRadius: RacingTheme.borderRadius.sm,
    paddingHorizontal: RacingTheme.spacing.sm,
    paddingVertical: RacingTheme.spacing.xs,
    minWidth: 40,
    alignItems: 'center',
  },
  mobileLapRankText: {
    fontSize: RacingTheme.typography.body,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.surface,
    textAlign: 'center' as const,
  },
  mobileLapStatus: {
    alignItems: 'flex-end',
    gap: RacingTheme.spacing.xs,
  },
  mobileStatusBadge: {
    fontSize: RacingTheme.typography.caption,
    fontWeight: RacingTheme.typography.medium as any,
    paddingHorizontal: RacingTheme.spacing.sm,
    paddingVertical: RacingTheme.spacing.xs,
    borderRadius: RacingTheme.borderRadius.sm,
    textAlign: 'center' as const,
    marginBottom: RacingTheme.spacing.xs,
  },
  mobileCleanBadge: {
    backgroundColor: RacingTheme.colors.success,
    color: RacingTheme.colors.surface,
  },
  mobileUncleanBadge: {
    backgroundColor: RacingTheme.colors.warning,
    color: RacingTheme.colors.surface,
  },
  mobileLapDetails: {
    gap: RacingTheme.spacing.sm,
  },
  mobileLapDetail: {
    flexDirection: 'row' as const,
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  mobileLapDetailLabel: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    flex: 1,
  },
  mobileLapDetailValue: {
    fontSize: RacingTheme.typography.body,
    fontWeight: RacingTheme.typography.medium as any,
    color: RacingTheme.colors.text,
    textAlign: 'right' as const,
    flex: 1,
  },
  mobileLapTimeRow: {
    flexDirection: 'row' as const,
    alignItems: 'center',
    justifyContent: 'flex-start',
    alignSelf: 'flex-start',
  },
  mobileLapDelta: {
    fontSize: RacingTheme.typography.caption,
    fontFamily: RacingTheme.typography.mono,
    fontWeight: RacingTheme.typography.bold as any,
    marginLeft: RacingTheme.spacing.sm,
  },
  mobileLapTimeHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: RacingTheme.spacing.xs,
  },
  mobileLapTimeExpand: {
    paddingHorizontal: RacingTheme.spacing.xs,
    paddingVertical: RacingTheme.spacing.xs,
  },
  mobileLapTimeExpandIcon: {
    fontSize: RacingTheme.typography.body,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.primary,
    marginRight: RacingTheme.spacing.sm,
  },
  mobileLapTimeExpandIconActive: {
    color: RacingTheme.colors.secondary,
  },
  mobileExpandedCard: {
    marginTop: RacingTheme.spacing.xs,
    marginLeft: RacingTheme.spacing.lg,
    marginRight: RacingTheme.spacing.lg,
    padding: RacingTheme.spacing.md,
  },
  mobileExpandedTitle: {
    fontSize: RacingTheme.typography.small,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: RacingTheme.spacing.sm,
  },
  mobileSectorBreakdown: {
    gap: RacingTheme.spacing.xs,
  },
  mobileSectorRow: {
    flexDirection: 'row' as const,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: RacingTheme.spacing.xs,
    paddingHorizontal: RacingTheme.spacing.sm,
    backgroundColor: RacingTheme.colors.surface,
    borderRadius: RacingTheme.borderRadius.sm,
  },
  mobileSectorLabel: {
    fontSize: RacingTheme.typography.caption,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.primary,
    fontFamily: RacingTheme.typography.mono,
    minWidth: 30,
  },
  mobileSectorTime: {
    fontSize: RacingTheme.typography.body,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.text,
    fontFamily: RacingTheme.typography.mono,
    flex: 1,
    textAlign: 'center' as const,
  },
  mobileSectorDelta: {
    fontSize: RacingTheme.typography.caption,
    fontFamily: RacingTheme.typography.mono,
    fontWeight: RacingTheme.typography.bold as any,
    minWidth: 50,
    textAlign: 'right' as const,
  },
  mobileNoData: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.textTertiary,
    textAlign: 'center' as const,
    fontStyle: 'italic',
  },
  // Sort Controls Styles
  sortControls: {
    flexDirection: 'row' as const,
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: RacingTheme.spacing.md,
    paddingHorizontal: RacingTheme.spacing.sm,
  },
  sortLabel: {
    fontSize: RacingTheme.typography.small,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  sortButtons: {
    flexDirection: 'row' as const,
    gap: RacingTheme.spacing.sm,
  },
  sortButton: {
    backgroundColor: RacingTheme.colors.surface,
    paddingHorizontal: RacingTheme.spacing.md,
    paddingVertical: RacingTheme.spacing.sm,
    borderRadius: RacingTheme.borderRadius.sm,
    borderWidth: 1,
    borderColor: RacingTheme.colors.surfaceElevated,
  },
  sortButtonActive: {
    backgroundColor: RacingTheme.colors.primary,
    borderColor: RacingTheme.colors.primary,
  },
  sortButtonText: {
    fontSize: RacingTheme.typography.caption,
    fontWeight: RacingTheme.typography.medium as any,
    color: RacingTheme.colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  sortButtonTextActive: {
    color: RacingTheme.colors.surface,
    fontWeight: RacingTheme.typography.bold as any,
  },
  // Selected State Styles
  mobileLapCardSelected: {
    borderColor: RacingTheme.colors.secondary,
    borderWidth: 2,
  },
  mobileLapRankSelected: {
    backgroundColor: RacingTheme.colors.secondary,
  },
  mobileLapRankTextSelected: {
    color: RacingTheme.colors.surface,
  },
  tableRowSelected: {
    backgroundColor: RacingTheme.colors.surfaceElevated,
  },
  cellSelected: {
    color: RacingTheme.colors.secondary,
    fontWeight: RacingTheme.typography.bold as any,
  },
  cellDelta: {
    flex: 1,
    fontSize: RacingTheme.typography.caption,
    fontFamily: RacingTheme.typography.mono,
    fontWeight: RacingTheme.typography.bold as any,
    textAlign: 'center' as const,
  },
  expandCell: {
    paddingHorizontal: RacingTheme.spacing.sm,
    paddingVertical: RacingTheme.spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandCellActive: {
    backgroundColor: RacingTheme.colors.surfaceElevated,
    borderRadius: RacingTheme.borderRadius.sm,
  },
  expandIcon: {
    fontSize: RacingTheme.typography.h4,
    color: RacingTheme.colors.primary,
    fontWeight: RacingTheme.typography.bold as any,
  },
  expandIconExpanded: {
    color: RacingTheme.colors.secondary,
  },
  tableTimeCell: {
    flex: 1, // Minimal space for lap time column
    flexDirection: 'row' as const,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: RacingTheme.spacing.sm,
    paddingVertical: RacingTheme.spacing.xs,
    gap: 1, // Ultra minimal gap between elements
  },
  tableTimeCellExpanded: {
    backgroundColor: RacingTheme.colors.surfaceElevated,
  },
  expandedSectorRow: {
    backgroundColor: RacingTheme.colors.surface,
    borderLeftWidth: 2,
    borderLeftColor: RacingTheme.colors.primary,
    marginLeft: RacingTheme.spacing.xl,
    marginRight: RacingTheme.spacing.xl,
  },
  expandedSectorContent: {
    padding: RacingTheme.spacing.md,
  },
  expandedSectorTitle: {
    fontSize: RacingTheme.typography.small,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: RacingTheme.spacing.sm,
  },
  expandedSectorGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: RacingTheme.spacing.sm,
  },
  expandedSectorItem: {
    backgroundColor: RacingTheme.colors.surfaceElevated,
    borderRadius: RacingTheme.borderRadius.sm,
    padding: RacingTheme.spacing.sm,
    alignItems: 'center',
    minWidth: 100,
  },
  expandedSectorLabel: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.primary,
    fontFamily: RacingTheme.typography.mono,
    fontWeight: RacingTheme.typography.bold as any,
    marginBottom: RacingTheme.spacing.xs,
  },
  expandedSectorTime: {
    fontSize: RacingTheme.typography.body,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.text,
    fontFamily: RacingTheme.typography.mono,
    marginBottom: RacingTheme.spacing.xs,
  },
  expandedSectorDelta: {
    fontSize: RacingTheme.typography.caption,
    fontFamily: RacingTheme.typography.mono,
    fontWeight: RacingTheme.typography.bold as any,
  },
  expandedNoData: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.textTertiary,
    textAlign: 'center' as const,
    fontStyle: 'italic',
  },
  // Session Group Headers
  sessionGroupHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: RacingTheme.colors.surface,
    paddingHorizontal: RacingTheme.spacing.md,
    paddingVertical: RacingTheme.spacing.sm,
    marginTop: RacingTheme.spacing.md,
    marginBottom: RacingTheme.spacing.sm,
    borderRadius: RacingTheme.borderRadius.md,
    borderWidth: 1,
    borderColor: RacingTheme.colors.surfaceElevated,
  },
  sessionGroupTitle: {
    fontSize: RacingTheme.typography.h4,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.primary,
    letterSpacing: 0.5,
  },
  sessionGroupCount: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.textSecondary,
    fontStyle: 'italic',
  },
  // Desktop Table Group Headers
  tableGroupHeader: {
    backgroundColor: RacingTheme.colors.surface,
    paddingHorizontal: RacingTheme.spacing.md,
    paddingVertical: RacingTheme.spacing.sm,
    marginTop: RacingTheme.spacing.sm,
    marginBottom: RacingTheme.spacing.xs,
    borderRadius: RacingTheme.borderRadius.sm,
    flexDirection: 'row' as const,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tableGroupTitle: {
    fontSize: RacingTheme.typography.small,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.primary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  tableGroupCount: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.textSecondary,
    fontStyle: 'italic',
  },
  // Mobile Fuel Styles
  mobileFuelBreakdown: {
    gap: RacingTheme.spacing.xs,
    marginTop: RacingTheme.spacing.sm,
    paddingLeft: RacingTheme.spacing.sm,
  },
  mobileFuelRow: {
    flexDirection: 'row' as const,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: RacingTheme.spacing.xs,
    paddingHorizontal: RacingTheme.spacing.sm,
    backgroundColor: RacingTheme.colors.surface,
    borderRadius: RacingTheme.borderRadius.sm,
  },
  mobileFuelLabel: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  mobileFuelValue: {
    fontSize: RacingTheme.typography.body,
    fontWeight: RacingTheme.typography.medium as any,
    color: RacingTheme.colors.text,
    fontFamily: RacingTheme.typography.mono,
  },
  // Desktop Fuel Styles
  expandedFuelSection: {
    paddingTop: RacingTheme.spacing.sm,
    paddingHorizontal: RacingTheme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: RacingTheme.colors.surfaceElevated,
    marginTop: RacingTheme.spacing.sm,
  },
  expandedFuelGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: RacingTheme.spacing.sm,
    marginTop: RacingTheme.spacing.sm,
  },
  expandedFuelItem: {
    backgroundColor: RacingTheme.colors.surfaceElevated,
    borderRadius: RacingTheme.borderRadius.sm,
    padding: RacingTheme.spacing.sm,
    alignItems: 'center',
    minWidth: 120,
  },
  expandedFuelLabel: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.primary,
    fontFamily: RacingTheme.typography.mono,
    fontWeight: RacingTheme.typography.bold as any,
    marginBottom: RacingTheme.spacing.xs,
    textAlign: 'center' as const,
  },
  expandedFuelValue: {
    fontSize: RacingTheme.typography.body,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.text,
    fontFamily: RacingTheme.typography.mono,
    textAlign: 'center' as const,
  },
};

export default LapComparisonSection;
