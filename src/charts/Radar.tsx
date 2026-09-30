import Svg, {G, Line, Path, Rect, Text as SvgText} from 'react-native-svg';

import {
  CAR_WIDTH_M,
  PLAYER_LENGTH_M,
  type Radar as RadarData,
  type RadarClass,
} from '@/src/analysis/radar';
import {dash, type as typeScale, useTheme} from '@/src/design';

// Cars around you (round 3 R2): heading-up, centred on the player, every car
// to scale at its true position and heading. Pure props: the caller says which
// 5 Hz update (`sampleLabel`) and how far the radar reaches.

const TICK_STEP_M = 10;
const SIDE_BAR_W = 4;
const SIDE_BAR_FRAC = 0.3;

export function Radar({
  width,
  height,
  rangeM,
  radar,
  sampleLabel,
  inset,
}: {
  width: number;
  height: number;
  /** Metres shown ahead of and behind the player. */
  rangeM: number;
  /** Null draws the empty frame (no field data, or no heading to rotate by). */
  radar: RadarData | null;
  /** The 5 Hz sample time, printed bottom right ("21:23.4"). */
  sampleLabel?: string;
  /** Drawn over a map: a translucent background instead of the surface. */
  inset?: boolean;
}) {
  const {color, lapColors} = useTheme();
  const pxPerM = height / (2 * rangeM);
  const cx = width / 2;
  const cy = height / 2;
  const classColor: Record<RadarClass, string> = {
    hypercar: color.classHypercar,
    lmp2: color.classLmp2,
    gt3: color.classGt3,
  };
  const ticks: number[] = [];
  for (let m = TICK_STEP_M; m <= rangeM; m += TICK_STEP_M) ticks.push(m);
  const axis = typeScale.axis;
  const barH = height * SIDE_BAR_FRAC;
  const ownW = CAR_WIDTH_M * pxPerM;
  const ownL = PLAYER_LENGTH_M * pxPerM;

  return (
    <Svg width={width} height={height}>
      <Rect
        x={0.5}
        y={0.5}
        width={width - 1}
        height={height - 1}
        rx={3}
        fill={inset ? color.radarInset : color.surface}
        stroke={color.lineStrong}
      />
      {ticks.flatMap(m =>
        [-1, 1].map(sign => {
          const y = cy - sign * m * pxPerM;
          return (
            <G key={`t${sign * m}`}>
              <Line
                x1={0}
                x2={width}
                y1={y}
                y2={y}
                stroke={color.grid}
                strokeWidth={1}
              />
              <Line x1={0} x2={4} y1={y} y2={y} stroke={color.median} />
              <Line
                x1={width - 4}
                x2={width}
                y1={y}
                y2={y}
                stroke={color.median}
              />
              {sign === 1 && (
                <SvgText
                  x={6}
                  y={y - 2}
                  fill={color.textFaint}
                  fontFamily={axis.fontFamily}
                  fontSize={9}>
                  {m}
                </SvgText>
              )}
            </G>
          );
        }),
      )}
      <Line
        x1={cx}
        x2={cx}
        y1={0}
        y2={height}
        stroke={color.median}
        strokeDasharray={dash.mark}
      />
      {radar?.cars.map(c => {
        const w = c.widthM * pxPerM;
        const l = c.lengthM * pxPerM;
        // Screen y grows downwards: ahead is up.
        const x = cx + c.sideM * pxPerM;
        const y = cy - c.forwardM * pxPerM;
        return (
          <Rect
            key={c.index}
            x={-w / 2}
            y={-l / 2}
            width={w}
            height={l}
            rx={Math.min(2, w / 2)}
            fill={classColor[c.cls]}
            opacity={c.opacity}
            transform={`translate(${x} ${y}) rotate(${
              (c.relYawRad * 180) / Math.PI
            })`}
          />
        );
      })}
      {radar?.leftLit && (
        <Rect
          x={0}
          y={cy - barH / 2}
          width={SIDE_BAR_W}
          height={barH}
          fill={color.text}
        />
      )}
      {radar?.rightLit && (
        <Rect
          x={width - SIDE_BAR_W}
          y={cy - barH / 2}
          width={SIDE_BAR_W}
          height={barH}
          fill={color.text}
        />
      )}
      <Rect
        x={cx - ownW / 2}
        y={cy - ownL / 2}
        width={ownW}
        height={ownL}
        rx={1.5}
        fill={lapColors[0]}
      />
      <Path
        d={`M${cx - ownW / 2},${cy - ownL / 2 + ownL * 0.3}L${cx},${
          cy - ownL / 2
        }L${cx + ownW / 2},${cy - ownL / 2 + ownL * 0.3}`}
        fill='none'
        stroke={color.bg}
        strokeWidth={1}
      />
      {sampleLabel && (
        <SvgText
          x={width - 5}
          y={height - 5}
          textAnchor='end'
          fill={color.textFaint}
          fontFamily={axis.fontFamily}
          fontSize={9}>
          {sampleLabel}
        </SvgText>
      )}
    </Svg>
  );
}
