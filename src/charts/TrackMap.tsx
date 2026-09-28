import {useMemo} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import Svg, {Circle, Line, Path, Text as SvgText} from 'react-native-svg';

import {keepClear} from '@/src/analysis/labelPlace';
import {
  nearestVertexDistance,
  offsetFromLine,
  signedArea2,
} from '@/src/analysis/loopSide';
import {fonts, useTheme} from '@/src/design';

// Track map (handoff v2 M1a): the OSM band with edges and the pit lane when
// the track has a good fit, else the driven line as a plain band; each lap's
// line; section boundary ticks, S labels inside the loop and corner numbers
// outside; a dot per lap at the cursor. Inputs are metres east/north; this
// fits them to the box, north up.

export type MapPoint = {x: number; y: number};

export type MapLine = {
  key: string;
  points: MapPoint[];
  color: string;
  width: number;
  opacity: number;
};

export type MapDot = {key: string; at: MapPoint; color: string};

/** A point on the reference line and its neighbours, for the band normal. */
export type MapAnchor = {at: MapPoint; prev: MapPoint; next: MapPoint};

export type MapMarks = {
  boundaries: MapAnchor[];
  sections: {n: number; anchor: MapAnchor}[];
  corners: {n: number; anchor: MapAnchor}[];
};

const PAD = 14;
// Widths and offsets in points, from the v2 M1a frame.
const BAND_EDGE_W = 10;
const BAND_FILL_W = 7.5;
const PIT_EDGE_W = 4.5;
const PIT_FILL_W = 2.5;
const DRIVEN_W = 6;
const TICK_HALF = 7;
const TICK_W = 1.3;
const SECTION_OFFSET = 17;
const CORNER_OFFSET = 10.5;
const PIT_LABEL_OFFSET = 11;
const HIT = 44;
// Mono glyph advance ≈ 0.62 em, for label boxes.
const MONO_EM = 0.62;
const SECTION_FONT = 10;
const CORNER_FONT = 8.5;

