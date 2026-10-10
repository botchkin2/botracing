import {useEffect, useRef, useState} from 'react';
import {PanResponder, StyleSheet, View, type ViewStyle} from 'react-native';
import Svg, {G, Line, Polygon, Rect, Text as SvgText} from 'react-native-svg';

import type {RaceLanes as RaceLanesModel, Span} from '@/src/analysis/raceLanes';
import {stroke, type as typeScale, useTheme} from '@/src/design';

import {laneScrubber, lanesLayout} from './raceLanesLayout';

// The YOUR RACE lanes (handoff round 3 §R1a/R1b): six lanes over the race,
// lap gridlines with labels, the playhead. Props in, SVG out: the window, the
// playhead and the clock belong to the Race screen, which also draws the zoom
// control and the window's start and end times.

const AXIS_H = 12;

export function RaceLanes({
  lanes,
  window,
  playheadS,
  width,
  laneHeight,
  labelWidth,
  lapLabelEvery,
  onScrub,
  compact = false,
}: {
  lanes: RaceLanesModel;
  window: Span;
  playheadS: number;
  /** Total width, label column included. */
  width: number;
  /** 9 on the phone, 12 on the desktop workspace. */
  laneHeight: number;
  /** 44 on the phone, 56 on the desktop. */
  labelWidth: number;
  lapLabelEvery: number;
  /** Called with the race time under the finger, while dragging. */
  onScrub: (timeS: number) => void;
  /** One thin strip for the phone's transport: no row labels, no lap labels, no axis row. */
  compact?: boolean;
}) {
  const {color} = useTheme();
  const laneWidth = Math.max(1, width - labelWidth);
  const layout = lanesLayout({
    lanes,
    window,
    laneWidth,
    laneHeight,
    lapLabelEvery,
  });
  const height = layout.height;
  const axisH = compact ? 0 : AXIS_H;
  const axis = {...typeScale.axis, fontSize: 9};

  // PanResponder reads its handlers once; keep the latest inputs in a ref.
  const latest = useRef({window, laneWidth, labelWidth, onScrub});
  useEffect(() => {
    latest.current = {window, laneWidth, labelWidth, onScrub};
  });
  // The ref is read only inside gesture callbacks, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() => {
    const scrub = laneScrubber(() => latest.current);
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: e => scrub.start(e.nativeEvent.locationX),
      onPanResponderMove: e => scrub.move(e.nativeEvent.locationX),
      onPanResponderRelease: scrub.end,
      onPanResponderTerminate: scrub.end,
    });
  });

  const playheadX =
    playheadS >= window.fromS && playheadS <= window.toS
      ? labelWidth +
        ((playheadS - window.fromS) / (window.toS - window.fromS)) * laneWidth
      : null;
  const mark = laneHeight - 3;

  return (
    <View
      {...responder.panHandlers}
      // Web: a mouse drag scrubs; without this it also selects the labels.
      style={[styles.noSelect, {width, height: height + axisH}]}>
      <Svg width={width} height={height + axisH} pointerEvents='none'>
        <Rect
          x={labelWidth}
          y={0}
          width={laneWidth}
          height={height}
          fill={color.surface}
        />
        {layout.lapLines.map((l, i) => (
          <G key={`lap-${i}`}>
            <Line
              x1={labelWidth + l.x}
              x2={labelWidth + l.x}
              y1={0}
              y2={height}
              stroke={color.grid}
              strokeWidth={1}
            />
            {l.label && !compact && (
              <SvgText
                x={labelWidth + l.x}
                y={height + AXIS_H - 2}
                textAnchor='middle'
                fill={color.textFaint}
                fontFamily={axis.fontFamily}
                fontSize={axis.fontSize}>
                {l.label}
              </SvgText>
            )}
          </G>
        ))}
        {layout.rows.map(row => (
          <G key={row.key}>
            {!compact && (
              <SvgText
                x={0}
                y={row.y + laneHeight - 2}
                fill={color.textMuted}
                fontFamily={axis.fontFamily}
                fontSize={axis.fontSize}>
                {row.label}
              </SvgText>
            )}
            {row.spans.map((s, i) => (
              <Rect
                key={`s-${i}`}
                x={labelWidth + s.x}
                y={row.y + 1.5}
                width={s.w}
                height={laneHeight - 3}
                fill={spanColor(row.key, color)}
              />
            ))}
            {row.ticks.map((x, i) => (
              <Line
                key={`t-${i}`}
                x1={labelWidth + x}
                x2={labelWidth + x}
                y1={row.y + 1}
                y2={row.y + laneHeight - 1}
                stroke={color.textSecondary}
                strokeWidth={1.5}
              />
            ))}
            {row.marks.map((m, i) => {
              const cx = labelWidth + m.x;
              const top = row.y + 1.5;
              // Up for a place made, down for one lost.
              const points = m.made
                ? `${cx - mark / 2},${top + mark} ${cx + mark / 2},${
                    top + mark
                  } ${cx},${top}`
                : `${cx - mark / 2},${top} ${cx + mark / 2},${top} ${cx},${
                    top + mark
                  }`;
              return (
                <Polygon
                  key={`p-${i}`}
                  points={points}
                  fill={m.made ? color.text : color.textMuted}
                />
              );
            })}
          </G>
        ))}
        {playheadX != null && (
          <Line
            x1={playheadX}
            x2={playheadX}
            y1={0}
            y2={height}
            stroke={color.accent}
            strokeWidth={stroke.cursor * 2}
          />
        )}
      </Svg>
    </View>
  );
}

// PIT is the pit amber, OFF the off-track red, a tow the text colour (white on dark), a battle grey.
function spanColor(
  key: string,
  color: ReturnType<typeof useTheme>['color'],
): string {
  if (key === 'pit') return color.accent;
  if (key === 'off') return color.offTrack;
  if (key === 'tow') return color.text;
  return color.textMuted;
}

const styles = StyleSheet.create({
  noSelect: {userSelect: 'none'} as ViewStyle,
});
