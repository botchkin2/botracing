import {toggle as toggleTap} from '@/src/state/lapSelection';
import {useRouter} from 'expo-router';
import {type ReactNode, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {
  BrakeMap,
  brakeMapHeight,
  type BrakeMapMarker,
  DotStrip,
} from '@/src/charts';
import {
  hitBox,
  lapColor as slotColor,
  lapStroke,
  stroke,
  radius,
  size,
  space,
  useLayout,
  useTheme,
} from '@/src/design';
import {SessionNav} from '@/src/workspace/SessionNav';
import {compareHref, cornerHref} from '@/src/nav/routes';
import {type TraceLoad} from '@/src/data/traces';
import {usePanelWidth} from '@/src/state/panelPrefs';
import {
  Chip,
  FoldedSection,
  PANEL_DIVIDER_W,
  PanelDivider,
  StatusBanner,
  Text,
} from '@/src/ui';

import {
  type BrakeMapModel,
  type BrakeMapPoint,
  type CornerModel,
  type CornerRow,
  type CornerSelection,
  type Measure,
  MEASURES,
  sortRows,
} from './model';
import {type CornerBlock, cornerLayout} from './layout';
import {useCornerModel} from './useCornerModel';
import {SectionWindowCard} from './SectionWindowCard';
import {ZoomTraces, type ZoomHeights} from './ZoomTraces';

export type {CornerSelection} from './model';

// Zoomed trace heights: phone (handoff §4) and desktop (D3).
const PHONE_H: ZoomHeights = {
  speed: 96,
  brake: 52,
  throttle: 52,
  gear: 40,
  delta: 0,
  steering: 40,
  line: 0,
};
// Desktop: the whole snapshot (delta, speed, brake, throttle, steering, line)
// has to sit in a scrolling column, so the pedals are shorter than before.
const DESK_H: ZoomHeights = {
  speed: 180,
  brake: 100,
  throttle: 100,
  gear: 60,
  delta: 100,
  steering: 60,
  line: 130,
};
// The wide layout's charts are kept at least this wide when the left column
// is dragged out: what the old layout gave them at 1280 (layout.width 1000,
// less the 600 column, the divider and the gutters), so the default holds.
const WIDE_MIN_CHARTS_W = 350;
const BRAKE_MAP_H = 210;
// Four rows of 40 pt.
const WIDE_TABLE_BODY_H = 160;

export function CornerScreen({
  sessionId,
  corner,
  whole = false,
  selection,
  onSelectionChange,
}: {
  sessionId: string;
  corner: number;
  /** The compound corner's whole window ("All" in the Parts row). */
  whole?: boolean;
  selection: CornerSelection;
  onSelectionChange: (next: CornerSelection) => void;
}) {
  const layout = useLayout();
  // Distributions pay off with many laps: on the desktop, default to every
  // comparable lap when the selection has at most one (livery #264).
  const [allComparable, setAllComparable] = useState(
    layout.isWide && selection.laps.length <= 1,
  );
  const result = useCornerModel(
    sessionId,
    corner,
    selection,
    allComparable,
    whole,
  );
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
        ) : result.state === 'error' ? (
          <View style={styles.banner}>
            <StatusBanner
              dot='idle'
              text={`Couldn’t load this session: ${result.message}`}
              actionLabel='Retry'
              onAction={result.retry}
            />
          </View>
        ) : (
          <Text tone='textMuted'>
            {result.state === 'noLaps'
              ? 'No comparable laps in this session.'
              : result.noMap
              ? 'No corner map for this track yet.'
              : `No corner ${corner} on this track.`}
          </Text>
        )}
      </View>
    );
  return (
    <CornerView
      sessionId={sessionId}
      model={result.model}
      lapIds={result.lapIds}
      keyLapIds={result.keyLapIds}
      traceLoad={result.traceLoad}
      onRetryTraces={result.retryTraces}
      selection={selection}
      allComparable={allComparable}
      onAllComparable={setAllComparable}
      onSelectionChange={onSelectionChange}
    />
  );
}

