import {useLocalSearchParams, useRouter} from 'expo-router';
import {useEffect, useMemo, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {useSessions} from '@/src/data/sessions';
import {
  formatDate,
  hitBox,
  size,
  space,
  useLayout,
  useTheme,
} from '@/src/design';
import {sessionHref} from '@/src/nav/routes';
import {useFuelPresets} from '@/src/state/fuelPresets';
import {
  Chip,
  EmptyState,
  Explainer,
  NumberField,
  Segment,
  Skeleton,
  StatusBanner,
  Text,
} from '@/src/ui';

import {ClassTimingSection} from './components/ClassTimingSection';
import {PitPlanCard} from './components/PitPlanCard';
import {PlanCard, Section} from './components/PlanCard';
import {Pair, RowsCard} from './components/PlanCards';
import {RaceCardView} from './components/RaceCardView';
import {RulesSheet} from './components/RulesSheet';
import {StopsCardView} from './components/StopsCardView';
import {TankCardView} from './components/TankCardView';
import {lastRaceLine} from './lastRace';
import {effectiveUnit, type Unit, UNITS} from './unit';
import {defaultCombo, parseNumber, planCombos} from './model';
import {useClassTiming} from './useClassTiming';
import {usePitSlider} from './usePitSlider';
import {useLastRaceHere, usePlanData} from './usePlanData';

// Track and car chips shown before "All".
const RECENT_COMBOS = 6;

// Every session he has driven, for the track and car choices.
const ALL_TIME_DAYS = 3650;

const LENGTH_KINDS = [
  {value: 'min', label: 'Minutes'},
  {value: 'laps', label: 'Laps'},
] as const;

/**
 * The pre-race planner (pit wall thread 35): his own green laps at a track
 * and car, for one set of event rules, as numbers. It recommends nothing.
 */
export function PlanScreen() {
  const {color} = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const sessions = useSessions({ageDays: ALL_TIME_DAYS});
  const combos = useMemo(
    () => planCombos(sessions.data?.items ?? []),
    [sessions.data],
  );
  // A link from a session opens the plan on its track and car.
  const {combo: comboParam} = useLocalSearchParams<{combo?: string}>();
  const [comboKey, setComboKey] = useState<string | null>(comboParam ?? null);
  const [showAll, setShowAll] = useState(false);
  const [unit, setUnit] = useState<Unit>('ve');
  const combo = combos.find(c => c.key === comboKey) ?? defaultCombo(combos);
  // The latest few, and the one picked even if it is older.
  const shownCombos = showAll
    ? combos
    : combos.filter((c, i) => i < RECENT_COMBOS || c.key === combo?.key);
  const data = usePlanData(combo, unit);
  const slider = usePitSlider(data, combo?.key ?? '');
  const chosen = useMemo(
    () =>
      slider.pit
        ? {
            raceLaps: slider.pit.finishLaps,
            stopsAfter: slider.pit.stops.map(s => s.after),
          }
        : null,
    [slider.pit],
  );
  const classTiming = useClassTiming(combo ?? null, data, chosen);
  const {preset, length, rules, view, plan, hist, limits} = data;
  // The switch shows only where there is VE to switch to.
  const hasVe = !data.fuelOnly && plan?.perLap.ve != null;
  const {lastFuel, pending: detailsPending} = limits;
  const {history, lapsOf, measured} = hist;

  const presets = useFuelPresets(s => s.presets);
  const activeId = useFuelPresets(s => s.activeId);
  const {save, remove, select, setLength} = useFuelPresets.getState();
  const [rulesOpen, setRulesOpen] = useState(false);
  // The length as typed, while it is being typed; else the length in force.
  const [draft, setDraft] = useState<{key: string; text: string} | null>(null);
  const lengthText =
    draft && draft.key === combo?.key ? draft.text : String(length.value);

  // The newest race here fills the race length in laps, until a rule set is in
  // force or the length is typed: a saved preset is never overwritten silently.
  const lastRace = useLastRaceHere(combo);
  const [typedFor, setTypedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!combo || !lastRace || preset || typedFor === combo.key) return;
    const {value, kind} = useFuelPresets.getState().length;
    if (kind === 'laps' && value === lastRace.raceLaps) return;
    useFuelPresets
      .getState()
      .setLength({kind: 'laps', value: lastRace.raceLaps});
  }, [combo?.key, lastRace?.sessionId, preset?.id]);
  const prefillLine = !lastRace
    ? null
    : preset
    ? 'Length and rules are from the rule set ' +
      preset.name +
      ', not from this race.'
    : typedFor === combo?.key
    ? 'Length is typed here; the fill limit is from this race.'
    : 'Length and fill limit below are prefilled from it: ' +
      lastRace.raceLaps +
      ' racing laps, the formation lap not counted.';

  const wide = layout.isDesktop;
  // Phone: one column. Desktop: the setup on the left, the results beside it
  // (round 6 section 2, round 7 3C: the timeline spans the results column).
  const resultsW = wide
    ? Math.min(layout.contentWidth - SETUP_W - space.xxl, RESULTS_MAX_W)
    : Math.min(layout.contentWidth, PLAN_MAX_W);
  const width = wide ? SETUP_W + space.xxl + resultsW : resultsW;
  // A card's content: the column less its padding and 1 pt border.
  const cardInnerW = resultsW - 2 * (space.lg + 1);
  const setup = !combo ? null : (
    <>
      {hasVe ? (
        <Section title='Units'>
          <Segment options={UNITS} value={unit} onChange={setUnit} />
        </Section>
      ) : null}

      <Section title='Track and car'>
        <View style={styles.chips}>
          {shownCombos.map(c => (
            <Chip
              key={c.key}
              label={c.label}
              selected={c.key === combo.key}
              onPress={() => setComboKey(c.key)}
            />
          ))}
          {combos.length > RECENT_COMBOS ? (
            <Chip
              label={showAll ? 'Fewer' : `All ${combos.length}`}
              dashed
              onPress={() => setShowAll(v => !v)}
            />
          ) : null}
        </View>
      </Section>

      {lastRace ? (
        <Section title='Your last race here'>
          <View style={styles.lastRace}>
            <View style={styles.lastText}>
              <Text variant='dataSmall' tone='textSecondary'>
                {formatDate(lastRace.startedAt) +
                  ' · ' +
                  lastRaceLine(lastRace)}
              </Text>
              {prefillLine ? (
                <Text variant='dataSmall' tone='textMuted'>
                  {prefillLine}
                </Text>
              ) : null}
            </View>
            <Pressable
              accessibilityRole='link'
              onPress={() => router.push(sessionHref(lastRace.sessionId))}
              style={hitBox.link}>
              <Text variant='bodyStrong' tone='accentInk'>
                Session →
              </Text>
            </Pressable>
          </View>
        </Section>
      ) : null}

      <Section title='Race length'>
        <View style={styles.lengthRow}>
          <Segment
            options={LENGTH_KINDS}
            value={length.kind}
            onChange={kind => {
              setTypedFor(combo.key);
              setLength({kind, value: length.value});
            }}
          />
          <NumberField
            label={length.kind === 'min' ? 'Minutes' : 'Laps'}
            value={lengthText}
            onChange={text => {
              setDraft({key: combo.key, text});
              setTypedFor(combo.key);
              const value = parseNumber(text);
              if (value != null) setLength({kind: length.kind, value});
            }}
          />
        </View>
      </Section>

      <Section title='Event rules'>
        <View style={styles.chips}>
          <Chip
            label={'Rules: ' + (preset ? preset.name : 'No limits') + ' ▾'}
            onPress={() => setRulesOpen(true)}
          />
        </View>
        {view?.stale ? (
          <StatusBanner
            dot='idle'
            text={`This preset may be stale: ${view.stale}.`}
          />
        ) : null}
        <RulesSheet
          visible={rulesOpen}
          onClose={() => setRulesOpen(false)}
          presets={presets}
          activeId={activeId}
          preset={preset}
          rulesLine={view?.rulesLine ?? null}
          stale={view?.stale ?? null}
          length={length}
          lastFillLimitL={lastFuel?.fillLimitL ?? null}
          lastVeRatio={measured.find(m => m.ratio != null)?.ratio ?? null}
          onSelect={id => {
            select(id);
            setDraft(null);
          }}
          onSave={save}
          onRemove={remove}
        />
      </Section>

      {detailsPending ? (
        <StatusBanner
          dot='waiting'
          text='Checking the fill limit of your sessions here.'
        />
      ) : lapsOf.pending ? (
        <StatusBanner
          dot='waiting'
          text={`Loading the laps of ${history.length} ${
            history.length === 1 ? 'session' : 'sessions'
          }.`}
        />
      ) : lapsOf.failed > 0 ? (
        <StatusBanner
          dot='idle'
          text={`${lapsOf.failed} of ${history.length} sessions did not load; the numbers use the rest.`}
        />
      ) : null}
    </>
  );
  const results = !combo ? null : (
    <>
      {rules == null ? (
        <EmptyState
          title='Max fuel is needed'
          body='These sessions have no fill limit or tank on record. Make a preset with the max fuel of the event.'
        />
      ) : view && plan && plan.history.laps === 0 && !lapsOf.pending ? (
        <EmptyState
          title={
            history.length === 0 && !detailsPending
              ? `No sessions here at ${rules.rules.fuelL} L`
              : 'No fuel data for this combination yet'
          }
          body={
            history.length === 0 && !detailsPending
              ? 'The plan uses only sessions at the fill limit of these rules, because a balance-of-performance change moves fuel use. A session that started part-full is not counted either. Change the max fuel, or drive here at this limit.'
              : 'Fuel use is added to sessions when they are analysed. It arrives with the next resync of your history.'
          }
        />
      ) : view ? (
        <>
          {data.cards ? (
            <>
              <PlanCard title='Race'>
                <RaceCardView card={data.cards.race} />
              </PlanCard>
              {slider.pit ? (
                <PitPlanCard
                  pit={slider.pit}
                  planned={slider.planned}
                  unit={effectiveUnit(unit, hasVe)}
                  onStop={slider.setStop}
                  onReset={slider.reset}
                />
              ) : null}
              <ClassTimingSection
                timing={classTiming}
                // The stop line is where the slider has it.
                windows={data.cards.stops.windows.map((w, i) => ({
                  ...w,
                  planLap: slider.pit?.stops[i]?.after ?? w.planLap,
                }))}
                windowNote={data.cards.stops.windowNote}
                width={cardInnerW}
                onStop={slider.pit ? slider.setStop : undefined}
                wide={wide}
              />
            </>
          ) : null}
          <Pair wide={wide}>
            {data.cards ? (
              <PlanCard
                title='Per tank'
                explainer={
                  data.fuelOnly ? TANK_EXPLAINER_FUEL_ONLY : TANK_EXPLAINER
                }>
                <TankCardView card={data.cards.tank} />
              </PlanCard>
            ) : null}
            {plan?.loadToFinish ? (
              <>
                {view.cards
                  .filter(c => c.key === 'load')
                  .map(card => (
                    <RowsCard key={card.key} card={card} />
                  ))}
                {/* No stop planned: the late-flag run-dry case, if any. */}
                {data.cards?.stops.windowNote ? (
                  <Text variant='dataSmall' tone='textSecondary'>
                    {data.cards.stops.windowNote}
                  </Text>
                ) : null}
              </>
            ) : data.cards ? (
              <PlanCard title='Stops' explainer={STOPS_EXPLAINER}>
                <StopsCardView
                  card={data.cards.stops}
                  carClass={combo.sessions[0]?.carClass ?? ''}
                  unit={unit}
                />
              </PlanCard>
            ) : null}
          </Pair>
          <Pair wide={wide}>
            {['dropStop', 'perLap'].flatMap(key =>
              view.cards
                .filter(c => c.key === key)
                .map(card => <RowsCard key={card.key} card={card} />),
            )}
          </Pair>
          <Explainer>{view.footnote}</Explainer>
        </>
      ) : null}
    </>
  );
  return (
    <ScrollView
      style={{backgroundColor: color.bg}}
      contentContainerStyle={[
        styles.page,
        {paddingTop: insets.top, paddingBottom: insets.bottom + space.xxl},
      ]}>
      <View style={[styles.column, {width}]}>
        <View style={styles.head}>
          <Text variant='display'>Plan</Text>
          <Explainer>
            Your own clean laps at a track and car, worked through one set of
            event rules. Numbers only: it recommends nothing.
          </Explainer>
        </View>

        {sessions.isPending ? (
          <Skeleton height={size.hit} />
        ) : combos.length === 0 || !combo ? (
          <EmptyState
            title='No sessions to plan from'
            body='Drive and upload a session at a track first: the plan uses your laps there.'
          />
        ) : wide ? (
          <View style={styles.split}>
            <View style={[styles.stack, {width: SETUP_W}]}>{setup}</View>
            <View style={[styles.stack, {width: resultsW}]}>{results}</View>
          </View>
        ) : (
          <>
            {setup}
            {results}
          </>
        )}
      </View>
    </ScrollView>
  );
}

