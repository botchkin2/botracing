import {useRouter} from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {radius, size, space, useLayout, useTheme} from '@/src/design';
import {cornerHref, sessionHref, trackHref, tracksHref} from '@/src/nav/routes';
import {Text} from '@/src/ui';

import {AboutBlock} from './components/AboutBlock';
import {CornerList} from './components/CornerList';
import {FactTiles} from './components/FactTiles';
import {HistoryPanel} from './components/HistoryPanel';
import {LayoutChips} from './components/LayoutChips';
import {PlanBlock} from './components/PlanBlock';
import {TrackMapPanel} from './components/TrackMapPanel';
import {type Combo} from '../plan/model';

import {type TrackModel} from './model';
import {useTrackModel} from './useTrackModel';

// Track page (Claude Design "Track page" v1 handoff): one layout's facts,
// its corners and the driver's own history there. Phone: one scrolling
// column (05). Desktop ≥1280: map | corners | history (T1); 900–1279: map
// and corners, history under the corners.

type Actions = {
  toggleCorner: (n: number) => void;
  openCorner: (n: number) => void;
  openSession: (sessionId: string) => void;
  openLayout: (trackId: string) => void;
};

export function TrackScreen({
  trackId,
  selectedCorner,
  onSelectCorner,
}: {
  trackId: string;
  selectedCorner: number | null;
  onSelectCorner: (n: number | null) => void;
}) {
  const {color} = useTheme();
  const router = useRouter();
  const layout = useLayout();
  const state = useTrackModel(trackId, selectedCorner);

  if (state.kind !== 'ready') {
    return (
      <View style={[styles.center, {backgroundColor: color.bg}]}>
        {state.kind === 'loading' ? (
          <ActivityIndicator color={color.textMuted} />
        ) : (
          <Text tone='textMuted'>{state.message}</Text>
        )}
      </View>
    );
  }

  const {refSessionId} = state;
  const actions: Actions = {
    toggleCorner: n => onSelectCorner(n === selectedCorner ? null : n),
    openCorner: n => {
      if (refSessionId) router.push(cornerHref(refSessionId, n));
    },
    openSession: id => router.push(sessionHref(id)),
    openLayout: id => router.replace(trackHref(id)),
  };
  const props = {
    model: state.model,
    plans: state.plans,
    mapLoading: state.mapLoading,
    attribution: state.attribution,
    canOpenCorner: refSessionId != null,
    actions,
  };
  return layout.isDesktop ? (
    <TrackDesktop {...props} wide={layout.isWide} width={layout.width} />
  ) : (
    <TrackPhone
      {...props}
      width={layout.contentWidth}
      onBack={() => router.navigate(tracksHref())}
    />
  );
}

type ViewProps = {
  model: TrackModel;
  plans: Combo[];
  mapLoading: boolean;
  attribution: string | null;
  canOpenCorner: boolean;
  actions: Actions;
};

