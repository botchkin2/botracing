import {useLocalSearchParams, useRouter} from 'expo-router';
import {useEffect, useMemo, useState} from 'react';
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
import {sessionHref, sessionsHref} from '@/src/nav/routes';
import {
  freshId,
  type FuelPreset,
  newPreset,
  useFuelPresets,
} from '@/src/state/fuelPresets';
import {
  Button,
  Chip,
  EmptyState,
  Explainer,
  NumberField,
  Segment,
  Skeleton,
  StatusBanner,
  Text,
} from '@/src/ui';

import {RaceCardView} from './components/RaceCardView';
import {StopsCardView} from './components/StopsCardView';
import {TankCardView} from './components/TankCardView';
import {lastRaceLine} from './lastRace';
import {defaultCombo, parseNumber, type PlanView, planCombos} from './model';
import {RulesEditor} from './RulesEditor';
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
  const combo = combos.find(c => c.key === comboKey) ?? defaultCombo(combos);
  // The latest few, and the one picked even if it is older.
  const shownCombos = showAll
    ? combos
    : combos.filter((c, i) => i < RECENT_COMBOS || c.key === combo?.key);
  const data = usePlanData(combo);
  const {preset, length, rules, view, plan, hist, limits} = data;
  const {lastFuel, pending: detailsPending} = limits;
  const {history, lapsOf, measured} = hist;

  const presets = useFuelPresets(s => s.presets);
  const activeId = useFuelPresets(s => s.activeId);
  const {save, remove, select, setLength} = useFuelPresets.getState();
  const [editing, setEditing] = useState<'new' | 'edit' | null>(null);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const width = Math.min(layout.contentWidth, PLAN_MAX_W);
  return (
    <ScrollView
      style={{backgroundColor: color.bg}}
      contentContainerStyle={[
        styles.page,
        {paddingTop: insets.top, paddingBottom: insets.bottom + space.xxl},
      ]}>
      <View style={[styles.column, {width}]}>
        {!layout.isWide ? (
          <Pressable
            accessibilityRole='link'
            onPress={() => router.navigate(sessionsHref())}
            style={hitBox.link}>
            <Text variant='bodyStrong' tone='accentInk'>
              ‹ Sessions
            </Text>
          </Pressable>
        ) : null}
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
        ) : (
          <>
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
                  label='No limits'
                  selected={preset == null}
                  onPress={() => {
                    select(null);
                    setEditing(null);
                  }}
                />
                {presets.map(p => (
                  <Chip
                    key={p.id}
                    label={p.name}
                    selected={p.id === activeId}
                    onPress={() => {
                      select(p.id);
                      setDraft(null);
                      setEditing(null);
                    }}
                  />
                ))}
                <Chip label='+ New' dashed onPress={() => setEditing('new')} />
              </View>
              {view ? (
                <Text variant='dataSmall' tone='textSecondary'>
                  {view.rulesLine}
                </Text>
              ) : null}
              {view?.stale ? (
                <StatusBanner
                  dot='idle'
                  text={`This preset may be stale: ${view.stale}.`}
                />
              ) : null}
              {preset && editing == null ? (
                <View style={styles.actions}>
                  <Button
                    label='Edit'
                    kind='outline'
                    onPress={() => setEditing('edit')}
                  />
                  <Button
                    label='Delete'
                    kind='tertiary'
                    onPress={() => remove(preset.id)}
                  />
                </View>
              ) : null}
              {editing ? (
                <RulesEditor
                  key={editing === 'edit' && preset ? preset.id : 'new'}
                  preset={editing === 'edit' ? preset : null}
                  lastFillLimitL={lastFuel?.fillLimitL ?? null}
                  lastVeRatio={
                    measured.find(m => m.ratio != null)?.ratio ?? null
                  }
                  onCancel={() => setEditing(null)}
                  onSave={fields => {
                    const base: FuelPreset =
                      editing === 'edit' && preset
                        ? preset
                        : newPreset(
                            fields.name,
                            {},
                            freshId(presets, presets.length + 1),
                            new Date().toISOString(),
                          );
                    save({
                      ...base,
                      ...fields,
                      length,
                      savedAt: new Date().toISOString(),
                    });
                    setEditing(null);
                  }}
                />
              ) : null}
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
                    <PlanCard
                      title='Per tank'
                      explainer={
                        data.fuelOnly
                          ? TANK_EXPLAINER_FUEL_ONLY
                          : TANK_EXPLAINER
                      }>
                      <TankCardView card={data.cards.tank} />
                    </PlanCard>
                  </>
                ) : null}
                {plan?.loadToFinish ? (
                  view.cards
                    .filter(c => c.key === 'load')
                    .map(card => <RowsCard key={card.key} card={card} />)
                ) : data.cards ? (
                  <PlanCard title='Stops' explainer={STOPS_EXPLAINER}>
                    <StopsCardView
                      card={data.cards.stops}
                      carClass={combo.sessions[0]?.carClass ?? ''}
                    />
                  </PlanCard>
                ) : null}
                {['dropStop', 'perLap'].flatMap(key =>
                  view.cards
                    .filter(c => c.key === key)
                    .map(card => <RowsCard key={card.key} card={card} />),
                )}
                <Explainer>{view.footnote}</Explainer>
              </>
            ) : null}
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

/** A card: the title, the content in a surface box, and the explainer under it. */
function PlanCard({
  title,
  explainer,
  children,
}: {
  title: string;
  explainer?: string;
  children: React.ReactNode;
}) {
  const {color} = useTheme();
  return (
    <Section title={title}>
      <View
        style={[
          styles.card,
          {backgroundColor: color.surface, borderColor: color.lineHeader},
        ]}>
        {children}
      </View>
      {explainer ? <Explainer>{explainer}</Explainer> : null}
    </Section>
  );
}

/** A card of label / value / note rows, as `planView` gives them. */
function RowsCard({card}: {card: PlanView['cards'][number]}) {
  return (
    <PlanCard title={card.title} explainer={card.explainer}>
      {card.rows.map((row, i) => (
        <View key={i} style={styles.rowBox}>
          <Text variant='label' tone='textMuted'>
            {row.label}
          </Text>
          <Text variant='data'>{row.value}</Text>
          {row.note ? (
            <Text variant='dataSmall' tone='textMuted'>
              {row.note}
            </Text>
          ) : null}
        </View>
      ))}
    </PlanCard>
  );
}

// A phone-first column; on a wide screen it stays readable, not stretched.
const PLAN_MAX_W = 640;

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text variant='label' tone='textMuted'>
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {alignItems: 'center'},
  column: {gap: space.xl, paddingHorizontal: size.gutter},
  head: {gap: space.xs, paddingTop: space.md},
  section: {gap: space.sm},
  // Row gap 2 x the chips' 8 pt vertical hit growth, so wrapped rows never overlap.
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: space.sm,
    rowGap: space.xl,
  },
  lengthRow: {flexDirection: 'row', alignItems: 'flex-end', gap: space.lg},
  actions: {flexDirection: 'row', gap: space.md},
  card: {
    gap: space.lg,
    padding: space.lg,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  rowBox: {gap: space.xs},
  lastRace: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.lg,
  },
  lastText: {flex: 1, gap: space.xxs},
});
