import {useRouter} from 'expo-router';
import {useMemo, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {planRace} from '@/src/analysis/fuelPlan';
import {
  useSession,
  useSessions,
  useSessionsDetail,
  useSessionsLaps,
} from '@/src/data/sessions';
import {hitBox, radius, size, space, useLayout, useTheme} from '@/src/design';
import {sessionsHref} from '@/src/nav/routes';
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

import {
  greenLapsOf,
  historySessions,
  parseNumber,
  planCombos,
  planView,
  rulesFor,
  veRatioFor,
  veRatioOf,
} from './model';
import {RulesEditor} from './RulesEditor';

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
  const [comboKey, setComboKey] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const combo = combos.find(c => c.key === comboKey) ?? combos[0] ?? null;
  // The latest few, and the one picked even if it is older.
  const shownCombos = showAll
    ? combos
    : combos.filter((c, i) => i < RECENT_COMBOS || c.key === combo?.key);
  const history = useMemo(() => (combo ? historySessions(combo) : []), [combo]);
  const ids = useMemo(() => history.map(s => s.id), [history]);
  const lapsOf = useSessionsLaps(ids);
  const sessionDetails = useSessionsDetail(ids);
  const last = useSession(ids[0] ?? '');
  const lastFuel = last.data?.fuel ?? null;

  const presets = useFuelPresets(s => s.presets);
  const activeId = useFuelPresets(s => s.activeId);
  const length = useFuelPresets(s => s.length);
  const {save, remove, select, setLength} = useFuelPresets.getState();
  const preset = presets.find(p => p.id === activeId) ?? null;
  const [editing, setEditing] = useState<'new' | 'edit' | null>(null);
  const [lengthText, setLengthText] = useState(String(length.value));

  // The litres one VE % is worth: the preset's, else measured in the newest
  // session there (VE % per lap depends on the load; thread 35 #1004).
  const measured = history.map((s, i) => ({
    startedAt: s.startedAt,
    // The uploader's value first (analysisVersion 11), else measured here.
    ratio:
      sessionDetails.details[i]?.fuel?.litresPerVePct ??
      (lapsOf.laps[i] ? veRatioOf(lapsOf.laps[i]) : null),
    fillLimitL: sessionDetails.details[i]?.fuel?.fillLimitL ?? null,
  }));
  const ratio = veRatioFor(preset, measured);
  const greenLaps = history.flatMap((s, i) => {
    const laps = lapsOf.laps[i];
    return laps ? greenLapsOf(s.id, laps, ratio ? ratio.perPctL : null) : [];
  });
  const rules = rulesFor(preset, length, lastFuel);
  const plan = rules ? planRace(rules.rules, greenLaps) : null;
  const view =
    rules && plan
      ? planView(preset, rules, plan, {
          since:
            history.length > 0 ? history[history.length - 1].startedAt : null,
          lastFillLimitL: lastFuel?.fillLimitL ?? null,
          ratio,
          lastRatio: measured.find(m => m.ratio != null)?.ratio ?? null,
          ratioLoadsL: [
            ...new Set(
              measured
                .filter(m => m.ratio != null && m.fillLimitL != null)
                .map(m => m.fillLimitL as number),
            ),
          ],
        })
      : null;

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

            <Section title='Race length'>
              <View style={styles.lengthRow}>
                <Segment
                  options={LENGTH_KINDS}
                  value={length.kind}
                  onChange={kind => setLength({kind, value: length.value})}
                />
                <NumberField
                  label={length.kind === 'min' ? 'Minutes' : 'Laps'}
                  value={lengthText}
                  onChange={text => {
                    setLengthText(text);
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
                      setLengthText(String(p.length.value));
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

            {lapsOf.pending ? (
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
                title='No fuel data for this combination yet'
                body='Fuel use is added to sessions when they are analysed. It arrives with the next resync of your history.'
              />
            ) : view ? (
              <>
                {view.cards.map(card => (
                  <Section key={card.key} title={card.title}>
                    <View
                      style={[
                        styles.card,
                        {
                          backgroundColor: color.surface,
                          borderColor: color.lineHeader,
                        },
                      ]}>
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
                    </View>
                    <Explainer>{card.explainer}</Explainer>
                  </Section>
                ))}
                <Explainer>{view.footnote}</Explainer>
              </>
            ) : null}
          </>
        )}
      </View>
    </ScrollView>
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
});
