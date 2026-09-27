import {useLaps, useTracks} from '@src/hooks/useApiQueries';
import {RacingTheme} from '@src/theme';
import {ApiError, Lap} from '@src/types';
import {trackMatchesSearch} from '@src/utils/trackNicknames';
import {useRouter} from 'expo-router';
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  LapTime,
  RacingButton,
  RacingCard,
  RacingDivider,
  StatusBadge,
  TimeRangeSelector,
} from './RacingUI';

interface EventGroup {
  eventId: string;
  eventName?: string;
  primaryCar: string;
  primaryTrack: string;
  laps: Lap[];
  bestLapTime: number;
  totalLaps: number;
  startTime: string;
  expanded: boolean;
  averageLapTime: number;
  sessionTypes: string[];
}

interface LapListProps {
  onSessionAnalysis?: (sessionData: import('@/types').SessionData) => void;
}

// Helper function for session type names
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

const LapList: React.FC<LapListProps> = ({onSessionAnalysis}) => {
  const [loading, setLoading] = useState(true);
  const [queryEnabled, setQueryEnabled] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const router = useRouter();
  const [eventGroups, setEventGroups] = useState<EventGroup[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTimeRange, setSelectedTimeRange] = useState<number>(1); // Default to 1 day (24h)
  const [source, setSource] = useState<'garage61' | 'lmu'>('garage61');
  const [selectedTrackIds, setSelectedTrackIds] = useState<number[]>([]);
  const [trackSearch, setTrackSearch] = useState('');
  const [fadeAnim] = useState(new Animated.Value(1));
  const [dimensions, setDimensions] = useState(Dimensions.get('window'));

  const {data: tracksResponse, isLoading: tracksLoading} = useTracks({
    enabled: queryEnabled,
    source,
  });
  const tracks = tracksResponse?.items ?? [];

  useEffect(() => {
    if (source !== 'lmu' || tracks.length === 0) return;
    setSelectedTrackIds(tracks.map(track => track.id));
  }, [source, tracks]);

  // Group tracks by name (same venue, multiple variants)
  const tracksByName = useMemo(() => {
    const map = new Map<string, Lap['track'][]>();
    tracks.forEach(t => {
      const list = map.get(t.name) ?? [];
      list.push(t);
      map.set(t.name, list);
    });
    return Array.from(map.entries())
      .map(([name, items]) => ({name, tracks: items}))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [tracks]);

  // Filter groups by search (nickname-aware)
  const filteredGroups = useMemo(() => {
    if (!trackSearch.trim()) return tracksByName;
    return tracksByName.filter(group =>
      group.tracks.some(t => trackMatchesSearch(t, trackSearch)),
    );
  }, [tracksByName, trackSearch]);

  const toggleTrackGroup = useCallback((trackIds: number[]) => {
    setSelectedTrackIds(prev => {
      const current = new Set(prev);
      const allSelected = trackIds.every(id => current.has(id));
      if (allSelected) {
        trackIds.forEach(id => current.delete(id));
      } else {
        trackIds.forEach(id => current.add(id));
      }
      return Array.from(current);
    });
  }, []);

  const selectAllFilteredTracks = useCallback(() => {
    if (filteredGroups.length === 0) return;
    setSelectedTrackIds(prev => {
      const next = new Set(prev);
      filteredGroups.forEach(g => g.tracks.forEach(t => next.add(t.id)));
      return Array.from(next);
    });
  }, [filteredGroups]);

  const clearTracks = useCallback(() => {
    setSelectedTrackIds([]);
  }, []);

  // Group laps by event ID with racing metrics
  const groupLapsByEvent = useCallback((lapData: Lap[]): EventGroup[] => {
    const groups: {[key: string]: EventGroup} = {};

    lapData.forEach(lap => {
      const eventId = lap.event || 'No Event';
      const eventName = lap.event || 'Unknown Event';

      if (!groups[eventId]) {
        groups[eventId] = {
          eventId,
          eventName,
          primaryCar: lap.car.name,
          primaryTrack: lap.track.name,
          laps: [],
          bestLapTime: Infinity,
          totalLaps: 0,
          startTime: lap.startTime,
          expanded: false,
          averageLapTime: 0,
          sessionTypes: [],
        };
      }

      groups[eventId].laps.push(lap);
      // Partial and untimed laps carry a duration, not a lap time.
      if (lap.lapTime > 0 && !lap.incomplete) {
        groups[eventId].bestLapTime = Math.min(
          groups[eventId].bestLapTime,
          lap.lapTime,
        );
      }
      groups[eventId].totalLaps++;

      // Track session types
      const sessionType = getSessionTypeName(lap.sessionType);
      if (!groups[eventId].sessionTypes.includes(sessionType)) {
        groups[eventId].sessionTypes.push(sessionType);
      }
    });

    // Calculate additional metrics and sort
    Object.values(groups).forEach(group => {
      // Sort laps by lap time (best first)
      // Timed laps first, fastest first. Partial and untimed laps after.
      const timed = (lap: Lap) => lap.lapTime > 0 && !lap.incomplete;
      group.laps.sort((a, b) =>
        timed(a) === timed(b)
          ? a.lapTime - b.lapTime
          : timed(a)
            ? -1
            : 1,
      );

      // Update primary car/track to match the best lap
      if (group.laps.length > 0) {
        const bestLap = group.laps[0];
        group.primaryCar = bestLap.car.name;
        group.primaryTrack = bestLap.track.name;
      }

      // Calculate average lap time (excluding outliers)
      if (group.bestLapTime === Infinity) group.bestLapTime = NaN;
      const validLaps = group.laps.filter(
        lap => lap.lapTime > 0 && !lap.incomplete,
      );
      if (validLaps.length > 0) {
        const totalTime = validLaps.reduce((sum, lap) => sum + lap.lapTime, 0);
        group.averageLapTime = totalTime / validLaps.length;
      }
    });

    // Sort events by most recent first
    return Object.values(groups).sort(
      (a, b) =>
        new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
    );
  }, []);

  // Memoize query parameters to ensure stable reference for React Query deduplication
  // Laps API requires tracks to be specified
  const lapsQueryParams = useMemo(
    () => ({
      limit: 200,
      age: selectedTimeRange,
      drivers: 'me',
      group: 'none',
      tracks: selectedTrackIds.length > 0 ? selectedTrackIds : undefined,
      source,
    }),
    [selectedTimeRange, selectedTrackIds, source],
  );

  const lapsQueryEnabled = queryEnabled && selectedTrackIds.length > 0;

  // Use cached laps query - only enable after component mounts and at least one track selected
  const {
    data: lapsResponse,
    isLoading: queryLoading,
    error: queryError,
    refetch,
  } = useLaps(lapsQueryParams, {enabled: lapsQueryEnabled});

  // Enable query after component mounts
  React.useEffect(() => {
    setQueryEnabled(true);
  }, []);

  // Group laps by event when data changes
  const groupedEvents = useMemo(() => {
    if (!lapsResponse?.items) {
      return [];
    }

    const grouped = groupLapsByEvent(lapsResponse.items);
    return grouped;
  }, [lapsResponse, groupLapsByEvent]);

  // Update event groups when grouped data changes
  useEffect(() => {
    setEventGroups(groupedEvents);
  }, [groupedEvents]);

  // Update loading state based on query loading
  useEffect(() => {
    setLoading(queryLoading && !lapsResponse);
  }, [queryLoading, lapsResponse]);

  // Handle errors from the query
  useEffect(() => {
    if (queryError) {
      setError({
        message: queryError.message || 'Failed to load lap data',
        code: queryError.code,
        details: queryError.details,
        status: queryError.status,
      });
    } else {
      setError(null);
    }
  }, [queryError]);

  const handleRefresh = () => {
    setRefreshing(true);
    refetch().finally(() => setRefreshing(false));
  };

  useEffect(() => {
    // Fade in animation - disabled useNativeDriver for web compatibility
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: RacingTheme.animations.normal,
      useNativeDriver: false, // Changed to false to prevent warnings
    }).start();
  }, [fadeAnim]);

  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({window}) => {
      setDimensions(window);
    });
    return () => subscription?.remove();
  }, []);

  // Determine if we should use mobile layout (screen width < 768px)
  const isMobile = dimensions.width < 768;

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString();
  };

  const formatTimeRange = (days: number): string => {
    if (days === 1) {
      return 'Last 24 Hours';
    }
    if (days === 3) {
      return 'Last 3 Days';
    }
    if (days === 7) {
      return 'Last 7 Days';
    }
    return `Last ${days} Days`;
  };

  const showLapsLoading =
    loading && selectedTrackIds.length > 0 && !lapsResponse;

  if (showLapsLoading) {
    return (
      <View style={styles.mainContainer}>
        <View style={styles.fullHeightContainer}>
          <View style={styles.centerContainer}>
            <ActivityIndicator
              size='large'
              color={RacingTheme.colors.primary}
            />
            <Text style={styles.loadingText}>LOADING TELEMETRY DATA...</Text>
          </View>
        </View>
      </View>
    );
  }

  const sourceSwitch = (
    <View style={styles.trackSelectorActions}>
      {(
        [
          ['garage61', 'iRacing'],
          ['lmu', 'LMU'],
        ] as const
      ).map(([id, label]) => (
        <TouchableOpacity
          key={id}
          onPress={() => {
            setSource(id);
            setSelectedTrackIds([]);
            setError(null);
          }}
          style={styles.trackSelectorActionBtn}>
          <Text
            style={[
              styles.trackSelectorActionText,
              source === id && {color: RacingTheme.colors.primary},
            ]}>
            {label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  if (error) {
    const garageSignIn = source !== 'lmu' && error.status === 401;
    return (
      <View style={styles.mainContainer}>
        <View style={styles.fullHeightContainer}>
          {sourceSwitch}
          <View style={styles.centerContainer}>
            <Text style={styles.errorText}>
              {garageSignIn
                ? 'SIGN IN REQUIRED'
                : source === 'lmu'
                  ? 'LMU LAPS UNAVAILABLE'
                  : 'TELEMETRY ERROR'}
            </Text>
            <Text style={styles.errorSubtext}>
              {garageSignIn
                ? 'Garage 61 needs a sign-in. LMU laps are on the switch above.'
                : error.message}
            </Text>
            <RacingButton
              title={garageSignIn ? 'SIGN IN WITH GARAGE 61' : 'RETRY CONNECTION'}
              onPress={() => {
                if (garageSignIn) {
                  router.replace('/driver-profile');
                } else {
                  refetch();
                }
              }}
              style={styles.refreshButton}
            />
          </View>
        </View>
      </View>
    );
  }

  const toggleEvent = (eventId: string) => {
    // Add haptic feedback and smooth animation
    setEventGroups(groups =>
      groups.map(group =>
        group.eventId === eventId
          ? {...group, expanded: !group.expanded}
          : group,
      ),
    );
  };

  const handleSessionAnalysis = (eventGroup: EventGroup) => {
    if (!onSessionAnalysis) {
      return;
    }

    // Get the primary session info from the best lap
    const bestLap = [...eventGroup.laps].sort(
      (a, b) => a.lapTime - b.lapTime,
    )[0];

    const sessionData = {
      eventId: eventGroup.eventId,
      eventName: eventGroup.eventName,
      session: bestLap.session,
      sessionType: bestLap.sessionType,
      laps: [],
      track: bestLap.track,
      car: bestLap.car,
      startTime: eventGroup.startTime,
    };

    onSessionAnalysis(sessionData);
  };

  return (
    <View style={styles.mainContainer}>
      <Animated.View style={[styles.fadeContainer, {opacity: fadeAnim}]}>
        <ScrollView
          key={`laplist-${eventGroups.length}-${
            eventGroups.filter(g => g.expanded).length
          }`}
          style={styles.scrollView}
          contentContainerStyle={styles.contentContainer}
          showsVerticalScrollIndicator={true}
          keyboardShouldPersistTaps='handled'>
          <View style={styles.container}>
            {/* Racing Dashboard Header (hidden on web; title is in top header) */}
            {Platform.OS !== 'web' && (
              <View style={styles.dashboardHeader}>
                <Text style={styles.dashboardTitle}>RACING ANALYTICS</Text>
                <Text style={styles.dashboardSubtitle}>
                  {formatTimeRange(selectedTimeRange)} Performance
                </Text>
              </View>
            )}

            {sourceSwitch}

            {/* Searchable track selector - laps API requires track filter */}
            <View style={styles.trackSelectorSection}>
              <Text style={styles.sectionTitle}>TRACKS</Text>
              <Text style={styles.trackSelectorHint}>
                Select at least one track to load sessions
              </Text>
              <TextInput
                style={styles.trackSearchInput}
                placeholder='Search tracks...'
                placeholderTextColor={RacingTheme.colors.textTertiary}
                value={trackSearch}
                onChangeText={setTrackSearch}
              />
              {tracksLoading ? (
                <View style={styles.trackListLoading}>
                  <ActivityIndicator
                    size='small'
                    color={RacingTheme.colors.primary}
                  />
                  <Text style={styles.trackListLoadingText}>
                    Loading tracks...
                  </Text>
                </View>
              ) : (
                <>
                  <View style={styles.trackSelectorActions}>
                    <TouchableOpacity
                      onPress={selectAllFilteredTracks}
                      style={styles.trackSelectorActionBtn}>
                      <Text style={styles.trackSelectorActionText}>
                        Select all ({filteredGroups.length} venues)
                      </Text>
                    </TouchableOpacity>
                    {selectedTrackIds.length > 0 && (
                      <TouchableOpacity
                        onPress={clearTracks}
                        style={styles.trackSelectorActionBtn}>
                        <Text style={styles.trackSelectorActionText}>
                          Clear
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <ScrollView
                    style={styles.trackListScroll}
                    nestedScrollEnabled
                    keyboardShouldPersistTaps='handled'>
                    {filteredGroups.map(group => {
                      const ids = group.tracks.map(t => t.id);
                      const allSelected = ids.every(id =>
                        selectedTrackIds.includes(id),
                      );
                      const someSelected = ids.some(id =>
                        selectedTrackIds.includes(id),
                      );
                      const variantLabel =
                        group.tracks.length > 1
                          ? ` (${group.tracks.length} variants)`
                          : '';
                      return (
                        <TouchableOpacity
                          key={group.name}
                          style={[
                            styles.trackRow,
                            (allSelected || someSelected) &&
                              styles.trackRowSelected,
                          ]}
                          onPress={() => toggleTrackGroup(ids)}
                          activeOpacity={0.7}>
                          <Text style={styles.trackRowCheck}>
                            {allSelected ? '✓' : someSelected ? '◐' : '○'}
                          </Text>
                          <Text
                            style={[
                              styles.trackRowName,
                              (allSelected || someSelected) &&
                                styles.trackRowNameSelected,
                            ]}
                            numberOfLines={2}>
                            {group.name}
                            {variantLabel}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                  {selectedTrackIds.length > 0 && (
                    <Text style={styles.trackSelectedCount}>
                      {selectedTrackIds.length} track variant
                      {selectedTrackIds.length !== 1 ? 's' : ''} selected
                    </Text>
                  )}
                </>
              )}
            </View>

            {/* Time Range Selector + Refresh (same row on web) */}
            {Platform.OS === 'web' ? (
              <View style={styles.topControlsRow}>
                <TimeRangeSelector
                  selectedRange={selectedTimeRange}
                  onRangeChange={setSelectedTimeRange}
                  style={styles.timeRangeSelectorWeb}
                />
                <RacingButton
                  title='🔄 REFRESH TELEMETRY'
                  onPress={handleRefresh}
                  style={styles.refreshButtonWeb}
                  disabled={refreshing}
                />
              </View>
            ) : (
              <>
                <TimeRangeSelector
                  selectedRange={selectedTimeRange}
                  onRangeChange={setSelectedTimeRange}
                  style={styles.timeRangeSelector}
                />
                <RacingButton
                  title='🔄 REFRESH TELEMETRY'
                  onPress={handleRefresh}
                  style={styles.refreshButton}
                  disabled={refreshing}
                />
              </>
            )}

            {/* Event Sessions List */}
            <View style={styles.eventsSection}>
              <Text style={styles.sectionTitle}>SESSION ANALYSIS</Text>

              {selectedTrackIds.length === 0 ? (
                <RacingCard style={styles.trackPromptCard}>
                  <Text style={styles.trackPromptText}>
                    Select at least one track above to load sessions.
                  </Text>
                </RacingCard>
              ) : Platform.OS === 'web' ? (
                // Web: Use View with map() for consistent behavior
                <View style={styles.eventsList}>
                  {eventGroups.map(event => (
                    <RacingCard key={event.eventId} style={styles.eventCard}>
                      {/* Event Header */}
                      <TouchableOpacity
                        style={[
                          isMobile
                            ? styles.mobileEventHeader
                            : styles.eventHeader,
                          Platform.OS === 'web' &&
                            !isMobile &&
                            styles.eventHeaderWeb,
                        ]}
                        onPress={() => toggleEvent(event.eventId)}>
                        {isMobile ? (
                          /* Mobile Layout */
                          <View style={styles.mobileEventContent}>
                            <View style={styles.mobileEventTopRow}>
                              <View style={styles.mobileEventMainInfo}>
                                <Text style={styles.mobileEventTitle}>
                                  {event.primaryCar}
                                </Text>
                                <Text style={styles.mobileEventTrack}>
                                  {event.primaryTrack}
                                </Text>
                              </View>
                              <View style={styles.mobileEventActions}>
                                {onSessionAnalysis && (
                                  <TouchableOpacity
                                    style={styles.mobileAnalyzeButton}
                                    onPress={() =>
                                      handleSessionAnalysis(event)
                                    }>
                                    <Text style={styles.analyzeIcon}>📊</Text>
                                  </TouchableOpacity>
                                )}
                                <Text style={styles.mobileExpandIcon}>
                                  {event.expanded ? '▼' : '▶'}
                                </Text>
                              </View>
                            </View>

                            <View style={styles.mobileEventStats}>
                              <View style={styles.mobileStatItem}>
                                <Text style={styles.mobileStatNumber}>
                                  {event.totalLaps}
                                </Text>
                                <Text style={styles.mobileStatLabel}>LAPS</Text>
                              </View>
                              <View style={styles.mobileStatItem}>
                                <Text style={styles.mobileStatNumber}>
                                  <LapTime time={event.bestLapTime} isBest />
                                </Text>
                                <Text style={styles.mobileStatLabel}>BEST</Text>
                              </View>
                            </View>

                            <View style={styles.mobileEventMeta}>
                              <Text style={styles.mobileEventDate}>
                                {formatDate(event.startTime)}
                              </Text>
                              <Text style={styles.mobileEventSessions}>
                                {event.sessionTypes.join(' • ')}
                              </Text>
                            </View>
                          </View>
                        ) : (
                          /* Desktop Layout */
                          <>
                            <View style={styles.eventMainInfo}>
                              <View style={styles.eventTitleRow}>
                                <Text style={styles.eventTitle}>
                                  {event.primaryCar}
                                </Text>
                                <Text style={styles.eventTrack}>
                                  {event.primaryTrack}
                                </Text>
                              </View>
                              <View style={styles.eventMetaRow}>
                                <Text style={styles.eventDate}>
                                  {formatDate(event.startTime)}
                                </Text>
                                <Text style={styles.eventSessions}>
                                  {event.sessionTypes.join(' • ')}
                                </Text>
                              </View>
                            </View>

                            <View
                              style={[
                                styles.eventStats,
                                Platform.OS === 'web' && styles.eventStatsWeb,
                              ]}>
                              <View
                                style={[
                                  styles.statItem,
                                  Platform.OS === 'web' && styles.statItemWeb,
                                ]}>
                                <Text style={styles.statNumber}>
                                  {event.totalLaps}
                                </Text>
                                <Text style={styles.statLabel}>LAPS</Text>
                              </View>
                              <View
                                style={[
                                  styles.statItem,
                                  Platform.OS === 'web' && styles.statItemWeb,
                                ]}>
                                <Text style={styles.statNumber}>
                                  <LapTime time={event.bestLapTime} isBest />
                                </Text>
                                <Text style={styles.statLabel}>BEST</Text>
                              </View>
                              {onSessionAnalysis && (
                                <TouchableOpacity
                                  style={[
                                    styles.analyzeButton,
                                    Platform.OS === 'web' &&
                                      styles.analyzeButtonWeb,
                                  ]}
                                  onPress={() => handleSessionAnalysis(event)}
                                  activeOpacity={0.7}>
                                  <Text style={styles.analyzeIcon}>📊</Text>
                                  {Platform.OS === 'web' && (
                                    <Text style={styles.analyzeButtonLabel}>
                                      Analyze
                                    </Text>
                                  )}
                                </TouchableOpacity>
                              )}
                              <Text
                                style={[
                                  styles.expandIcon,
                                  Platform.OS === 'web' && styles.expandIconWeb,
                                ]}>
                                {event.expanded ? '▼' : '▶'}
                              </Text>
                            </View>
                          </>
                        )}
                      </TouchableOpacity>

                      {/* Expanded Lap Details */}
                      {event.expanded && (
                        <View style={styles.expandedContent}>
                          <RacingDivider />

                          {isMobile ? (
                            /* Mobile Card Layout for Laps */
                            <View style={styles.mobileLapsContainer}>
                              {event.laps.map((lap, index) => (
                                <RacingCard
                                  key={lap.id}
                                  style={styles.mobileLapCard}>
                                  <View style={styles.mobileLapHeader}>
                                    <View style={styles.mobileLapRank}>
                                      <Text style={styles.mobileLapRankText}>
                                        #{index + 1}
                                      </Text>
                                    </View>
                                    <View style={styles.mobileLapStatus}>
                                      {lap.clean && (
                                        <StatusBadge status='clean' />
                                      )}
                                      {lap.offtrack && (
                                        <StatusBadge status='offtrack' />
                                      )}
                                      {lap.pitlane && (
                                        <StatusBadge status='pit' />
                                      )}
                                      {lap.incomplete && (
                                        <StatusBadge status='incomplete' />
                                      )}
                                    </View>
                                  </View>

                                  <View style={styles.mobileLapDetails}>
                                    <View style={styles.mobileLapDetail}>
                                      <Text style={styles.mobileLapDetailLabel}>
                                        LAP TIME
                                      </Text>
                                      <LapTime
                                        time={lap.lapTime}
                                        isBest={index === 0}
                                      />
                                    </View>
                                    <View style={styles.mobileLapDetail}>
                                      <Text style={styles.mobileLapDetailLabel}>
                                        SESSION
                                      </Text>
                                      <Text style={styles.mobileLapDetailValue}>
                                        {getSessionTypeName(lap.sessionType)} #
                                        {lap.session}
                                      </Text>
                                    </View>
                                  </View>
                                </RacingCard>
                              ))}
                            </View>
                          ) : (
                            /* Desktop Table Layout */
                            <>
                              {/* Lap List Header */}
                              <View style={styles.lapListHeader}>
                                <Text style={styles.lapHeaderRank}>RANK</Text>
                                <Text style={styles.lapHeaderTime}>
                                  LAP TIME
                                </Text>
                                <Text style={styles.lapHeaderSession}>
                                  SESSION
                                </Text>
                                <Text style={styles.lapHeaderStatus}>
                                  STATUS
                                </Text>
                              </View>

                              <RacingDivider />

                              {/* Individual Laps */}
                              {event.laps.map((lap, index) => (
                                <View key={lap.id} style={styles.lapRow}>
                                  <Text style={styles.lapRank}>
                                    #{index + 1}
                                  </Text>
                                  <LapTime
                                    time={lap.lapTime}
                                    isBest={index === 0}
                                    style={styles.lapTimeCell}
                                  />
                                  <Text style={styles.lapSession}>
                                    {getSessionTypeName(lap.sessionType)} #
                                    {lap.session}
                                  </Text>
                                  <View style={styles.lapStatus}>
                                    {lap.clean && (
                                      <StatusBadge status='clean' />
                                    )}
                                    {lap.offtrack && (
                                      <StatusBadge status='offtrack' />
                                    )}
                                    {lap.pitlane && (
                                      <StatusBadge status='pit' />
                                    )}
                                    {lap.incomplete && (
                                      <StatusBadge status='incomplete' />
                                    )}
                                  </View>
                                </View>
                              ))}
                            </>
                          )}
                        </View>
                      )}
                    </RacingCard>
                  ))}
                </View>
              ) : (
                // Android: Use View + map() for reliable rendering
                <View style={styles.eventsListAndroid}>
                  {eventGroups.map(event => (
                    <RacingCard
                      key={event.eventId}
                      style={styles.eventCardAndroid}>
                      {/* Event Header */}
                      <TouchableOpacity
                        style={[
                          isMobile
                            ? styles.mobileEventHeader
                            : styles.eventHeader,
                          Platform.OS === 'web' &&
                            !isMobile &&
                            styles.eventHeaderWeb,
                        ]}
                        onPress={() => toggleEvent(event.eventId)}>
                        {isMobile ? (
                          /* Mobile Layout */
                          <View style={styles.mobileEventContent}>
                            <View style={styles.mobileEventTopRow}>
                              <View style={styles.mobileEventMainInfo}>
                                <Text style={styles.mobileEventTitle}>
                                  {event.primaryCar}
                                </Text>
                                <Text style={styles.mobileEventTrack}>
                                  {event.primaryTrack}
                                </Text>
                              </View>
                              <View style={styles.mobileEventActions}>
                                {onSessionAnalysis && (
                                  <TouchableOpacity
                                    style={styles.mobileAnalyzeButton}
                                    onPress={() =>
                                      handleSessionAnalysis(event)
                                    }>
                                    <Text style={styles.analyzeIcon}>📊</Text>
                                  </TouchableOpacity>
                                )}
                                <Text style={styles.mobileExpandIcon}>
                                  {event.expanded ? '▼' : '▶'}
                                </Text>
                              </View>
                            </View>

                            <View style={styles.mobileEventStats}>
                              <View style={styles.mobileStatItem}>
                                <Text style={styles.mobileStatNumber}>
                                  {event.totalLaps}
                                </Text>
                                <Text style={styles.mobileStatLabel}>LAPS</Text>
                              </View>
                              <View style={styles.mobileStatItem}>
                                <Text style={styles.mobileStatNumber}>
                                  <LapTime time={event.bestLapTime} isBest />
                                </Text>
                                <Text style={styles.mobileStatLabel}>BEST</Text>
                              </View>
                            </View>

                            <View style={styles.mobileEventMeta}>
                              <Text style={styles.mobileEventDate}>
                                {formatDate(event.startTime)}
                              </Text>
                              <Text style={styles.mobileEventSessions}>
                                {event.sessionTypes.join(' • ')}
                              </Text>
                            </View>
                          </View>
                        ) : (
                          /* Desktop Layout */
                          <>
                            <View style={styles.eventMainInfo}>
                              <View style={styles.eventTitleRow}>
                                <Text style={styles.eventTitle}>
                                  {event.primaryCar}
                                </Text>
                                <Text style={styles.eventTrack}>
                                  {event.primaryTrack}
                                </Text>
                              </View>
                              <View style={styles.eventMetaRow}>
                                <Text style={styles.eventDate}>
                                  {formatDate(event.startTime)}
                                </Text>
                                <Text style={styles.eventSessions}>
                                  {event.sessionTypes.join(' • ')}
                                </Text>
                              </View>
                            </View>

                            <View
                              style={[
                                styles.eventStats,
                                Platform.OS === 'web' && styles.eventStatsWeb,
                              ]}>
                              <View
                                style={[
                                  styles.statItem,
                                  Platform.OS === 'web' && styles.statItemWeb,
                                ]}>
                                <Text style={styles.statNumber}>
                                  {event.totalLaps}
                                </Text>
                                <Text style={styles.statLabel}>LAPS</Text>
                              </View>
                              <View
                                style={[
                                  styles.statItem,
                                  Platform.OS === 'web' && styles.statItemWeb,
                                ]}>
                                <Text style={styles.statNumber}>
                                  <LapTime time={event.bestLapTime} isBest />
                                </Text>
                                <Text style={styles.statLabel}>BEST</Text>
                              </View>
                              {onSessionAnalysis && (
                                <TouchableOpacity
                                  style={[
                                    styles.analyzeButton,
                                    Platform.OS === 'web' &&
                                      styles.analyzeButtonWeb,
                                  ]}
                                  onPress={() => handleSessionAnalysis(event)}
                                  activeOpacity={0.7}>
                                  <Text style={styles.analyzeIcon}>📊</Text>
                                  {Platform.OS === 'web' && (
                                    <Text style={styles.analyzeButtonLabel}>
                                      Analyze
                                    </Text>
                                  )}
                                </TouchableOpacity>
                              )}
                              <Text
                                style={[
                                  styles.expandIcon,
                                  Platform.OS === 'web' && styles.expandIconWeb,
                                ]}>
                                {event.expanded ? '▼' : '▶'}
                              </Text>
                            </View>
                          </>
                        )}
                      </TouchableOpacity>

                      {/* Expanded Lap Details */}
                      {event.expanded && (
                        <View style={styles.expandedContent}>
                          <RacingDivider />

                          {isMobile ? (
                            /* Mobile Card Layout for Laps */
                            <View style={styles.mobileLapsContainer}>
                              {event.laps.map((lap, index) => (
                                <RacingCard
                                  key={lap.id}
                                  style={styles.mobileLapCard}>
                                  <View style={styles.mobileLapHeader}>
                                    <View style={styles.mobileLapRank}>
                                      <Text style={styles.mobileLapRankText}>
                                        #{index + 1}
                                      </Text>
                                    </View>
                                    <View style={styles.mobileLapStatus}>
                                      {lap.clean && (
                                        <StatusBadge status='clean' />
                                      )}
                                      {lap.offtrack && (
                                        <StatusBadge status='offtrack' />
                                      )}
                                      {lap.pitlane && (
                                        <StatusBadge status='pit' />
                                      )}
                                      {lap.incomplete && (
                                        <StatusBadge status='incomplete' />
                                      )}
                                    </View>
                                  </View>

                                  <View style={styles.mobileLapDetails}>
                                    <View style={styles.mobileLapDetail}>
                                      <Text style={styles.mobileLapDetailLabel}>
                                        LAP TIME
                                      </Text>
                                      <LapTime
                                        time={lap.lapTime}
                                        isBest={index === 0}
                                      />
                                    </View>
                                    <View style={styles.mobileLapDetail}>
                                      <Text style={styles.mobileLapDetailLabel}>
                                        SESSION
                                      </Text>
                                      <Text style={styles.mobileLapDetailValue}>
                                        {getSessionTypeName(lap.sessionType)} #
                                        {lap.session}
                                      </Text>
                                    </View>
                                  </View>
                                </RacingCard>
                              ))}
                            </View>
                          ) : (
                            /* Desktop Table Layout */
                            <>
                              {/* Lap List Header */}
                              <View style={styles.lapListHeader}>
                                <Text style={styles.lapHeaderRank}>RANK</Text>
                                <Text style={styles.lapHeaderTime}>
                                  LAP TIME
                                </Text>
                                <Text style={styles.lapHeaderSession}>
                                  SESSION
                                </Text>
                                <Text style={styles.lapHeaderStatus}>
                                  STATUS
                                </Text>
                              </View>

                              <RacingDivider />

                              {/* Individual Laps */}
                              {event.laps.map((lap, index) => (
                                <View key={lap.id} style={styles.lapRow}>
                                  <Text style={styles.lapRank}>
                                    #{index + 1}
                                  </Text>
                                  <LapTime
                                    time={lap.lapTime}
                                    isBest={index === 0}
                                    style={styles.lapTimeCell}
                                  />
                                  <Text style={styles.lapSession}>
                                    {getSessionTypeName(lap.sessionType)} #
                                    {lap.session}
                                  </Text>
                                  <View style={styles.lapStatus}>
                                    {lap.clean && (
                                      <StatusBadge status='clean' />
                                    )}
                                    {lap.offtrack && (
                                      <StatusBadge status='offtrack' />
                                    )}
                                    {lap.pitlane && (
                                      <StatusBadge status='pit' />
                                    )}
                                    {lap.incomplete && (
                                      <StatusBadge status='incomplete' />
                                    )}
                                  </View>
                                </View>
                              ))}
                            </>
                          )}
                        </View>
                      )}
                    </RacingCard>
                  ))}
                </View>
              )}

              {selectedTrackIds.length > 0 &&
                eventGroups.length === 0 &&
                !loading && (
                  <RacingCard style={styles.emptyCard}>
                    <Text style={styles.emptyIcon}>🏁</Text>
                    <Text style={styles.emptyTitle}>NO RACING DATA</Text>
                    <Text style={styles.emptyMessage}>
                      No laps recorded in the{' '}
                      {formatTimeRange(selectedTimeRange).toLowerCase()}.{'\n'}
                      Hit the track and start analyzing your performance!
                    </Text>
                  </RacingCard>
                )}
            </View>

            <View style={styles.bottomSpacing} />
          </View>
        </ScrollView>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  mainContainer: {
    flex: 1,
    backgroundColor: RacingTheme.colors.background,
  },
  fadeContainer: {
    flex: 1,
  },
  fullHeightContainer: {
    flex: 1,
    minHeight: '100vh' as any,
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
  dashboardHeader: {
    alignItems: 'center',
    marginBottom: RacingTheme.spacing.lg,
  },
  dashboardTitle: {
    fontSize: RacingTheme.typography.h2,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.primary,
    letterSpacing: 2,
    marginBottom: RacingTheme.spacing.xs,
  },
  dashboardSubtitle: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  timeRangeSelector: {
    marginBottom: RacingTheme.spacing.lg,
    alignSelf: 'center',
  },
  topControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: RacingTheme.spacing.lg,
  },
  timeRangeSelectorWeb: {
    marginBottom: 0,
  },
  refreshButtonWeb: {
    marginBottom: 0,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: RacingTheme.spacing.lg,
  },
  metricCard: {
    width: '48%',
    marginBottom: RacingTheme.spacing.md,
  },
  refreshButton: {
    marginBottom: RacingTheme.spacing.lg,
    alignSelf: 'center',
  },
  trackSelectorSection: {
    marginBottom: RacingTheme.spacing.lg,
    padding: RacingTheme.spacing.md,
    backgroundColor: RacingTheme.colors.surface,
    borderRadius: RacingTheme.borderRadius.md,
    borderWidth: 1,
    borderColor: RacingTheme.colors.surfaceElevated,
  },
  trackSelectorHint: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.textSecondary,
    marginBottom: RacingTheme.spacing.sm,
  },
  trackSearchInput: {
    backgroundColor: RacingTheme.colors.background,
    borderRadius: RacingTheme.borderRadius.sm,
    borderWidth: 1,
    borderColor: RacingTheme.colors.surfaceElevated,
    paddingHorizontal: RacingTheme.spacing.md,
    paddingVertical: RacingTheme.spacing.sm,
    fontSize: RacingTheme.typography.body,
    color: RacingTheme.colors.text,
    marginBottom: RacingTheme.spacing.sm,
  },
  trackListLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: RacingTheme.spacing.sm,
    paddingVertical: RacingTheme.spacing.md,
  },
  trackListLoadingText: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.textSecondary,
  },
  trackSelectorActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: RacingTheme.spacing.sm,
    marginBottom: RacingTheme.spacing.xs,
  },
  trackSelectorActionBtn: {
    paddingVertical: RacingTheme.spacing.xs,
    paddingHorizontal: RacingTheme.spacing.sm,
  },
  trackSelectorActionText: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.primary,
  },
  trackListScroll: {
    maxHeight: 220,
    marginBottom: RacingTheme.spacing.xs,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: RacingTheme.spacing.sm,
    paddingHorizontal: RacingTheme.spacing.sm,
    borderRadius: RacingTheme.borderRadius.sm,
    gap: RacingTheme.spacing.sm,
  },
  trackRowSelected: {
    backgroundColor: RacingTheme.colors.surfaceElevated,
  },
  trackRowCheck: {
    fontSize: RacingTheme.typography.body,
    color: RacingTheme.colors.primary,
    width: 24,
  },
  trackRowName: {
    flex: 1,
    fontSize: RacingTheme.typography.body,
    color: RacingTheme.colors.textSecondary,
  },
  trackRowNameSelected: {
    color: RacingTheme.colors.text,
  },
  trackSelectedCount: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.textTertiary,
  },
  trackPromptCard: {
    padding: RacingTheme.spacing.lg,
    marginBottom: RacingTheme.spacing.md,
  },
  trackPromptText: {
    fontSize: RacingTheme.typography.body,
    color: RacingTheme.colors.textSecondary,
    textAlign: 'center',
  },
  eventsSection: {
    marginBottom: RacingTheme.spacing.lg,
  },
  eventsList: {
    backgroundColor: RacingTheme.colors.background,
  },
  // Android-specific container for proper content sizing
  eventsListAndroid: {
    backgroundColor: RacingTheme.colors.background,
  },
  sectionTitle: {
    fontSize: RacingTheme.typography.h4,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.text,
    marginBottom: RacingTheme.spacing.md,
    letterSpacing: 1,
  },
  eventCard: {
    marginBottom: RacingTheme.spacing.md,
  },
  // Ensure Android cards have minimum height for content visibility
  eventCardAndroid: {
    marginBottom: RacingTheme.spacing.md,
    minHeight: 140,
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: RacingTheme.spacing.md,
  },
  eventMainInfo: {
    flex: 1,
  },
  eventTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: RacingTheme.spacing.xs,
  },
  eventTitle: {
    fontSize: RacingTheme.typography.h4,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.primary,
    marginRight: RacingTheme.spacing.sm,
  },
  eventTrack: {
    fontSize: RacingTheme.typography.body,
    color: RacingTheme.colors.textSecondary,
  },
  eventMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eventDate: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.textTertiary,
  },
  eventSessions: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.secondary,
    fontWeight: RacingTheme.typography.medium as any,
  },
  eventStats: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  eventStatsWeb: {
    gap: RacingTheme.spacing.lg,
    marginLeft: RacingTheme.spacing.md,
  },
  statItem: {
    alignItems: 'center',
    marginRight: RacingTheme.spacing.md,
  },
  statItemWeb: {
    marginRight: RacingTheme.spacing.lg,
    minWidth: 56,
  },
  statNumber: {
    fontSize: RacingTheme.typography.body,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.text,
  },
  statLabel: {
    fontSize: RacingTheme.typography.small,
    color: RacingTheme.colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  expandIcon: {
    fontSize: RacingTheme.typography.h4,
    color: RacingTheme.colors.primary,
  },
  expandIconWeb: {
    marginLeft: RacingTheme.spacing.sm,
  },
  analyzeButton: {
    marginRight: RacingTheme.spacing.sm,
    padding: RacingTheme.spacing.xs,
    borderRadius: RacingTheme.borderRadius.sm,
    backgroundColor: RacingTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: RacingTheme.colors.secondary,
  },
  analyzeButtonWeb: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: RacingTheme.spacing.sm,
    paddingHorizontal: RacingTheme.spacing.md,
    marginRight: RacingTheme.spacing.md,
    gap: RacingTheme.spacing.xs,
    minHeight: 44,
  },
  analyzeButtonLabel: {
    fontSize: RacingTheme.typography.body,
    fontWeight: RacingTheme.typography.semibold as any,
    color: RacingTheme.colors.secondary,
  },
  analyzeIcon: {
    fontSize: RacingTheme.typography.body,
    color: RacingTheme.colors.secondary,
  },
  expandedContent: {
    padding: RacingTheme.spacing.md,
  },
  lapListHeader: {
    flexDirection: 'row',
    paddingVertical: RacingTheme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: RacingTheme.colors.surfaceElevated,
  },
  lapHeaderRank: {
    flex: 1,
    fontSize: RacingTheme.typography.small,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  lapHeaderTime: {
    flex: 2,
    fontSize: RacingTheme.typography.small,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  lapHeaderSession: {
    flex: 3,
    fontSize: RacingTheme.typography.small,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  lapHeaderStatus: {
    flex: 2,
    fontSize: RacingTheme.typography.small,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  lapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: RacingTheme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: RacingTheme.colors.surfaceElevated,
  },
  lapRank: {
    flex: 1,
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.textTertiary,
    fontFamily:
      Platform.OS === 'android' ? 'monospace' : RacingTheme.typography.mono,
  },
  lapTimeCell: {
    flex: 2,
  },
  lapSession: {
    flex: 3,
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.textSecondary,
  },
  lapStatus: {
    flex: 2,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  emptyCard: {
    alignItems: 'center',
    padding: RacingTheme.spacing.xl,
  },
  emptyIcon: {
    fontSize: RacingTheme.typography.h1,
    marginBottom: RacingTheme.spacing.md,
  },
  emptyTitle: {
    fontSize: RacingTheme.typography.h3,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.text,
    textAlign: 'center',
    marginBottom: RacingTheme.spacing.sm,
  },
  emptyMessage: {
    fontSize: RacingTheme.typography.body,
    color: RacingTheme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
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
  errorSubtext: {
    fontSize: RacingTheme.typography.body,
    color: RacingTheme.colors.text,
    textAlign: 'center',
    marginBottom: RacingTheme.spacing.lg,
  },
  bottomSpacing: {
    height: RacingTheme.spacing.xxxl, // Extra space for scrolling
  },
  // Mobile Event Card Styles
  mobileEventHeader: {
    padding: RacingTheme.spacing.md,
  },
  mobileEventContent: {
    gap: RacingTheme.spacing.md,
  },
  mobileEventTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  mobileEventMainInfo: {
    flex: 1,
  },
  mobileEventTitle: {
    fontSize: RacingTheme.typography.h4,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.primary,
    marginBottom: RacingTheme.spacing.xs,
  },
  mobileEventTrack: {
    fontSize: RacingTheme.typography.body,
    color: RacingTheme.colors.textSecondary,
  },
  mobileEventActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: RacingTheme.spacing.sm,
  },
  mobileAnalyzeButton: {
    padding: RacingTheme.spacing.sm,
    borderRadius: RacingTheme.borderRadius.sm,
    backgroundColor: RacingTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: RacingTheme.colors.secondary,
  },
  mobileExpandIcon: {
    fontSize: RacingTheme.typography.h4,
    color: RacingTheme.colors.primary,
  },
  mobileEventStats: {
    flexDirection: 'row',
    gap: RacingTheme.spacing.lg,
  },
  mobileStatItem: {
    alignItems: 'center',
    flex: 1,
  },
  mobileStatNumber: {
    fontSize: RacingTheme.typography.h3,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.text,
    marginBottom: RacingTheme.spacing.xs,
  },
  mobileStatLabel: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  mobileEventMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: RacingTheme.spacing.md,
  },
  mobileEventDate: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.textTertiary,
  },
  mobileEventSessions: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.secondary,
    fontWeight: RacingTheme.typography.medium as any,
    marginLeft: RacingTheme.spacing.sm,
  },
  // Mobile Lap Cards Styles
  mobileLapsContainer: {
    gap: RacingTheme.spacing.md,
  },
  mobileLapCard: {
    padding: RacingTheme.spacing.md,
  },
  mobileLapHeader: {
    flexDirection: 'row',
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
    textAlign: 'center',
  },
  mobileLapStatus: {
    flexDirection: 'row',
    gap: RacingTheme.spacing.xs,
  },
  mobileLapDetails: {
    gap: RacingTheme.spacing.sm,
  },
  mobileLapDetail: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  mobileLapDetailLabel: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    flex: 1,
  },
  mobileLapDetailValue: {
    fontSize: RacingTheme.typography.body,
    fontWeight: RacingTheme.typography.medium as any,
    color: RacingTheme.colors.text,
    textAlign: 'right',
    flex: 1,
  },
});

export default LapList;
