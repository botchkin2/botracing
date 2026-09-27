import {useTelemetry} from '@/src/hooks/useApiQueries';
import {Lap} from '@/src/types';
import {findClosestIndex} from '@/src/utils/binarySearch';
import {LAP_COLOR_SCHEMES, SERIES_BASE_COLORS} from '@/src/utils/colors';
import {
  parseTelemetryData,
  type TimeSeriesData,
} from '@/src/utils/dataProcessing';
import {convertLatLongToXY, type TrackMapData} from '@/src/utils/geometry';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, {Path} from 'react-native-svg';

const {width} = Dimensions.get('window');

interface NormalizedSeriesData {
  key: string;
  color: string;
  minVal: number;
  maxVal: number;
  range: number;
  normalizedData: Float32Array;
}

export interface ProcessedLapData {
  raw: TimeSeriesData[];
  normalized: TimeSeriesData[];
  normalizedSeries: NormalizedSeriesData[];
  totalPoints: number;
  trackMap?: TrackMapData;
  // Pre-computed mapping from lap distance % to data index for fast lookup
  lapDistToIndexMap: Float32Array;
}

interface VisibleDataInfo {
  data: TimeSeriesData[];
  startIdx: number;
  endIdx: number;
}

interface MultiLapTimeSeriesChartProps {
  laps: Lap[];
  selectedSeries: string[];
  title?: string;
  // External control props (when provided, component uses these instead of internal state)
  externalIsPlaying?: boolean;
  externalPlaybackSpeed?: number;
  externalZoomLevel?: number;
  externalShowTrackMap?: boolean;
  onSeriesChange?: (series: string[]) => void;
  // Pre-loaded data to avoid duplicate API calls
  preloadedData?: Map<string, ProcessedLapData>;
  // Shared position tracking
  externalCurrentPosition?: number;
  onPositionChange?: (position: number) => void;
  // Error handling
  onApiError?: () => void;
}

// Component to handle individual lap telemetry loading
export const LapTelemetryLoader: React.FC<{
  lap: Lap;
  onLapCompleted: (
    lapId: string,
    data: ProcessedLapData | null,
    error?: any,
  ) => void;
  onLapLoadingStart?: (lapId: string) => void;
  lapIndex: number;
}> = ({lap, onLapCompleted, onLapLoadingStart, lapIndex}) => {
  // Stagger CSV loading to prevent overwhelming the server
  const [canLoad, setCanLoad] = useState(false);

  // Delay loading based on lap index to prevent all requests at once
  useEffect(() => {
    const delay = lapIndex * 100; // 100ms delay between each lap
    const timer = setTimeout(() => {
      setCanLoad(true);
      onLapLoadingStart?.(lap.id);
    }, delay);
    return () => clearTimeout(timer);
  }, [lapIndex, lap.id, onLapLoadingStart]);

  const query = useTelemetry(lap.id, {enabled: canLoad});
  const hasCompleted = useRef(false);

  useEffect(() => {
    // Prevent duplicate completions
    if (hasCompleted.current) {
      return;
    }

    // Check if query has finished (success or error)
    const isFinished = query.isSuccess || query.isError;

    if (!isFinished) {
      return;
    }

    hasCompleted.current = true;

    try {
      if (query.isSuccess && query.data) {
        const parsedData = parseTelemetryData(query.data);
        if (parsedData.length > 0) {
          const seriesKeys = [
            'brake',
            'throttle',
            'rpm',
            'steeringWheelAngle',
            'speed',
            'gear',
          ] as const;
          const normalizedSeries: NormalizedSeriesData[] = seriesKeys.map(
            seriesKey => {
              const values = new Float32Array(parsedData.length);
              let minVal = Infinity;
              let maxVal = -Infinity;

              for (let i = 0; i < parsedData.length; i++) {
                const val = parsedData[i][seriesKey] as number;
                values[i] = val;
                minVal = Math.min(minVal, val);
                maxVal = Math.max(maxVal, val);
              }

              const range = maxVal - minVal;
              const normalizedValues = new Float32Array(parsedData.length);
              if (range > 0) {
                for (let i = 0; i < parsedData.length; i++) {
                  normalizedValues[i] = (values[i] - minVal) / range;
                }
              }

              return {
                key: seriesKey,
                color:
                  LAP_COLOR_SCHEMES[lapIndex]?.[seriesKey] ||
                  SERIES_BASE_COLORS[seriesKey],
                minVal,
                maxVal,
                range,
                normalizedData: normalizedValues,
              };
            },
          );

          // Pre-compute mapping from lap distance % to data index for fast lookup
          const lapDistToIndexMap = new Float32Array(parsedData.length);
          for (let i = 0; i < parsedData.length; i++) {
            lapDistToIndexMap[i] = parsedData[i].lapDistPct;
          }

          onLapCompleted(lap.id, {
            raw: parsedData,
            normalized: parsedData,
            normalizedSeries,
            totalPoints: parsedData.length,
            trackMap: convertLatLongToXY(parsedData),
            lapDistToIndexMap,
          });
        } else {
          onLapCompleted(lap.id, null);
        }
      } else if (query.isError) {
        onLapCompleted(lap.id, null, query.error);
      }
    } catch {
      onLapCompleted(lap.id, null);
    }
  }, [
    query.isSuccess,
    query.isError,
    query.data,
    query.error,
    lap.id,
    lapIndex,
    onLapCompleted,
  ]);

  return null;
};

