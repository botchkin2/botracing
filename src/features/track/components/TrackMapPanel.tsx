import {StyleSheet, View} from 'react-native';

import {TrackMap} from '@/src/charts';
import {radius, space, useTheme} from '@/src/design';
import {Text} from '@/src/ui';

import {failedText, type MapPart} from '../mapLoad';
import {type TrackMapModel} from '../model';

// The Track page map (handoff T1/05): the OSM outline and pit lane when the
// fit is good, else the driven line and its note; numbered corner badges
// that share the selection with the corner list; the S/F tick.
export function TrackMapPanel({
  map,
  width,
  height,
  large,
  selected,
  onToggle,
  attribution,
  loading,
  failed,
}: {
  map: TrackMapModel | null;
  width: number;
  height: number;
  large: boolean;
  selected: number | null;
  onToggle: (n: number) => void;
  /** OSM credit; shown only when the OSM outline is drawn. */
  attribution: string | null;
  loading: boolean;
  /** Parts that failed; named on the map, never a silent blank. */
  failed: MapPart[];
}) {
  const {color} = useTheme();
  return (
    <View style={{width}}>
      <View
        style={[styles.frame, {width, height, borderColor: color.lineStrong}]}>
        {map ? (
          <>
            <TrackMap
              width={width - 2}
              height={height - 2}
              outline={map.outline}
              outlineFaded={map.outlineFaded}
              pitLane={map.pitLane}
              lines={
                // The lap's line fits the view and is the band when there is no
                // outline; with no lap yet the outline fits the view itself.
                map.line
                  ? [
                      {
                        key: 'ref',
                        points: map.line,
                        color: color.text,
                        width: 1,
                        opacity: 0,
                      },
                    ]
                  : []
              }
              dots={[]}
              marks={map.marks}
              openSection={null}
              onPressSection={noop}
              badges={{
                size: large ? 'large' : 'small',
                selected,
                onPress: onToggle,
              }}
              startFinish={map.startFinish}
            />
            {map.note ? (
              <Text variant='dataSmall' tone='textMuted' style={styles.note}>
                {map.note}
              </Text>
            ) : attribution && map.real ? (
              <Text
                variant='attribution'
                tone='textFaint'
                style={styles.credit}>
                {attribution}
              </Text>
            ) : null}
          </>
        ) : (
          <View style={styles.empty}>
            {failed.length === 0 ? (
              <Text variant='dataSmall' tone='textMuted'>
                {loading ? 'Loading the map…' : 'No map yet'}
              </Text>
            ) : null}
          </View>
        )}
      </View>
      {failed.length > 0 ? (
        <Text variant='dataSmall' tone='textMuted' style={styles.below}>
          {failedText(failed)}
        </Text>
      ) : null}
    </View>
  );
}

function noop() {}

const styles = StyleSheet.create({
  below: {marginTop: space.sm},
  frame: {borderWidth: 1, borderRadius: radius.md, overflow: 'hidden'},
  note: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: space.lg,
  },
  credit: {position: 'absolute', right: space.sm, bottom: space.xs},
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
});
