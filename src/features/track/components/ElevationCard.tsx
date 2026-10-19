import {StyleSheet, View} from 'react-native';
import {Path, Rect} from 'react-native-svg';

import {ChartLabel, ChartSvg} from '@/src/charts/ChartLabel';
import {baselineUnder} from '@/src/charts/labelBox';
import {radius, size, space, type as typeScale, useTheme} from '@/src/design';
import {Text} from '@/src/ui';

import {type ElevationModel, plotElevation} from '../elevationProfile';

/**
 * The track's curated height along the lap, with each corner section shaded
 * (thread 86). Instrument only: metres on the axis, the lap's two ends under
 * it. Drawn only where a height is curated; the caller passes null otherwise.
 */
export function ElevationCard({
  elevation,
  width,
}: {
  elevation: ElevationModel;
  width: number;
}) {
  const {color} = useTheme();
  const height = size.elevationProfile;
  const left = size.elevationAxis;
  const top = size.elevationPad;
  const axisH = typeScale.axis.fontSize + space.sm;
  const plotH = height - top - axisH - size.elevationPad;
  const plot = plotElevation(elevation, {
    left,
    top,
    plotW: width - left - space.sm,
    plotH,
  });
  const endsY = baselineUnder(top + plotH, typeScale.axis.fontSize);
  return (
    <View style={styles.block}>
      <Text variant='label'>Height</Text>
      <View style={[styles.card, {backgroundColor: color.surface}]}>
        <ChartSvg width={width} height={height}>
          {plot.bands.map((b, i) => (
            <Rect
              key={i}
              x={b.x}
              y={top}
              width={b.width}
              height={plotH}
              fill={color.band}
            />
          ))}
          {plot.ticks.map(t => (
            <ChartLabel
              key={t.v}
              x={left - space.xs}
              y={t.y + typeScale.axis.fontSize / 3}
              anchor='end'
              fill={color.textFaint}>
              {t.label}
            </ChartLabel>
          ))}
          <Path
            d={plot.path}
            fill='none'
            stroke={color.textSecondary}
            strokeWidth={1.5}
          />
          <ChartLabel x={left} y={endsY} fill={color.textFaint}>
            0 m
          </ChartLabel>
          <ChartLabel
            x={width - space.sm}
            y={endsY}
            anchor='end'
            fill={color.textFaint}>
            {`${Math.round(plot.endsM[1])} m`}
          </ChartLabel>
        </ChartSvg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {gap: space.xs},
  card: {borderRadius: radius.sm, overflow: 'hidden'},
});
