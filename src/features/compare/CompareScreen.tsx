import {useRouter} from 'expo-router';
import {type ReactNode, useCallback, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Svg, {Line} from 'react-native-svg';

import {CornerGrid, TrackMap} from '@/src/charts';
import {lapStroke, radius, space, useLayout, useTheme} from '@/src/design';
import {Chip, Explainer, Text} from '@/src/ui';

import {ChartBlock, type LapStyle} from './components/ChartBlock';
import {
  type CompareModel,
  type CompareSelection,
  makeReference,
  removeLap,
} from './model';
import {useCompareModel} from './useCompareModel';

export type {CompareSelection} from './model';

const MAP_H = 170;
const DESKTOP_SIDE_W = 360;
const DESKTOP_MAP_H = 220;
// Traces are the point on desktop (livery's spec, thread 24 #254).
const DESKTOP_CHART_SCALE = 1.4;

export function CompareScreen({
  sessionId,
  selection,
  onSelectionChange,
}: {
  sessionId: string;
  selection: CompareSelection;
  onSelectionChange: (next: CompareSelection) => void;
}) {
  // The cursor moves on every drag frame, so it lives here, not in the URL.
  const [cursorM, setCursorM] = useState(selection.cursorM);
  const result = useCompareModel(sessionId, {...selection, cursorM});
  const {color} = useTheme();
  const insets = useSafeAreaInsets();

  if (result.state !== 'ready')
    return (
      <View
        style={[
          styles.screen,
          styles.center,
          {backgroundColor: color.bg, paddingTop: insets.top},
        ]}>
        {result.state === 'loading' ? (
          <ActivityIndicator color={color.accent} />
        ) : (
          <Text tone='textMuted'>Couldn’t load: {result.message}</Text>
        )}
      </View>
    );
  return (
    <CompareView
      sessionId={sessionId}
      model={result.model}
      selection={selection}
      cursorM={cursorM}
      onCursor={setCursorM}
      onSelectionChange={onSelectionChange}
    />
  );
}

function CompareView({
  sessionId,
  model,
  selection,
  cursorM,
  onCursor,
  onSelectionChange,
}: {
  sessionId: string;
  model: CompareModel;
  selection: CompareSelection;
  cursorM: number;
  onCursor: (m: number) => void;
  onSelectionChange: (next: CompareSelection) => void;
}) {
  const {color, scheme} = useTheme();
  const layout = useLayout();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [mapShown, setMapShown] = useState(true);

  const count = selection.laps.length;
  const lapStyle: LapStyle = useCallback(
    (selIndex, highlighted) => lapStroke(scheme, selIndex, count, highlighted),
    [scheme, count],
  );
  const openCorner = (n: number) =>
    router.push({
      pathname: '/session/[id]/corner/[n]',
      params: {id: sessionId, n: String(n), laps: selection.laps.join(',')},
    });

  const sideW = layout.isDesktop ? DESKTOP_SIDE_W : layout.contentWidth;
  const mainW = layout.isDesktop
    ? layout.contentWidth - DESKTOP_SIDE_W - space.xxl
    : layout.contentWidth;
  const windowM: [number, number] = [0, model.lengthM];

  const header = (
    <View style={styles.header}>
      <Pressable
        accessibilityRole='link'
        hitSlop={space.md}
        onPress={() =>
          router.navigate({
            pathname: '/session/[id]',
            params: {id: sessionId, laps: selection.laps.join(',')},
          })
        }>
        <Text variant='bodyStrong' tone='accentInk'>
          ‹ Session
        </Text>
      </Pressable>
      <Text variant='display' style={styles.flex}>
        Compare
      </Text>
      {!layout.isDesktop && (
        <Pressable
          accessibilityRole='button'
          hitSlop={space.md}
          onPress={() => setMapShown(v => !v)}>
          <Text variant='dataStrong' tone='accentInk'>
            {mapShown ? 'Hide map' : 'Show map'}
          </Text>
        </Pressable>
      )}
    </View>
  );

  const reference = (
    <View style={styles.refRow}>
      <Text variant='label' tone='textMuted'>
        Reference
      </Text>
      <Svg width={14} height={4}>
        <Line
          x1={0}
          x2={14}
          y1={2}
          y2={2}
          stroke={lapStyle(0, false).color}
          strokeWidth={2.3}
        />
      </Svg>
      <Text variant='dataStrong' numberOfLines={1} style={styles.flex}>
        {model.reference}
      </Text>
    </View>
  );

  const chipItems = (
    <>
      {model.chips.map(c => (
        <Chip
          key={c.lapId}
          label={c.label}
          selected={c.isRef}
          onPress={() => onSelectionChange(makeReference(selection, c.lapId))}
          leading={
            <View
              style={[
                styles.swatch,
                {backgroundColor: lapStyle(c.selIndex, c.highlighted).color},
              ]}
            />
          }
          trailing={
            <>
              <Text
                variant='dataSmall'
                tone={c.isRef ? 'textMuted' : c.faster ? 'faster' : 'slower'}>
                {c.delta}
              </Text>
              {!c.isRef && (
                <Pressable
                  accessibilityLabel={`Remove ${c.label}`}
                  hitSlop={space.md}
                  onPress={() =>
                    onSelectionChange(removeLap(selection, c.lapId))
                  }>
                  <Text variant='dataSmall' tone='textFaint'>
                    ×
                  </Text>
                </Pressable>
              )}
            </>
          }
        />
      ))}
      {model.manyChip && <Chip label={model.manyChip} dashed />}
    </>
  );
  const chips = layout.isDesktop ? (
    <View style={styles.chipsWrap}>{chipItems}</View>
  ) : (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipsRow}>
      {chipItems}
    </ScrollView>
  );

  const map = model.map && (layout.isDesktop || mapShown) && (
    <View style={[styles.mapBox, {backgroundColor: color.surface}]}>
      <TrackMap
        width={sideW}
        height={layout.isDesktop ? DESKTOP_MAP_H : MAP_H}
        outline={model.map.outline}
        lines={model.map.lines.map(l => {
          const {
            color: c,
            width,
            opacity,
          } = lapStyle(l.selIndex, l.highlighted);
          return {key: l.lapId, points: l.points, color: c, width, opacity};
        })}
        dots={model.map.dots.map(d => ({
          key: d.lapId,
          at: d.at,
          color: lapStyle(d.selIndex, d.highlighted).color,
        }))}
        badges={model.map.badges}
        onPressBadge={openCorner}
      />
      {model.map.attribution && (
        <Text variant='dataSmall' tone='textFaint' style={styles.attribution}>
          {model.map.attribution}
        </Text>
      )}
    </View>
  );

  const position = (
    <View style={styles.positionRow}>
      <Text variant='dataStrong'>{model.position.place}</Text>
      <Text variant='dataSmall' tone='textMuted'>
        {model.position.distance}
      </Text>
      <View style={styles.values}>
        {model.position.speeds.map(s => (
          <Text
            key={s.lapId}
            variant='dataStrong'
            style={{color: lapStyle(s.selIndex, s.highlighted).color}}>
            {s.text}
          </Text>
        ))}
        <Text variant='dataSmall' tone='textFaint'>
          km/h
        </Text>
      </View>
    </View>
  );

  const grid = model.grid && (
    <Section title='Time per corner' explainer={model.grid.explainer}>
      <CornerGrid
        width={sideW}
        corners={model.grid.corners}
        rows={model.grid.rows.map(r => ({
          key: r.key,
          label: r.label,
          cells: r.cells,
          color:
            r.selIndex == null
              ? undefined
              : lapStyle(r.selIndex, r.lapId === selection.hl).color,
        }))}
        openCorner={selection.corner}
        onPressCorner={openCorner}
      />
    </Section>
  );

  const charts = (
    <View style={styles.charts}>
      <View
        style={[
          styles.chartsBar,
          {backgroundColor: color.surface, borderColor: color.lineHeader},
        ]}>
        <Text variant='label' tone='textMuted'>
          Charts
        </Text>
        {model.pending > 0 && (
          <Text variant='dataSmall' tone='textFaint'>
            loading {model.pending} lap{model.pending > 1 ? 's' : ''}…
          </Text>
        )}
      </View>
      <Explainer>
        Drag any chart to move through the lap. The cursor, map dots and values
        follow it.
      </Explainer>
      {model.charts.map(c => (
        <ChartBlock
          key={c.key}
          chart={c}
          width={mainW}
          heightScale={layout.isDesktop ? DESKTOP_CHART_SCALE : 1}
          stepM={model.stepM}
          windowM={windowM}
          cursorM={cursorM}
          lapStyle={lapStyle}
          onScrub={onCursor}
        />
      ))}
    </View>
  );

  const top = {paddingTop: insets.top + space.lg};
  if (layout.isDesktop)
    return (
      <View style={[styles.screen, top, {backgroundColor: color.bg}]}>
        <View style={[styles.desktop, {width: layout.contentWidth}]}>
          <ScrollView style={{width: sideW}} contentContainerStyle={styles.col}>
            {header}
            {reference}
            {chips}
            {map}
            {position}
            {grid}
          </ScrollView>
          <ScrollView style={{width: mainW}} contentContainerStyle={styles.col}>
            {charts}
          </ScrollView>
        </View>
      </View>
    );
  return (
    <ScrollView
      style={[styles.screen, {backgroundColor: color.bg}]}
      contentContainerStyle={[
        styles.col,
        top,
        {width: layout.contentWidth, alignSelf: 'center'},
      ]}>
      {header}
      {reference}
      {chips}
      {map}
      {position}
      {grid}
      {charts}
    </ScrollView>
  );
}