function Title({model}: {model: TrackModel}) {
  const {color} = useTheme();
  return (
    <View style={styles.title}>
      <Text variant='pageTitle'>{model.title}</Text>
      {model.country ? (
        <View style={styles.country}>
          {model.countryCode ? (
            <Text
              variant='dataSmall'
              tone='textSecondary'
              style={[styles.cc, {borderColor: color.median}]}>
              {model.countryCode}
            </Text>
          ) : null}
          <Text variant='dataSmall' tone='textMuted'>
            {model.country}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function TrackPhone({
  model,
  plans,
  mapLoading,
  attribution,
  canOpenCorner,
  actions,
  width,
  onBack,
}: ViewProps & {width: number; onBack: () => void}) {
  const {color} = useTheme();
  const insets = useSafeAreaInsets();
  const sel = model.selection;
  return (
    <ScrollView
      style={{backgroundColor: color.bg}}
      contentContainerStyle={[
        styles.phone,
        {paddingTop: insets.top, paddingBottom: insets.bottom + space.xxl},
      ]}>
      <Pressable accessibilityRole='link' onPress={onBack} style={styles.back}>
        <Text variant='bodyStrong' tone='accentInk'>
          ‹ Tracks
        </Text>
      </Pressable>
      <Title model={model} />
      <TrackMapPanel
        map={model.map}
        width={width}
        height={size.trackMapPhone}
        large={false}
        selected={model.selection?.n ?? null}
        onToggle={actions.toggleCorner}
        attribution={attribution}
        loading={mapLoading}
      />
      <FactTiles facts={model.facts} layout='grid' />
      {model.corners.length > 0 ? (
        <View>
          <Text variant='label'>Corners</Text>
          <View style={styles.bleed}>
            <CornerList
              groups={model.corners}
              compact={false}
              onToggle={actions.toggleCorner}
            />
          </View>
          {sel && canOpenCorner ? (
            <Pressable
              accessibilityRole='link'
              onPress={() => actions.openCorner(sel.n)}
              style={styles.selLine}>
              <Text variant='body' tone='textSecondary'>
                {sel.label}
              </Text>
              <Text variant='body' tone='accentInk'>
                Corner screen →
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <PlanBlock combos={plans} />
      {model.history ? (
        <HistoryPanel
          history={model.history}
          width={width}
          compact={false}
          onOpenSession={actions.openSession}
        />
      ) : null}
      {model.about ? <AboutBlock about={model.about} /> : null}
      <LayoutChips layouts={model.layouts} onOpen={actions.openLayout} />
    </ScrollView>
  );
}

function TrackDesktop({
  model,
  plans,
  mapLoading,
  attribution,
  canOpenCorner,
  actions,
  wide,
  width,
}: ViewProps & {wide: boolean; width: number}) {
  const {color} = useTheme();
  const sel = model.selection;
  const mapColW = wide ? size.trackColMap : Math.round(width * 0.58);
  const mapW = mapColW - space.xl * 2 - space.xs;
  const mapH = wide ? size.trackMapDesk : Math.round(mapW * 0.8);
  const history = (
    <>
      <PlanBlock combos={plans} />
      {model.history ? (
        <HistoryPanel
          history={model.history}
          width={size.trackColHistory - space.xl * 2}
          compact
          onOpenSession={actions.openSession}
        />
      ) : null}
      {model.about ? <AboutBlock about={model.about} /> : null}
    </>
  );
  const corners = (
    <View style={styles.cornersCol}>
      <View style={styles.colHead}>
        <Text variant='label'>Corners</Text>
      </View>
      <ScrollView style={styles.fill}>
        <CornerList
          groups={model.corners}
          compact
          onToggle={actions.toggleCorner}
        />
        {!wide ? <View style={styles.colBody}>{history}</View> : null}
      </ScrollView>
      <View
        style={[
          styles.footer,
          {backgroundColor: color.surface, borderColor: color.lineHeader},
        ]}>
        {sel ? (
          <>
            <Text variant='dataStrong' numberOfLines={1} style={styles.fill}>
              {sel.label}
            </Text>
            {canOpenCorner ? (
              <Pressable
                accessibilityRole='link'
                onPress={() => actions.openCorner(sel.n)}
                style={[styles.primary, {backgroundColor: color.accent}]}>
                <Text variant='bodyStrong' style={{color: color.bg}}>
                  Corner →
                </Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </View>
    </View>
  );
  return (
    <View style={[styles.fill, {backgroundColor: color.bg}]}>
      <View style={[styles.strip, {borderColor: color.lineHeader}]}>
        <Title model={model} />
        <FactTiles facts={model.facts} layout='row' />
      </View>
      <View style={styles.body}>
        <ScrollView
          style={[
            styles.mapCol,
            {width: mapColW, borderColor: color.lineHeader},
          ]}
          contentContainerStyle={styles.mapColBody}>
          <View style={styles.mapHead}>
            <Text variant='label'>Track map</Text>
          </View>
          <TrackMapPanel
            map={model.map}
            width={mapW}
            height={mapH}
            large
            selected={model.selection?.n ?? null}
            onToggle={actions.toggleCorner}
            attribution={attribution}
            loading={mapLoading}
          />
          <LayoutChips layouts={model.layouts} onOpen={actions.openLayout} />
        </ScrollView>
        <View
          style={[
            wide ? {width: size.trackColCorners} : styles.fill,
            styles.divider,
            {borderColor: color.lineHeader},
          ]}>
          {corners}
        </View>
        {wide ? (
          <ScrollView
            style={{width: size.trackColHistory}}
            contentContainerStyle={styles.colBody}>
            {history}
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  fill: {flex: 1, minWidth: 0},
  phone: {paddingHorizontal: size.gutter, gap: space.xxl - 2},
  back: {height: size.hit, justifyContent: 'center'},
  title: {gap: space.xs, flexShrink: 1},
  country: {flexDirection: 'row', alignItems: 'center', gap: space.md},
  cc: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.xs,
    overflow: 'hidden',
  },
  bleed: {marginHorizontal: -size.gutter, marginTop: space.md},
  selLine: {
    height: size.hit,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  strip: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.xxl + space.xs,
    justifyContent: 'space-between',
    paddingHorizontal: space.xl + space.xs,
    paddingTop: space.lg + 2,
    paddingBottom: space.lg,
    borderBottomWidth: 1,
  },
  body: {flex: 1, flexDirection: 'row', minHeight: 0},
  mapCol: {flexGrow: 0, borderRightWidth: 1},
  mapColBody: {
    paddingHorizontal: space.xl + space.xs,
    paddingVertical: space.lg + 2,
    gap: space.md,
  },
  mapHead: {flexDirection: 'row', alignItems: 'baseline', gap: space.md + 2},
  divider: {borderRightWidth: 1},
  cornersCol: {flex: 1, minHeight: 0},
  colHead: {
    paddingHorizontal: space.xl,
    paddingTop: space.lg + 2,
    paddingBottom: space.md,
  },
  colBody: {
    paddingHorizontal: space.xl,
    paddingTop: space.lg + 2,
    paddingBottom: space.xl + space.xs,
    gap: space.xl + space.xs,
  },
  footer: {
    minHeight: size.hit + space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md + 2,
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    borderTopWidth: 1,
  },
  primary: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
  },
});
