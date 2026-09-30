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

import {size, space, useLayout, useTheme} from '@/src/design';
import {trackHref} from '@/src/nav/routes';
import {Explainer, Text} from '@/src/ui';

import {useSessionDesktopModel} from '../desktopModel';
import {type RowModel, type Selection, type SessionScreenModel} from '../model';

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
}) {
  const {color} = useTheme();
  const router = useRouter();
  const layout = useLayout();
  const listRef = useRef<FlatList<RowModel>>(null);
  // layout.width already excludes the rail (the route's ContentInset).
  const centreW = layout.width - size.sidePanelWidth;
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
    if (!scrollToLapId) return;
    const index = model.rows.findIndex(
      r => r.kind === 'lap' && r.lapId === scrollToLapId,
    );
    if (index >= 0) listRef.current?.scrollToIndex({index, viewPosition: 0.5});
  }, [scrollToLapId, model.rows]);

  return (
    <View style={[styles.screen, {backgroundColor: color.bg}]}>
      <View
        style={[
          styles.centre,
          {width: centreW, borderColor: color.lineHeader},
        ]}>
        <View style={styles.head}>
          <View style={styles.titleBlock}>
            <Text variant='display' style={styles.title} numberOfLines={1}>
              {model.title}
            </Text>
            <View style={styles.subRow}>
              <Text
                variant='dataSmall'
                tone='textMuted'
                numberOfLines={1}
                style={styles.subtitle}>
                {model.subtitle}
              </Text>
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
            </View>
          </View>
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
              <Explainer>{tagKey}</Explainer>
            </View>
          }
        />
      </View>
      <View style={[styles.side, {width: size.sidePanelWidth}]}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.sideScroll}>
          <SidePanels
            sessionId={sessionId}
            selection={selection}
            colorOf={colorOf}
            onHighlight={onHighlight}
            cards={cards}
          />
          {detail ?? (
            <Explainer>
              Click a bar, a row or a dot to see that lap, and tick laps to
              compare.
            </Explainer>
          )}
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
}: {
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
      {cards}
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
  centre: {borderRightWidth: 1},
  head: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.xxl,
    paddingHorizontal: PAD_X,
    paddingTop: space.lg,
  },
  titleBlock: {flexShrink: 1, gap: space.xxs},
  title: {fontSize: 22},
  subRow: {flexDirection: 'row', alignItems: 'center', gap: space.md},
  subtitle: {flexShrink: 1},
  facts: {marginLeft: 'auto', flexDirection: 'row', gap: space.xxl},
  factValue: {fontSize: 15},
  chart: {paddingHorizontal: PAD_X, paddingTop: space.lg, gap: space.xs},
  rowPad: {paddingHorizontal: PAD_X},
  footer: {padding: PAD_X},
  side: {flexShrink: 0, flexDirection: 'column'},
  sideScroll: {padding: space.xl, gap: space.xl},
  tray: {padding: space.lg, borderTopWidth: 1},
});
