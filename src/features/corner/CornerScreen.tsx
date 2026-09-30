import {useRouter} from 'expo-router';
import {useState} from 'react';
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
  type BrakeMapMarker,
  DotStrip,
  TraceChart,
} from '@/src/charts';
import {
  lapColors,
  lapStroke,
  stroke,
  radius,
  space,
  useLayout,
  useTheme,
  turnLabel,
} from '@/src/design';
import {compareHref, cornerHref} from '@/src/nav/routes';
import {type TraceLoad} from '@/src/data/traces';
import {
  Chip,
  Explainer,
  Skeleton,
  StatusBanner,
  Text,
  TraceRetryBanner,
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
  type ZoomLine,
} from './model';
import {MAX_ON_LAPS, toggleLap} from './keyLaps';
import {useCornerModel} from './useCornerModel';

export type {CornerSelection} from './model';

// Zoomed trace heights: phone (handoff §4) and desktop (D3).
const PHONE_H = {speed: 96, brake: 52, throttle: 52};
const DESK_H = {speed: 226, brake: 122, throttle: 122};
const DESK_LEFT_W = 600;
const DESK_RIGHT_W = 840;
const BRAKE_MAP_H = 210;

export function CornerScreen({
  sessionId,
  corner,
  selection,
  onSelectionChange,
}: {
  sessionId: string;
  corner: number;
  selection: CornerSelection;
  onSelectionChange: (next: CornerSelection) => void;
}) {
  const layout = useLayout();
  // Distributions pay off with many laps: on the desktop, default to every
  // comparable lap when the selection has at most one (livery #264).
  const [allComparable, setAllComparable] = useState(
    layout.isWide && selection.laps.length <= 1,
  );
  const result = useCornerModel(sessionId, corner, selection, allComparable);
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
          color: lapColors[scheme][onIndex],
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
  const toggle = (lapId: string) => {
    const r = toggleLap(keyLapIds, lapId);
    if (r.kind === 'full')
      return setNotice(
        `${MAX_ON_LAPS - 1} laps on besides the reference. Tap one off first.`,
      );
    if (r.kind === 'reference')
      return setNotice('The reference stays on. Change it in Compare.');
    setNotice(null);
    onSelectionChange({...selection, laps: r.laps});
  };
  const canToggle = allComparable && model.strips != null;
  const rowOf = new Map(model.rows.map(r => [r.lapId, r] as const));
  const go = (n: number) =>
    router.replace(
      cornerHref(sessionId, n, {laps: selection.laps, hl: selection.hl}),
    );

  const header = (
    <View style={styles.gap}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole='link'
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
          <Chip label='‹' onPress={() => go(model.prev!)} />
        )}
        {model.next != null && (
          <Chip label='›' onPress={() => go(model.next!)} />
        )}
      </View>
      <Text variant='display'>{model.title}</Text>
      <Text variant='dataSmall' tone='textMuted'>
        {model.subtitle}
      </Text>
      <View style={styles.wrap}>
        {model.corners.map(n => (
          <Chip
            key={n}
            label={turnLabel(n)}
            selected={n === model.corner}
            onPress={() => go(n)}
          />
        ))}
        <Chip
          label={
            allComparable ? '✓ All comparable laps' : '+ All comparable laps'
          }
          selected={allComparable}
          onPress={() => onAllComparable(!allComparable)}
        />
      </View>
    </View>
  );

  const measures = (
    <View style={styles.gap}>
      {model.strips ? (
        <View style={styles.gap}>
          <Text variant='explainer' tone='textMuted'>
            {canToggle
              ? 'Coloured dots are the laps on; grey dots are the other comparable laps. Tap a dot to turn that lap on or off.'
              : 'Coloured dots are the laps on; grey dots are the other laps. Tap a dot to highlight it.'}
          </Text>
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
              {s.note ? (
                <Text variant='explainer' tone='textMuted'>
                  {s.note}
                </Text>
              ) : null}
              {s.keyValues.length > 0 ? (
                <View style={styles.wrap}>
                  {s.keyValues.map(k => (
                    <Text
                      key={k.onIndex}
                      variant='dataSmall'
                      style={{color: lapColors[scheme][k.onIndex]}}>
                      {k.text}
                    </Text>
                  ))}
                </View>
              ) : null}
              {s.empty ? (
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
                  resolution={s.resolution}
                  leftWord={s.leftWord}
                  rightWord={s.rightWord}
                  dots={s.dots.map(d => {
                    const on = d.onIndex != null;
                    return {
                      key: d.lapId,
                      value: d.value,
                      color: on
                        ? lapColors[scheme][d.onIndex as number]
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
            </View>
          ))
        : null}
      {(!model.strips || layout.isWide) && (
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
      )}
      {model.highlightLine && (
        <Text variant='dataSmall' tone='textSecondary'>
          {model.highlightLine}
        </Text>
      )}
      <Explainer>{model.explainer}</Explainer>
    </View>
  );

  const tracesW = layout.isWide ? DESK_RIGHT_W - 40 : layout.contentWidth;
  const h = layout.isWide ? DESK_H : PHONE_H;
  const traces = (
    <ZoomTraces
      model={model}
      width={tracesW}
      heights={h}
      lapStyle={lapStyle}
      load={traceLoad}
      onRetry={onRetryTraces}
    />
  );

  const top = {paddingTop: insets.top + space.lg};
  if (layout.isWide)
    return (
      <View
        style={[styles.screen, styles.columns, {backgroundColor: color.bg}]}>
        <ScrollView
          style={{width: DESK_LEFT_W, flexGrow: 0}}
          contentContainerStyle={[styles.col, top]}>
          {header}
          {model.brakeMap && (
            <BrakeMapPanel map={model.brakeMap} lapColor={lapColor} />
          )}
          {measures}
        </ScrollView>
        <ScrollView
          style={{width: DESK_RIGHT_W, flexGrow: 0}}
          contentContainerStyle={[styles.col, top]}>
          {model.highlightLine && (
            <Text variant='dataStrong'>{model.highlightLine}</Text>
          )}
          {traces}
        </ScrollView>
      </View>
    );
  return (
    <ScrollView
      style={[styles.screen, {backgroundColor: color.bg}]}
      contentContainerStyle={[
        styles.col,
        top,
        // col pads by space.xl; contentWidth is the inside, so charts and
        // strips sized to it fit instead of overflowing past the gutter.
        {width: layout.contentWidth + 2 * space.xl, alignSelf: 'center'},
      ]}>
      {header}
      {measures}
      {traces}
    </ScrollView>
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
            </Pressable>
          );
        })}
      </View>
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
    </View>
  );
}