export function TrackMap({
  width,
  height,
  outline,
  pitLane,
  lines,
  dots,
  marks,
  openSection,
  onPressSection,
}: {
  width: number;
  height: number;
  /** Real track outline (OSM); empty when the fit is not good enough. */
  outline: MapPoint[][];
  pitLane: MapPoint[][];
  /** Drawn in order, reference last: it is also the band with no outline. */
  lines: MapLine[];
  dots: MapDot[];
  marks: MapMarks;
  openSection: number | null;
  onPressSection: (n: number) => void;
}) {
  const {color} = useTheme();

  // Fit to the laps (not the outline, which includes other layouts), north up.
  const fit = useMemo(() => {
    const all = lines.flatMap(l => l.points);
    if (all.length === 0) return null;
    const xs = all.map(p => p.x);
    const ys = all.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const scale = Math.min(
      (width - 2 * PAD) / (maxX - minX || 1),
      (height - 2 * PAD) / (maxY - minY || 1),
    );
    const offX = (width - (maxX - minX) * scale) / 2;
    const offY = (height - (maxY - minY) * scale) / 2;
    return (p: MapPoint) => ({
      x: offX + (p.x - minX) * scale,
      y: height - (offY + (p.y - minY) * scale),
    });
  }, [lines, width, height]);

  const toPath = (pts: MapPoint[]) =>
    fit
      ? pts
          .map((p, i) => {
            const q = fit(p);
            return `${i ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`;
          })
          .join('')
      : '';

  const outlinePaths = useMemo(() => outline.map(toPath), [outline, fit]);
  const pitPaths = useMemo(() => pitLane.map(toPath), [pitLane, fit]);
  const linePaths = useMemo(
    () => lines.map(l => ({...l, d: toPath(l.points)})),
    [lines, fit],
  );

  if (!fit) return <View style={{width, height}} />;

  const real = outlinePaths.length > 0;
  const driven = linePaths[linePaths.length - 1];
  // The reference line on screen decides which side is inside the loop
  // (its winding), and keeps labels off the band.
  const refScreen = (lines[lines.length - 1]?.points ?? []).map(fit);
  const clockwise = signedArea2(refScreen) > 0;
  // A point `offset` pt off the line at an anchor: positive is inside the
  // loop, negative outside.
  const off = (a: MapAnchor, offset: number) =>
    offsetFromLine(fit(a.prev), fit(a.at), fit(a.next), offset, clockwise);

  // Some OSM tracks split the pit lane into entry, lane and exit: label the
  // longest.
  const pit = pitLane.reduce<MapPoint[]>(
    (best, l) => (l.length > best.length ? l : best),
    [],
  );
  const pitI = Math.floor(pit.length / 2);
  const pitAt =
    pit.length > 2 &&
    off(
      {at: pit[pitI], prev: pit[pitI - 1], next: pit[pitI + 1]},
      PIT_LABEL_OFFSET,
    );
  // Labels in priority order: sections, then corners, then PIT. Any that
  // would overlap one before it is left out (tight corners at phone size).
  type Label = {kind: 'section' | 'corner' | 'pit'; n: number; at: MapPoint};
  const bandClear = (l: Label) =>
    l.kind === 'section' ||
    nearestVertexDistance(l.at, refScreen) > BAND_EDGE_W / 2 + CORNER_FONT / 2;
  const candidates: Label[] = [
    ...marks.sections.map(s => ({
      kind: 'section' as const,
      n: s.n,
      at: off(s.anchor, SECTION_OFFSET),
    })),
    ...marks.corners.map(c => ({
      kind: 'corner' as const,
      n: c.n,
      at: off(c.anchor, -CORNER_OFFSET),
    })),
    ...(real && pitAt ? [{kind: 'pit' as const, n: 0, at: pitAt}] : []),
    // Corner and PIT labels that would sit on another part of the track
    // (two straights side by side) are left out; section labels stay, since
    // they are the tap targets.
  ].filter(bandClear);
  const textOf = (l: Label) =>
    l.kind === 'section' ? `S${l.n}` : l.kind === 'corner' ? `C${l.n}` : 'PIT';
  const kept = keepClear(
    candidates.map(l => {
      const font = l.kind === 'section' ? SECTION_FONT : CORNER_FONT;
      return {
        x: l.at.x,
        y: l.at.y,
        width: textOf(l).length * font * MONO_EM,
        // Line box, not cap height: glyphs sit above and below the point.
        height: font * 1.3,
      };
    }),
    2,
  ).map(i => candidates[i]);
  const sectionLabels = kept.filter(l => l.kind === 'section');

  return (
    <View style={{width, height}}>
      <Svg width={width} height={height}>
        {real ? (
          <>
            {outlinePaths.map((d, i) => (
              <Path
                key={`oe${i}`}
                d={d}
                stroke={color.trackEdge}
                strokeWidth={BAND_EDGE_W}
                strokeLinejoin='round'
                fill='none'
              />
            ))}
            {outlinePaths.map((d, i) => (
              <Path
                key={`of${i}`}
                d={d}
                stroke={color.trackFill}
                strokeWidth={BAND_FILL_W}
                strokeLinejoin='round'
                fill='none'
              />
            ))}
            {pitPaths.map((d, i) => (
              <Path
                key={`pe${i}`}
                d={d}
                stroke={color.trackEdge}
                strokeWidth={PIT_EDGE_W}
                strokeLinejoin='round'
                strokeLinecap='round'
                fill='none'
              />
            ))}
            {pitPaths.map((d, i) => (
              <Path
                key={`pf${i}`}
                d={d}
                stroke={color.trackFill}
                strokeWidth={PIT_FILL_W}
                strokeLinejoin='round'
                fill='none'
              />
            ))}
          </>
        ) : (
          driven && (
            <Path
              d={driven.d}
              stroke={color.track}
              strokeWidth={DRIVEN_W}
              strokeLinejoin='round'
              fill='none'
            />
          )
        )}
        {marks.boundaries.map((b, i) => {
          const a = off(b, TICK_HALF);
          const c = off(b, -TICK_HALF);
          return (
            <Line
              key={`t${i}`}
              x1={a.x}
              y1={a.y}
              x2={c.x}
              y2={c.y}
              stroke={color.sectionTick}
              strokeWidth={TICK_W}
            />
          );
        })}
        {linePaths.map(l => (
          <Path
            key={l.key}
            d={l.d}
            stroke={l.color}
            strokeWidth={l.width}
            strokeOpacity={l.opacity}
            strokeLinejoin='round'
            fill='none'
          />
        ))}
        {sectionLabels.map(s => (
          <SvgText
            key={`s${s.n}`}
            x={s.at.x}
            y={s.at.y + 3.5}
            textAnchor='middle'
            fill={s.n === openSection ? color.text : color.mapLabel}
            fontFamily={fonts.monoBold}
            fontSize={SECTION_FONT}>
            {`S${s.n}`}
          </SvgText>
        ))}
        {kept
          .filter(l => l.kind !== 'section')
          .map(l => (
            <SvgText
              key={`${l.kind}${l.n}`}
              x={l.at.x}
              y={l.at.y + 3}
              textAnchor='middle'
              fill={color.mapCornerLabel}
              fontFamily={l.kind === 'pit' ? fonts.monoBold : fonts.monoMedium}
              fontSize={CORNER_FONT}>
              {textOf(l)}
            </SvgText>
          ))}
        {dots.map(d => {
          const q = fit(d.at);
          return (
            <Circle
              key={d.key}
              cx={q.x}
              cy={q.y}
              r={4.5}
              fill={d.color}
              stroke={color.bg}
              strokeWidth={1.5}
            />
          );
        })}
      </Svg>
      {/* 44 pt hit targets over the section labels: tap opens the section. */}
      {sectionLabels.map(s => (
        <Pressable
          key={`hit${s.n}`}
          accessibilityRole='button'
          accessibilityLabel={`Section ${s.n}`}
          onPress={() => onPressSection(s.n)}
          style={[styles.hit, {left: s.at.x - HIT / 2, top: s.at.y - HIT / 2}]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  hit: {position: 'absolute', width: HIT, height: HIT},
});
