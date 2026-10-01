import {useRouter} from 'expo-router';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import type {RaceFacts} from '@/src/analysis/fuelPlan';
import {LapTimeBars} from '@/src/charts';
import {
  hitBox,
  lapStroke,
  radius,
  size,
  space,
  useLayout,
  useTheme,
} from '@/src/design';
import {SessionNav} from '@/src/workspace/SessionNav';
import {compareHref, sessionsHref, trackHref} from '@/src/nav/routes';
import {Explainer, Text, useHowToRead} from '@/src/ui';

import {CompareTray} from './components/CompareTray';
import {LapDetail} from './components/LapDetail';
import {FuelUseCard} from './components/FuelUseCard';
import {PitCard} from './components/PitCard';
import {TiresCard} from './components/TiresCard';
import {type PitCard as PitCardModel} from './pitCard';
import {LAP_BARS_HELP} from './lapBarsHelp';
import {SessionWorkspace} from './components/SessionWorkspace';
import {
  LapRow,
  LapTableHeader,
  ROW_H,
  NoteRow,
  StintRow,
} from './components/LapTableRow';
import {
  BAR_CLAMP_S,
  type NoteRowModel,
  type RowModel,
  type Selection,
  type SessionScreenModel,
  selectStint,
  toggleLap,
  useSessionScreenModel,
} from './model';

const CHART_H = 166;
const DESKTOP_SIDE_W = 340;
const DESKTOP_TABLE_MAX_W = 640;

const TAG_KEY =
  'Purple = best lap and best sectors. OUT/IN = pit lap, RESET = ended in a reset to the garage, PART = partial, PARK = parked start (the roll to the line), SLOW = slow outlier, OFF = seconds off track, HIT = impact (possible damage). TOW = seconds in a slipstream, TRAF = seconds within 1 s of a car ahead (from 2 s), BLUE = faster-class cars that passed, PASS = passes made and suffered within the car’s class, BTL = seconds within 1 s of a same-class car. Excluded laps are dimmed.';

export type {Selection} from './model';

export function SessionScreen({
  sessionId,
  selection,
  onSelectionChange,
  renderPlanHalf,
  renderPooledUse,
}: {
  sessionId: string;
  selection: Selection;
  onSelectionChange: (next: Selection) => void;
  /** The planner against this race: another feature's half of the card, put here by the route. */
  renderPlanHalf?: (card: PitCardModel, facts: RaceFacts) => ReactNode;
  renderPooledUse?: (planKey: string, width: number) => ReactNode;
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
      renderPlanHalf={renderPlanHalf}
      renderPooledUse={renderPooledUse}
    />
  );
}

