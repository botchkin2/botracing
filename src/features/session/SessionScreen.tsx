import {useRouter} from 'expo-router';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {ActivityIndicator, FlatList, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import type {RaceFacts} from '@/src/analysis/fuelPlan';
import {LapTimeBars} from '@/src/charts';
import {
  hitBox,
  lapStroke,
  radius,
  space,
  useLayout,
  useTheme,
} from '@/src/design';
import {type DaySet, useDaySet, useSession} from '@/src/data/sessions';
import {SessionNav} from '@/src/workspace/SessionNav';
import {
  compareHref,
  sessionHref,
  sessionsHref,
  trackHref,
} from '@/src/nav/routes';
import {replace, toggle} from '@/src/state/lapSelection';
import {LapStrip} from './components/LapStrip';
import {usePanelWidth} from '@/src/state/panelPrefs';
import {FoldedSection, PANEL_DIVIDER_W, Pressable, Text} from '@/src/ui';

import {CompareTray} from './components/CompareTray';
import {LapDetail} from './components/LapDetail';
import {LapCandidates} from './components/LapCandidates';
import {FuelUseCard} from './components/FuelUseCard';
import {EnergyLineRow} from './components/EnergyLineRow';
import {PitCard} from './components/PitCard';
import {TagKey} from './components/TagKey';
import {TiresCard} from './components/TiresCard';
import {type PitCard as PitCardModel} from './pitCard';
import {fuelSummary, pitSummary, tiresSummary} from './foldedSummaries';
import {LinkedScrollContext, useLinkedScroll} from './components/linkedScroll';
import {OptimumLines} from './components/OptimumLines';
import {SessionGrid} from './components/SessionGrid';
import {ClassTableView} from './components/ClassTable';
import {MovedLine, RebuiltLine} from './components/RebuiltLine';
import {SessionHead} from './components/SessionHead';
import {BrakeLedger} from './components/BrakeLedger';
import {SetToggle} from './components/SetToggle';
import type {SetKind} from './components/SetToggle';
import {SpreadRows} from './components/SpreadRows';
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
  useDayScreenModel,
  useSessionOpeningLapIds,
  useSessionScreenModel,
} from './model';
import {sectionCellHref, sectionHeadHref, sectionTapsOf} from './sectionTaps';

const CHART_H = 166;
const DESKTOP_SIDE_W = 340;
const DESKTOP_TABLE_MAX_W = 640;
// The wide workspace's centre (bars and lap table) is kept at least this wide
// when the right column is dragged out: the old 600 less the divider's 10, so
// the default 400 column still fits a 1280 window (layout.width 1000).
const WIDE_MIN_CENTRE_W = 590;
// Bars and lap table have nothing to fill more than this with; on a wider
// window the right column grows instead (triage #9).
const WIDE_MAX_CENTRE_W = 760;

export type {Selection} from './model';