export const MultiLapTimeSeriesChart: React.FC<
  MultiLapTimeSeriesChartProps
> = ({
  laps,
  selectedSeries,
  title = 'Multi-Lap Comparison',
  externalIsPlaying,
  externalPlaybackSpeed,
  externalZoomLevel,
  externalShowTrackMap,
  onSeriesChange,
  preloadedData,
  externalCurrentPosition,
  onPositionChange,
  onApiError,
}) => {
  // Use preloaded data if provided, otherwise manage our own state
  const [lapDataMap, setLapDataMap] = useState<Map<string, ProcessedLapData>>(
    preloadedData || new Map(),
  );
  const [isLoading, setIsLoading] = useState(!preloadedData);

  // Use external controls if provided, otherwise use internal state
  const useExternalControls = externalIsPlaying !== undefined;
  const [internalIsPlaying, setInternalIsPlaying] = useState(false);
  const [internalPlaybackSpeed, setInternalPlaybackSpeed] = useState(1);
  const [internalZoomLevel, setInternalZoomLevel] = useState(3);
  const [internalShowTrackMap, setInternalShowTrackMap] = useState(true);

  // Effective values (external or internal)
  const isPlaying = useExternalControls
    ? externalIsPlaying!
    : internalIsPlaying;
  const playbackSpeed = useExternalControls
    ? externalPlaybackSpeed!
    : internalPlaybackSpeed;
  const zoomLevel = useExternalControls
    ? externalZoomLevel!
    : internalZoomLevel;
  const showTrackMap = useExternalControls
    ? externalShowTrackMap!
    : internalShowTrackMap;
  const animationRef = useRef<NodeJS.Timeout | null>(null);
  const referenceLapDataRef = useRef<ProcessedLapData | null>(null);
  /** Latest playback position (updated every tick). Used so we don't need state for position. */
  const positionRef = useRef<number>(0);
  /** Stable reference to position change callback to avoid dependency loops */
  const onPositionChangeRef = useRef(onPositionChange);
  onPositionChangeRef.current = onPositionChange;
  const visibleDataCache = useRef<{
    position: number;
    zoomLevel: number;
    totalPoints: number;
    data: TimeSeriesData[];
    startIdx: number;
    endIdx: number;
  } | null>(null);

  // Update lapDataMap when preloadedData changes
  useEffect(() => {
    if (preloadedData) {
      setLapDataMap(preloadedData);
      setIsLoading(false);
    }
  }, [preloadedData]);

  // Calculate real-time advancement rate based on lap time and sample count
  const calculateAdvancementRate = useCallback(
    (totalSamples: number, lapTimeSeconds?: number): number => {
      if (!lapTimeSeconds || lapTimeSeconds <= 0) {
        // Fallback to hardcoded value if no lap time provided
        return 1.767;
      }

      // Calculate samples per second for real-time playback
      const samplesPerSecond = totalSamples / lapTimeSeconds;

      // Assuming ~30ms frame interval at speed 1, calculate samples per frame
      const framesPerSecond = 1000 / 30; // ~33.3 FPS
      const samplesPerFrame = samplesPerSecond / framesPerSecond;

      return samplesPerFrame;
    },
    [],
  );

  // Use first lap as reference for position/index-based playback
  const referenceLapData = useMemo(() => {
    const result =
      lapDataMap.size === 0 ? null : Array.from(lapDataMap.values())[0];
    // Update ref for animation functions to access current value
    referenceLapDataRef.current = result;
    return result;
  }, [lapDataMap]);

  // Update visible data based on position and zoom level
  const updateVisibleData = useCallback(
    (data: TimeSeriesData[], position: number): number => {
      if (!data || data.length === 0) {
        return 0;
      }
      const totalPoints = data.length;

      // Check cache first
      if (
        visibleDataCache.current &&
        visibleDataCache.current.position === position &&
        visibleDataCache.current.zoomLevel === zoomLevel &&
        visibleDataCache.current.totalPoints === totalPoints
      ) {
        return visibleDataCache.current.startIdx;
      }

      // Calculate the range of data to show based on zoom level
      // Zoom 1-5 maps to 15%-2% of data visible (higher zoom = less data = more zoomed in)
      const dataPercentage = 15 - (zoomLevel - 1) * 3.25; // 15% at zoom 1, 2% at zoom 5
      const pointsToShow = Math.max(
        50,
        Math.floor(totalPoints * (dataPercentage / 100)),
      );

      // Position determines where the leftmost data point is (x=0 = "now")
      // Leftmost (x=0) is always "now", rightmost shows future data
      const startIdx = Math.max(
        0,
        Math.min(totalPoints - pointsToShow, Math.floor(position)),
      );
      const endIdx = Math.min(totalPoints - 1, startIdx + pointsToShow - 1);

      const visiblePoints = data.slice(startIdx, endIdx + 1);

      // Update cache
      visibleDataCache.current = {
        position,
        zoomLevel,
        totalPoints,
        data: visiblePoints,
        startIdx,
        endIdx,
      };

      // Update visible data state
      setVisibleData({data: visiblePoints, startIdx, endIdx});

      return startIdx;
    },
    [zoomLevel],
  );

  // State for visible data
  const [visibleData, setVisibleData] = useState<VisibleDataInfo>({
    data: [],
    startIdx: 0,
    endIdx: 0,
  });

  // Helper functions for position management
  const getCurrentPosition = useCallback(
    (): number => externalCurrentPosition ?? positionRef.current,
    [externalCurrentPosition],
  );

  const updatePosition = useCallback(
    (newPosition: number) => {
      const refData = referenceLapDataRef.current;
      if (refData) {
        const dataPercentage = 15 - (zoomLevel - 1) * 3.25; // 15% at zoom 1, 2% at zoom 5
        const pointsToShow = Math.max(
          50,
          Math.floor(refData.totalPoints * (dataPercentage / 100)),
        );

        const startIdx = Math.max(
          0,
          Math.min(refData.totalPoints - pointsToShow, Math.floor(newPosition)),
        );
        const endIdx = Math.min(
          refData.totalPoints - 1,
          startIdx + pointsToShow - 1,
        );
        const visiblePoints = refData.raw.slice(startIdx, endIdx + 1);

        setVisibleData({data: visiblePoints, startIdx, endIdx});
      }

      positionRef.current = newPosition;

      // Update external position if callback provided
      if (onPositionChangeRef.current) {
        onPositionChangeRef.current(newPosition);
      }
    },
    [zoomLevel],
  );

  // Start playback (only for internal controls)
  const startPlayback = useCallback(() => {
    if (isPlaying || !referenceLapData) {
      return;
    }
    if (useExternalControls) {
      // External controls don't need to set state here - it's handled by parent
      return;
    }
    setInternalIsPlaying(true);
  }, [isPlaying, referenceLapData, useExternalControls]);

  // Stop playback
  const stopPlayback = useCallback(() => {
    if (!useExternalControls) {
      setInternalIsPlaying(false);
    }
    if (animationRef.current) {
      clearInterval(animationRef.current);
      animationRef.current = null;
    }
  }, [useExternalControls]);

  // Reset playback
  const resetPlayback = useCallback(() => {
    stopPlayback();
    updatePosition(0);
  }, [stopPlayback, updatePosition]);

  // Handle playback state changes (for external controls)
  useEffect(() => {
    // Stop any existing animation
    if (animationRef.current) {
      clearInterval(animationRef.current);
      animationRef.current = null;
    }

    if (isPlaying && referenceLapDataRef.current) {
      // Start animation
      const animate = () => {
        const refData = referenceLapDataRef.current;
        if (!refData) {
          return;
        }

        const currentPos = externalCurrentPosition ?? positionRef.current;
        const baseAdvancementRate = calculateAdvancementRate(
          refData.totalPoints,
          laps[0]?.lapTime,
        );
        let advancement = baseAdvancementRate * playbackSpeed;

        let nextPos = currentPos + advancement;
        if (nextPos >= refData.totalPoints) {
          nextPos = 0; // Loop back to start
        } else if (nextPos < 0) {
          nextPos = refData.totalPoints - 1; // Loop back to end
        }

        positionRef.current = nextPos;

        // Update visible data only if window actually changes
        const dataPercentage = 15 - (zoomLevel - 1) * 3.25; // 15% at zoom 1, 2% at zoom 5
        const pointsToShow = Math.max(
          50,
          Math.floor(refData.totalPoints * (dataPercentage / 100)),
        );

        const startIdx = Math.max(
          0,
          Math.min(refData.totalPoints - pointsToShow, Math.floor(nextPos)),
        );
        const endIdx = Math.min(
          refData.totalPoints - 1,
          startIdx + pointsToShow - 1,
        );

        // Only update visible data if the window actually changed
        if (
          !visibleDataCache.current ||
          visibleDataCache.current.startIdx !== startIdx ||
          visibleDataCache.current.endIdx !== endIdx
        ) {
          const visiblePoints = refData.raw.slice(startIdx, endIdx + 1);
          visibleDataCache.current = {
            position: nextPos,
            zoomLevel,
            totalPoints: refData.totalPoints,
            data: visiblePoints,
            startIdx,
            endIdx,
          };
          setVisibleData({data: visiblePoints, startIdx, endIdx});
        }

        if (onPositionChangeRef.current) {
          onPositionChangeRef.current(nextPos);
        }
      };

      // Use variable interval based on speed
      const animationInterval = Math.max(10, 30 / Math.abs(playbackSpeed));
      animationRef.current = setInterval(animate, animationInterval);
    }

    return () => {
      if (animationRef.current) {
        clearInterval(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [isPlaying, playbackSpeed, zoomLevel, externalCurrentPosition]);

  // Update visible data when reference lap data first loads (initial position = 0)
  useEffect(() => {
    const refData = referenceLapDataRef.current;
    if (refData) {
      const dataPercentage = 15 - (zoomLevel - 1) * 3.25; // 15% at zoom 1, 2% at zoom 5
      const pointsToShow = Math.max(
        50,
        Math.floor(refData.totalPoints * (dataPercentage / 100)),
      );

      const startIdx = 0;
      const endIdx = Math.min(
        refData.totalPoints - 1,
        startIdx + pointsToShow - 1,
      );
      const visiblePoints = refData.raw.slice(startIdx, endIdx + 1);

      setVisibleData({data: visiblePoints, startIdx, endIdx});
    }
  }, [referenceLapData?.totalPoints, zoomLevel]);

  // Update visible data when zoom level changes (keep current position)
  useEffect(() => {
    const refData = referenceLapDataRef.current;
    if (refData) {
      const currentPos = externalCurrentPosition ?? positionRef.current;
      const dataPercentage = 15 - (zoomLevel - 1) * 3.25; // 15% at zoom 1, 2% at zoom 5
      const pointsToShow = Math.max(
        50,
        Math.floor(refData.totalPoints * (dataPercentage / 100)),
      );

      const startIdx = Math.max(
        0,
        Math.min(refData.totalPoints - pointsToShow, Math.floor(currentPos)),
      );
      const endIdx = Math.min(
        refData.totalPoints - 1,
        startIdx + pointsToShow - 1,
      );
      const visiblePoints = refData.raw.slice(startIdx, endIdx + 1);

      setVisibleData({data: visiblePoints, startIdx, endIdx});
    }
  }, [zoomLevel, externalCurrentPosition]);

  // Update visible data when zoom changes during playback
  useEffect(() => {
    if (isPlaying && referenceLapData) {
      // Stop current animation
      if (animationRef.current) {
        clearInterval(animationRef.current);
      }

      // Restart with new speed
      const animate = () => {
        const currentPos = externalCurrentPosition ?? positionRef.current;
        let advancement = 1.767; // Base advancement rate
        advancement *= playbackSpeed;

        const refData = referenceLapDataRef.current;
        if (!refData) {
          return;
        }

        let nextPos = currentPos + advancement;
        if (nextPos >= refData.totalPoints) {
          nextPos = 0; // Loop back to start
        } else if (nextPos < 0) {
          nextPos = refData.totalPoints - 1; // Loop back to end
        }

        positionRef.current = nextPos;
        if (referenceLapDataRef.current) {
          updateVisibleData(referenceLapDataRef.current.raw, nextPos);
        }
        if (onPositionChangeRef.current) {
          onPositionChangeRef.current(nextPos);
        }
      };

      // Use variable interval based on speed
      const animationInterval = Math.max(10, 30 / Math.abs(playbackSpeed));

      animationRef.current = setInterval(animate, animationInterval);
    }
  }, [
    zoomLevel,
    isPlaying,
    playbackSpeed,
    referenceLapData,
    externalCurrentPosition,
    onPositionChange,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) {
        clearInterval(animationRef.current);
      }
    };
  }, []);

  // Calculate chart dimensions - use maximum screen width for better data visualization
  const chartWidth = width - 40;
  const chartHeight = 250;

  // Current position is tracked by currentPosition (index-based)

  if (laps.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>No laps selected</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <Text style={styles.loadingText}>
            Loading telemetry data... ({lapDataMap.size}/{laps.length} loaded)
          </Text>
        </View>
      )}

      {lapDataMap.size === 0 && !isLoading && (
        <View style={styles.errorOverlay}>
          <Text style={styles.errorText}>No telemetry data available</Text>
        </View>
      )}

      {/* Controls - only show when not using external controls */}
      {!useExternalControls && (
        <View style={styles.compactControls}>
          <View style={styles.transportBar}>
            {/* Row 1: Playback controls and map toggle */}
            <View style={styles.controlsRow}>
              <View style={styles.resetMapGroup}>
                <TouchableOpacity
                  style={styles.miniButton}
                  onPress={resetPlayback}>
                  <Text style={styles.miniText}>🔄</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.miniButton,
                    showTrackMap && styles.miniButtonActive,
                  ]}
                  onPress={() => setInternalShowTrackMap(!showTrackMap)}>
                  <Text style={styles.miniText}>🗺️</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.playbackGroup}>
                <TouchableOpacity
                  style={styles.miniButton}
                  onPress={() => {
                    setInternalPlaybackSpeed(
                      Math.max(-5.0, playbackSpeed - 0.5),
                    );
                    if (!isPlaying) {
                      startPlayback();
                    }
                  }}>
                  <Text style={styles.miniText}>⏪</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.miniButton}
                  onPress={() => {
                    updatePosition(Math.max(0, getCurrentPosition() - 50));
                    if (!isPlaying) {
                      startPlayback();
                    }
                  }}>
                  <Text style={styles.miniText}>⏮️</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.playButtonMini,
                    isPlaying && styles.playButtonActive,
                  ]}
                  onPress={() => {
                    if (isPlaying) {
                      stopPlayback();
                    } else {
                      startPlayback();
                    }
                  }}>
                  <Text style={styles.playText}>{isPlaying ? '⏸️' : '▶️'}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.miniButton}
                  onPress={() => {
                    updatePosition(
                      Math.min(
                        (referenceLapData?.totalPoints || 0) - 1,
                        getCurrentPosition() + 50,
                      ),
                    );
                    if (!isPlaying) {
                      startPlayback();
                    }
                  }}>
                  <Text style={styles.miniText}>⏭️</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.miniButton}
                  onPress={() => {
                    setInternalPlaybackSpeed(
                      Math.min(5.0, playbackSpeed + 0.5),
                    );
                    if (!isPlaying) {
                      startPlayback();
                    }
                  }}>
                  <Text style={styles.miniText}>⏩</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Row 2: Status and zoom controls */}
            <View style={styles.controlsRow}>
              <View style={styles.statusGroup}>
                <Text
                  style={[
                    styles.statusText,
                    playbackSpeed < 0 && styles.statusTextReverse,
                  ]}>
                  {playbackSpeed.toFixed(1)}x
                </Text>
                <Text style={styles.statusText}>
                  {referenceLapData && laps[0]?.lapTime
                    ? (() => {
                        const idx = Math.min(
                          getCurrentPosition(),
                          referenceLapData.raw.length - 1,
                        );
                        const point = referenceLapData.raw[Math.max(0, idx)];
                        return point
                          ? `${(
                              (point.lapDistPct / 100) *
                              laps[0].lapTime!
                            ).toFixed(2)}s`
                          : '—';
                      })()
                    : '—'}
                </Text>
              </View>

              <View style={styles.zoomGroup}>
                <TouchableOpacity
                  style={styles.miniButton}
                  onPress={() =>
                    setInternalZoomLevel(Math.max(1, zoomLevel - 1))
                  }>
                  <Text style={styles.miniText}>🔍-</Text>
                </TouchableOpacity>
                <Text style={styles.zoomLevelText}>{zoomLevel}</Text>
                <TouchableOpacity
                  style={styles.miniButton}
                  onPress={() =>
                    setInternalZoomLevel(Math.min(5, zoomLevel + 1))
                  }>
                  <Text style={styles.miniText}>🔍+</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* Chart */}
      <View style={styles.chartContainer}>
        <View style={styles.simpleChart}>
          <View style={styles.yAxis}>
            {[100, 80, 60, 40, 20, 0].map(value => (
              <Text key={value} style={styles.yAxisLabel}>
                {value}%
              </Text>
            ))}
            <View style={styles.yAxisLine} />
          </View>

          <View style={styles.chartArea}>
            <View style={styles.gridLines}>
              {[0, 20, 40, 60, 80, 100].map(value => (
                <View
                  key={`grid-${value}`}
                  style={[
                    styles.gridLine,
                    {top: ((100 - value) / 100) * chartHeight},
                  ]}
                />
              ))}
            </View>

            <View style={styles.lineChart}>
              {Array.from(lapDataMap.entries()).map(([lapId, lapData]) => {
                const lap = laps.find(l => l.id === lapId);
                if (!lap) {
                  return null;
                }

                // Check if this is the reference lap (first lap in the array)
                const isReferenceLap =
                  laps.length > 0 &&
                  laps[0]?.id === lapId &&
                  lapData === referenceLapData;

                return selectedSeries.map(seriesKey => {
                  const series = lapData.normalizedSeries.find(
                    s => s.key === seriesKey,
                  );
                  if (!series) {
                    return null;
                  }

                  // Use reference lap's visible data points as the frame of reference
                  // For each frame (point) in the reference lap, filter other laps by matching lap distance %
                  const visibleCount = visibleData.data.length;
                  let pathData = '';

                  for (let i = 0; i < visibleCount; i++) {
                    const refPoint = visibleData.data[i];
                    if (!refPoint) {
                      continue;
                    }

                    let normalizedValue: number;
                    let dataIndex: number;

                    if (isReferenceLap) {
                      // For reference lap, use the point directly from visible data
                      dataIndex = visibleData.startIdx + i;
                      normalizedValue = series.normalizedData[dataIndex] || 0;
                    } else {
                      // For other laps, find the closest point at the same lap distance percentage
                      // Use binary search for O(log n) lookup instead of O(n) linear search
                      const closestIdx = findClosestIndex(
                        lapData.lapDistToIndexMap,
                        refPoint.lapDistPct,
                      );

                      dataIndex = closestIdx;
                      normalizedValue = series.normalizedData[closestIdx] || 0;
                    }

                    // Calculate x position (same for all laps - based on reference lap's frame sequence)
                    const x =
                      visibleCount > 1
                        ? (i / (visibleCount - 1)) * chartWidth
                        : 0;
                    const y = chartHeight - normalizedValue * chartHeight;

                    if (i === 0) {
                      pathData += `M ${x} ${y}`;
                    } else {
                      pathData += ` L ${x} ${y}`;
                    }
                  }

                  return (
                    <View
                      key={`${lapId}-${seriesKey}`}
                      style={styles.svgContainer}>
                      <Svg
                        width={chartWidth}
                        height={chartHeight}
                        style={styles.svgChart}>
                        <Path
                          d={pathData}
                          stroke={series.color}
                          strokeWidth={2}
                          fill='none'
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          opacity={isReferenceLap ? 1.0 : 0.7}
                        />
                      </Svg>
                    </View>
                  );
                });
              })}
            </View>

            <View style={styles.xAxis}>
              {(() => {
                const firstLapTime = laps[0]?.lapTime;
                const data = visibleData.data;
                const n = data.length;

                if (!firstLapTime || firstLapTime <= 0 || n < 2) {
                  // Fallback: show lap % when lap time unavailable
                  return Array.from({length: 6}, (_, i) => {
                    const dataIndex = Math.floor(((n - 1) * i) / 5);
                    const pt = data[dataIndex];
                    const x = (i / 5) * chartWidth;
                    return (
                      <Text
                        key={`fb-${i}`}
                        style={[styles.xAxisLabel, {left: x - 20}]}>
                        {i === 0
                          ? 'Now'
                          : pt
                          ? `${pt.lapDistPct.toFixed(1)}%`
                          : ''}
                      </Text>
                    );
                  });
                }

                const tStart = (data[0].lapDistPct / 100) * firstLapTime;
                const tEnd = (data[n - 1].lapDistPct / 100) * firstLapTime;

                /** Map time (seconds into first lap) to x position in chart pixels */
                const timeToX = (t: number): number => {
                  const lapPct = (t / firstLapTime) * 100;
                  if (lapPct <= data[0].lapDistPct) return 0;
                  if (lapPct >= data[n - 1].lapDistPct) return chartWidth;
                  for (let i = 0; i < n - 1; i++) {
                    const a = data[i].lapDistPct;
                    const b = data[i + 1].lapDistPct;
                    if (lapPct >= a && lapPct <= b) {
                      const fraction = b === a ? 0 : (lapPct - a) / (b - a);
                      const index = i + fraction;
                      return (index / (n - 1)) * chartWidth;
                    }
                  }
                  return chartWidth;
                };

                const notchStep = 0.25;
                const t0 = Math.ceil(tStart / notchStep) * notchStep;
                const notches: React.ReactNode[] = [];
                const labelSet = new Set<number>();

                for (let t = t0; t <= tEnd; t += notchStep) {
                  const x = timeToX(t);
                  const isWholeSecond = Math.abs(t - Math.round(t)) < 0.01;
                  if (isWholeSecond) {
                    labelSet.add(Math.round(t));
                  }
                  notches.push(
                    <View
                      key={`notch-${t}`}
                      style={[
                        styles.xAxisNotch,
                        isWholeSecond && styles.xAxisNotchMajor,
                        {left: x - 1},
                      ]}
                    />,
                  );
                }

                const labels: React.ReactNode[] = [];
                labelSet.forEach(t => {
                  const x = timeToX(t);
                  labels.push(
                    <Text
                      key={`label-${t}`}
                      style={[styles.xAxisLabel, {left: x - 20}]}>
                      {t}s
                    </Text>,
                  );
                });

                return (
                  <>
                    {notches}
                    {labels}
                  </>
                );
              })()}
            </View>
          </View>
        </View>
      </View>

      <View style={styles.dataSelectorBelow}>
        <View style={styles.seriesSelector}>
          <Text style={styles.seriesLabel}>Data:</Text>
          {[
            {key: 'brake', label: 'Brake'},
            {key: 'throttle', label: 'Throttle'},
            {key: 'rpm', label: 'RPM'},
            {key: 'steeringWheelAngle', label: 'Steering'},
            {key: 'speed', label: 'Speed'},
            {key: 'gear', label: 'Gear'},
          ].map(series => {
            const isSelected = selectedSeries.includes(series.key);
            return onSeriesChange ? (
              <TouchableOpacity
                key={series.key}
                style={[
                  styles.seriesButton,
                  isSelected && styles.seriesButtonActive,
                ]}
                onPress={() => {
                  if (isSelected) {
                    if (selectedSeries.length > 1) {
                      onSeriesChange(
                        selectedSeries.filter(s => s !== series.key),
                      );
                    }
                  } else {
                    onSeriesChange([...selectedSeries, series.key]);
                  }
                }}>
                <Text
                  style={[
                    styles.seriesButtonText,
                    isSelected && styles.seriesButtonTextActive,
                  ]}>
                  {isSelected ? '●' : '○'} {series.label}
                </Text>
              </TouchableOpacity>
            ) : (
              <Text key={series.key} style={styles.seriesLabel}>
                {series.label}
              </Text>
            );
          })}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1e1e1e',
    borderRadius: 16,
    padding: 0,
    margin: 0,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  header: {
    alignItems: 'center',
    marginBottom: 16,
  },
  dataSelectorBelow: {
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  seriesSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    flexWrap: 'wrap',
  },
  seriesLabel: {
    color: '#cccccc',
    fontSize: 14,
    marginRight: 8,
  },
  seriesButton: {
    backgroundColor: '#333',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#444',
    marginRight: 8,
  },
  seriesButtonActive: {
    backgroundColor: '#2196F3',
    borderColor: '#2196F3',
  },
  seriesButtonText: {
    fontSize: 12,
    color: '#cccccc',
    fontWeight: '500',
  },
  seriesButtonTextActive: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
  loadingText: {
    color: '#cccccc',
    fontSize: 14,
    textAlign: 'center',
    padding: 20,
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 14,
    textAlign: 'center',
    padding: 20,
  },
  compactControls: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
  },
  transportBar: {
    flexDirection: 'column',
    gap: 8,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  resetMapGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  playbackGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  miniButton: {
    backgroundColor: '#333',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 2,
  },
  miniButtonActive: {
    backgroundColor: '#2196F3',
  },
  miniText: {
    fontSize: 14,
  },
  playButtonMini: {
    backgroundColor: '#4CAF50',
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  playButtonActive: {
    backgroundColor: '#FF5722',
  },
  playText: {
    fontSize: 16,
  },
  statusGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 8,
  },
  statusText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
    marginHorizontal: 4,
    minWidth: 35,
    textAlign: 'center',
  },
  statusTextReverse: {
    color: '#ff6b6b',
  },
  zoomGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  zoomLevelText: {
    color: '#cccccc',
    fontSize: 12,
    fontWeight: 'bold',
    marginHorizontal: 4,
    minWidth: 20,
    textAlign: 'center',
  },
  trackMapContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  trackMap: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#333',
  },
  trackMapSvg: {
    width: 200,
    height: 150,
  },
  chartContainer: {
    alignItems: 'center',
    overflow: 'hidden',
  },
  simpleChart: {
    flexDirection: 'row',
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 12,
    marginVertical: 4,
    width: width - 8,
    height: 320,
  },
  chartArea: {
    flex: 1,
    position: 'relative',
  },
  gridLines: {
    position: 'absolute',
    width: '100%',
    height: 250,
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#333',
    opacity: 0.3,
  },
  lineChart: {
    position: 'relative',
    width: '100%',
    height: 250,
  },
  svgContainer: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  svgChart: {
    width: '100%',
    height: '100%',
  },
  yAxis: {
    width: 50,
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingRight: 10,
    height: 250,
  },
  yAxisLine: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: '#444',
  },
  yAxisLabel: {
    fontSize: 12,
    color: '#cccccc',
    textAlign: 'right',
  },
  xAxis: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 30,
    borderTopWidth: 1,
    borderTopColor: '#444',
  },
  xAxisNotch: {
    position: 'absolute',
    top: 0,
    width: 2,
    height: 5,
    backgroundColor: '#444',
  },
  xAxisNotchMajor: {
    height: 10,
  },
  xAxisLabel: {
    position: 'absolute',
    top: 10,
    fontSize: 12,
    color: '#cccccc',
    textAlign: 'center',
    width: 40,
  },
  legendSection: {
    marginTop: 16,
    marginBottom: 16,
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    padding: 16,
  },
  legendTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 12,
    textAlign: 'center',
  },
  legendGroup: {
    marginBottom: 16,
  },
  legendGroupTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#cccccc',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  legendItems: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 100,
  },
  legendColorBox: {
    width: 16,
    height: 16,
    borderRadius: 3,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#444',
  },
  legendText: {
    color: '#cccccc',
    fontSize: 12,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  errorOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
});
