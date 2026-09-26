import {BottomNavigation, ScreenContainer} from '@src/components';
import {RacingTheme} from '@src/theme';
import React, {useEffect, useMemo, useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, {Circle, Line, Path} from 'react-native-svg';
import stint from '../sample_data/lmu/stint.json';

type LapTrace = {
  id: string;
  lapNumber: number;
  durationSec: number;
  gameLapTime: number | null;
  partial: boolean;
  inPit: boolean;
  leftAsphalt: boolean;
  gameDidNotTime: boolean;
  distanceM: number;
  speed: number[];
  throttle: number[];
  brake: number[];
  steer: number[];
  rpm: number[];
  gear: number[];
  lat: number[];
  lon: number[];
  off?: number[];
  edge?: number[];
  from?: {
    recordingTime: string;
    gameLapTime: number | null;
  };
};

type SeriesKey = 'speed' | 'throttle' | 'brake' | 'steer' | 'rpm' | 'gear';

const SERIES: {key: SeriesKey; label: string; unit: string}[] = [
  {key: 'speed', label: 'Speed', unit: 'km/h'},
  {key: 'throttle', label: 'Throttle', unit: '0-1'},
  {key: 'brake', label: 'Brake', unit: '0-1'},
  {key: 'steer', label: 'Steer', unit: '% lock'},
  {key: 'rpm', label: 'RPM', unit: 'rpm'},
  {key: 'gear', label: 'Gear', unit: ''},
];

const LAP_COLORS = [
  '#00d4ff',
  '#00ff88',
  '#ff9500',
  '#ff073a',
  '#c084fc',
  '#f472b6',
  '#facc15',
  '#38bdf8',
];

const STRIDES = [1, 2, 4, 8];

const laps = stint.laps as LapTrace[];
const reference = (stint as {reference?: LapTrace}).reference;

function formatSeconds(seconds: number | null): string {
  if (seconds == null) return 'untimed';
  const minutes = Math.floor(seconds / 60);
  const rest = (seconds - minutes * 60).toFixed(3).padStart(6, '0');
  return `${minutes}:${rest}`;
}

function tagsFor(lap: LapTrace): string {
  return [
    lap.partial ? 'partial' : '',
    lap.inPit ? 'pit' : '',
    lap.leftAsphalt ? 'off asphalt' : '',
    lap.gameDidNotTime ? 'untimed' : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function colorFor(id: string): string {
  if (reference && id === reference.id) return '#ffffff';
  const index = laps.findIndex(lap => lap.id === id);
  return LAP_COLORS[(index < 0 ? 0 : index) % LAP_COLORS.length];
}

function elapsedSeconds(lap: LapTrace): number[] {
  const count = lap.speed.length;
  const step = (lap.distanceM > 1 ? lap.distanceM : 1) / Math.max(1, count - 1);
  const times = new Array<number>(count);
  times[0] = 0;
  for (let i = 1; i < count; i++) {
    const metersPerSecond = Math.max(lap.speed[i - 1], 8) / 3.6;
    times[i] = times[i - 1] + step / metersPerSecond;
  }
  return times;
}

function flagSpans(
  flags: number[] | undefined,
  stride: number,
): Array<[number, number]> {
  if (!flags || flags.length === 0) return [];
  const spans: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i < flags.length; i += stride) {
    if (flags[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      spans.push([start, i]);
      start = -1;
    }
  }
  if (start >= 0) spans.push([start, flags.length - 1]);
  return spans;
}

function linePath(
  values: number[],
  stride: number,
  width: number,
  height: number,
  min: number,
  max: number,
): string {
  const span = max - min || 1;
  const last = values.length - 1;
  let d = '';
  for (let i = 0; i <= last; i += stride) {
    const x = (i / last) * width;
    const y = height - ((values[i] - min) / span) * (height - 4) - 2;
    d += `${d ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return d;
}

const LmuTryScreen: React.FC = () => {
  const {width} = useWindowDimensions();
  const chartWidth = Math.max(280, width - 32);
  const [stride, setStride] = useState(2);
  const [seriesOn, setSeriesOn] = useState<Set<SeriesKey>>(
    () => new Set(['speed', 'throttle', 'brake']),
  );
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playRate, setPlayRate] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(() => {
    const initial = new Set(
      laps
        .filter(lap => lap.gameLapTime != null && !lap.partial)
        .map(lap => lap.id),
    );
    if (reference) initial.add(reference.id);
    return initial;
  });

  const drawn = Math.ceil(stint.points / stride);
  const selectedLaps = useMemo(() => {
    const chosen = laps.filter(lap => selected.has(lap.id));
    if (reference && selected.has(reference.id)) chosen.push(reference);
    return chosen;
  }, [selected]);

  const baseline = useMemo(() => {
    const timed = selectedLaps.filter(
      lap => lap.gameLapTime != null && !lap.partial,
    );
    const pool = timed.length > 0 ? timed : selectedLaps;
    if (pool.length === 0) return undefined;
    return pool.reduce((best, lap) =>
      (lap.gameLapTime ?? lap.durationSec) <
      (best.gameLapTime ?? best.durationSec)
        ? lap
        : best,
    );
  }, [selectedLaps]);

  const elapsed = useMemo(() => {
    const byId = new Map<string, number[]>();
    for (const lap of selectedLaps) byId.set(lap.id, elapsedSeconds(lap));
    return byId;
  }, [selectedLaps]);

  useEffect(() => {
    if (!playing || !baseline) return;
    const lapMs = (baseline.durationSec || 80) * 1000;
    const tick = Math.max(16, lapMs / stint.points / playRate);
    const timer = setInterval(() => {
      setCursor(current => {
        if (current >= stint.points - 1) {
          setPlaying(false);
          return stint.points - 1;
        }
        return current + 1;
      });
    }, tick);
    return () => clearInterval(timer);
  }, [baseline, playRate, playing]);

  const charts = useMemo(() => {
    return SERIES.filter(series => seriesOn.has(series.key)).map(series => {
      let min = Infinity;
      let max = -Infinity;
      for (const lap of selectedLaps) {
        const values = lap[series.key];
        for (let i = 0; i < values.length; i += stride) {
          const value = values[i];
          if (value < min) min = value;
          if (value > max) max = value;
        }
      }
      if (!Number.isFinite(min)) {
        min = 0;
        max = 1;
      }
      const paths = selectedLaps.map(lap => ({
        id: lap.id,
        color: colorFor(lap.id),
        d: linePath(lap[series.key], stride, chartWidth, 160, min, max),
        dashed: reference != null && lap.id === reference.id,
      }));
      return {series, min, max, paths};
    });
  }, [chartWidth, selectedLaps, seriesOn, stride]);

  const map = useMemo(() => {
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    for (const lap of selectedLaps) {
      for (let i = 0; i < lap.lat.length; i += stride) {
        if (lap.lat[i] < minLat) minLat = lap.lat[i];
        if (lap.lat[i] > maxLat) maxLat = lap.lat[i];
        if (lap.lon[i] < minLon) minLon = lap.lon[i];
        if (lap.lon[i] > maxLon) maxLon = lap.lon[i];
      }
    }
    const latSpan = maxLat - minLat || 1;
    const lonSpan = maxLon - minLon || 1;
    const height = 180;
    const project = (lat: number, lon: number) => ({
      x: ((lon - minLon) / lonSpan) * chartWidth,
      y: height - ((lat - minLat) / latSpan) * height,
    });
    const paths = selectedLaps.map(lap => {
      let d = '';
      for (let i = 0; i < lap.lat.length; i += stride) {
        const x = ((lap.lon[i] - minLon) / lonSpan) * chartWidth;
        const y = height - ((lap.lat[i] - minLat) / latSpan) * height;
        d += `${d ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)} `;
      }
      return {
        id: lap.id,
        d,
        color: colorFor(lap.id),
        dashed: reference != null && lap.id === reference.id,
      };
    });
    return {height, paths, project};
  }, [chartWidth, selectedLaps, stride]);

  const delta = useMemo(() => {
    const baseTimes = baseline ? elapsed.get(baseline.id) : undefined;
    if (!baseTimes) return null;
    let min = 0;
    let max = 0;
    const paths = selectedLaps
      .filter(lap => lap.id !== baseline.id)
      .map(lap => {
        const times = elapsed.get(lap.id) ?? [];
        const values = times.map(
          (time, index) => time - (baseTimes[index] ?? 0),
        );
        for (let i = 0; i < values.length; i += stride) {
          if (values[i] < min) min = values[i];
          if (values[i] > max) max = values[i];
        }
        return {
          id: lap.id,
          color: colorFor(lap.id),
          values,
          dashed: reference != null && lap.id === reference.id,
        };
      });
    const pad = Math.max(0.05, Math.max(Math.abs(min), Math.abs(max)));
    return {
      min: -pad,
      max: pad,
      paths: paths.map(path => ({
        ...path,
        d: linePath(path.values, stride, chartWidth, 140, -pad, pad),
      })),
    };
  }, [baseline, chartWidth, elapsed, selectedLaps, stride]);

  const cursorX =
    stint.points <= 1 ? 0 : (cursor / (stint.points - 1)) * chartWidth;

  const spread = useMemo(() => {
    const times = selectedLaps
      .map(lap => lap.gameLapTime)
      .filter((time): time is number => time != null && time > 0);
    if (times.length < 2) return null;
    return Math.max(...times) - Math.min(...times);
  }, [selectedLaps]);

  const scrubTo = (x: number) => {
    const index = Math.round((x / chartWidth) * (stint.points - 1));
    setCursor(Math.max(0, Math.min(stint.points - 1, index)));
    setPlaying(false);
  };

  const toggleLap = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSeries = (key: SeriesKey) => {
    setSeriesOn(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <ScreenContainer style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{stint.track}</Text>
        <Text style={styles.sub}>
          {stint.car} · {stint.sessionType} · {stint.recordingTime}
        </Text>
        <Text style={styles.meta}>
          {laps.length} laps stored at {stint.points} points
          {reference
            ? ` · reference ${formatSeconds(reference.gameLapTime)} from ${
                reference.from?.recordingTime
              }`
            : ''}
          . Drawing {selectedLaps.length} traces at {drawn} points.
          {spread != null
            ? ` Timed laps in view cover ${spread.toFixed(3)}s.`
            : ''}
        </Text>

        <View style={styles.playRow}>
          <TouchableOpacity
            style={[styles.chip, playing && styles.chipOn]}
            onPress={() => {
              if (cursor >= stint.points - 1) setCursor(0);
              setPlaying(value => !value);
            }}>
            <Text style={styles.chipText}>{playing ? 'Pause' : 'Play'}</Text>
          </TouchableOpacity>
          {[1, 4].map(rate => (
            <TouchableOpacity
              key={rate}
              style={[styles.chip, playRate === rate && styles.chipOn]}
              onPress={() => setPlayRate(rate)}>
              <Text style={styles.chipText}>{rate}x</Text>
            </TouchableOpacity>
          ))}
          <Text style={styles.meta}>
            {baseline
              ? `${Math.round(
                  (cursor / Math.max(1, stint.points - 1)) * 100,
                )}% along the lap`
              : 'Pick a lap'}
          </Text>
        </View>
        <View
          style={styles.scrub}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={event => scrubTo(event.nativeEvent.locationX)}
          onResponderMove={event => scrubTo(event.nativeEvent.locationX)}>
          <View style={styles.scrubTrack} />
          <View style={[styles.scrubKnob, {left: Math.max(0, cursorX - 7)}]} />
        </View>
        {selectedLaps.map(lap => (
          <Text
            key={lap.id}
            style={[styles.readout, {color: colorFor(lap.id)}]}>
            L{lap.lapNumber} {lap.speed[cursor]?.toFixed(0)} km/h · thr{' '}
            {lap.throttle[cursor]?.toFixed(2)} · brk{' '}
            {lap.brake[cursor]?.toFixed(2)} · g{lap.gear[cursor]}
            {lap.off?.[cursor] ? ' · off asphalt' : ''}
            {lap.edge?.[cursor] ? ' · past edge' : ''}
            {baseline && lap.id !== baseline.id
              ? ` · ${(
                  (elapsed.get(lap.id)?.[cursor] ?? 0) -
                  (elapsed.get(baseline.id)?.[cursor] ?? 0)
                ).toFixed(2)}s`
              : baseline && lap.id === baseline.id
              ? ' · baseline'
              : ''}
          </Text>
        ))}

        <Text style={styles.section}>Detail</Text>
        <View style={styles.row}>
          {STRIDES.map(value => (
            <TouchableOpacity
              key={value}
              style={[styles.chip, stride === value && styles.chipOn]}
              onPress={() => setStride(value)}>
              <Text style={styles.chipText}>
                {Math.ceil(stint.points / value)} pts
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.section}>Channels</Text>
        <View style={styles.row}>
          {SERIES.map(series => (
            <TouchableOpacity
              key={series.key}
              style={[styles.chip, seriesOn.has(series.key) && styles.chipOn]}
              onPress={() => toggleSeries(series.key)}>
              <Text style={styles.chipText}>{series.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.section}>Laps</Text>
        <View style={styles.row}>
          {laps.map((lap, index) => {
            const on = selected.has(lap.id);
            const tag = tagsFor(lap);
            return (
              <TouchableOpacity
                key={lap.id}
                style={[
                  styles.lapChip,
                  {borderColor: LAP_COLORS[index % LAP_COLORS.length]},
                  on && styles.chipOn,
                ]}
                onPress={() => toggleLap(lap.id)}>
                <Text style={styles.chipText}>
                  L{lap.lapNumber}{' '}
                  {formatSeconds(lap.gameLapTime ?? lap.durationSec)}
                  {lap.id === stint.bestLapId ? ' best' : ''}
                </Text>
                {tag ? <Text style={styles.tag}>{tag}</Text> : null}
              </TouchableOpacity>
            );
          })}
          {reference ? (
            <TouchableOpacity
              style={[
                styles.lapChip,
                {borderColor: '#ffffff'},
                selected.has(reference.id) && styles.chipOn,
              ]}
              onPress={() => toggleLap(reference.id)}>
              <Text style={styles.chipText}>
                Other session {formatSeconds(reference.gameLapTime)}
              </Text>
              <Text style={styles.tag}>pinned reference</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <Text style={styles.section}>Line</Text>
        <Svg width={chartWidth} height={map.height}>
          {map.paths.map(path => (
            <Path
              key={path.id}
              d={path.d}
              stroke={path.color}
              strokeWidth={path.dashed ? 2.5 : 1.5}
              strokeDasharray={path.dashed ? '5 4' : undefined}
              fill='none'
            />
          ))}
          {selectedLaps.map(lap =>
            (lap.off ?? []).map((flag, index) => {
              if (!flag || index % stride !== 0) return null;
              const point = map.project(lap.lat[index], lap.lon[index]);
              return (
                <Circle
                  key={`${lap.id}-off-${index}`}
                  cx={point.x}
                  cy={point.y}
                  r={3}
                  fill='#ff073a'
                />
              );
            }),
          )}
          <Line
            x1={cursorX}
            x2={cursorX}
            y1={0}
            y2={map.height}
            stroke='#ffffff'
            strokeWidth={1}
          />
        </Svg>

        {delta && baseline ? (
          <View style={styles.chartBlock}>
            <Text style={styles.section}>
              Delta vs L{baseline.lapNumber}{' '}
              <Text style={styles.meta}>
                seconds lost along the lap. Above the middle is slower.
              </Text>
            </Text>
            <Svg width={chartWidth} height={140}>
              <Line
                x1={0}
                x2={chartWidth}
                y1={70}
                y2={70}
                stroke='#404040'
                strokeWidth={1}
              />
              {delta.paths.map(path => (
                <Path
                  key={path.id}
                  d={path.d}
                  stroke={path.color}
                  strokeWidth={path.dashed ? 2.5 : 1.5}
                  strokeDasharray={path.dashed ? '5 4' : undefined}
                  fill='none'
                />
              ))}
              <Line
                x1={cursorX}
                x2={cursorX}
                y1={0}
                y2={140}
                stroke='#ffffff'
                strokeWidth={1}
              />
            </Svg>
          </View>
        ) : null}

        {charts.map(chart => (
          <View key={chart.series.key} style={styles.chartBlock}>
            <Text style={styles.section}>
              {chart.series.label}{' '}
              <Text style={styles.meta}>
                {chart.min.toFixed(chart.series.key === 'rpm' ? 0 : 1)} –{' '}
                {chart.max.toFixed(chart.series.key === 'rpm' ? 0 : 1)}{' '}
                {chart.series.unit}
              </Text>
            </Text>
            <Svg width={chartWidth} height={160}>
              {chart.series.key === 'speed'
                ? selectedLaps.flatMap(lap =>
                    flagSpans(lap.off, stride).map(([start, end]) => {
                      const x1 = (start / (stint.points - 1)) * chartWidth;
                      const x2 = (end / (stint.points - 1)) * chartWidth;
                      return (
                        <Line
                          key={`${lap.id}-band-${start}`}
                          x1={x1}
                          x2={Math.max(x2, x1 + 2)}
                          y1={156}
                          y2={156}
                          stroke='#ff073a'
                          strokeWidth={4}
                        />
                      );
                    }),
                  )
                : null}
              {chart.paths.map(path => (
                <Path
                  key={path.id}
                  d={path.d}
                  stroke={path.color}
                  strokeWidth={path.dashed ? 2.5 : 1.5}
                  strokeDasharray={path.dashed ? '5 4' : undefined}
                  fill='none'
                />
              ))}
              <Line
                x1={cursorX}
                x2={cursorX}
                y1={0}
                y2={160}
                stroke='#ffffff'
                strokeWidth={1}
              />
            </Svg>
          </View>
        ))}
      </ScrollView>
      <BottomNavigation currentScreen='lmu-try' />
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: RacingTheme.colors.background,
  },
  content: {
    padding: 16,
    paddingBottom: 120,
  },
  title: {
    color: RacingTheme.colors.text,
    fontSize: 22,
    fontWeight: '700',
  },
  sub: {
    color: RacingTheme.colors.textSecondary,
    marginTop: 4,
  },
  meta: {
    color: RacingTheme.colors.textTertiary,
    marginTop: 8,
    fontSize: 13,
  },
  section: {
    color: RacingTheme.colors.text,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: RacingTheme.colors.surfaceElevated,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: RacingTheme.colors.surface,
  },
  lapChip: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: RacingTheme.colors.surface,
  },
  chipOn: {
    backgroundColor: RacingTheme.colors.surfaceElevated,
  },
  chipText: {
    color: RacingTheme.colors.text,
    fontVariant: ['tabular-nums'],
  },
  tag: {
    color: RacingTheme.colors.textTertiary,
    fontSize: 11,
    marginTop: 2,
  },
  chartBlock: {
    marginTop: 4,
  },
  playRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  scrub: {
    height: 28,
    justifyContent: 'center',
    marginTop: 4,
  },
  scrubTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: RacingTheme.colors.surfaceElevated,
  },
  scrubKnob: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#ffffff',
  },
  readout: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
});

export default LmuTryScreen;