const TANK_EXPLAINER =
  'Laps one full load lasts. Bar = median use per lap, notch = p90 use. The shorter meter sets the stint length.';
const TANK_EXPLAINER_FUEL_ONLY =
  'Laps one full load lasts. Bar = median use per lap, notch = p90 use. This car has no VE; fuel sets the stint length.';
const STOPS_EXPLAINER =
  'Full tank: each stint runs until the meter that runs out first is empty, at median use. Equal stints are shown for comparison.';

// A phone-first column; on a wide screen it stays readable, not stretched.
const PLAN_MAX_W = 640;
// Desktop (round 6 section 2: the timeline card is 840 pt wide): the setup
// column, and the most the results column grows to.
const SETUP_W = 300;
const RESULTS_MAX_W = 840;

const styles = StyleSheet.create({
  page: {alignItems: 'center'},
  column: {gap: space.xl, paddingHorizontal: size.gutter},
  split: {flexDirection: 'row', gap: space.xxl, alignItems: 'flex-start'},
  stack: {gap: space.xl},
  head: {gap: space.xs, paddingTop: space.md},
  // Row gap 2 x the chips' 8 pt vertical hit growth, so wrapped rows never overlap.
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: space.sm,
    rowGap: space.xl,
  },
  lengthRow: {flexDirection: 'row', alignItems: 'flex-end', gap: space.lg},
  actions: {flexDirection: 'row', gap: space.md},
  lastRace: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.lg,
  },
  lastText: {flex: 1, gap: space.xxs},
});
