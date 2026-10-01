import Svg, {G, Line, Rect, Text as SvgText} from 'react-native-svg';

import {dash, size, stroke, type as typeScale, useTheme} from '@/src/design';

import {type ReadyClassTiming} from '../classTiming';
import {type StopWindow} from '../planCards';

// Spacing of the lap ticks: the first of these that gives at most 8 ticks.
const TICK_STEPS = [5, 10, 20, 25, 50, 100];
const PAD_R = 8;
// A segment narrower than this gets no label inside it.
const LABEL_MIN_W = 22;
const BAND_OPACITY = 0.7;

function tickStep(raceLaps: number): number {
  return TICK_STEPS.find(s => raceLaps / s <= 8) ?? 100;
}

/**
 * The Race timeline (round 6, section 2): his stints and each faster class on
 * one lap axis, his stops as amber dashes through every lane. Each class lane
 * is a band per pass (the range) with a tick at the estimate. Round 7 (3A):
 * each stop is a pit window, an amber box on the stint lane from earliest to
 * latest with the planned stop a solid line inside it and a thin tick where the
 * tank runs out at the median use; the dashed stop line then continues through
 * the class lanes only. Without windows the dashes run through every lane as
 * before. Drawn from finished values; the model owns every number.
 */
export function RaceTimelineView({
  timing,
  windows,
  width,
}: {
  timing: ReadyClassTiming;
  windows: StopWindow[];
  width: number;
}) {
  const {color} = useTheme();
  const axis = typeScale.axis;
  const raceLaps = timing.raceLaps;
  if (raceLaps == null) return null;
  const lanes = timing.faster.flatMap(c =>
    c.estimate ? [{key: c.key, label: c.label, passes: c.estimate.passes}] : [],
  );
  const plotX = size.timelineLabel;
  const plotW = Math.max(1, width - plotX - PAD_R);
  const xOf = (lap: number) =>
    plotX + (Math.min(lap, raceLaps) / raceLaps) * plotW;
  const laneY = (i: number) =>
    size.timelineAxis + i * (size.timelineLane + size.timelineGap);
  const laneCount = 1 + lanes.length;
  const height = laneY(laneCount) - size.timelineGap;
  const step = tickStep(raceLaps);
  const ticks: number[] = [];
  for (let t = 0; t <= raceLaps; t += step) ticks.push(t);
  const bounds = [0, ...timing.stopsAfter, raceLaps];
  return (
    <Svg width={width} height={height}>
      {ticks.map(t => (
        <G key={t}>
          <Line
            x1={xOf(t)}
            x2={xOf(t)}
            y1={size.timelineAxis}
            y2={height}
            stroke={color.line}
            strokeWidth={stroke.grey}
          />
          <SvgText
            x={xOf(t)}
            y={size.timelineAxis - 6}
            textAnchor='middle'
            fill={color.textMuted}
            fontFamily={axis.fontFamily}
            fontSize={axis.fontSize}>
            {t}
          </SvgText>
        </G>
      ))}
      <SvgText
        x={0}
        y={laneY(0) + size.timelineLane / 2 + 3}
        fill={color.textSecondary}
        fontFamily={axis.fontFamily}
        fontSize={axis.fontSize}>
        Stints
      </SvgText>
      {bounds.slice(0, -1).map((from, i) => {
        const x = xOf(from);
        const w = xOf(bounds[i + 1]) - x;
        return (
          <G key={from}>
            <Rect
              x={x}
              y={laneY(0)}
              width={w}
              height={size.timelineLane}
              fill={color.surfaceRaised}
              stroke={color.lineStrong}
              strokeWidth={stroke.grey}
            />
            {w >= LABEL_MIN_W ? (
              <SvgText
                x={x + w / 2}
                y={laneY(0) + size.timelineLane / 2 + 3}
                textAnchor='middle'
                fill={color.text}
                fontFamily={axis.fontFamily}
                fontSize={axis.fontSize}>
                {i + 1}
              </SvgText>
            ) : null}
          </G>
        );
      })}
      {windows.map(w => (
        <G key={`window${w.stop}`}>
          <Rect
            x={xOf(w.earliest)}
            y={laneY(0)}
            width={Math.max(1, xOf(w.latest) - xOf(w.earliest))}
            height={size.timelineLane}
            fill={color.accentTint}
            stroke={color.accent}
            strokeWidth={stroke.grey}
          />
          {w.medianLap != null ? (
            <Line
              x1={xOf(w.medianLap)}
              x2={xOf(w.medianLap)}
              y1={laneY(0)}
              y2={laneY(0) + size.timelineLane}
              stroke={color.textMuted}
              strokeWidth={stroke.grey}
            />
          ) : null}
          <Line
            x1={xOf(w.planLap)}
            x2={xOf(w.planLap)}
            y1={laneY(0)}
            y2={laneY(0) + size.timelineLane}
            stroke={color.accent}
            strokeWidth={stroke.ref}
          />
        </G>
      ))}
      {lanes.map((lane, i) => (
        <G key={lane.key}>
          <SvgText
            x={0}
            y={laneY(i + 1) + size.timelineLane / 2 + 3}
            fill={color.textSecondary}
            fontFamily={axis.fontFamily}
            fontSize={axis.fontSize}>
            {lane.label}
          </SvgText>
          {lane.passes.map(p => (
            <G key={p.centre}>
              <Rect
                x={xOf(p.lo)}
                y={laneY(i + 1)}
                width={Math.max(1, xOf(p.hi) - xOf(p.lo))}
                height={size.timelineLane}
                fill={color.lineStrong}
                fillOpacity={BAND_OPACITY}
              />
              <Line
                x1={xOf(p.centre)}
                x2={xOf(p.centre)}
                y1={laneY(i + 1)}
                y2={laneY(i + 1) + size.timelineLane}
                stroke={color.text}
                strokeWidth={stroke.selected}
              />
            </G>
          ))}
        </G>
      ))}
      {timing.stopsAfter.map(s => (
        <Line
          key={s}
          x1={xOf(s)}
          x2={xOf(s)}
          y1={windows.length > 0 ? laneY(1) : size.timelineAxis}
          y2={height}
          stroke={color.accent}
          strokeWidth={stroke.selected}
          strokeDasharray={dash.pit}
        />
      ))}
    </Svg>
  );
}
