import {useRouter} from 'expo-router';
import {useCallback, useEffect, useMemo, useRef} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {LapTimeBars} from '@/src/charts';
import {lapStroke, radius, space, useLayout, useTheme} from '@/src/design';
import {Explainer, Text} from '@/src/ui';

import {CompareTray} from './components/CompareTray';
import {LapDetail} from './components/LapDetail';
import {
  LapRow,
  LapTableHeader,
  ROW_H,
  StintRow,
} from './components/LapTableRow';
import {
  BAR_CLAMP_S,
  type RowModel,
  type Selection,
  type SessionScreenModel,
  selectStint,
  toggleLap,
  useSessionScreenModel,
} from './model';

const CHART_H = 166;
const DESKTOP_SIDE_W = 340;

const TAG_KEY =
  'Purple = best lap and best sectors. OUT/IN = pit lap, PART = partial, SLOW = slow outlier, OFF = seconds off track, HIT = impact (possible damage). Excluded laps are dimmed.';

export type {Selection} from './model';

export function SessionScreen({
  sessionId,
  selection,
  onSelectionChange,
}: {
  sessionId: string;
  selection: Selection;
  onSelectionChange: (next: Selection) => void;
}) {
  const result = useSessionScreenModel(sessionId, selection);
  const {color} = useTheme();
  const insets = useSafeAreaInsets();

  if (result.state !== 'ready') {
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
          <Text tone='textMuted'>
            Couldn’t load this session: {result.message}
          </Text>
        )}
      </View>
    );
  }
  return (
    <SessionView
      sessionId={sessionId}
      model={result.model}
      selection={selection}
      onSelectionChange={onSelectionChange}
    />
  );
}