function CornerView({
  sessionId,
  model,
  lapIds,
  keyLapIds,
  traceLoad,
  onRetryTraces,
  selection,
  allComparable,
  onAllComparable,
  onSelectionChange,
}: {
  sessionId: string;
  model: CornerModel;
  lapIds: string[];
  keyLapIds: string[];
  traceLoad: TraceLoad;
  onRetryTraces: () => void;
  selection: CornerSelection;
  allComparable: boolean;
  onAllComparable: (on: boolean) => void;
  onSelectionChange: (next: CornerSelection) => void;
}) {
  const {color, scheme} = useTheme();
  const layout = useLayout();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [sort, setSort] = useState<{by: Measure; dir: 'asc' | 'desc'}>({
    by: 'time',
    dir: 'asc',
  });

  const [notice, setNotice] = useState<string | null>(null);
  // Phone: the lap table is one tap away, the strips stay the first read.
  const count = lapIds.length;
  // A lap that is on has its own lap colour everywhere on the screen; the
  // rest keep the tinted or grey style of their mode.
  const lapStyle = (
    onIndex: number | null,
    selIndex: number,
    highlighted: boolean,
  ) =>
    onIndex != null
      ? {
          color: slotColor(scheme, onIndex),
          width: onIndex === 0 || highlighted ? stroke.ref : stroke.selected,
          opacity: 1,
        }
      : lapStroke(scheme, Math.max(1, selIndex), count, false);
  const lapColor = (
    onIndex: number | null,
    selIndex: number,
    highlighted: boolean,
  ) => lapStyle(onIndex, selIndex, highlighted).color;
  const highlight = (lapId: string) =>
    onSelectionChange({...selection, hl: lapId});
  // With every comparable lap drawn, a dot tap turns that lap on or off
  // (thread 27 #624); the laps on are the URL's `laps`, as in Compare.
  // A dot tap adds or removes that lap from the set on screen (no cap, no
  // reference lap: src/state/lapSelection.ts).
  const toggle = (lapId: string) =>
    onSelectionChange({...selection, laps: toggleTap(keyLapIds, lapId)});
  const canToggle = allComparable && model.strips != null;
  const rowOf = new Map(model.rows.map(r => [r.lapId, r] as const));
  const go = (n: number, whole = false) =>
    router.replace(
      cornerHref(sessionId, n, {laps: selection.laps, hl: selection.hl}, whole),
    );

  // One chip per section; a compound one (the bus stop) opens on its first
  // part, and its parts are a second row to drill into.
  const cornerChips = model.sections.map(s => (
    <Chip
      key={s.sectionN}
      label={s.label}
      minWidth={size.hit}
      selected={s.selected}
      onPress={() => go(s.firstCorner)}
    />
  ));
  // "All" first: the whole compound window as one corner. Its URL names the
  // first part, so a step back from All lands before the section.
  const allPartsChip = model.all ? (
    <Chip
      key='all'
      label='All'
      minWidth={size.hit}
      selected={model.all.selected}
      onPress={() => go(model.parts[0].n, true)}
    />
  ) : null;
  const partChips = model.parts.map(p => (
    <Chip
      key={p.n}
      label={p.label}
      minWidth={size.hit}
      selected={p.selected}
      onPress={() => go(p.n)}
    />
  ));

  // The Compare link and the corner step chips. On the phone they are pinned
  // above the scrolling page, so they stay in reach from any scroll position.
  const navRow = (
    <View style={styles.row}>
      <Pressable
        accessibilityRole='link'
        style={hitBox.link}
        hitSlop={space.md}
        onPress={() =>
          router.navigate(
            compareHref(sessionId, {
              laps: selection.laps,
              hl: selection.hl,
              corner: model.sectionN,
            }),
          )
        }>
        <Text variant='bodyStrong' tone='accentInk'>
          ‹ Compare
        </Text>
      </Pressable>
      <View style={styles.flex} />
      {model.prev != null && (
        <Chip label='‹' minWidth={size.hit} onPress={() => go(model.prev!)} />
      )}
      {model.next != null && (
        <Chip label='›' minWidth={size.hit} onPress={() => go(model.next!)} />
      )}
    </View>
  );

  const titleBlock = (
    <View style={styles.gap}>
      <Text variant='display'>{model.title}</Text>
      <Text variant='dataSmall' tone='textMuted'>
        {model.subtitle}
      </Text>
    </View>
  );
  // One line that scrolls sideways on both layouts: 25 corners wrapped to
  // four rows and pushed the table out of the first screen (D32).
  const seekChips = (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipsRow}>
      {cornerChips}
    </ScrollView>
  );
  const partsRow =
    partChips.length > 0 ? (
      <View style={styles.wrap}>
        <Text variant='label' tone='textMuted'>
          Parts
        </Text>
        {allPartsChip}
        {partChips}
      </View>
    ) : null;
  const allChip = (
    <View style={styles.row}>
      <Chip
        label={
          allComparable ? '✓ All comparable laps' : '+ All comparable laps'
        }
        selected={allComparable}
        onPress={() => onAllComparable(!allComparable)}
      />
    </View>
  );

  // The lap table. On a phone it folds under its own header, not under a chip
  // that reads like a lap label.
  const lapTable = (
    <CornerTable
      rows={
        layout.isWide ? sortRows(model.rows, sort.by, sort.dir) : model.rows
      }
      sortable={layout.isWide}
      sort={sort}
      onSort={by =>
        setSort(s =>
          s.by === by
            ? {by, dir: s.dir === 'asc' ? 'desc' : 'asc'}
            : {by, dir: by === 'minSpeed' ? 'desc' : 'asc'},
        )
      }
      lapColor={lapColor}
      onPressRow={highlight}
    />
  );

  const spread = (
    <View style={styles.gap}>
      {layout.isWide ? null : allChip}
      {model.window ? <SectionWindowCard window={model.window} /> : null}
      {model.strips ? (
        <View style={styles.gap}>
          {canToggle && selection.laps.length >= 2 ? (
            <View style={styles.row}>
              <Chip
                label='Reset to reference + best'
                onPress={() => {
                  setNotice(null);
                  onSelectionChange({
                    ...selection,
                    laps: selection.laps.slice(0, 1),
                  });
                }}
              />
            </View>
          ) : null}
          {notice ? (
            <Text variant='dataSmall' tone='textSecondary'>
              {notice}
            </Text>
          ) : null}
        </View>
      ) : null}
      {model.strips
        ? model.strips.map(s => (
            <View key={s.measure} style={styles.gap}>
              <View style={styles.row}>
                <Text variant='label' tone='textMuted'>
                  {s.label}
                </Text>
                <Text variant='dataSmall' tone='textFaint'>
                  {s.unit}
                </Text>
                <View style={styles.flex} />
                <Text variant='dataSmall' tone='textMuted'>
                  {s.summary}
                </Text>
              </View>
              {s.keyValues.length > 0 ? (
                <View style={styles.wrap}>
                  {s.keyValues.map(k => (
                    <Text
                      key={k.onIndex}
                      variant='dataSmall'
                      style={{color: slotColor(scheme, k.onIndex)}}>
                      {k.text}
                    </Text>
                  ))}
                </View>
              ) : null}
              {s.empty && s.flatNote ? null : s.empty ? (
                <Text variant='dataSmall' tone='textFaint'>
                  No lap has a {s.label.toLowerCase()} in this corner.
                </Text>
              ) : (
                <DotStrip
                  width={layout.isWide ? 440 : layout.contentWidth}
                  min={s.min}
                  max={s.max}
                  flipped={s.flipped}
                  band={s.band}
                  coincidentWithin={s.coincidentWithin}
                  minLabel={s.minLabel}
                  maxLabel={s.maxLabel}
                  unit={s.unit}
                  midLabel={s.midLabel}
                  resolution={s.resolution}
                  leftWord={s.leftWord}
                  rightWord={s.rightWord}
                  dots={s.dots.map(d => {
                    const on = d.onIndex != null;
                    return {
                      key: d.lapId,
                      value: d.value,
                      color: on
                        ? slotColor(scheme, d.onIndex as number)
                        : color.barNeutral,
                      r: on ? 4.2 : 2.8,
                      opacity: on ? 1 : d.flagged ? 0.25 : 0.55,
                      top: on,
                    };
                  })}
                  onPressDot={canToggle ? toggle : highlight}
                  pressLabel={id => {
                    const r = rowOf.get(id);
                    const name = r ? r.label : id;
                    if (!canToggle) return `Highlight ${name}`;
                    return `${name}: turn ${r?.onIndex != null ? 'off' : 'on'}`;
                  }}
                />
              )}
              {s.measure === 'throttle' ? (
                // One fixed line, so the strip does not jump when the count
                // appears or goes (round 5, item 7).
                <View style={styles.stripNote}>
                  {s.flatNote ? (
                    <Text variant='dataSmall' tone='textFaint'>
                      {s.flatNote}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          ))
        : null}
    </View>
  );

  // Desktop: the left column is resizable (kept per viewer); the charts take
  // all the width it leaves.
  const left = usePanelWidth(
    'corner',
    layout.width - WIDE_MIN_CHARTS_W - PANEL_DIVIDER_W - 2 * space.xl,
  );
  const tracesW = layout.isWide
    ? layout.width - left.width - PANEL_DIVIDER_W - 2 * space.xl
    : layout.contentWidth;
  const h = layout.isWide ? DESK_H : PHONE_H;
  const traces = (
    <ZoomTraces
      model={model}
      width={tracesW}
      heights={h}
      desktop={layout.isWide}
      lapStyle={lapStyle}
      load={traceLoad}
      onRetry={onRetryTraces}
    />
  );

  const top = {paddingTop: insets.top + space.lg};
  const plan = cornerLayout(layout.isWide);
  const shape = model.brakeMap ? (
    <BrakeMapPanel
      map={model.brakeMap}
      width={layout.isWide ? left.width - 2 * space.xl : layout.contentWidth}
      lapColor={lapColor}
    />
  ) : null;
  const blocks: Record<CornerBlock, ReactNode> = {
    charts: traces,
    shape,
    laps: lapTable,
    spread: (
      <FoldedSection title='Spread' summary={null}>
        {spread}
      </FoldedSection>
    ),
    nav: <SessionNav sessionId={sessionId} />,
  };
  const body = plan.order.map(id => <View key={id}>{blocks[id]}</View>);
  if (layout.isWide)
    return (
      <View
        style={[styles.screen, styles.columns, {backgroundColor: color.bg}]}>
        <ScrollView
          style={{width: left.width, flexGrow: 0}}
          contentContainerStyle={[styles.col, top]}>
          {navRow}
          {titleBlock}
          {seekChips}
          {partsRow}
          {allChip}
          {body}
        </ScrollView>
        <PanelDivider
          anchor='left'
          width={left.width}
          onResize={left.onResize}
          onCommit={left.onCommit}
          onReset={left.reset}
          label='Resize the braking map and measures panel'
        />
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.col, top]}>
          {traces}
        </ScrollView>
      </View>
    );
  // Phone: the Compare link and the corner chips stay pinned, so stepping is
  // in reach wherever the page is scrolled.
  return (
    <View style={[styles.screen, {backgroundColor: color.bg}]}>
      <View
        style={[
          styles.pinned,
          {backgroundColor: color.bg, paddingTop: top.paddingTop},
        ]}>
        {navRow}
        {seekChips}
        {partsRow}
      </View>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.col,
          {paddingTop: space.lg},
          // col pads by space.xl; contentWidth is the inside, so charts and
          // strips sized to it fit instead of overflowing past the gutter.
          {width: layout.contentWidth + 2 * space.xl, alignSelf: 'center'},
        ]}>
        {titleBlock}
        {body}
      </ScrollView>
    </View>
  );
}