function SessionView({
  sessionId,
  model,
  selection,
  onSelectionChange,
  renderPlanHalf,
  renderPooledUse,
}: {
  sessionId: string;
  model: SessionScreenModel;
  selection: Selection;
  onSelectionChange: (next: Selection) => void;
  renderPlanHalf?: (card: PitCardModel, facts: RaceFacts) => ReactNode;
  renderPooledUse?: (planKey: string, width: number) => ReactNode;
}) {
  const {color, scheme} = useTheme();
  const layout = useLayout();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const listRef = useRef<FlatList<RowModel>>(null);
  const barsHelp = useHowToRead('the lap times', LAP_BARS_HELP);
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

  const {contentWidth} = layout;
  const sideW = layout.isDesktop ? DESKTOP_SIDE_W : 0;
  // A lap table has nothing to fill 800 pt with; cap it on desktop.
  const tableW = layout.isDesktop
    ? Math.min(DESKTOP_TABLE_MAX_W, contentWidth - sideW - space.xxl)
    : contentWidth;

  // Desktop workspace: a bar or dot tap scrolls its row into view.
  const [wideScrollTo, setWideScrollTo] = useState<string | null>(null);
  // A pit row tapped on desktop: the Pit stops card marks that stop's column.
  const [pitFocus, setPitFocus] = useState<{
    lapIndex: number;
    at: number;
  } | null>(null);

  const highlight = (lapId: string, scroll: boolean) => {
    if (scroll && layout.isWide) setWideScrollTo(lapId);
    else if (scroll) pendingScroll.current = lapId;
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
        hollow: b.hollow,
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

  const chartBlock = (width: number) =>
    model.chart ? (
      <View style={styles.section}>
        <View style={styles.titleRow}>
          <Text variant='label' tone='textMuted'>
            Lap times
          </Text>
          {barsHelp.button}
        </View>
        {barsHelp.panel}
        <LapTimeBars
          width={width}
          height={CHART_H}
          bars={bars}
          rangeS={BAR_CLAMP_S}
          medianLabel='median'
          stintBreaks={model.chart.stintBreaks.map(b => ({
            afterIndex: b.afterLap - 1,
            label: b.label,
          }))}
          pits={model.chart.pits.map(i => i - 1)}
          resets={model.chart.resets.map(i => i - 1)}
          rails={
            model.chart.rails && {
              tow: model.chart.rails.tow.map(i => i - 1),
              tick: model.chart.rails.tick.map(i => i - 1),
              pit: model.chart.rails.pit.map(i => i - 1),
            }
          }
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
    );

  const header = (
    <View
      onLayout={e => (headerHeight.current = e.nativeEvent.layout.height)}
      style={[styles.block, {width: tableW}]}>
      {/* From 900 pt the top bar carries the back link and the session name. */}
      {!layout.isDesktop && (
        <>
          <Pressable
            accessibilityRole='link'
            onPress={() => router.navigate(sessionsHref())}
            style={hitBox.link}
            hitSlop={space.md}>
            <Text variant='bodyStrong' tone='accentInk'>
              ‹ Sessions
            </Text>
          </Pressable>
          <Text variant='display' style={styles.title}>
            {model.title}
          </Text>
        </>
      )}
      <Text variant='dataSmall' tone='textMuted'>
        {model.subtitle}
      </Text>
      {!layout.isDesktop && <SessionNav sessionId={sessionId} />}
      {model.trackId ? (
        <Pressable
          accessibilityRole='link'
          onPress={() => router.push(trackHref(model.trackId))}
          style={hitBox.link}
          hitSlop={space.md}>
          <Text variant='body' tone='accentInk'>
            Track page ›
          </Text>
        </Pressable>
      ) : null}
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
      {model.paceRule ? <Explainer>{model.paceRule}</Explainer> : null}

      {chartBlock(tableW)}

      {model.pitCard && (
        <View style={styles.section}>
          <PitCard
            card={model.pitCard}
            width={tableW}
            plan={
              model.planVsRace && renderPlanHalf
                ? renderPlanHalf(model.pitCard, model.planVsRace)
                : null
            }
          />
        </View>
      )}

      <View style={styles.section}>
        <TiresCard card={model.tires} width={tableW} />
      </View>

      {model.fuelUse && (
        <View style={styles.section}>
          <FuelUseCard
            card={model.fuelUse}
            pooled={renderPooledUse?.(model.fuelUse.planKey, tableW)}
          />
        </View>
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
        router.push(compareHref(sessionId, {laps: selection.laps}))
      }
    />
  );

  const pitRowPress = (row: NoteRowModel, wide: boolean) => {
    const lapIndex = row.pitLapIndex;
    if (!wide || lapIndex == null || model.pitCard?.kind !== 'stops')
      return undefined;
    return () => setPitFocus({lapIndex, at: Date.now()});
  };

  const renderRow = (item: RowModel, width: number, wide = false) =>
    item.kind === 'note' ? (
      <NoteRow
        row={item}
        width={width}
        wide={wide}
        onPress={pitRowPress(item, wide)}
      />
    ) : item.kind === 'stint' ? (
      <StintRow
        row={item}
        width={width}
        wide={wide}
        onSelectStint={() =>
          onSelectionChange(selectStint(selection, item.lapIds))
        }
      />
    ) : (
      <LapRow
        row={item}
        width={width}
        wide={wide}
        lapColor={item.selIndex != null ? colorOf(item.selIndex) : undefined}
        onPress={() => highlight(item.lapId, false)}
        onToggle={() => onSelectionChange(toggleLap(selection, item.lapId))}
      />
    );

  if (layout.isWide)
    return (
      <SessionWorkspace
        sessionId={sessionId}
        model={model}
        selection={selection}
        onSelectionChange={onSelectionChange}
        colorOf={i => colorOf(i)}
        onHighlight={id => highlight(id, true)}
        scrollToLapId={wideScrollTo}
        chart={chartBlock}
        detail={
          model.detail && (
            <LapDetail detail={model.detail} onAction={detailAction} />
          )
        }
        tray={tray}
        cards={
          <>
            {model.pitCard && (
              <PitCard
                card={model.pitCard}
                width={size.sidePanelWidth - 2 * space.xl}
                focusLapIndex={pitFocus?.lapIndex ?? null}
                plan={
                  model.planVsRace && renderPlanHalf
                    ? renderPlanHalf(model.pitCard, model.planVsRace)
                    : null
                }
              />
            )}
            <TiresCard
              card={model.tires}
              width={size.sidePanelWidth - 2 * space.xl}
            />
            {model.fuelUse && (
              <FuelUseCard
                card={model.fuelUse}
                pooled={renderPooledUse?.(
                  model.fuelUse.planKey,
                  size.sidePanelWidth - 2 * space.xl,
                )}
              />
            )}
          </>
        }
        renderRow={(row, width) => renderRow(row, width, true)}
        tagKey={TAG_KEY}
        pitFocus={pitFocus}
      />
    );

  return (
    <View
      style={[
        styles.screen,
        {backgroundColor: color.bg, paddingTop: insets.top + space.lg},
      ]}>
      <View
        style={[
          styles.columns,
          {
            width: layout.isDesktop ? tableW + sideW + space.xxl : contentWidth,
          },
        ]}>
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
          renderItem={({item}) => renderRow(item, tableW)}
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
  // Wraps: a fifth fact ("Best without TOW or TRAF") does not fit beside the
  // four at 375 pt.
  facts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: space.xxl,
    rowGap: space.sm,
    marginTop: space.md,
  },
  factValue: {fontSize: 14},
  section: {marginTop: space.xl, gap: space.xs},
  titleRow: {flexDirection: 'row', alignItems: 'center', gap: space.sm},
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
