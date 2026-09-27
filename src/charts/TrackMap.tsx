import {useMemo} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import Svg, {Circle, G, Path, Text as SvgText} from 'react-native-svg';

import {type as typeScale, useTheme} from '@/src/design';

// Track map (handoff §3 "Map"): the OSM outline when the track has a good
// fit, each lap's line, a dot per lap at the cursor, and corner badges.
// Inputs are metres east/north of one origin; this fits them to the box.

export type MapPoint = {x: number; y: number};

export type MapLine = {
  key: string;
  points: MapPoint[];
  color: string;
  width: number;
  opacity: number;
};

export type MapDot = {key: string; at: MapPoint; color: string};

export type MapBadge = {n: number; at: MapPoint; open: boolean};

const PAD = 14;
const BADGE_R = 8;
const TRACK_W = 6;

export function TrackMap({
  width,
  height,
  outline,
  lines,
  dots,
  badges,
  onPressBadge,
}: {
  width: number;
  height: number;
  /** Real track outline (OSM); empty when the fit is not good enough. */
  outline: MapPoint[][];
  lines: MapLine[];
  dots: MapDot[];
  badges: MapBadge[];
  onPressBadge: (n: number) => void;
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
  const linePaths = useMemo(
    () => lines.map(l => ({...l, d: toPath(l.points)})),
    [lines, fit],
  );

  if (!fit) return <View style={{width, height}} />;
  const axis = typeScale.axis;
  return (
    <View style={{width, height}}>
      <Svg width={width} height={height}>
        {outlinePaths.map((d, i) => (
          <Path
            key={`o${i}`}
            d={d}
            stroke={color.track}
            strokeWidth={TRACK_W}
            strokeLinecap='round'
            strokeLinejoin='round'
            fill='none'
          />
        ))}
        {outline.length === 0 && linePaths[0] && (
          <Path
            d={linePaths[0].d}
            stroke={color.track}
            strokeWidth={TRACK_W}
            strokeLinejoin='round'
            fill='none'
          />
        )}
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
        {badges.map(b => {
          const q = fit(b.at);
          return (
            <G key={`b${b.n}`}>
              <Circle
                cx={q.x}
                cy={q.y}
                r={BADGE_R}
                fill={b.open ? color.text : color.surfaceRaised}
                stroke={color.lineStrong}
                strokeWidth={1}
              />
              <SvgText
                x={q.x}
                y={q.y + 3.2}
                textAnchor='middle'
                fill={b.open ? color.bg : color.text}
                fontFamily={axis.fontFamily}
                fontSize={9}>
                {b.n}
              </SvgText>
            </G>
          );
        })}
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
      {/* 44 pt hit targets over the badges. */}
      {badges.map(b => {
        const q = fit(b.at);
        return (
          <Pressable
            key={`hit${b.n}`}
            accessibilityRole='button'
            accessibilityLabel={`Corner ${b.n}`}
            onPress={() => onPressBadge(b.n)}
            style={[styles.hit, {left: q.x - 22, top: q.y - 22}]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  hit: {position: 'absolute', width: 44, height: 44},
});
