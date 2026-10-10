import {useState} from 'react';
import {StyleSheet, View} from 'react-native';

import {TraceChart, type TraceSeries} from '@/src/charts';
import {screenLateral, toScreenLateral} from '@/src/charts/screenLateral';
import {drawnGear} from './drawnGear';
import {cornerScales, pedalScale, steeringScale} from './scales';
import {lapColors, space, useTheme} from '@/src/design';
import {type TraceLoad} from '@/src/data/traces';
import {Skeleton, StatusBanner, Text, TraceRetryBanner} from '@/src/ui';

import {type CornerModel, type ZoomLine} from './model';
import {type ReadoutChart, readoutsAt} from './readouts';
import {lapsShownText, noBrakeIn} from './traceFacts';

// The Corner screen's zoomed charts. The phone shows speed, brake and
// throttle. The desktop is a complete snapshot of one turn (apex #947): the
// time difference from this turn's entry, speed, brake, throttle, steering
// and the racing line, on one distance axis with one hover cursor, this
// turn's own stretch shaded across all of them.

export type ZoomHeights = {
  speed: number;
  brake: number;
  throttle: number;
  gear: number;
  // Desktop only.
  delta: number;
  steering: number;
  line: number;
};

type LapStyle = (
  onIndex: number | null,
  selIndex: number,
  highlighted: boolean,
) => {color: string; width: number; opacity: number};

// The steering trace is thin: it is context under the pedals (apex #947).
const STEERING_WIDTH = 1.2;