function Section({
  title,
  explainer,
  children,
}: {
  title: string;
  explainer: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text variant='label' tone='textMuted'>
        {title}
      </Text>
      <Explainer>{explainer}</Explainer>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1},
  center: {alignItems: 'center', justifyContent: 'center'},
  flex: {flex: 1},
  col: {gap: space.md, paddingBottom: space.xxxl},
  desktop: {flex: 1, flexDirection: 'row', gap: space.xxl, alignSelf: 'center'},
  header: {flexDirection: 'row', alignItems: 'center', gap: space.lg},
  refRow: {flexDirection: 'row', alignItems: 'center', gap: space.sm},
  chipsRow: {gap: space.sm, paddingVertical: space.xs},
  chipsWrap: {flexDirection: 'row', flexWrap: 'wrap', gap: space.sm},
  swatch: {width: 10, height: 3},
  mapBox: {borderRadius: radius.md, overflow: 'hidden'},
  attribution: {position: 'absolute', right: space.xs, bottom: space.xxs},
  positionRow: {flexDirection: 'row', alignItems: 'baseline', gap: space.sm},
  values: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space.md,
  },
  section: {gap: space.xs, marginTop: space.sm},
  charts: {gap: space.lg, marginTop: space.sm},
  chartsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    height: 32,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
});