// Phone: one horizontal ScrollView holds the whole measure block (header and
// every row), so the columns stay aligned when swiped. The lap column is pinned
// beside it, and rows and header have fixed heights so the two stay in step.
// Desktop (sortable) keeps CornerTable's own layout.
const PHONE_ROW_H = 52;
const PHONE_HEAD_H = 34;
const PHONE_CELL_W = 84;
const FADE = [0.15, 0.4, 0.75];

function PhoneCornerTable({
  rows,
  lapColor,
  onPressRow,
}: {
  rows: CornerRow[];
  lapColor: (
    onIndex: number | null,
    selIndex: number,
    highlighted: boolean,
  ) => string;
  onPressRow: (lapId: string) => void;
}) {
  const {color} = useTheme();
  const [viewW, setViewW] = useState(0);
  const [contentW, setContentW] = useState(0);
  const [x, setX] = useState(0);
  const more = contentW > viewW + 1 && x < contentW - viewW - 1;
  const rowStyle = (r: CornerRow) => [
    styles.phoneRow,
    {borderColor: color.line},
    r.highlighted && {backgroundColor: color.accentTint},
  ];
  return (
    <View style={styles.phoneTable}>
      <View style={styles.lapCol}>
        <View style={[styles.phoneHead, {borderColor: color.lineHeader}]}>
          <Text variant='tableHeader' tone='textMuted'>
            Lap
          </Text>
        </View>
        {rows.map(r => (
          <Pressable
            key={r.lapId}
            onPress={() => onPressRow(r.lapId)}
            style={rowStyle(r)}>
            <View style={styles.row}>
              <View
                style={[
                  styles.bar,
                  {
                    backgroundColor: lapColor(
                      r.onIndex,
                      r.selIndex,
                      r.highlighted,
                    ),
                  },
                ]}
              />
              <Text variant='dataStrong'>{r.label}</Text>
            </View>
            {r.isRef && (
              <Text variant='dataSmall' tone='textFaint'>
                REF
              </Text>
            )}
          </Pressable>
        ))}
      </View>
      <View
        style={styles.scrollBox}
        onLayout={e => setViewW(e.nativeEvent.layout.width)}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={e => setX(e.nativeEvent.contentOffset.x)}
          onContentSizeChange={w => setContentW(w)}>
          <View>
            <View
              style={[
                styles.phoneHead,
                styles.measures,
                {borderColor: color.lineHeader},
              ]}>
              {MEASURES.map(m => (
                <View key={m.id} style={styles.phoneCell}>
                  <Text
                    variant='tableHeader'
                    tone='textMuted'
                    style={styles.right}>
                    {m.label}
                  </Text>
                  <Text
                    variant='dataSmall'
                    tone='textFaint'
                    style={styles.right}>
                    {m.unit}
                  </Text>
                </View>
              ))}
            </View>
            {rows.map(r => (
              <Pressable
                key={r.lapId}
                onPress={() => onPressRow(r.lapId)}
                style={[...rowStyle(r), styles.measures]}>
                {MEASURES.map(m => {
                  const c = r.cells[m.id];
                  return (
                    <View key={m.id} style={styles.phoneCell}>
                      <Text variant='data' style={styles.right}>
                        {c.value}
                      </Text>
                      {c.gap != null && (
                        <Text
                          variant='dataSmall'
                          tone={
                            m.id === 'time'
                              ? c.better
                                ? 'faster'
                                : 'slower'
                              : 'textMuted'
                          }
                          style={styles.right}>
                          {c.gap}
                        </Text>
                      )}
                    </View>
                  );
                })}
              </Pressable>
            ))}
          </View>
        </ScrollView>
        {more && (
          <View style={styles.fade} pointerEvents='none'>
            {FADE.map(o => (
              <View
                key={o}
                style={[
                  styles.fadeBand,
                  {backgroundColor: color.bg, opacity: o},
                ]}
              />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

function CornerTable({
  rows,
  sortable,
  sort,
  onSort,
  lapColor,
  onPressRow,
}: {
  rows: CornerRow[];
  sortable: boolean;
  sort: {by: Measure; dir: 'asc' | 'desc'};
  onSort: (by: Measure) => void;
  lapColor: (
    onIndex: number | null,
    selIndex: number,
    highlighted: boolean,
  ) => string;
  onPressRow: (lapId: string) => void;
}) {
  const {color} = useTheme();
  if (!sortable)
    return (
      <PhoneCornerTable
        rows={rows}
        lapColor={lapColor}
        onPressRow={onPressRow}
      />
    );
  return (
    <View>
      <View
        style={[
          styles.tableRow,
          styles.tableHead,
          {backgroundColor: color.surface, borderColor: color.lineHeader},
        ]}>
        <Text variant='tableHeader' tone='textMuted' style={styles.lapCol}>
          Lap
        </Text>
        {MEASURES.map(m => {
          const active = sortable && sort.by === m.id;
          return (
            <Pressable
              key={m.id}
              disabled={!sortable}
              onPress={() => onSort(m.id)}
              style={styles.cellCol}>
              <Text
                variant='tableHeader'
                tone={active ? 'text' : 'textMuted'}
                style={styles.right}>
                {m.label}
                {active ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
              </Text>
              <Text variant='dataSmall' tone='textFaint' style={styles.right}>
                {m.unit}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <ScrollView
        style={styles.tableBody}
        nestedScrollEnabled
        showsVerticalScrollIndicator>
        {rows.map(r => (
          <Pressable
            key={r.lapId}
            onPress={() => onPressRow(r.lapId)}
            style={[
              styles.tableRow,
              {borderColor: color.line},
              r.highlighted && {backgroundColor: color.accentTint},
            ]}>
            <View style={styles.lapCol}>
              <View style={styles.row}>
                <View
                  style={[
                    styles.bar,
                    {
                      backgroundColor: lapColor(
                        r.onIndex,
                        r.selIndex,
                        r.highlighted,
                      ),
                    },
                  ]}
                />
                <Text variant='dataStrong'>{r.label}</Text>
              </View>
              {r.isRef && (
                <Text variant='dataSmall' tone='textFaint'>
                  REF
                </Text>
              )}
            </View>
            {MEASURES.map(m => {
              const c = r.cells[m.id];
              return (
                <View key={m.id} style={styles.cellCol}>
                  <Text variant='data' style={styles.right}>
                    {c.value}
                  </Text>
                  {c.gap != null && (
                    <Text
                      variant='dataSmall'
                      tone={
                        m.id === 'time'
                          ? c.better
                            ? 'faster'
                            : 'slower'
                          : 'textMuted'
                      }
                      style={styles.right}>
                      {c.gap}
                    </Text>
                  )}
                </View>
              );
            })}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

// Handoff D3: brake points are circles (key laps r 4.8, others r 2.8 grey at
// 55%); full-throttle points are squares (6 pt key, 4 pt others).
function BrakeMapPanel({
  map,
  width,
  lapColor,
}: {
  map: BrakeMapModel;
  width: number;
  lapColor: (
    onIndex: number | null,
    selIndex: number,
    highlighted: boolean,
  ) => string;
}) {
  const {color} = useTheme();
  const isKey = (p: BrakeMapPoint) => p.onIndex != null;
  const marker = (
    p: BrakeMapPoint,
    shape: BrakeMapMarker['shape'],
  ): BrakeMapMarker => ({
    key: `${shape}-${p.lapId}`,
    at: p.at,
    shape,
    size: shape === 'circle' ? (isKey(p) ? 4.8 : 2.8) : isKey(p) ? 6 : 4,
    color: isKey(p)
      ? lapColor(p.onIndex, p.selIndex, p.highlighted)
      : color.barNeutral,
    opacity: isKey(p) ? 1 : 0.55,
  });
  // Key laps last, so they sit on top of the grey spread.
  const markers = [
    ...map.throttles.map(p => marker(p, 'square')),
    ...map.brakes.map(p => marker(p, 'circle')),
  ].sort((a, b) => Number(a.opacity === 1) - Number(b.opacity === 1));
  return (
    <View style={styles.gap}>
      <Text variant='label' tone='textMuted'>
        Brake ● · full throttle ■
      </Text>
      <BrakeMap
        width={width}
        height={brakeMapHeight(width, map.centreline, BRAKE_MAP_H)}
        centreline={map.centreline}
        stretch={map.stretch}
        neighbours={map.neighbours}
        apex={map.apex}
        ticks={map.ticks}
        markers={markers}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1},
  pinned: {paddingHorizontal: space.xl, paddingBottom: space.sm},
  center: {alignItems: 'center', justifyContent: 'center'},
  banner: {alignSelf: 'stretch', paddingHorizontal: space.xl},
  flex: {flex: 1},
  col: {gap: space.lg, padding: space.xl, paddingBottom: space.xxxl},
  gap: {gap: space.xs},
  row: {flexDirection: 'row', alignItems: 'center', gap: space.sm},
  // Desktop: two columns bounded to the viewport, each scrolling on its own.
  columns: {flexDirection: 'row', alignItems: 'stretch', overflow: 'hidden'},
  // Vertical padding = the chips' 8 pt hit growth, or the scroll view clips it.
  chipsRow: {flexDirection: 'row', gap: space.sm, paddingVertical: space.md},
  // Row gap 2 x the chips' 8 pt vertical hit growth, so wrapped rows never overlap.
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: space.sm,
    rowGap: space.xl,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    borderBottomWidth: 1,
    gap: space.xs,
  },
  tableHead: {minHeight: 30, borderTopWidth: 1},
  // Wide: the rows scroll under a fixed header, sized so the shape, the table
  // and the Spread fold header share the first 1440x900 screen (D32).
  tableBody: {maxHeight: WIDE_TABLE_BODY_H},
  lapCol: {width: 44},
  cellCol: {flex: 1},
  phoneTable: {flexDirection: 'row'},
  phoneHead: {
    height: PHONE_HEAD_H,
    justifyContent: 'center',
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  phoneRow: {
    height: PHONE_ROW_H,
    justifyContent: 'center',
    borderBottomWidth: 1,
  },
  phoneCell: {width: PHONE_CELL_W, justifyContent: 'center'},
  measures: {flexDirection: 'row'},
  scrollBox: {flex: 1, overflow: 'hidden'},
  fade: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
  },
  fadeBand: {width: 8, height: '100%'},
  right: {textAlign: 'right'},
  bar: {width: 3, height: 14, borderRadius: radius.xs},
  stripNote: {minHeight: size.stripNote, justifyContent: 'center'},
});
