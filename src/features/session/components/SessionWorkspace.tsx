import {type ReactNode, useEffect, useRef} from 'react';
import {useRouter} from 'expo-router';
import {
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import {space, useLayout, useTheme} from '@/src/design';
import {trackHref} from '@/src/nav/routes';
import {PANEL_DIVIDER_W, PanelDivider, Text} from '@/src/ui';

import {useSessionDesktopModel} from '../desktopModel';
import {type RowModel, type Selection, type SessionScreenModel} from '../model';

import {EnergyLineRow} from './EnergyLineRow';
import {LapDistribution} from './LapDistribution';
import {LapTableHeader, WIDE_ROW_H} from './LapTableRow';
import {StintCornerBars} from './StintCornerBars';
import {StintsPanel} from './StintsPanel';

// Centre column side padding from the handoff D1 (bars 780 wide at 1440).
const PAD_X = space.xl + space.xs;

/**
 * Desktop (≥1280) D1 Session workspace: centre (header, lap-time bars, wide
 * lap table) and a 340 pt right column (stints, distribution, stint vs stint,
 * lap detail, compare tray). The rail sits left of it in the route. Only
 * rearranges the phone's components; the screen passes them in.
 */
export function SessionWorkspace({
  sessionId,
  model,
  selection,
  onSelectionChange,
  colorOf,
  onHighlight,
  scrollToLapId,
  chart,
  detail,
  tray,
  cards,
  renderRow,
  tagKey,
  pitFocus,
  side,
}: {
  sessionId: string;
  model: SessionScreenModel;
  selection: Selection;
  onSelectionChange: (next: Selection) => void;
  colorOf: (selIndex: number) => string;
  /** Highlights a lap and scrolls its row into view (dot taps). */
  onHighlight: (lapId: string) => void;
  /** Set when a bar tap should bring its table row into view. */
  scrollToLapId: string | null;
  chart: (width: number) => ReactNode;
  detail: ReactNode;
  tray: ReactNode;
  /** The race pit review or the practice fuel card, under the stints; null for other sessions. */
  cards: ReactNode;
  renderRow: (row: RowModel, width: number) => ReactNode;
  tagKey: string;
  /** Set when a pit row was tapped: the side column scrolls to the cards. */
  pitFocus: {lapIndex: number; at: number} | null;
  /** The right column's width and the divider's handlers (usePanelWidth). */
  side: {
    width: number;
    onResize: (width: number) => void;
    onCommit: (width: number) => void;
    reset: () => void;
  };
}) {
  const {color} = useTheme();
  const router = useRouter();
  const layout = useLayout();
  const listRef = useRef<FlatList<RowModel>>(null);
  const sideRef = useRef<ScrollView>(null);
  const cardsY = useRef(0);
  // layout.width already excludes the rail (the route's ContentInset).
  const centreW = layout.width - side.width - PANEL_DIVIDER_W;
  const innerW = centreW - PAD_X * 2;

  // Esc clears the highlight (handoff desktop keyboard notes).
  useEffect(() => {
    if (Platform.OS !== 'web' || !selection.hl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSelectionChange({...selection, hl: null});
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, onSelectionChange]);

  useEffect(() => {
    if (pitFocus)
      sideRef.current?.scrollTo({y: cardsY.current, animated: true});
  }, [pitFocus]);

  useEffect(() => {
    if (!scrollToLapId) return;
    const index = model.rows.findIndex(
      r => r.kind === 'lap' && r.lapId === scrollToLapId,
    );
    if (index >= 0) listRef.current?.scrollToIndex({index, viewPosition: 0.5});
  }, [scrollToLapId, model.rows]);

  return (
    <View style={[styles.screen, {backgroundColor: color.bg}]}>
      <View style={{width: centreW}}>
        <View style={styles.head}>
          {/* The bar names the session (round 6), so the head is the stats row. */}
          {model.trackId ? (
            <Pressable
              accessibilityRole='link'
              onPress={() => router.push(trackHref(model.trackId))}
              hitSlop={space.md}>
              <Text variant='dataSmall' tone='accentInk'>
                Track page ›
              </Text>
            </Pressable>
          ) : null}
          <View style={styles.facts}>
            {model.facts.map(f => (
              <View key={f.label}>
                <Text variant='tableHeader' tone='textMuted'>
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
        </View>
        <View style={styles.extra}>
          {model.energy ? (
            <EnergyLineRow
              line={model.energy}
              onPress={() =>
                sideRef.current?.scrollTo({y: cardsY.current, animated: true})
              }
            />
          ) : null}
          {model.optimum.length > 0 ? (
            <>
              <View style={styles.optimum}>
                {model.optimum.map(f => (
                  <View key={f.label}>
                    <Text variant='tableHeader' tone='textMuted'>
                      {f.label}
                    </Text>
                    <Text variant='dataStrong' style={styles.factValue}>
                      {f.value}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}
        </View>
        <View style={styles.chart}>{chart(innerW)}</View>
        <View style={[styles.rowPad, {backgroundColor: color.surface}]}>
          <LapTableHeader width={innerW} wide />
        </View>
        <FlatList
          ref={listRef}
          style={styles.flex}
          data={model.rows}
          keyExtractor={r => (r.kind === 'lap' ? r.lapId : r.key)}
          getItemLayout={(_, index) => ({
            length: WIDE_ROW_H,
            offset: WIDE_ROW_H * index,
            index,
          })}
          renderItem={({item}) => (
            <View style={styles.rowPad}>{renderRow(item, innerW)}</View>
          )}
          ListFooterComponent={
            <View style={styles.footer}>
              <Text variant='dataSmall' tone='textMuted'>
                {tagKey}
              </Text>
            </View>
          }
        />
      </View>
      <PanelDivider
        width={side.width}
        onResize={side.onResize}
        onCommit={side.onCommit}
        onReset={side.reset}
        label='Resize the lap detail and cards panel'
      />
      <View style={[styles.side, {width: side.width}]}>
        <ScrollView
          ref={sideRef}
          style={styles.flex}
          contentContainerStyle={styles.sideScroll}>
          <SidePanels
            onCardsY={y => {
              cardsY.current = y;
            }}
            sessionId={sessionId}
            selection={selection}
            colorOf={colorOf}
            onHighlight={onHighlight}
            cards={cards}
          />
          {detail}
        </ScrollView>
        {tray && (
          <View
            style={[
              styles.tray,
              {backgroundColor: color.surface, borderColor: color.lineHeader},
            ]}>
            {tray}
          </View>
        )}
      </View>
    </View>
  );
}

function SidePanels({
  sessionId,
  selection,
  colorOf,
  onHighlight,
  cards,
  onCardsY,
}: {
  onCardsY: (y: number) => void;
  sessionId: string;
  selection: Selection;
  colorOf: (selIndex: number) => string;
  onHighlight: (lapId: string) => void;
  /** Drawn right under the stints table. */
  cards: ReactNode;
}) {
  const desk = useSessionDesktopModel(sessionId, selection);
  if (!desk) return null;
  return (
    <>
      {desk.stints.length > 0 && <StintsPanel rows={desk.stints} />}
      <View onLayout={e => onCardsY(e.nativeEvent.layout.y)}>{cards}</View>
      {desk.distribution && (
        <LapDistribution
          model={desk.distribution}
          colorOf={colorOf}
          onPressLap={onHighlight}
        />
      )}
      {desk.stintVsStint && <StintCornerBars model={desk.stintVsStint} />}
    </>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, flexDirection: 'row'},
  flex: {flex: 1},
  head: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.xxl,
    paddingHorizontal: PAD_X,
    paddingTop: space.lg,
  },
  facts: {marginLeft: 'auto', flexDirection: 'row', gap: space.xxl},
  factValue: {fontSize: 15},
  // Under the stats row: the optimal-lap facts.
  extra: {paddingHorizontal: PAD_X, paddingTop: space.sm, gap: space.sm},
  helpRow: {flexDirection: 'row', alignItems: 'center', gap: space.sm},
  optimum: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.xxl,
  },
  chart: {paddingHorizontal: PAD_X, paddingTop: space.lg, gap: space.xs},
  rowPad: {paddingHorizontal: PAD_X},
  footer: {padding: PAD_X},
  side: {flexShrink: 0, flexDirection: 'column'},
  sideScroll: {padding: space.xl, gap: space.xl},
  tray: {padding: space.lg, borderTopWidth: 1},
});