function SessionView({
  sessionId,
  model,
  selection,
  onSelectionChange,
}: {
  sessionId: string;
  model: SessionScreenModel;
  selection: Selection;
  onSelectionChange: (next: Selection) => void;
}) {
  const {color, scheme} = useTheme();
  const layout = useLayout();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const listRef = useRef<FlatList<RowModel>>(null);
  const headerHeight = useRef(0);
  // A bar tap highlights a lap, which can open the detail panel and change
  // the header height; scroll once that render has laid out.
  const pendingScroll = useRef<string | null>(null);

  const count = selection.laps.length;
  const colorOf = useCallback(
    (selIndex: number, highlighted = false) =>
      lapStroke(scheme, selIndex, count, highlighted).color,
    [scheme, count],
  );

  const sideW = layout.isDesktop ? DESKTOP_SIDE_W : 0;
  const tableW = layout.isDesktop
    ? layout.contentWidth - sideW - space.xxl
    : layout.contentWidth;

  const highlight = (lapId: string, scroll: boolean) => {
    if (scroll) pendingScroll.current = lapId;
    onSelectionChange({...selection, hl: lapId});
  };

  useEffect(() => {
    const lapId = pendingScroll.current;
    if (!lapId || lapId !== selection.hl) return;
    pendingScroll.current = null;
    const index = model.rows.findIndex(
      r => r.kind === 'lap' && r.lapId === lapId,
    );
    if (index < 0) return;
    // Two frames: the new header lays out, then its onLayout updates the
    // offset that getItemLayout reads.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() =>
        listRef.current?.scrollToIndex({index, viewPosition: 0.55}),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [selection.hl, model.rows]);

  const bars = useMemo(
    () =>
      (model.chart?.bars ?? []).map(b => ({
        key: b.lapId,
        label: `L${b.lapIndex}`,
        deltaS: b.deltaS,
        excluded: !b.comparable,
        highlighted: b.highlighted,
        fill:
          b.selIndex != null
            ? colorOf(b.selIndex)
            : b.best
            ? color.best
            : color.barNeutral,
      })),
    [model.chart, colorOf, color],
  );

  const detailAction = () => {
    const d = model.detail;
    if (!d || d.action === 'reference') return;
    onSelectionChange(toggleLap(selection, d.lapId));
  };

  const header = (
    <View
      onLayout={e => (headerHeight.current = e.nativeEvent.layout.height)}
      style={[styles.block, {width: tableW}]}>
      <Pressable
        accessibilityRole='link'
        onPress={() => router.navigate('/')}
        hitSlop={space.md}>
        <Text variant='bodyStrong' tone='accentInk'>
          ‹ Sessions
        </Text>
      </Pressable>
      <Text variant='display' style={styles.title}>
        {model.title}
      </Text>
      <Text variant='dataSmall' tone='textMuted'>
        {model.subtitle}
      </Text>
      <View style={styles.facts}>
        {model.facts.map(f => (
          <View key={f.label}>
            <Text variant='label' tone='textMuted'>
              {f.label}
            </Text>
            <Text
              variant='dataStrong'
              tone={f.best ? 'best' : 'text'}
              style={styles.factValue}>
              {f.value}
            </Text>
          </View>
        ))}
      </View>

      {model.chart ? (
        <View style={styles.section}>
          <Text variant='label' tone='textMuted'>
            Lap times
          </Text>
          <Explainer>{model.chart.explainer}</Explainer>
          <LapTimeBars
            width={tableW}
            height={CHART_H}
            bars={bars}
            rangeS={BAR_CLAMP_S}
            medianLabel='median'
            stintBreaks={model.chart.stintBreaks.map(b => ({
              afterIndex: b.afterLap - 1,
              label: b.label,
            }))}
            pits={model.chart.pits.map(i => i - 1)}
            onPressBar={id => highlight(id, true)}
          />
        </View>
      ) : (
        model.noComparable && (
          <View
            style={[
              styles.card,
              {backgroundColor: color.surface, borderColor: color.lineHeader},
            ]}>
            <Text variant='title'>{model.noComparable.title}</Text>
            {model.noComparable.reasons.map(r => (
              <Text key={r} variant='dataSmall' tone='textMuted'>
                {r}
              </Text>
            ))}
          </View>
        )
      )}

      {!layout.isDesktop && model.detail && (
        <View style={styles.section}>
          <LapDetail detail={model.detail} onAction={detailAction} />
        </View>
      )}
      <View style={styles.section}>
        <LapTableHeader width={tableW} />
      </View>
    </View>
  );

  const tray = model.tray && (
    <CompareTray
      tray={model.tray}
      colorOf={i => colorOf(i)}
      onClear={() => onSelectionChange({laps: [], hl: selection.hl})}
      onCompare={() =>
        router.push({
          pathname: '/session/[id]/compare',
          params: {id: sessionId, laps: selection.laps.join(',')},
        })
      }
    />
  );

  return (
    <View
      style={[
        styles.screen,
        {backgroundColor: color.bg, paddingTop: insets.top + space.lg},
      ]}>
      <View style={[styles.columns, {width: layout.contentWidth}]}>
        <FlatList
          ref={listRef}
          style={{width: tableW}}
          data={model.rows}
          keyExtractor={r => (r.kind === 'lap' ? r.lapId : r.key)}
          ListHeaderComponent={header}
          ListFooterComponent={
            <View style={[styles.footer, {width: tableW}]}>
              <Explainer>{TAG_KEY}</Explainer>
            </View>
          }
          getItemLayout={(_, index) => ({
            length: ROW_H,
            offset: headerHeight.current + ROW_H * index,
            index,
          })}
          renderItem={({item}) =>
            item.kind === 'stint' ? (
              <StintRow
                row={item}
                width={tableW}
                onSelectStint={() =>
                  onSelectionChange(selectStint(selection, item.lapIds))
                }
              />
            ) : (
              <LapRow
                row={item}
                width={tableW}
                lapColor={
                  item.selIndex != null ? colorOf(item.selIndex) : undefined
                }
                onPress={() => highlight(item.lapId, false)}
                onToggle={() =>
                  onSelectionChange(toggleLap(selection, item.lapId))
                }
              />
            )
          }
        />
        {layout.isDesktop && (
          <View style={[styles.side, {width: sideW}]}>
            {model.detail ? (
              <LapDetail detail={model.detail} onAction={detailAction} />
            ) : (
              <Explainer>
                Tap a bar or a row to see that lap, and tick laps to compare.
              </Explainer>
            )}
            {tray}
          </View>
        )}
      </View>
      {!layout.isDesktop && tray && (
        <View
          style={[styles.floatingTray, {bottom: insets.bottom + 18}]}
          pointerEvents='box-none'>
          {tray}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1},
  center: {alignItems: 'center', justifyContent: 'center'},
  columns: {
    flex: 1,
    flexDirection: 'row',
    alignSelf: 'center',
    gap: space.xxl,
  },
  block: {gap: space.xs},
  title: {fontSize: 22, marginTop: space.sm},
  facts: {flexDirection: 'row', gap: space.xxl, marginTop: space.md},
  factValue: {fontSize: 14},
  section: {marginTop: space.xl, gap: space.xs},
  card: {
    marginTop: space.xl,
    padding: space.xl,
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  footer: {paddingTop: space.md, paddingBottom: 120},
  side: {paddingTop: space.xxxl, gap: space.lg},
  floatingTray: {position: 'absolute', left: space.lg, right: space.lg},
});
