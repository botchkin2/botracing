import {RacingButton, RacingCard, RacingDivider} from '@src/components';
import {useLaps} from '@src/hooks/useApiQueries';
import {RacingTheme} from '@src/theme';
import {Lap, SessionData} from '@src/types';
import {LAP_COLOR_SCHEMES, SERIES_BASE_COLORS} from '@src/utils/colors';
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, {Circle, Path} from 'react-native-svg';
import {
  LapTelemetryLoader,
  MultiLapTimeSeriesChart,
  ProcessedLapData,
} from './MultiLapTimeSeriesChart';

const DESKTOP_BREAKPOINT = 900;

interface ChartConfig {
  id: string;
  selectedSeries: string[];
  title: string;
}

interface MultiLapComparisonProps {
  sessionData: SessionData;
  onBack: () => void;
  selectedLapIds?: Set<string>;
}

const MultiLapComparison: React.FC<MultiLapComparisonProps> = ({
  sessionData,
  onBack,
  selectedLapIds,
}) => {
  // All hooks must be called before any conditional logic
  const [laps, setLaps] = useState<Lap[]>([]);
  const [fadeAnim] = useState(new Animated.Value(1));
  const [internalSelectedLapIds, setInternalSelectedLapIds] = useState<
    Set<string>
  >(new Set());
  const [sortBy, setSortBy] = useState<'time' | 'lapNumber'>('time');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Shared control states for all charts
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [zoomLevel, setZoomLevel] = useState(3);
  const [showTrackMap, setShowTrackMap] = useState(true);
  const [currentPosition, setCurrentPosition] = useState(0);
  const [windowWidth, setWindowWidth] = useState(
    () => Dimensions.get('window').width,
  );
  const isDesktop = windowWidth >= DESKTOP_BREAKPOINT;

  // Multiple charts state
  const [charts, setCharts] = useState<ChartConfig[]>([
    {
      id: 'chart-1',
      selectedSeries: ['brake', 'throttle'],
      title: 'Lap Comparison',
    },
  ]);

  // Data loading state for sharing across charts
  const [lapDataMap, setLapDataMap] = useState<Map<string, ProcessedLapData>>(
    new Map(),
  );
  const [dataLoading, setDataLoading] = useState(true);

  // Enhanced loading progress tracking
  const [loadingProgress, setLoadingProgress] = useState<{
    loadedCount: number;
    totalCount: number;
    currentlyLoading: string[];
    completedLaps: string[];
  }>({
    loadedCount: 0,
    totalCount: 0,
    currentlyLoading: [],
    completedLaps: [],
  });

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
      // Use passed selectedLapIds if available, otherwise default to selecting all clean laps
      if (selectedLapIds && selectedLapIds.size > 0) {
        setInternalSelectedLapIds(selectedLapIds);
      } else {
        setInternalSelectedLapIds(
          new Set(
            lapsResponse.items.filter(lap => lap.clean).map(lap => lap.id),
          ),
        );
      }
    }
  }, [lapsResponse, selectedLapIds]);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: RacingTheme.animations.normal,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({window}) => {
      setWindowWidth(window.width);
    });
    return () => subscription?.remove();
  }, []);

  // Get selected laps (memoized to prevent infinite re-renders)
  const selectedLaps = useMemo(() => {
    return laps
      .filter(lap => internalSelectedLapIds.has(lap.id))
      .sort((a, b) => {
        let comparison = 0;
        if (sortBy === 'time') {
          comparison = a.lapTime - b.lapTime;
        } else if (sortBy === 'lapNumber') {
          comparison = a.lapNumber - b.lapNumber;
        }
        return sortDirection === 'asc' ? comparison : -comparison;
      });
  }, [laps, internalSelectedLapIds, sortBy, sortDirection]);

  // Shared position tracking for track map
  const getCurrentPosition = useCallback(
    () => currentPosition,
    [currentPosition],
  );

  const updatePosition = useCallback((newPosition: number) => {
    setCurrentPosition(newPosition);
  }, []);

  // Data loading handler for sharing across all charts
  const handleLapCompleted = useCallback(
    (lapId: string, data: ProcessedLapData | null) => {
      if (data) {
        setLapDataMap(prev => {
          // Only create new Map if this lap wasn't already loaded
          if (prev.has(lapId)) {
            return prev; // No change needed
          }
          const newMap = new Map(prev);
          newMap.set(lapId, data);
          return newMap;
        });
      }
      // Update loading progress
      setLoadingProgress(prev => ({
        ...prev,
        loadedCount: prev.loadedCount + 1,
        currentlyLoading: prev.currentlyLoading.filter(id => id !== lapId),
        completedLaps: [...prev.completedLaps, lapId],
      }));
    },
    [],
  );

  // Handler for when lap loading starts
  const handleLapLoadingStart = useCallback((lapId: string) => {
    setLoadingProgress(prev => ({
      ...prev,
      currentlyLoading: [...prev.currentlyLoading, lapId],
    }));
  }, []);

  // Memoize loading state calculations to prevent infinite re-renders
  const loadingState = useMemo(() => {
    const allLapsLoaded = selectedLaps.every(lap => lapDataMap.has(lap.id));
    const loadedCount = selectedLaps.filter(lap =>
      lapDataMap.has(lap.id),
    ).length;
    return {
      allLapsLoaded,
      loadedCount,
      selectedLapsCount: selectedLaps.length,
      lapDataMapSize: lapDataMap.size,
    };
  }, [selectedLaps, lapDataMap]);

  // Check if all lap data is loaded and update progress
  useEffect(() => {
    setDataLoading(!loadingState.allLapsLoaded);

    // Update total count when selected laps change
    setLoadingProgress(prev => ({
      ...prev,
      totalCount: loadingState.selectedLapsCount,
      loadedCount: loadingState.loadedCount,
    }));
  }, [loadingState]);

  // Add null checks to prevent runtime errors - after all hooks are called
  if (!sessionData || !sessionData.car || !sessionData.track) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size='large' color={RacingTheme.colors.primary} />
        <Text style={styles.loadingText}>Loading session data...</Text>
      </View>
    );
  }

  // Handle lap selection
  const toggleLapSelection = (lapId: string) => {
    setInternalSelectedLapIds(prev => {
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
    setInternalSelectedLapIds(new Set(laps.map(lap => lap.id)));
  };

  const selectCleanLaps = () => {
    setInternalSelectedLapIds(
      new Set(laps.filter(lap => lap.clean).map(lap => lap.id)),
    );
  };

  const clearSelection = () => {
    setInternalSelectedLapIds(new Set());
  };

  // Chart management functions
  const addChart = () => {
    const newChartId = `chart-${charts.length + 1}`;
    const newChart: ChartConfig = {
      id: newChartId,
      selectedSeries: ['brake', 'throttle'], // Default series for new charts
      title: `Chart ${charts.length + 1}`,
    };
    setCharts(prev => [...prev, newChart]);
  };

  const removeChart = (chartId: string) => {
    if (charts.length > 1) {
      setCharts(prev => prev.filter(chart => chart.id !== chartId));
    }
  };

  const updateChartSeries = (chartId: string, newSeries: string[]) => {
    setCharts(prev =>
      prev.map(chart =>
        chart.id === chartId ? {...chart, selectedSeries: newSeries} : chart,
      ),
    );
  };

  // Shared control functions
  const togglePlayback = () => {
    setIsPlaying(prev => !prev);
  };

  const resetPlayback = () => {
    setIsPlaying(false);
  };

  const updatePlaybackSpeed = (speed: number) => {
    setPlaybackSpeed(speed);
  };

  const updateZoom = (zoom: number) => {
    setZoomLevel(zoom);
  };

  const toggleTrackMap = () => {
    setShowTrackMap(prev => !prev);
  };

  // Handle sort change
  const handleSortChange = (newSortBy: 'time' | 'lapNumber') => {
    if (sortBy === newSortBy) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(newSortBy);
      setSortDirection('asc');
    }
  };

  const formatLapTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = (seconds % 60).toFixed(3);
    return `${minutes}:${remainingSeconds.padStart(6, '0')}`;
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
        </View>
      </View>
    );
  }

  return (
    <View style={styles.mainContainer}>
      {/* Load telemetry data once for all charts */}
      {selectedLaps.map((lap, index) => {
        // Only load if not already loaded
        if (!lapDataMap.has(lap.id)) {
          return (
            <LapTelemetryLoader
              key={lap.id}
              lap={lap}
              onLapCompleted={handleLapCompleted}
              onLapLoadingStart={handleLapLoadingStart}
              lapIndex={index}
            />
          );
        }
        return null;
      })}

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={true}>
        <Animated.View style={[{opacity: fadeAnim}]}>
          <View style={styles.container}>
            {/* Back Button */}
            <View style={styles.backButtonContainer}>
              <RacingButton
                title='⬅ BACK TO SESSION ANALYSIS'
                onPress={onBack}
                style={styles.backButton}
              />
            </View>

            {/* Session Header (title hidden on web; shown in top header) */}
            <View style={styles.header}>
              {Platform.OS !== 'web' && (
                <Text style={styles.title}>MULTI-LAP COMPARISON</Text>
              )}
              <View style={styles.sessionInfo}>
                <Text style={styles.sessionName}>
                  {sessionData.car.name} • {sessionData.track.name}
                </Text>
                <Text style={styles.sessionDetails}>
                  {getSessionTypeName(sessionData.sessionType)} •{' '}
                  {new Date(sessionData.startTime).toLocaleDateString()}
                </Text>
              </View>
            </View>

            {/* Add Chart Button */}
            {selectedLaps.length > 0 && !dataLoading && (
              <View style={styles.addChartButtonContainer}>
                <TouchableOpacity
                  style={styles.addChartButton}
                  onPress={addChart}>
                  <Text style={styles.addChartButtonText}>+ ADD CHART</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Lap Selection Controls - 2x2 grid for vertical efficiency on mobile */}
            <View style={styles.selectionSection}>
              <Text style={[styles.sectionTitle, styles.selectionSectionTitle]}>
                LAP SELECTION
              </Text>
              <View style={styles.selectionControls}>
                <View style={styles.selectionRow}>
                  <RacingButton
                    title='SELECT ALL'
                    onPress={selectAllLaps}
                    style={[styles.selectionButton, styles.selectionGridCell]}
                  />
                  <RacingButton
                    title='CLEAN LAPS'
                    onPress={selectCleanLaps}
                    style={[styles.selectionButton, styles.selectionGridCell]}
                  />
                </View>
                <View style={styles.selectionRow}>
                  <RacingButton
                    title='CLEAR ALL'
                    onPress={clearSelection}
                    style={[styles.selectionButton, styles.selectionGridCell]}
                  />
                </View>
              </View>
              <Text style={styles.selectionInfo}>
                {selectedLaps.length} of {laps.length} laps selected for
                comparison
              </Text>
            </View>

            {/* Shared Controls - hidden on desktop when map is shown (all controls move next to map) */}
            {selectedLaps.length > 0 && (!isDesktop || !showTrackMap) && (
              <View style={styles.sharedControlsSection}>
                <Text style={styles.sectionTitle}>SHARED CONTROLS</Text>
                <View style={styles.sharedControls}>
                  {/* Row 1: Playback Controls */}
                  <View style={styles.controlsRow}>
                    <View style={styles.resetMapGroup}>
                      <TouchableOpacity
                        style={styles.controlButton}
                        onPress={resetPlayback}>
                        <Text style={styles.controlButtonText}>🔄 RESET</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.controlButton,
                          showTrackMap && styles.controlButtonActive,
                        ]}
                        onPress={toggleTrackMap}>
                        <Text style={styles.controlButtonText}>🗺️ MAP</Text>
                      </TouchableOpacity>
                    </View>

                    <View style={styles.playbackGroup}>
                      <TouchableOpacity
                        style={styles.controlButton}
                        onPress={() =>
                          updatePlaybackSpeed(
                            Math.max(-5.0, playbackSpeed - 0.5),
                          )
                        }>
                        <Text style={styles.controlButtonText}>⏪</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.controlButton}
                        onPress={() =>
                          updatePosition(Math.max(0, getCurrentPosition() - 50))
                        }>
                        <Text style={styles.controlButtonText}>⏮️</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.playButton,
                          isPlaying && styles.playButtonActive,
                        ]}
                        onPress={togglePlayback}>
                        <Text style={styles.playButtonText}>
                          {isPlaying ? '⏸️' : '▶️'}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.controlButton}
                        onPress={() =>
                          updatePosition(
                            Math.min(
                              (Array.from(lapDataMap.values())[0]
                                ?.totalPoints || 0) - 1,
                              getCurrentPosition() + 50,
                            ),
                          )
                        }>
                        <Text style={styles.controlButtonText}>⏭️</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.controlButton}
                        onPress={() =>
                          updatePlaybackSpeed(
                            Math.min(5.0, playbackSpeed + 0.5),
                          )
                        }>
                        <Text style={styles.controlButtonText}>⏩</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Row 2: Zoom Controls */}
                  <View style={[styles.controlsRow, styles.controlsRowLast]}>
                    <View style={styles.zoomGroup}>
                      <TouchableOpacity
                        style={styles.controlButton}
                        onPress={() => updateZoom(Math.max(1, zoomLevel - 1))}>
                        <Text style={styles.controlButtonText}>🔍-</Text>
                      </TouchableOpacity>
                      <Text style={styles.zoomText}>{zoomLevel}</Text>
                      <TouchableOpacity
                        style={styles.controlButton}
                        onPress={() => updateZoom(Math.min(5, zoomLevel + 1))}>
                        <Text style={styles.controlButtonText}>🔍+</Text>
                      </TouchableOpacity>
                    </View>

                    <View style={styles.statusGroup}>
                      <Text style={styles.statusText}>
                        Speed: {playbackSpeed.toFixed(1)}x
                      </Text>
                    </View>
                  </View>

                  {/* Row 3: Add Chart Button */}
                </View>
              </View>
            )}

            {/* Shared Track Map */}
            {showTrackMap &&
              selectedLaps.length > 0 &&
              !dataLoading &&
              (() => {
                // Get track map from the first available lap data
                const firstLapData = Array.from(lapDataMap.values())[0];
                const trackMap = firstLapData?.trackMap;
                const referenceLapData = Array.from(lapDataMap.values())[0]; // Use first lap as reference

                if (!trackMap) {
                  return null;
                }

                const mapBlock = (
                  <View style={styles.sharedTrackMapContainer}>
                    <View style={styles.sharedTrackMap}>
                      <Svg
                        width={250}
                        height={180}
                        style={styles.trackMapSvg}
                        viewBox='0 0 250 180'>
                        <Path
                          d={(() => {
                            if (!trackMap || trackMap.coordinates.length < 2) {
                              return '';
                            }

                            let pathData = '';
                            trackMap.coordinates.forEach((coord, index) => {
                              const x = coord.x * 230 + 10;
                              const y = coord.y * 160 + 10;

                              if (index === 0) {
                                pathData += `M ${x} ${y}`;
                              } else {
                                pathData += ` L ${x} ${y}`;
                              }
                            });

                            if (trackMap.coordinates.length > 2) {
                              const firstCoord = trackMap.coordinates[0];
                              const x = firstCoord.x * 230 + 10;
                              const y = firstCoord.y * 160 + 10;
                              pathData += ` L ${x} ${y}`;
                            }

                            return pathData;
                          })()}
                          stroke='#2196F3'
                          strokeWidth={3}
                          fill='none'
                          strokeLinecap='round'
                          strokeLinejoin='round'
                        />

                        {/* Current position indicator */}
                        {(() => {
                          if (
                            !trackMap ||
                            trackMap.coordinates.length === 0 ||
                            !referenceLapData
                          ) {
                            return null;
                          }

                          // Use the shared playback position
                          const currentIndex = Math.floor(getCurrentPosition());
                          const currentCoord =
                            trackMap.coordinates[
                              Math.min(
                                currentIndex,
                                trackMap.coordinates.length - 1,
                              )
                            ];

                          if (!currentCoord) {
                            return null;
                          }

                          const x = currentCoord.x * 230 + 10;
                          const y = currentCoord.y * 160 + 10;

                          return (
                            <Circle
                              cx={x}
                              cy={y}
                              r={5}
                              fill='#FF5722'
                              stroke='#FFFFFF'
                              strokeWidth={2}
                            />
                          );
                        })()}
                      </Svg>
                    </View>
                  </View>
                );

                if (isDesktop) {
                  return (
                    <View style={styles.mapAndPlaybackRow}>
                      {mapBlock}
                      <View style={styles.allControlsColumn}>
                        <Text style={styles.sectionTitle}>SHARED CONTROLS</Text>
                        <View style={styles.sharedControls}>
                          <View style={styles.controlsRow}>
                            <View style={styles.resetMapGroup}>
                              <TouchableOpacity
                                style={styles.controlButton}
                                onPress={resetPlayback}>
                                <Text style={styles.controlButtonText}>
                                  🔄 RESET
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[
                                  styles.controlButton,
                                  showTrackMap && styles.controlButtonActive,
                                ]}
                                onPress={toggleTrackMap}>
                                <Text style={styles.controlButtonText}>
                                  🗺️ MAP
                                </Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                          <View style={styles.controlsRow}>
                            <View style={styles.playbackGroup}>
                              <TouchableOpacity
                                style={styles.controlButton}
                                onPress={() =>
                                  updatePlaybackSpeed(
                                    Math.max(-5.0, playbackSpeed - 0.5),
                                  )
                                }>
                                <Text style={styles.controlButtonText}>⏪</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={styles.controlButton}
                                onPress={() =>
                                  updatePosition(
                                    Math.max(0, getCurrentPosition() - 50),
                                  )
                                }>
                                <Text style={styles.controlButtonText}>⏮️</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[
                                  styles.playButton,
                                  isPlaying && styles.playButtonActive,
                                ]}
                                onPress={togglePlayback}>
                                <Text style={styles.playButtonText}>
                                  {isPlaying ? '⏸️' : '▶️'}
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={styles.controlButton}
                                onPress={() =>
                                  updatePosition(
                                    Math.min(
                                      (Array.from(lapDataMap.values())[0]
                                        ?.totalPoints || 0) - 1,
                                      getCurrentPosition() + 50,
                                    ),
                                  )
                                }>
                                <Text style={styles.controlButtonText}>⏭️</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={styles.controlButton}
                                onPress={() =>
                                  updatePlaybackSpeed(
                                    Math.min(5.0, playbackSpeed + 0.5),
                                  )
                                }>
                                <Text style={styles.controlButtonText}>⏩</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                          <View
                            style={[
                              styles.controlsRow,
                              styles.controlsRowLast,
                            ]}>
                            <View style={styles.zoomGroup}>
                              <TouchableOpacity
                                style={styles.controlButton}
                                onPress={() =>
                                  updateZoom(Math.max(1, zoomLevel - 1))
                                }>
                                <Text style={styles.controlButtonText}>
                                  🔍-
                                </Text>
                              </TouchableOpacity>
                              <Text style={styles.zoomText}>{zoomLevel}</Text>
                              <TouchableOpacity
                                style={styles.controlButton}
                                onPress={() =>
                                  updateZoom(Math.min(5, zoomLevel + 1))
                                }>
                                <Text style={styles.controlButtonText}>
                                  🔍+
                                </Text>
                              </TouchableOpacity>
                            </View>
                            <View style={styles.statusGroup}>
                              <Text style={styles.statusText}>
                                Speed: {playbackSpeed.toFixed(1)}x
                              </Text>
                            </View>
                          </View>
                        </View>
                      </View>
                    </View>
                  );
                }

                return mapBlock;
              })()}

            {/* Charts */}
            {selectedLaps.length > 0 && !dataLoading && (
              <View style={styles.chartsSection}>
                {charts.map(chart => (
                  <View key={chart.id} style={styles.chartContainer}>
                    {charts.length > 1 && (
                      <View style={styles.chartHeader}>
                        <TouchableOpacity
                          style={styles.removeChartButton}
                          onPress={() => removeChart(chart.id)}>
                          <Text style={styles.removeChartButtonText}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                    <MultiLapTimeSeriesChart
                      laps={selectedLaps}
                      selectedSeries={chart.selectedSeries}
                      title={chart.title}
                      // Shared controls
                      externalIsPlaying={isPlaying}
                      externalPlaybackSpeed={playbackSpeed}
                      externalZoomLevel={zoomLevel}
                      externalShowTrackMap={false} // Hide individual track maps
                      onSeriesChange={newSeries =>
                        updateChartSeries(chart.id, newSeries)
                      }
                      // Pre-loaded data to avoid duplicate API calls
                      preloadedData={lapDataMap}
                      // Shared position tracking
                      externalCurrentPosition={currentPosition}
                      onPositionChange={setCurrentPosition}
                    />
                  </View>
                ))}
              </View>
            )}

            {/* Enhanced loading indicator for charts */}
            {selectedLaps.length > 0 && dataLoading && (
              <View style={styles.enhancedLoadingContainer}>
                <View style={styles.loadingCard}>
                  <Text style={styles.loadingTitle}>DOWNLOADING LAP DATA</Text>

                  {/* Progress Bar */}
                  <View style={styles.progressBarContainer}>
                    <View
                      style={[
                        styles.progressBar,
                        {
                          width: `${
                            (loadingProgress.loadedCount /
                              loadingProgress.totalCount) *
                            100
                          }%`,
                        },
                      ]}
                    />
                  </View>

                  <Text style={styles.progressText}>
                    {loadingProgress.loadedCount} of{' '}
                    {loadingProgress.totalCount} laps loaded
                  </Text>

                  {/* Currently Loading Laps */}
                  {loadingProgress.currentlyLoading.length > 0 && (
                    <View style={styles.currentlyLoadingSection}>
                      <Text style={styles.currentlyLoadingTitle}>
                        Currently downloading:
                      </Text>
                      {loadingProgress.currentlyLoading.map(lapId => {
                        const lap = selectedLaps.find(l => l.id === lapId);
                        return lap ? (
                          <View key={lapId} style={styles.loadingLapItem}>
                            <ActivityIndicator
                              size='small'
                              color={RacingTheme.colors.primary}
                            />
                            <Text style={styles.loadingLapText}>
                              Lap {lap.lapNumber}
                            </Text>
                          </View>
                        ) : null;
                      })}
                    </View>
                  )}

                  {/* Completed Laps */}
                  {loadingProgress.completedLaps.length > 0 && (
                    <View style={styles.completedSection}>
                      <Text style={styles.completedTitle}>
                        ✓ {loadingProgress.completedLaps.length} laps completed
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Shared Legend */}
            {selectedLaps.length > 0 && !dataLoading && (
              <View style={styles.sharedLegendSection}>
                <Text style={styles.legendTitle}>LEGEND</Text>

                {/* Series Legend */}
                <View style={styles.legendGroup}>
                  <Text style={styles.legendGroupTitle}>Data Series</Text>
                  <View style={styles.legendItems}>
                    {Object.entries(SERIES_BASE_COLORS).map(
                      ([seriesKey, color]) => {
                        const seriesLabels = {
                          brake: 'Brake',
                          throttle: 'Throttle',
                          rpm: 'RPM',
                          steeringWheelAngle: 'Steering',
                          speed: 'Speed',
                          gear: 'Gear',
                        };
                        return (
                          <View key={seriesKey} style={styles.legendItem}>
                            <View
                              style={[
                                styles.legendColorBox,
                                {backgroundColor: color},
                              ]}
                            />
                            <Text style={styles.legendText}>
                              {
                                seriesLabels[
                                  seriesKey as keyof typeof seriesLabels
                                ]
                              }
                            </Text>
                          </View>
                        );
                      },
                    )}
                  </View>
                </View>

                {/* Lap Legend */}
                {selectedLaps.length > 1 && (
                  <View style={styles.legendGroup}>
                    <Text style={styles.legendGroupTitle}>Laps</Text>
                    <View style={styles.legendItems}>
                      {selectedLaps.map((lap, index) => {
                        // Use the first series color (brake) to represent this lap's color scheme
                        const lapColor =
                          LAP_COLOR_SCHEMES[index]?.brake ||
                          SERIES_BASE_COLORS.brake;
                        return (
                          <View key={lap.id} style={styles.legendItem}>
                            <View
                              style={[
                                styles.legendColorBox,
                                {backgroundColor: lapColor},
                              ]}
                            />
                            <Text style={styles.legendText}>
                              Lap {lap.lapNumber} {index === 0 && '(Reference)'}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                )}
              </View>
            )}

            {/* Lap List */}
            <View style={styles.lapListSection}>
              <Text style={styles.sectionTitle}>
                LAP LIST ({laps.length} LAPS)
              </Text>

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
                      {sortBy === 'time' &&
                        (sortDirection === 'asc' ? '↑' : '↓')}
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

              {/* Lap Table */}
              <RacingCard style={styles.tableCard}>
                <View style={styles.tableHeader}>
                  <Text style={styles.headerCell}>SELECT</Text>
                  <TouchableOpacity
                    style={styles.headerCellTouchable}
                    onPress={() => handleSortChange('lapNumber')}>
                    <Text
                      style={[
                        styles.headerCell,
                        sortBy === 'lapNumber' && styles.headerCellActive,
                      ]}>
                      LAP#{' '}
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
                      TIME{' '}
                      {sortBy === 'time' &&
                        (sortDirection === 'asc' ? '↑' : '↓')}
                    </Text>
                  </TouchableOpacity>
                  <Text style={styles.headerCell}>STATUS</Text>
                </View>

                <RacingDivider />

                {laps
                  .sort((a, b) => {
                    let comparison = 0;
                    if (sortBy === 'time') {
                      comparison = a.lapTime - b.lapTime;
                    } else if (sortBy === 'lapNumber') {
                      comparison = a.lapNumber - b.lapNumber;
                    }
                    return sortDirection === 'asc' ? comparison : -comparison;
                  })
                  .map((lap, index) => {
                    const isSelected = internalSelectedLapIds.has(lap.id);
                    return (
                      <View key={lap.id}>
                        <View
                          style={[
                            styles.tableRow,
                            isSelected && styles.tableRowSelected,
                          ]}>
                          <TouchableOpacity
                            style={styles.cell}
                            onPress={() => toggleLapSelection(lap.id)}
                            activeOpacity={0.7}>
                            <Text
                              style={[
                                styles.cell,
                                isSelected && styles.cellSelected,
                              ]}>
                              {isSelected ? '✓' : '○'}
                            </Text>
                          </TouchableOpacity>
                          <Text
                            style={[
                              styles.cell,
                              isSelected && styles.cellSelected,
                            ]}>
                            {lap.lapNumber}
                          </Text>
                          <Text
                            style={[
                              styles.cell,
                              isSelected && styles.cellSelected,
                            ]}>
                            {formatLapTime(lap.lapTime)}
                          </Text>
                          <View style={styles.cell}>
                            {lap.clean ? (
                              <Text
                                style={[styles.statusBadge, styles.cleanBadge]}>
                                ✓ CLEAN
                              </Text>
                            ) : (
                              <Text
                                style={[
                                  styles.statusBadge,
                                  styles.uncleanBadge,
                                ]}>
                                ⚠ OFF-TRACK
                              </Text>
                            )}
                          </View>
                        </View>
                        {index < laps.length - 1 && <RacingDivider />}
                      </View>
                    );
                  })}
              </RacingCard>
            </View>

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
  backButtonContainer: {
    marginBottom: RacingTheme.spacing.lg,
  },
  backButton: {
    alignSelf: 'flex-start',
  },
  header: {
    marginBottom: RacingTheme.spacing.lg,
  },
  title: {
    fontSize: RacingTheme.typography.h2,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.primary,
    letterSpacing: 2,
    marginBottom: RacingTheme.spacing.sm,
  },
  sessionInfo: {
    backgroundColor: RacingTheme.colors.surface,
    padding: RacingTheme.spacing.md,
    borderRadius: RacingTheme.borderRadius.md,
    borderWidth: 1,
    borderColor: RacingTheme.colors.surfaceElevated,
  },
  sessionName: {
    fontSize: RacingTheme.typography.h4,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.primary,
    marginBottom: RacingTheme.spacing.xs,
  },
  sessionDetails: {
    fontSize: RacingTheme.typography.body,
    color: RacingTheme.colors.textSecondary,
  },
  sectionTitle: {
    fontSize: RacingTheme.typography.h4,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.text,
    marginBottom: RacingTheme.spacing.md,
    letterSpacing: 1,
  },
  seriesSection: {
    marginBottom: RacingTheme.spacing.lg,
  },
  seriesButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: RacingTheme.spacing.sm,
  },
  seriesButton: {
    backgroundColor: RacingTheme.colors.surface,
    paddingHorizontal: RacingTheme.spacing.md,
    paddingVertical: RacingTheme.spacing.sm,
    borderRadius: RacingTheme.borderRadius.sm,
    borderWidth: 1,
    borderColor: RacingTheme.colors.surfaceElevated,
  },
  seriesButtonActive: {
    backgroundColor: RacingTheme.colors.primary,
    borderColor: RacingTheme.colors.primary,
  },
  seriesButtonText: {
    fontSize: RacingTheme.typography.caption,
    fontWeight: RacingTheme.typography.medium as any,
    color: RacingTheme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  seriesButtonTextActive: {
    color: RacingTheme.colors.surface,
    fontWeight: RacingTheme.typography.bold as any,
  },
  selectionSection: {
    marginBottom: RacingTheme.spacing.lg,
  },
  selectionSectionTitle: {
    marginBottom: RacingTheme.spacing.sm,
  },
  selectionControls: {
    flexDirection: 'column',
    gap: RacingTheme.spacing.xs,
    marginBottom: RacingTheme.spacing.md,
  },
  selectionRow: {
    flexDirection: 'row',
    gap: RacingTheme.spacing.sm,
  },
  selectionButton: {
    flex: 1,
    minWidth: 0,
    paddingVertical: RacingTheme.spacing.xs,
  },
  selectionGridCell: {
    flex: 1,
    minWidth: 0,
  },
  selectionInfo: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.textSecondary,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  sharedControlsSection: {
    marginBottom: RacingTheme.spacing.sm,
  },
  sharedControls: {
    backgroundColor: RacingTheme.colors.surface,
    borderRadius: RacingTheme.borderRadius.md,
    paddingVertical: RacingTheme.spacing.sm,
    paddingHorizontal: RacingTheme.spacing.md,
    borderWidth: 1,
    borderColor: RacingTheme.colors.surfaceElevated,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginBottom: RacingTheme.spacing.xs,
    flexWrap: 'wrap',
    gap: RacingTheme.spacing.sm,
  },
  controlsRowLast: {
    marginBottom: 0,
  },
  resetMapGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: RacingTheme.spacing.sm,
  },
  playbackGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  controlButton: {
    backgroundColor: RacingTheme.colors.surfaceElevated,
    paddingHorizontal: RacingTheme.spacing.md,
    paddingVertical: RacingTheme.spacing.sm,
    borderRadius: RacingTheme.borderRadius.sm,
    borderWidth: 1,
    borderColor: RacingTheme.colors.surfaceElevated,
  },
  controlButtonActive: {
    backgroundColor: RacingTheme.colors.primary,
    borderColor: RacingTheme.colors.primary,
  },
  controlButtonText: {
    fontSize: RacingTheme.typography.caption,
    fontWeight: RacingTheme.typography.medium as any,
    color: RacingTheme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  playButton: {
    backgroundColor: RacingTheme.colors.success,
    paddingHorizontal: RacingTheme.spacing.lg,
    paddingVertical: RacingTheme.spacing.sm,
    borderRadius: RacingTheme.borderRadius.sm,
    borderWidth: 1,
    borderColor: RacingTheme.colors.success,
  },
  playButtonActive: {
    backgroundColor: RacingTheme.colors.error,
    borderColor: RacingTheme.colors.error,
  },
  playButtonText: {
    fontSize: RacingTheme.typography.body,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.surface,
  },
  zoomGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  zoomText: {
    fontSize: RacingTheme.typography.caption,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.primary,
    marginHorizontal: RacingTheme.spacing.sm,
    minWidth: 20,
    textAlign: 'center',
  },
  mapAndPlaybackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: RacingTheme.spacing.lg,
    marginBottom: RacingTheme.spacing.sm,
    flexWrap: 'wrap',
  },
  playbackControlsColumn: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: RacingTheme.spacing.sm,
  },
  allControlsColumn: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'center',
    minWidth: 280,
  },
  sharedTrackMapContainer: {
    alignItems: 'center',
    marginBottom: RacingTheme.spacing.sm,
  },
  sharedTrackMap: {
    backgroundColor: RacingTheme.colors.surface,
    borderRadius: RacingTheme.borderRadius.md,
    padding: RacingTheme.spacing.md,
    borderWidth: 1,
    borderColor: RacingTheme.colors.surfaceElevated,
  },
  trackMapSvg: {
    width: 250,
    height: 180,
  },
  statusGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusText: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.text,
    fontStyle: 'italic',
  },
  addChartButtonContainer: {
    alignItems: 'center',
    marginBottom: RacingTheme.spacing.md,
  },
  addChartButton: {
    backgroundColor: RacingTheme.colors.secondary,
    paddingHorizontal: RacingTheme.spacing.xl,
    paddingVertical: RacingTheme.spacing.md,
    borderRadius: RacingTheme.borderRadius.md,
    borderWidth: 1,
    borderColor: RacingTheme.colors.secondary,
    minWidth: 150,
    alignItems: 'center',
  },
  addChartButtonText: {
    fontSize: RacingTheme.typography.body,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.surface,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  chartsSection: {
    marginBottom: RacingTheme.spacing.sm,
  },
  chartContainer: {
    marginBottom: RacingTheme.spacing.sm,
  },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginBottom: RacingTheme.spacing.sm,
    paddingHorizontal: RacingTheme.spacing.sm,
  },
  removeChartButton: {
    backgroundColor: RacingTheme.colors.error,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeChartButtonText: {
    fontSize: RacingTheme.typography.caption,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.surface,
  },
  lapListSection: {
    marginBottom: RacingTheme.spacing.lg,
  },
  sortControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: RacingTheme.spacing.md,
    paddingHorizontal: RacingTheme.spacing.sm,
  },
  sortLabel: {
    fontSize: RacingTheme.typography.small,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sortButtons: {
    flexDirection: 'row',
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
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sortButtonTextActive: {
    color: RacingTheme.colors.surface,
    fontWeight: RacingTheme.typography.bold as any,
  },
  tableCard: {
    padding: RacingTheme.spacing.md,
  },
  tableHeader: {
    flexDirection: 'row',
    paddingVertical: RacingTheme.spacing.sm,
  },
  headerCell: {
    flex: 1,
    fontSize: RacingTheme.typography.small,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  headerCellTouchable: {
    flex: 1,
  },
  headerCellActive: {
    color: RacingTheme.colors.primary,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: RacingTheme.spacing.sm,
  },
  tableRowSelected: {
    backgroundColor: RacingTheme.colors.surfaceElevated,
  },
  cell: {
    flex: 1,
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.textSecondary,
    textAlign: 'center',
  },
  cellSelected: {
    color: RacingTheme.colors.secondary,
    fontWeight: RacingTheme.typography.bold as any,
  },
  statusBadge: {
    fontSize: RacingTheme.typography.caption,
    fontWeight: RacingTheme.typography.medium as any,
    textAlign: 'center',
    paddingHorizontal: RacingTheme.spacing.xs,
    paddingVertical: RacingTheme.spacing.xs,
    borderRadius: RacingTheme.borderRadius.sm,
  },
  cleanBadge: {
    backgroundColor: RacingTheme.colors.success,
    color: RacingTheme.colors.surface,
  },
  uncleanBadge: {
    backgroundColor: RacingTheme.colors.warning,
    color: RacingTheme.colors.surface,
  },
  loadingText: {
    marginTop: RacingTheme.spacing.md,
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.primary,
    letterSpacing: 1,
  },
  enhancedLoadingContainer: {
    alignItems: 'center',
    marginBottom: RacingTheme.spacing.lg,
  },
  loadingCard: {
    backgroundColor: RacingTheme.colors.surface,
    borderRadius: RacingTheme.borderRadius.md,
    padding: RacingTheme.spacing.lg,
    borderWidth: 1,
    borderColor: RacingTheme.colors.surfaceElevated,
    minWidth: 300,
    alignItems: 'center',
  },
  loadingTitle: {
    fontSize: RacingTheme.typography.h4,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.primary,
    marginBottom: RacingTheme.spacing.md,
    letterSpacing: 1,
  },
  progressBarContainer: {
    width: '100%',
    height: 8,
    backgroundColor: RacingTheme.colors.surfaceElevated,
    borderRadius: 4,
    marginBottom: RacingTheme.spacing.md,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: RacingTheme.colors.primary,
    borderRadius: 4,
  },
  progressText: {
    fontSize: RacingTheme.typography.body,
    color: RacingTheme.colors.text,
    fontWeight: RacingTheme.typography.medium as any,
    marginBottom: RacingTheme.spacing.md,
  },
  currentlyLoadingSection: {
    width: '100%',
    marginBottom: RacingTheme.spacing.md,
  },
  currentlyLoadingTitle: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.textSecondary,
    fontWeight: RacingTheme.typography.bold as any,
    marginBottom: RacingTheme.spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  loadingLapItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: RacingTheme.spacing.xs,
  },
  loadingLapText: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.text,
    marginLeft: RacingTheme.spacing.sm,
  },
  completedSection: {
    width: '100%',
  },
  completedTitle: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.success,
    fontWeight: RacingTheme.typography.medium as any,
    textAlign: 'center',
  },
  sharedLegendSection: {
    marginTop: RacingTheme.spacing.lg,
    marginBottom: RacingTheme.spacing.lg,
    backgroundColor: RacingTheme.colors.surface,
    borderRadius: RacingTheme.borderRadius.md,
    padding: RacingTheme.spacing.lg,
    borderWidth: 1,
    borderColor: RacingTheme.colors.surfaceElevated,
  },
  legendTitle: {
    fontSize: RacingTheme.typography.h4,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.primary,
    marginBottom: RacingTheme.spacing.md,
    textAlign: 'center',
    letterSpacing: 1,
  },
  legendGroup: {
    marginBottom: RacingTheme.spacing.lg,
  },
  legendGroupTitle: {
    fontSize: RacingTheme.typography.body,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.text,
    marginBottom: RacingTheme.spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  legendItems: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: RacingTheme.spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 120,
  },
  legendColorBox: {
    width: 16,
    height: 16,
    borderRadius: 3,
    marginRight: RacingTheme.spacing.sm,
    borderWidth: 1,
    borderColor: RacingTheme.colors.surfaceElevated,
  },
  legendText: {
    color: RacingTheme.colors.text,
    fontSize: RacingTheme.typography.caption,
  },
  errorText: {
    fontSize: RacingTheme.typography.h2,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.error,
    textAlign: 'center',
    marginBottom: RacingTheme.spacing.lg,
    letterSpacing: 1,
  },
  bottomSpacing: {
    height: RacingTheme.spacing.xxxl,
  },
});

export default MultiLapComparison;