export function SessionScreen({
  sessionId,
  selection,
  onSelectionChange,
  renderPlanHalf,
  renderPooledUse,
  setKind = 'session',
  onSetChange,
}: {
  sessionId: string;
  selection: Selection;
  onSelectionChange: (next: Selection) => void;
  /** The set of laps the URL asks for (`?set=day`). */
  setKind?: SetKind;
  /** Switch set: the route clears the lap selection (ids differ between a session and a day). */
  onSetChange?: (next: SetKind) => void;
  /** The planner against this race: another feature's half of the card, put here by the route. */
  renderPlanHalf?: (card: PitCardModel, facts: RaceFacts) => ReactNode;
  renderPooledUse?: (planKey: string, width: number) => ReactNode;
}) {
  // The one selection for this screen: the URL's laps, or the opening set when
  // the URL names none. The model, the table, the chart and the grid all read it.
  const openingIds = useSessionOpeningLapIds(sessionId);
  // The sitting this session is in (data/sessions/lapSet.ts): offered as a
  // toggle, and read only when the URL asks for it.
  const head = useSession(sessionId);
  const day = useDaySet(sessionId, head.data?.trackId, setKind === 'day');
  const dayReady = day.state === 'ready' ? day.set : null;
  const resolved = useMemo<Selection>(() => {
    if (selection.laps.length > 0) return selection;
    return {...selection, laps: dayReady ? dayReady.openingIds : openingIds};
  }, [selection, openingIds, dayReady]);
  const sessionResult = useSessionScreenModel(sessionId, resolved);
  const dayResult = useDayScreenModel(dayReady, resolved);
  const result = dayReady ? dayResult : sessionResult;
  const {color} = useTheme();
  const insets = useSafeAreaInsets();
  const setToggle =
    day.ids.length > 1 && onSetChange ? (
      <SetToggle value={dayReady ? 'day' : 'session'} onChange={onSetChange} />
    ) : null;
  // A day asked for is read in; until its members have loaded the screen waits
  // rather than show a session as the day. A member made under other rules is
  // analysed again in the background and does not hold the view.
  if (setKind === 'day' && day.state === 'loading')
    return (
      <View
        style={[
          styles.screen,
          styles.center,
          {backgroundColor: color.bg, paddingTop: insets.top},
        ]}>
        <ActivityIndicator color={color.accent} />
      </View>
    );

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
  if (result.model.movedTo) return <MovedLine to={result.model.movedTo} />;
  return (
    <SessionView
      sessionId={sessionId}
      model={result.model}
      selection={resolved}
      onSelectionChange={onSelectionChange}
      renderPlanHalf={renderPlanHalf}
      renderPooledUse={renderPooledUse}
      day={dayReady}
      setToggle={setToggle}
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
  day = null,
  setToggle = null,
}: {
  sessionId: string;
  model: SessionScreenModel;
  /** The laps are a day: no session cards, grid or side panels, no jump to Corner by a cell. */
  day?: DaySet | null;
  /** Session | Day, when the session is in a sitting. */
  setToggle?: ReactNode;
  selection: Selection;
  onSelectionChange: (next: Selection) => void;
  renderPlanHalf?: (card: PitCardModel, facts: RaceFacts) => ReactNode;
  renderPooledUse?: (planKey: string, width: number) => ReactNode;
}) {
  const {color, scheme} = useTheme();
  const layout = useLayout();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // Carried to every link out of a day, so Corner and Compare follow the set.
  const set = day ? 'day' : null;
  const listRef = useRef<FlatList<RowModel>>(null);
  // The lap table's rows and head scroll sideways as one (phone and tablet).
  const tableLink = useLinkedScroll();
  const headerHeight = useRef(0);
  // Where the Pit stops / Fuel card starts in the header, for the energy line's tap.
  const pitCardY = useRef(0);
  // A bar tap highlights a lap, which can open the detail panel and change
  // the header height; scroll once that render has laid out.
  const pendingScroll = useRef<string | null>(null);

  const colorOf = useCallback(
    (selIndex: number, highlighted = false) =>
      lapStroke(scheme, selIndex, highlighted).color,
    [scheme],
  );

  const {contentWidth} = layout;
  // The wide workspace's right column: resizable, kept per viewer.
  const panel = usePanelWidth(
    'session',
    layout.width - WIDE_MIN_CENTRE_W - PANEL_DIVIDER_W,
    layout.width - WIDE_MAX_CENTRE_W - PANEL_DIVIDER_W,
  );
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
    if (!d) return;
    onSelectionChange({...selection, laps: toggle(selection.laps, d.lapId)});
  };

  const chartBlock = (width: number) =>
    model.chart ? (
      <View style={styles.section}>
        <Text variant='label' tone='textMuted'>
          Lap times
        </Text>
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

  const tiresCard = model.tires ? (
    <TiresCard card={model.tires} width={tableW} titled={layout.isDesktop} />
  ) : null;
  const fuelCard = model.fuelUse ? (
    <FuelUseCard
      card={model.fuelUse}
      pooled={renderPooledUse?.(model.fuelUse.planKey, tableW)}
    />
  ) : null;

  const pitCard = model.pitCard ? (
    <PitCard
      card={model.pitCard}
      width={tableW}
      plan={
        model.planVsRace && renderPlanHalf
          ? renderPlanHalf(model.pitCard, model.planVsRace)
          : null
      }
    />
  ) : null;

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
      {!layout.isDesktop && setToggle}
      {!layout.isDesktop && <SessionNav sessionId={sessionId} set={set} />}
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
      {layout.isDesktop ? (
        <>
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
          {model.energy ? (
            <EnergyLineRow
              line={model.energy}
              onPress={() =>
                model.energy?.target === 'pit'
                  ? listRef.current?.scrollToOffset({offset: pitCardY.current})
                  : listRef.current?.scrollToEnd()
              }
            />
          ) : null}
          {model.optimum.length > 0 ? (
            <View style={styles.block}>
              <View style={styles.facts}>
                {model.optimum.map(f => (
                  <View key={f.label}>
                    <Text variant='label' tone='textMuted'>
                      {f.label}
                    </Text>
                    <Text variant='dataStrong' style={styles.factValue}>
                      {f.value}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </>
      ) : (
        <SessionHead facts={model.facts} />
      )}
      {!layout.isDesktop && model.rebuilt ? (
        <RebuiltLine rebuilt={model.rebuilt} />
      ) : null}
      {model.spread.length > 0 ? (
        <SpreadRows
          rows={model.spread}
          sessionId={sessionId}
          laps={selection.laps}
          set={set}
        />
      ) : null}
      {model.brake.length > 0 ? (
        <BrakeLedger
          rows={model.brake}
          sessionId={sessionId}
          laps={selection.laps}
          set={day ? 'day' : null}
        />
      ) : null}
      {model.classTable ? <ClassTableView table={model.classTable} /> : null}

      {chartBlock(tableW)}
      {!layout.isDesktop && model.optimumLines.length > 0 && (
        <OptimumLines lines={model.optimumLines} />
      )}

      {layout.isDesktop && model.pitCard && (
        <View
          style={styles.section}
          onLayout={e => (pitCardY.current = e.nativeEvent.layout.y)}>
          {pitCard}
        </View>
      )}

      {layout.isDesktop ? (
        <>
          <View style={styles.section}>{tiresCard}</View>
          {fuelCard ? <View style={styles.section}>{fuelCard}</View> : null}
        </>
      ) : null}

      {!layout.isDesktop && model.detail && (
        <View style={styles.section}>
          <LapDetail
            detail={model.detail}
            onAction={detailAction}
            extra={
              <LapCandidates sessionId={sessionId} lapId={model.detail.lapId} />
            }
          />
        </View>
      )}
    </View>
  );

  const tray = model.tray && (
    <CompareTray
      tray={model.tray}
      colorOf={i => colorOf(i)}
      onClear={() => onSelectionChange({laps: [], hl: selection.hl})}
      onStint={lapIds =>
        onSelectionChange({...selection, laps: replace(lapIds)})
      }
      onCompare={() =>
        router.push(compareHref(sessionId, {laps: selection.laps, set}))
      }
    />
  );

  const pitRowPress = (row: NoteRowModel, wide: boolean) => {
    const lapIndex = row.pitLapIndex;
    if (!wide || lapIndex == null || model.pitCard?.kind !== 'stops')
      return undefined;
    return () => setPitFocus({lapIndex, at: Date.now()});
  };

  // Which section columns open something: the game's sectors and the start straight do not.
  const sectionTaps = sectionTapsOf(model.sections);
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
          onSelectionChange({...selection, laps: replace(item.lapIds)})
        }
        onOpen={
          item.sessionId
            ? () => router.push(sessionHref(item.sessionId as string))
            : undefined
        }
      />
    ) : (
      <LapRow
        row={item}
        width={width}
        wide={wide}
        sectionTaps={sectionTaps}
        sectionNames={model.sections?.heads}
        onSectionPress={i => {
          const href = sectionCellHref(
            sessionId,
            model.sections,
            i,
            item.lapId,
            selection.laps,
            set,
          );
          if (href) router.push(href);
        }}
        lapColor={item.selIndex != null ? colorOf(item.selIndex) : undefined}
        onPress={() => highlight(item.lapId, false)}
        onToggle={() =>
          onSelectionChange({
            ...selection,
            laps: toggle(selection.laps, item.lapId),
          })
        }
      />
    );

  if (layout.isWide)
    return (
      <SessionWorkspace
        sessionId={sessionId}
        day={day}
        setToggle={setToggle}
        model={model}
        selection={selection}
        onSelectionChange={onSelectionChange}
        colorOf={i => colorOf(i)}
        onHighlight={id => highlight(id, true)}
        scrollToLapId={wideScrollTo}
        chart={chartBlock}
        detail={
          model.detail && (
            <LapDetail
              detail={model.detail}
              onAction={detailAction}
              extra={
                day ? null : (
                  <LapCandidates
                    sessionId={sessionId}
                    lapId={model.detail.lapId}
                  />
                )
              }
            />
          )
        }
        tray={tray}
        cards={
          <>
            {model.pitCard && (
              <PitCard
                card={model.pitCard}
                width={panel.width - 2 * space.xl}
                focusLapIndex={pitFocus?.lapIndex ?? null}
                plan={
                  model.planVsRace && renderPlanHalf
                    ? renderPlanHalf(model.pitCard, model.planVsRace)
                    : null
                }
              />
            )}
            {model.tires && (
              <TiresCard
                card={model.tires}
                width={panel.width - 2 * space.xl}
              />
            )}
            {model.fuelUse && (
              <FuelUseCard
                card={model.fuelUse}
                pooled={renderPooledUse?.(
                  model.fuelUse.planKey,
                  panel.width - 2 * space.xl,
                )}
              />
            )}
          </>
        }
        renderRow={(row, width) => renderRow(row, width, true)}
        tagKey={<TagKey />}
        pitFocus={pitFocus}
        side={panel}
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
        <LinkedScrollContext.Provider value={tableLink}>
          <FlatList
            ref={listRef}
            style={{width: tableW}}
            data={model.rows}
            keyExtractor={r => (r.kind === 'lap' ? r.lapId : r.key)}
            ListHeaderComponent={
              <>
                {header}
                <View style={[styles.strip, {width: tableW}]}>
                  <LapStrip
                    laps={model.strip}
                    ticked={selection.laps}
                    onTap={id =>
                      onSelectionChange({
                        ...selection,
                        laps: toggle(selection.laps, id),
                      })
                    }
                    onDrag={ids => onSelectionChange({...selection, laps: ids})}
                  />
                </View>
                <View style={styles.section}>
                  <LapTableHeader
                    width={tableW}
                    heads={model.sections?.heads ?? model.sectorHeads}
                    headTaps={sectionTaps}
                    onHeadPress={i => {
                      const href = sectionHeadHref(
                        sessionId,
                        model.sections,
                        i,
                        selection.laps,
                        set,
                      );
                      if (href) router.push(href);
                    }}
                  />
                </View>
              </>
            }
            ListFooterComponent={
              <View style={[styles.footer, {width: tableW}]}>
                {/* The grid comes after the lap table (Botkin, 2 Oct screenshots). */}
                <SessionGrid
                  id={sessionId}
                  day={day}
                  ticked={selection.laps}
                  onTap={lapId =>
                    onSelectionChange({
                      ...selection,
                      laps: toggle(selection.laps, lapId),
                    })
                  }
                />
                {layout.isDesktop ? null : (
                  <FoldedSection title='Tags' summary={null}>
                    <TagKey />
                  </FoldedSection>
                )}
                {/* The phone: the laps first, then the cards: Tires open, the rest folded to one line. */}
                {layout.isDesktop ? null : (
                  <>
                    {model.pitCard ? (
                      <FoldedSection
                        title={
                          model.pitCard.kind === 'stops' ? 'Pit stops' : 'Fuel'
                        }
                        summary={pitSummary(model.pitCard)}
                        defaultOpen={model.pitCard.kind === 'stops'}>
                        {model.energy ? (
                          <EnergyLineRow line={model.energy} />
                        ) : null}
                        {pitCard}
                      </FoldedSection>
                    ) : null}
                    {model.tires ? (
                      <FoldedSection
                        title='Tires'
                        summary={tiresSummary(model.tires)}
                        defaultOpen>
                        {tiresCard}
                      </FoldedSection>
                    ) : null}
                    {model.fuelUse && fuelCard ? (
                      <FoldedSection
                        title='Fuel use'
                        summary={fuelSummary(model.fuelUse.fuelUse)}>
                        {fuelCard}
                      </FoldedSection>
                    ) : null}
                  </>
                )}
              </View>
            }
            getItemLayout={(_, index) => ({
              length: ROW_H,
              offset: headerHeight.current + ROW_H * index,
              index,
            })}
            renderItem={({item}) => renderRow(item, tableW)}
          />
        </LinkedScrollContext.Provider>
        {layout.isDesktop && (
          <View style={[styles.side, {width: sideW}]}>
            {model.detail ? (
              <LapDetail
                detail={model.detail}
                onAction={detailAction}
                extra={
                  day ? null : (
                    <LapCandidates
                      sessionId={sessionId}
                      lapId={model.detail.lapId}
                    />
                  )
                }
              />
            ) : null}
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
  strip: {paddingBottom: space.md},
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
  // Wraps: the facts do not all fit on one row at 375 pt.
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