// Handoff D3: brake points are circles (key laps r 4.8, others r 2.8 grey at
// 55%); full-throttle points are squares (6 pt key, 4 pt others).
function BrakeMapPanel({
  map,
  lapColor,
}: {
  map: BrakeMapModel;
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
        Where each lap braked
      </Text>
      <BrakeMap
        width={DESK_LEFT_W - 40}
        height={BRAKE_MAP_H}
        centreline={map.centreline}
        apex={map.apex}
        ticks={map.ticks}
        markers={markers}
      />
      <Explainer>
        Circles are brake points and squares are full-throttle points, placed on
        the reference lap’s line at that distance. The laps on are in colour.
      </Explainer>
    </View>
  );
}

function ZoomTraces({
  model,
  width,
  heights,
  lapStyle,
  load,
  onRetry,
}: {
  model: CornerModel;
  width: number;
  heights: {speed: number; brake: number; throttle: number};
  load: TraceLoad;
  onRetry: () => void;
  lapStyle: (
    onIndex: number | null,
    selIndex: number,
    highlighted: boolean,
  ) => {color: string; width: number; opacity: number};
}) {
  const {zoom} = model;
  const rank = (l: ZoomLine) =>
    l.onIndex === 0 ? 2 : l.onIndex != null ? 1 : 0;
  const lines = [...zoom.lines].sort((a, b) => rank(a) - rank(b));
  const series = (pick: (l: ZoomLine) => number[]) =>
    lines.map(l => {
      const s = lapStyle(l.onIndex, l.selIndex, l.highlighted);
      return {
        key: l.lapId,
        values: pick(l),
        color: s.color,
        width: s.width,
        opacity: s.opacity,
      };
    });
  const apex = [{m: zoom.apexM, label: 'Apex', solid: true}];
  const pointMarks = (at: (l: ZoomLine) => number | null) =>
    lines
      .filter(l => l.key && at(l) != null)
      .map(l => ({
        m: at(l) as number,
        color: lapStyle(l.onIndex, l.selIndex, l.highlighted).color,
      }));
  const speedDomain = domainIn(
    lines.map(l => l.speedKph),
    zoom.windowM,
    zoom.stepM,
  );
  const common = {
    width,
    stepM: zoom.stepM,
    windowM: zoom.windowM,
    cursorM: -1,
    gridOriginM: zoom.apexM,
  };
  if (lines.length === 0)
    return (
      <View style={styles.gap}>
        {load.kind === 'failed' && (
          <TraceRetryBanner
            failed={load.failed}
            othersShow={load.kind === 'partial'}
            onRetry={onRetry}
          />
        )}
        <Text variant='label' tone='textMuted'>
          Speed km/h
        </Text>
        <Skeleton height={heights.speed} />
        <Text variant='label' tone='textMuted'>
          Brake %
        </Text>
        <Skeleton height={heights.brake} />
        <Text variant='label' tone='textMuted'>
          Throttle %
        </Text>
        <Skeleton height={heights.throttle} />
      </View>
    );
  return (
    <View style={styles.gap}>
      {load.kind === 'partial' && (
        <TraceRetryBanner
          failed={load.failed}
          othersShow={load.kind === 'partial'}
          onRetry={onRetry}
        />
      )}
      <Text variant='label' tone='textMuted'>
        Speed km/h
      </Text>
      <TraceChart
        {...common}
        height={heights.speed}
        domain={speedDomain}
        series={series(l => l.speedKph)}
        band={
          zoom.band
            ? {low: zoom.band.speed[0], high: zoom.band.speed[1]}
            : undefined
        }
        marks={apex}
      />
      <Text variant='label' tone='textMuted'>
        Brake %
      </Text>
      <TraceChart
        {...common}
        height={heights.brake}
        domain={[-4, 104]}
        series={series(l => l.brakePct)}
        marks={[...apex, ...pointMarks(l => l.brakeAtM)]}
      />
      <Text variant='label' tone='textMuted'>
        Throttle %
      </Text>
      <TraceChart
        {...common}
        height={heights.throttle}
        domain={[-4, 104]}
        series={series(l => l.throttlePct)}
        marks={[...apex, ...pointMarks(l => l.fullThrottleAtM)]}
      />
    </View>
  );
}