export function ZoomTraces({
  model,
  width,
  heights,
  desktop,
  lapStyle,
  load,
  onRetry,
}: {
  model: CornerModel;
  width: number;
  heights: ZoomHeights;
  desktop: boolean;
  load: TraceLoad;
  onRetry: () => void;
  lapStyle: LapStyle;
}) {
  const {zoom} = model;
  const {color, scheme} = useTheme();
  const [hoverM, setHoverM] = useState<number | null>(null);
  const rank = (l: ZoomLine) =>
    l.onIndex === 0 ? 2 : l.onIndex != null ? 1 : 0;
  const lines = [...zoom.lines].sort((a, b) => rank(a) - rank(b));
  const series = (
    pick: (l: ZoomLine) => Partial<Pick<TraceSeries, 'values' | 'samples'>>,
    widthOf?: (w: number) => number,
  ): TraceSeries[] =>
    lines.map(l => {
      const s = lapStyle(l.onIndex, l.selIndex, l.highlighted);
      return {
        key: l.lapId,
        values: [],
        ...pick(l),
        color: s.color,
        width: widthOf ? widthOf(s.width) : s.width,
        opacity: s.opacity,
      };
    });
  const apex = [
    {m: zoom.apexM, label: 'Apex', solid: true},
    // Neighbouring corners' apexes: faint, named, so their braking in the
    // window is not taken for this turn's.
    ...zoom.neighbours.map(n => ({m: n.apexM, label: `${n.label} apex`})),
  ];
  const shownText = lapsShownText(lines.length, model.rows.length);
  const caption = (
    <View style={styles.gap}>
      {zoom.caption ? (
        <Text variant='dataSmall' tone='textMuted'>
          {zoom.caption}
        </Text>
      ) : null}
      {shownText && (
        <Text variant='dataSmall' tone='textMuted'>
          {shownText}
        </Text>
      )}
    </View>
  );
  const noBrake = noBrakeIn(
    lines.map(l => l.brakePct),
    zoom.windowM,
    zoom.stepM,
  );
  const pointMarks = (at: (l: ZoomLine) => number | null) =>
    lines
      .filter(l => l.key && at(l) != null)
      .map(l => ({
        m: at(l) as number,
        color: lapStyle(l.onIndex, l.selIndex, l.highlighted).color,
      }));
  // The fitted scales read the comparable laps only (see cornerScales).
  const scales = cornerScales(
    lines.map(l => ({
      comparable: l.comparable,
      speedKph: l.speedKph,
      deltaS: l.deltaS,
      trackEdgeM: l.samples.trackEdgeM.values,
    })),
    zoom.windowM,
    zoom.stepM,
  );
  const {speed, delta} = scales;
  const pedal = pedalScale();
  const steering = steeringScale();
  // The road's own half width: its measured edges in the window.
  const lateral = scales.lateral;
  // Gears in the window, integers: the axis runs from the lowest to the
  // highest gear the set used, with a half-step of room either side.
  const gearsShown = lines.flatMap(l => {
    const from = Math.max(0, Math.floor(zoom.windowM[0] / zoom.stepM));
    const to = Math.min(
      l.gear.length - 1,
      Math.ceil(zoom.windowM[1] / zoom.stepM),
    );
    return drawnGear(l.gear.slice(from, to + 1)).filter(Number.isFinite);
  });
  const gearLo = gearsShown.reduce((a, g) => Math.min(a, g), Infinity);
  const gearHi = gearsShown.reduce((a, g) => Math.max(a, g), -Infinity);
  const gearOk = Number.isFinite(gearLo) && Number.isFinite(gearHi);
  const gearDomain: [number, number] = gearOk
    ? [gearLo - 0.5, gearHi + 0.5]
    : [0.5, 7.5];
  const gearTicks = gearOk
    ? Array.from({length: gearHi - gearLo + 1}, (_, i) => gearLo + i).map(
        v => ({
          v,
          label: `${v}`,
        }),
      )
    : [];
  const common = {
    width,
    stepM: zoom.stepM,
    windowM: zoom.windowM,
    cursorM: -1,
    gridOriginM: zoom.apexM,
    stretchM: [zoom.stretch.fromM, zoom.stretch.toM] as [number, number],
    dimM: zoom.dimmed,
    // One pointer for every chart; the desktop only (the phone has no hover).
    ...(desktop ? {hoverM, onHover: setHoverM} : {}),
  };
  // The brake zone is its own band on this chart, in the median colour (the
  // set's median, not one lap's), so it needs no reference lap.
  const brakeBand = zoom.brakeZone
    ? {fromM: zoom.brakeZone[0], toM: zoom.brakeZone[1], color: color.textMuted}
    : undefined;
  const readouts = desktop
    ? readoutsAt(lines, zoom.stepM, hoverM ?? zoom.apexM)
    : null;
  // A chart's label, its unit, and the laps' values at the pointer.
  const header = (chart: ReadoutChart, label: string) => {
    return (
      <>
        <View style={styles.header}>
          <Text variant='label' tone='textMuted'>
            {label}
          </Text>
          {readouts && (
            <View style={styles.readouts}>
              {readouts[chart].map(r => (
                <Text
                  key={r.lapId}
                  variant='dataSmall'
                  style={{color: lapColors[scheme][r.onIndex]}}>
                  {r.label} {r.text}
                </Text>
              ))}
            </View>
          )}
        </View>
      </>
    );
  };

  if (lines.length === 0)
    return (
      <View style={styles.gap}>
        {load.kind === 'failed' && (
          <TraceRetryBanner
            failed={load.failed}
            othersShow={false}
            onRetry={onRetry}
          />
        )}
        {load.kind === 'needsResync' && (
          <StatusBanner
            dot='idle'
            text='Corner traces need this session to be synced again.'
          />
        )}
        {caption}
        {desktop && (
          <>
            <Text variant='label' tone='textMuted'>
              Delta from this turn’s entry, s
            </Text>
            <Skeleton height={heights.delta} />
          </>
        )}
        <Text variant='label' tone='textMuted'>
          Speed km/h
        </Text>
        <Skeleton height={heights.speed} />
        <Text variant='label' tone='textMuted'>
          Brake %
        </Text>
        <Skeleton height={heights.brake} />
        <Text variant='label' tone='textMuted'>
          Throttle %
        </Text>
        <Skeleton height={heights.throttle} />
        {desktop && (
          <>
            <Text variant='label' tone='textMuted'>
              Steering, % of full lock
            </Text>
            <Skeleton height={heights.steering} />
            <Text variant='label' tone='textMuted'>
              Racing line
            </Text>
            <Skeleton height={heights.line} />
          </>
        )}
      </View>
    );

  const lateralAny = lines.some(l => l.samples.pathLateralM.values.length > 0);
  return (
    <View style={styles.gap}>
      {load.kind === 'partial' && (
        <TraceRetryBanner
          failed={load.failed}
          othersShow={load.kind === 'partial'}
          onRetry={onRetry}
        />
      )}
      {caption}
      {desktop && (
        <>
          {header('delta', 'Delta from this turn’s entry, s')}
          <TraceChart
            {...common}
            height={heights.delta}
            domain={[delta.lo, delta.hi]}
            yTicks={delta.ticks}
            series={series(l => ({values: l.deltaS}))}
            zeroLine
            marks={apex}
          />
        </>
      )}
      {header('speed', 'Speed km/h')}
      <TraceChart
        {...common}
        height={heights.speed}
        domain={[speed.lo, speed.hi]}
        yTicks={speed.ticks}
        series={series(l => ({values: l.speedKph}))}
        band={
          zoom.band
            ? {low: zoom.band.speed[0], high: zoom.band.speed[1]}
            : undefined
        }
        marks={apex}
      />
      {header('brake', `Brake %${noBrake ? ' · no brake in this corner' : ''}`)}
      <TraceChart
        {...common}
        height={heights.brake}
        domain={[pedal.lo, pedal.hi]}
        yTicks={pedal.ticks}
        baseBand={brakeBand}
        series={series(l => ({values: l.brakePct}))}
        marks={[...apex, ...pointMarks(l => l.brakeAtM)]}
      />
      {header('throttle', 'Throttle %')}
      <TraceChart
        {...common}
        height={heights.throttle}
        domain={[pedal.lo, pedal.hi]}
        yTicks={pedal.ticks}
        series={series(l => ({values: l.throttlePct}))}
        marks={[...apex, ...pointMarks(l => l.fullThrottleAtM)]}
      />
      {header('gear', 'Gear')}
      <TraceChart
        {...common}
        height={heights.gear}
        domain={gearDomain}
        yTicks={gearTicks}
        series={series(l => ({values: drawnGear(l.gear)})).map(s => ({
          ...s,
          stepped: true,
        }))}
        marks={apex}
      />
      {desktop && (
        <>
          {header('steering', 'Steering, % of full lock')}
          <TraceChart
            {...common}
            height={heights.steering}
            domain={[steering.lo, steering.hi]}
            yTicks={steering.ticks}
            series={series(
              l => ({
                values: l.steeringPct.map(toScreenLateral),
                samples: screenLateral(l.samples.steeringPct),
              }),
              w => Math.min(w, STEERING_WIDTH),
            )}
            zeroLine
            sideLabels={{above: 'L', below: 'R'}}
            marks={apex}
          />
          {header('line', 'Racing line, m from the game’s centre path')}
          {lateralAny ? (
            <TraceChart
              {...common}
              height={heights.line}
              domain={[lateral.lo, lateral.hi]}
              yTicks={lateral.ticks}
              series={[
                ...edgeSeries(zoom.edges, color.textFaint),
                ...series(l => ({
                  samples: screenLateral(l.samples.pathLateralM),
                })),
              ]}
              zeroLine
              sideLabels={{above: 'L', below: 'R'}}
              marks={apex}
            />
          ) : (
            <Text variant='dataSmall' tone='textFaint'>
              No lateral data for these laps yet: it arrives when the session is
              next re-analysed.
            </Text>
          )}
        </>
      )}
    </View>
  );
}

// Faint lines for the edges the laps were seen against, one series per run.
function edgeSeries(
  edges: CornerModel['zoom']['edges'],
  colour: string,
): TraceSeries[] {
  return [
    ...edges.right.map((samples, i) => ({key: `edge-r${i}`, samples})),
    ...edges.left.map((samples, i) => ({key: `edge-l${i}`, samples})),
  ].map(e => ({
    key: e.key,
    values: [],
    samples: screenLateral(e.samples),
    color: colour,
    width: 1,
    opacity: 0.6,
  }));
}

const styles = StyleSheet.create({
  gap: {gap: space.xs},
  header: {flexDirection: 'row', alignItems: 'baseline', gap: space.lg},
  readouts: {flexDirection: 'row', flexWrap: 'wrap', gap: space.md},
});
