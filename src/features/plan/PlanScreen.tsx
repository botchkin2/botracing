import {useLocalSearchParams, useRouter} from 'expo-router';
import {useMemo, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {useSessions} from '@/src/data/sessions';
import {
  formatDate,
  hitBox,
  radius,
  size,
  space,
  useLayout,
  useTheme,
} from '@/src/design';
import {sessionHref} from '@/src/nav/routes';
import {useFuelPresets} from '@/src/state/fuelPresets';
import {EmptyState, Segment, Skeleton, StatusBanner, Text} from '@/src/ui';

import {ClassTimingSection} from './components/ClassTimingSection';
import {PitPlanCard} from './components/PitPlanCard';
import {PlanCard, Section} from './components/PlanCard';
import {eventLabel} from './planEvent';
import {LengthStepper} from './components/LengthStepper';
import {StartLoad} from './components/StartLoad';
import {PooledUseCard} from './components/PooledUseCard';
import {RulesBlock} from './components/RulesBlock';
import {TrackCarPicker} from './components/TrackCarPicker';
import {LoadTableCard, Pair, RowsCard} from './components/PlanCards';
import {RaceCardView} from './components/RaceCardView';
import {StopsCardView} from './components/StopsCardView';
import {TankCardView} from './components/TankCardView';
import {lastRaceLine} from './lastRace';
import {effectiveUnit, type Unit, UNITS} from './unit';
import {
  carChoices,
  comboCar,
  comboTrack,
  defaultCombo,
  parseNumber,
  planCombos,
  rulesCells,
  startChips,
  trackChoices,
} from './model';
import {useClassTiming} from './useClassTiming';
import {usePitSlider} from './usePitSlider';
import {useLastRaceHere, usePlanData} from './usePlanData';

// Every session he has driven, for the track and car choices.
const ALL_TIME_DAYS = 3650;

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
  const [unit, setUnit] = useState<Unit>('ve');
  const combo = combos.find(c => c.key === comboKey) ?? defaultCombo(combos);
  // What the car starts with, as typed for this track and car; blank is a full
  // load, and the last race's start is only offered (parc #1902).
  const [startTyped, setStartTyped] = useState<{
    key: string;
    ve: string;
    fuel: string;
  } | null>(null);
  const startText =
    startTyped && startTyped.key === combo?.key
      ? startTyped
      : {key: combo?.key ?? '', ve: '', fuel: ''};
  const start = {
    vePct: parseNumber(startText.ve),
    fuelL: parseNumber(startText.fuel),
  };
  // The event being planned: a series week at this track and car; the newest
  // one until another is picked (thread 44 #1983).
  const [eventPick, setEventPick] = useState<{
    key: string;
    week: string;
  } | null>(null);
  const eventWeek =
    eventPick && eventPick.key === combo?.key ? eventPick.week : null;
  const data = usePlanData(combo, unit, start, eventWeek);
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
  // The length as typed, while it is being typed; else the length in force.
  const [draft, setDraft] = useState<{key: string; text: string} | null>(null);
  const lengthText =
    draft && draft.key === combo?.key ? draft.text : String(length.value);

  // The race length is the driver's: Minutes until he picks otherwise (he has
  // never run a lap-based race, pit-wall thread 44 #1954). The newest race of
  // the planned event prefills the fill limit and the start chips, not the length.
  const lastRace = useLastRaceHere(combo, data.limits.event);

  const wide = layout.isDesktop;
  // Phone: one column. Desktop: the setup on the left and the results beside
  // it (round 6 section 2, round 7 3C: the timeline spans the results column);
  // at the wide breakpoint the use and lap time scatter takes a third column
  // (D6a).
  const three = layout.isWide;
  const avail = Math.min(layout.width, size.planPage) - 2 * size.gutter;
  const railW = three ? size.planRail + space.xxl : 0;
  const resultsW = wide
    ? Math.min(avail - size.planSetup - space.xxl - railW, size.planResults)
    : Math.min(layout.contentWidth, size.planColumn);
  const width = wide ? size.planSetup + space.xxl + resultsW + railW : resultsW;
  // A card's content: the column less its padding and 1 pt border.
  const cardInnerW = resultsW - 2 * (space.lg + 1);
  // An event's load: the largest fill limit among its sessions, so a start
  // below the full load (his choice, "fuel is time") never reads as the cap.
  const eventLoadL = (e: {sessionIds: string[]}) => {
    const loads = e.sessionIds.flatMap(id => {
      const i = combo?.sessions.findIndex(x => x.id === id) ?? -1;
      const l = i >= 0 ? limits.limitsL[i] : null;
      return l == null ? [] : [l];
    });
    return loads.length > 0 ? Math.max(...loads) : null;
  };
  const ruleSheet = {
    presets,
    activeId,
    preset,
    rulesLine: view?.rulesLine ?? null,
    stale: view?.stale ?? null,
    length,
    lastFillLimitL: lastFuel?.fillLimitL ?? null,
    lastVeRatio: measured.find(m => m.ratio != null)?.ratio ?? null,
    events: limits.events.map(e => ({
      week: e.week,
      label: eventLabel(e, eventLoadL(e)),
      selected: preset == null && e.week === limits.event?.week,
    })),
    onEvent: (week: string) => {
      select(null);
      setDraft(null);
      if (combo) setEventPick({key: combo.key, week});
    },
    onSelect: (id: string | null) => {
      select(id);
      setDraft(null);
    },
    onSave: save,
    onRemove: remove,
  };
  const rulesBlock = (compact: boolean) => (
    <RulesBlock
      cells={rulesCells(
        rules?.rules ?? null,
        hasVe,
        hist.ratio?.perPctL ?? null,
        data.formation,
      )}
      sheet={ruleSheet}
      eventText={data.eventText}
      compact={compact}
    />
  );
  // The order of 07a: the chips (track, car, rules on the phone), the last
  // race under them, then the length. Desktop (D6a) gives the rules their own
  // block with its numbers under the length.
  const setup = !combo ? null : (
    <>
      {hasVe ? (
        <Section title='Units'>
          <Segment options={UNITS} value={unit} onChange={setUnit} />
        </Section>
      ) : null}

      <TrackCarPicker
        track={comboTrack(combo)}
        car={comboCar(combo)}
        tracks={trackChoices(combos, combo)}
        cars={carChoices(combos, combo)}
        onPick={setComboKey}>
        {wide ? null : rulesBlock(true)}
      </TrackCarPicker>
      {!wide && view?.stale ? (
        <StatusBanner
          dot='idle'
          text={`This preset may be stale: ${view.stale}.`}
        />
      ) : null}

      {lastRace ? (
        <Section title='Your last race here'>
          <View style={styles.lastRace}>
            <View style={styles.lastText}>
              <Text variant='dataSmall' tone='textSecondary'>
                {formatDate(lastRace.startedAt) +
                  ' · ' +
                  lastRaceLine(lastRace)}
              </Text>
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

      <Section title='Length'>
        <LengthStepper
          kind={length.kind}
          text={lengthText}
          onKind={kind => {
            setLength({kind, value: length.value});
          }}
          onText={text => {
            setDraft({key: combo.key, text});
            const value = parseNumber(text);
            if (value != null) setLength({kind: length.kind, value});
          }}
          onStep={delta => {
            setDraft(null);
            setLength({
              kind: length.kind,
              value: Math.max(1, length.value + delta),
            });
          }}
        />
      </Section>

      {rules ? (
        <Section title='Start'>
          <StartLoad
            hasVe={hasVe}
            veText={startText.ve}
            fuelText={startText.fuel}
            full={{fuelL: rules.rules.fuelL, vePct: rules.rules.vePct}}
            chips={startChips(
              lastRace?.start ?? null,
              {fuelL: rules.rules.fuelL, vePct: rules.rules.vePct},
              hasVe,
            )}
            onVe={ve => setStartTyped({...startText, ve})}
            onFuel={fuel => setStartTyped({...startText, fuel})}
          />
        </Section>
      ) : null}

      {wide ? (
        <Section title='Rules'>
          {rulesBlock(false)}
          {view?.stale ? (
            <StatusBanner
              dot='idle'
              text={`This preset may be stale: ${view.stale}.`}
            />
          ) : null}
        </Section>
      ) : null}

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
  // Use and lap time (D6a): the green laps the plan reads, in the unit shown.
  const scatter =
    combo && view && wide ? (
      <View
        style={[
          styles.rail,
          {backgroundColor: color.surface, borderColor: color.lineHeader},
        ]}>
        <PooledUseCard
          planKey={combo.key}
          sessionId={lastRace?.sessionId ?? ''}
          width={(three ? size.planRail : resultsW) - 2 * (space.lg + 1)}
          measure={effectiveUnit(unit, hasVe)}
        />
      </View>
    ) : null;
  const results = !combo ? null : (
    <>
      {rules == null ? (
        <EmptyState title='Max fuel is needed' />
      ) : view && plan && plan.history.laps === 0 && !lapsOf.pending ? (
        <EmptyState
          title={
            history.length === 0 && !detailsPending
              ? `No sessions here at ${rules.rules.fuelL} L`
              : 'No fuel data for this combination yet'
          }
        />
      ) : view ? (
        <>
          <Pair wide={wide}>
            {data.cards ? (
              <PlanCard title='Race'>
                <RaceCardView card={data.cards.race} />
              </PlanCard>
            ) : null}
            {data.cards ? (
              <PlanCard title='Per tank'>
                <TankCardView card={data.cards.tank} />
              </PlanCard>
            ) : null}
          </Pair>
          {data.cards && slider.pit ? (
            <PitPlanCard
              pit={slider.pit}
              planned={slider.planned}
              unit={effectiveUnit(unit, hasVe)}
              wide={wide}
              onStop={slider.setStop}
              onReset={slider.reset}
            />
          ) : null}
          {plan?.loadToFinish ? (
            <>
              {view.loadTable ? <LoadTableCard table={view.loadTable} /> : null}
              {/* No stop planned: the late-flag run-dry case, if any. */}
              {data.cards?.stops.windowNote ? (
                <Text variant='dataSmall' tone='textSecondary'>
                  {data.cards.stops.windowNote}
                </Text>
              ) : null}
            </>
          ) : data.cards ? (
            <PlanCard title='Stops'>
              <StopsCardView
                card={data.cards.stops}
                carClass={combo.sessions[0]?.carClass ?? ''}
              />
            </PlanCard>
          ) : null}
          {data.cards ? (
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
          ) : null}
          <Pair wide={wide}>
            {['dropStop', 'perLap'].flatMap(key =>
              view.cards
                .filter(c => c.key === key)
                .map(card => <RowsCard key={card.key} card={card} />),
            )}
          </Pair>
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
        </View>

        {sessions.isPending ? (
          <Skeleton height={size.hit} />
        ) : combos.length === 0 || !combo ? (
          <EmptyState title='No sessions to plan from' />
        ) : wide ? (
          <View style={styles.split}>
            <View style={[styles.stack, {width: size.planSetup}]}>{setup}</View>
            <View style={[styles.stack, {width: resultsW}]}>
              {results}
              {three ? null : scatter}
            </View>
            {three ? (
              <View style={[styles.stack, {width: size.planRail}]}>
                {scatter}
              </View>
            ) : null}
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

const styles = StyleSheet.create({
  page: {alignItems: 'center'},
  column: {gap: space.xl, paddingHorizontal: size.gutter},
  split: {flexDirection: 'row', gap: space.xxl, alignItems: 'flex-start'},
  stack: {gap: space.xl},
  rail: {
    padding: space.lg,
    borderWidth: 1,
    borderRadius: radius.md,
  },
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
