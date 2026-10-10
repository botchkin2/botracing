import {useState} from 'react';
import {StyleSheet, View} from 'react-native';

import {TraceChart, type TraceSeries} from '@/src/charts';
import {screenLateral, toScreenLateral} from '@/src/charts/screenLateral';
import {drawnGear} from './drawnGear';
import {lapColor, space, useTheme} from '@/src/design';
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
  const speedDomain = domainIn(
    lines.map(l => l.speedKph),
    zoom.windowM,
    zoom.stepM,
  );
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
                  style={{color: lapColor(scheme, r.onIndex)}}>
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
            domain={deltaDomain(lines, zoom.windowM, zoom.stepM)}
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
        domain={speedDomain}
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
        domain={[-4, 104]}
        baseBand={brakeBand}
        series={series(l => ({values: l.brakePct}))}
        marks={[...apex, ...pointMarks(l => l.brakeAtM)]}
      />
      {header('throttle', 'Throttle %')}
      <TraceChart
        {...common}
        height={heights.throttle}
        domain={[-4, 104]}
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
            domain={symmetricDomain(
              lines.map(l => l.samples.steeringPct.values),
              10,
            )}
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
              domain={symmetricDomain(
                [
                  ...lines.map(l => l.samples.pathLateralM.values),
                  ...lines.map(l => l.samples.trackEdgeM.values),
                ],
                2,
              )}
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

// A range centred on 0 that holds every value, rounded up to `unit`.
function symmetricDomain(arrays: number[][], unit: number): [number, number] {
  let m = 0;
  for (const a of arrays)
    for (const v of a) if (Number.isFinite(v)) m = Math.max(m, Math.abs(v));
  const top = Math.max(unit, Math.ceil(m / unit) * unit);
  return [-top, top];
}

function deltaDomain(
  lines: ZoomLine[],
  window: [number, number],
  stepM: number,
): [number, number] {
  const [lo, hi] = domainIn(
    lines.map(l => l.deltaS),
    window,
    stepM,
  );
  // Always show the zero line, and never squeeze a flat delta to nothing.
  const top = Math.max(hi, 0.05);
  const bottom = Math.min(lo, -0.05);
  return [bottom, top];
}

function domainIn(
  arrays: number[][],
  [a, b]: [number, number],
  stepM: number,
): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  const from = Math.max(0, Math.floor(a / stepM));
  const to = Math.ceil(b / stepM);
  for (const arr of arrays)
    for (let i = from; i <= Math.min(to, arr.length - 1); i++) {
      if (!Number.isFinite(arr[i])) continue;
      lo = Math.min(lo, arr[i]);
      hi = Math.max(hi, arr[i]);
    }
  if (!Number.isFinite(lo)) return [0, 1];
  const pad = (hi - lo) * 0.06 || 1;
  return [lo - pad, hi + pad];
}

const styles = StyleSheet.create({
  gap: {gap: space.xs},
  header: {flexDirection: 'row', alignItems: 'baseline', gap: space.lg},
  readouts: {flexDirection: 'row', flexWrap: 'wrap', gap: space.md},
});
