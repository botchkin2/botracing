import {useLaps} from '@src/hooks/useApiQueries';
import {RacingTheme} from '@src/theme';
import {Lap, SessionData} from '@src/types';
import React, {useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import LapComparisonSection from './LapComparisonSection';
import LapSelectionControls from './LapSelectionControls';
import OptimalSectorAnalysis from './OptimalSectorAnalysis';
import SectorVarianceAnalysis from './SectorVarianceAnalysis';
import SessionHeader from './SessionHeader';
import SummaryMetrics from './SummaryMetrics';

interface SessionAnalysisProps {
  sessionData: SessionData;
  onBack: () => void;
  onMultiLapComparison?: (selectedLapIds: Set<string>) => void;
}

const SessionAnalysis: React.FC<SessionAnalysisProps> = ({
  sessionData,
  onBack,
  onMultiLapComparison,
}) => {
  // All hooks must be called before any conditional logic
  const [laps, setLaps] = useState<Lap[]>([]);
  const [fadeAnim] = useState(new Animated.Value(1));
  const [dimensions, setDimensions] = useState(Dimensions.get('window'));
  const [selectedLapIds, setSelectedLapIds] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<'time' | 'lapNumber'>('lapNumber');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [expandedLaps, setExpandedLaps] = useState<Set<string>>(new Set());
  const [lapsSectionExpanded, setLapsSectionExpanded] =
    useState<boolean>(false);

  // Handle lap selection
  const toggleLapSelection = (lapId: string) => {
    setSelectedLapIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(lapId)) {
        newSet.delete(lapId);
      } else {
        newSet.add(lapId);
      }
      return newSet;
    });
  };

  const selectAllLaps = () => {
    setSelectedLapIds(new Set(laps.map(lap => lap.id)));
  };

  const selectCleanLaps = () => {
    setSelectedLapIds(
      new Set(
        laps
          .filter(lap => lap.clean && !lap.pitIn && !lap.pitOut)
          .map(lap => lap.id),
      ),
    );
  };

  const clearSelection = () => {
    setSelectedLapIds(new Set());
  };

  const getSessionTypeName = (type: number): string => {
    switch (type) {
      case 1:
        return 'Practice';
      case 2:
        return 'Qualifying';
      case 3:
        return 'Race';
      default:
        return 'Unknown';
    }
  };

  // Handle sort change
  const handleSortChange = (newSortBy: 'time' | 'lapNumber') => {
    if (sortBy === newSortBy) {
      // Toggle direction if same sort type
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // New sort type, default to ascending
      setSortBy(newSortBy);
      setSortDirection('asc');
    }
  };

  // Group laps by session type and session ID for restarted sessions
  const groupedLaps = useMemo(() => {
    const groups: Record<string, Lap[]> = {};

    laps.forEach(lap => {
      const sessionTypeName = getSessionTypeName(lap.sessionType);
      const groupKey = `${sessionTypeName}-${lap.session}`;

      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(lap);
    });

    // Sort groups by session type order (Practice, Qualifying, Race) and then by session ID
    const sortedGroupKeys = Object.keys(groups).sort((a, b) => {
      const aParts = a.split('-');
      const bParts = b.split('-');

      const sessionTypeOrder = {Practice: 1, Qualifying: 2, Race: 3};
      const aOrder =
        sessionTypeOrder[aParts[0] as keyof typeof sessionTypeOrder] || 99;
      const bOrder =
        sessionTypeOrder[bParts[0] as keyof typeof sessionTypeOrder] || 99;

      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }

      // If same session type, sort by session ID
      return parseInt(aParts[1]) - parseInt(bParts[1]);
    });

    return sortedGroupKeys.map(key => ({
      sessionType: key.split('-')[0],
      sessionId: parseInt(key.split('-')[1]),
      laps: groups[key].sort((a, b) => a.lapNumber - b.lapNumber), // Sort laps within group by lap number
    }));
  }, [laps]);

  // Get selected laps for calculations
  const selectedLaps = laps.filter(lap => selectedLapIds.has(lap.id));

  // Calculate optimal sector times from all selected laps
  const getOptimalLapData = () => {
    const sectorMap = new Map<number, number>();

    // Find the best time for each sector across all selected laps
    selectedLaps.forEach(lap => {
      if (lap.sectors && Array.isArray(lap.sectors)) {
        lap.sectors.forEach((sector: any, sectorIndex: number) => {
          // Based on the API response, sectors are: {sectorTime: number, incomplete: boolean}
          if (
            sector &&
            typeof sector.sectorTime === 'number' &&
            sector.sectorTime > 0 &&
            !sector.incomplete
          ) {
            const sectorNum = sectorIndex; // Use array index as sector number (0-based)
            const currentBest = sectorMap.get(sectorNum);
            if (currentBest === undefined || sector.sectorTime < currentBest) {
              sectorMap.set(sectorNum, sector.sectorTime);
            }
          }
        });
      }
    });

    // Convert to sorted array for display (keep original sector numbers)
    const optimalSectors = Array.from(sectorMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([sector, time]) => ({sector, time})); // Keep original 0-based internally

    // Calculate theoretical optimal lap time
    const optimalLapTime = optimalSectors.reduce(
      (sum, sector) => sum + sector.time,
      0,
    );

    return {optimalSectors, optimalLapTime};
  };

  // Calculate sector variance analysis
  const getSectorVarianceData = () => {
    const sectorStats = new Map<
      number,
      {
        times: number[];
        sum: number;
        sumSquares: number;
        count: number;
      }
    >();

    // Collect all valid sector times for each sector
    selectedLaps.forEach(lap => {
      if (lap.sectors && Array.isArray(lap.sectors)) {
        lap.sectors.forEach((sector: any, sectorIndex: number) => {
          if (
            sector &&
            typeof sector.sectorTime === 'number' &&
            sector.sectorTime > 0 &&
            !sector.incomplete
          ) {
            const sectorNum = sectorIndex;
            if (!sectorStats.has(sectorNum)) {
              sectorStats.set(sectorNum, {
                times: [],
                sum: 0,
                sumSquares: 0,
                count: 0,
              });
            }
            const stats = sectorStats.get(sectorNum)!;
            stats.times.push(sector.sectorTime);
            stats.sum += sector.sectorTime;
            stats.sumSquares += sector.sectorTime * sector.sectorTime;
            stats.count += 1;
          }
        });
      }
    });

    // Calculate variance and standard deviation for each sector
    const sectorVariances = Array.from(sectorStats.entries())
      .map(([sectorNum, stats]) => {
        const mean = stats.sum / stats.count;
        const variance = stats.sumSquares / stats.count - mean * mean;
        const stdDev = Math.sqrt(variance);
        // Scale inconsistency so that 0.5s standard deviation = 100% inconsistency
        // This makes 0.5s variation highly visible regardless of sector length
        const scaledInconsistency = (stdDev / 0.5) * 100; // 0.5s = 100% benchmark

        // Find best time for this sector
        const bestTime = Math.min(...stats.times);
        // Calculate spread as max - min range
        const spread = Math.max(...stats.times) - Math.min(...stats.times);
        // Potential savings = sum of (each lap's sector time - best) = total time lost vs best
        const potentialImprovement = stats.times.reduce(
          (sum, t) => sum + (t - bestTime),
          0,
        );

        return {
          sector: sectorNum,
          mean,
          variance,
          stdDev,
          coefficientOfVariation: scaledInconsistency / 100, // Keep original CV for compatibility
          scaledInconsistency, // New scaled metric (0.5s = 100%)
          bestTime,
          spread,
          lapCount: stats.count,
          times: stats.times,
          potentialImprovement,
        };
      })
      .sort(
        (a, b) =>
          (b.scaledInconsistency || b.coefficientOfVariation * 100) -
          (a.scaledInconsistency || a.coefficientOfVariation * 100),
      ); // Sort by most inconsistent first

    return sectorVariances;
  };

  const {optimalSectors, optimalLapTime} = getOptimalLapData();
  const sectorVariances = getSectorVarianceData();
  const meanSectors = sectorVariances.map(s => ({
    sector: s.sector,
    time: s.mean,
  }));
  const meanLapTime = sectorVariances.reduce((sum, s) => sum + s.mean, 0);

  // Toggle lap expansion
  const toggleLapExpansion = (lapId: string) => {
    setExpandedLaps(prev => {
      const newSet = new Set(prev);
      if (newSet.has(lapId)) {
        newSet.delete(lapId);
      } else {
        newSet.add(lapId);
      }
      return newSet;
    });
  };

  // Memoize query parameters to ensure stable reference for React Query deduplication
  const lapsQueryParams = useMemo(
    () =>
      sessionData
        ? {
            limit: 1000,
            drivers: 'me',
            event: sessionData.eventId,
            tracks:
              sessionData.track?.id != null
                ? [sessionData.track.id]
                : undefined,
            unclean: true,
            group: 'none',
            lapTypes: '1,2,3,4',
            source: sessionData.track?.platform === 'lmu' ? 'lmu' : 'garage61',
          }
        : undefined,
    [
      sessionData?.eventId,
      sessionData?.track?.id,
      sessionData?.track?.platform,
    ],
  );

  // Use cached laps query - only when sessionData is available
  const {
    data: lapsResponse,
    isLoading,
    error,
  } = useLaps(lapsQueryParams, {enabled: !!lapsQueryParams});

  // Set laps and default selection when data loads
  useEffect(() => {
    if (lapsResponse?.items) {
      setLaps(lapsResponse.items);
      // Default to selecting all clean laps (excluding pit laps)
      setSelectedLapIds(
        new Set(
          lapsResponse.items
            .filter((lap: Lap) => lap.clean && !lap.pitIn && !lap.pitOut)
            .map((lap: Lap) => lap.id),
        ),
      );
    }
  }, [lapsResponse]);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: RacingTheme.animations.normal,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({window}) => {
      setDimensions(window);
    });
    return () => subscription?.remove();
  }, []);

  // Add null checks to prevent runtime errors - after all hooks are called
  if (!sessionData || !sessionData.car || !sessionData.track) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size='large' color={RacingTheme.colors.primary} />
        <Text style={styles.loadingText}>Loading session data...</Text>
      </View>
    );
  }

  // Determine if we should use mobile layout (screen width < 768px)
  const isMobile = dimensions.width < 768;

  if (isLoading && !lapsResponse) {
    return (
      <View style={styles.mainContainer}>
        <View style={styles.centerContainer}>
          <ActivityIndicator size='large' color={RacingTheme.colors.primary} />
          <Text style={styles.loadingText}>LOADING SESSION LAPS...</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.mainContainer}>
        <View style={styles.centerContainer}>
          <Text style={styles.errorText}>ERROR LOADING SESSION LAPS</Text>
          <Text style={styles.errorText}>{error.message}</Text>

          <View style={styles.errorActions}>
            <Text style={styles.errorHelpText}>
              This appears to be a network or server error. The API token is
              configured server-side via Firebase. Try refreshing or contact
              support if the issue persists.
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.mainContainer}>
      <ScrollView
        key={`scroll-${lapsSectionExpanded}`}
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={true}
        keyboardShouldPersistTaps='handled'>
        <Animated.View style={[{opacity: fadeAnim}]}>
          <View style={styles.container}>
            <SessionHeader sessionData={sessionData} onBack={onBack} />

            <SummaryMetrics selectedLaps={selectedLaps} />

            <OptimalSectorAnalysis
              optimalSectors={optimalSectors}
              optimalLapTime={optimalLapTime}
              meanSectors={meanSectors}
              meanLapTime={meanLapTime}
              isMobile={isMobile}
            />

            <LapSelectionControls
              laps={laps}
              selectedLaps={selectedLaps}
              onSelectAllLaps={selectAllLaps}
              onSelectCleanLaps={selectCleanLaps}
              onClearSelection={clearSelection}
              onMultiLapComparison={onMultiLapComparison}
            />

            <LapComparisonSection
              lapsSectionExpanded={lapsSectionExpanded}
              setLapsSectionExpanded={setLapsSectionExpanded}
              sortBy={sortBy}
              sortDirection={sortDirection}
              handleSortChange={handleSortChange}
              expandedLaps={expandedLaps}
              toggleLapExpansion={toggleLapExpansion}
              selectedLapIds={selectedLapIds}
              toggleLapSelection={toggleLapSelection}
              groupedLaps={groupedLaps}
              optimalSectors={optimalSectors}
              optimalLapTime={optimalLapTime}
              isMobile={isMobile}
              laps={laps}
            />

            <SectorVarianceAnalysis
              sectorVariances={sectorVariances}
              isMobile={isMobile}
            />

            <View style={styles.bottomSpacing} />
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: RacingTheme.colors.background,
  },
  mainContainer: {
    flex: 1,
    backgroundColor: RacingTheme.colors.background,
  },
  scrollView: {
    flex: 1,
    backgroundColor: RacingTheme.colors.background,
  },
  contentContainer: {
    flexGrow: 1,
    paddingBottom: 100,
  },
  container: {
    padding: RacingTheme.spacing.md,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: RacingTheme.spacing.md,
    backgroundColor: RacingTheme.colors.background,
  },
  loadingText: {
    marginTop: RacingTheme.spacing.md,
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.primary,
    letterSpacing: 1,
  },
  errorText: {
    fontSize: RacingTheme.typography.h2,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.error,
    textAlign: 'center',
    marginBottom: RacingTheme.spacing.lg,
    letterSpacing: 1,
  },
  errorActions: {
    alignItems: 'center',
    marginTop: RacingTheme.spacing.xl,
  },
  errorHelpText: {
    fontSize: RacingTheme.typography.body,
    color: RacingTheme.colors.textSecondary,
    textAlign: 'center',
    marginBottom: RacingTheme.spacing.lg,
    paddingHorizontal: RacingTheme.spacing.lg,
    lineHeight: 20,
  },
  bottomSpacing: {
    height: RacingTheme.spacing.xxxl,
  },
});

export default SessionAnalysis;