function domainIn(
  arrays: number[][],
  [a, b]: [number, number],
  stepM: number,
): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  const from = Math.max(0, Math.floor(a / stepM));
  const to = Math.ceil(b / stepM);
  for (const arr of arrays)
    for (let i = from; i <= Math.min(to, arr.length - 1); i++) {
      lo = Math.min(lo, arr[i]);
      hi = Math.max(hi, arr[i]);
    }
  if (!Number.isFinite(lo)) return [0, 1];
  const pad = (hi - lo) * 0.06 || 1;
  return [lo - pad, hi + pad];
}

const styles = StyleSheet.create({
  screen: {flex: 1},
  center: {alignItems: 'center', justifyContent: 'center'},
  banner: {alignSelf: 'stretch', paddingHorizontal: space.xl},
  flex: {flex: 1},
  col: {gap: space.lg, padding: space.xl, paddingBottom: space.xxxl},
  gap: {gap: space.xs},
  row: {flexDirection: 'row', alignItems: 'center', gap: space.sm},
  // Desktop: two columns bounded to the viewport, each scrolling on its own.
  columns: {flexDirection: 'row', alignItems: 'stretch', overflow: 'hidden'},
  wrap: {flexDirection: 'row', flexWrap: 'wrap', gap: space.sm},
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    borderBottomWidth: 1,
    gap: space.xs,
  },
  tableHead: {minHeight: 30, borderTopWidth: 1},
  lapCol: {width: 44},
  cellCol: {flex: 1},
  right: {textAlign: 'right'},
  bar: {width: 3, height: 14, borderRadius: radius.xs},
});
