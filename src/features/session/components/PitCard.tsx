import {type ReactNode} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';

import {SplitBar} from '@/src/charts';
import {size, space, useTheme} from '@/src/design';
import {Explainer, Text, useHowToRead} from '@/src/ui';

import {
  type FuelCard,
  type PitCard as PitCardModel,
  type PitColumn,
  type StopsCard,
  type WheelWear,
} from '../pitCard';
import {PIT_REVIEW_HELP} from '../pitReview';

/**
 * The race's Pit stops card (round 5 item 3): a "Fuel" card when nothing was
 * stopped for, otherwise one column per stop with the measure names pinned on
 * the left so the same measure reads across. One or two stops share the width;
 * three or more are fixed columns that scroll sideways inside the card (the
 * page itself never scrolls sideways). `plan` is the lower half, "Plan vs what
 * happened", passed in by the route so this feature does not import the plan's.
 */
export function PitCard({
  card,
  width,
  plan,
  focusLapIndex,
}: {
  card: PitCardModel;
  /** The width the card may use, in points. */
  width: number;
  plan?: ReactNode;
  /** The stop a pit row in the lap table pointed at: its column is marked. */
  focusLapIndex?: number | null;
}) {
  const {color} = useTheme();
  const help = useHowToRead('the pit stops', PIT_REVIEW_HELP);
  return (
    <View style={styles.card}>
      <View style={styles.title}>
        <Text variant='label'>
          {card.kind === 'fuel' ? 'Fuel' : 'Pit stops'}
        </Text>
        {help.button}
      </View>
      <Explainer>
        {card.kind === 'fuel'
          ? 'No stops. What was in the car at the start, what was used, and what was left.'
          : 'Per stop: what was left on the way in, what was added, time in the pit lane, and tyres.'}
      </Explainer>
      {help.panel}
      {card.kind === 'fuel' ? (
        <FuelBody card={card} width={width} />
      ) : (
        <StopsBody
          card={card}
          width={width}
          focusLapIndex={focusLapIndex ?? null}
        />
      )}
      {plan ? (
        <View style={[styles.plan, {borderColor: color.lineStrong}]}>
          {plan}
        </View>
      ) : null}
    </View>
  );
}

function FuelBody({card, width}: {card: FuelCard; width: number}) {
  const {color} = useTheme();
  const cell = (label: string, value: string, note: string | null) => (
    <View style={[styles.fuelRow, {borderColor: color.line}]}>
      <Text variant='label' tone='textMuted'>
        {label}
      </Text>
      <Text variant='dataStrong'>{value}</Text>
      {note ? (
        <Text variant='dataSmall' tone='textMuted'>
          {note}
        </Text>
      ) : null}
    </View>
  );
  const used = card.end.usedShare;
  return (
    <View>
      {cell('Start', card.start.value, card.start.note)}
      {cell('Used', card.used.value, card.used.note)}
      {cell(card.end.title, card.end.value, null)}
      {used != null ? (
        <View style={styles.bar}>
          <SplitBar
            width={width}
            parts={[
              {value: used, ink: 'dim'},
              {value: 1 - used, ink: 'bright'},
            ]}
            label={`Used ${Math.round(used * 100)} % of what was loaded`}
          />
          <Text variant='dataSmall' tone='textMuted'>
            grey = used · white = left
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function StopsBody({
  card,
  width,
  focusLapIndex,
}: {
  card: StopsCard;
  width: number;
  focusLapIndex: number | null;
}) {
  const {color} = useTheme();
  const scroll = card.layout === 'scroll';
  const colW = scroll
    ? size.pitCol
    : Math.floor((width - size.pitKey) / card.columns.length);
  // Bars take a column's inner width, so they line up with their value.
  const barW = colW - space.md;
  const laneMax = Math.max(0, ...card.columns.map(c => c.lane?.laneS ?? 0));
  const rows = [
    {key: 'head', label: '', h: size.pitHeadRow},
    {key: 'in', label: 'In', h: size.pitRow},
    {key: 'added', label: 'Added', h: size.pitRow},
    ...(card.hasVe ? [{key: 'veOut', label: 'VE out', h: size.pitBarRow}] : []),
    {key: 'lane', label: 'Pit lane', h: size.pitBarRow},
    {key: 'tyres', label: 'Tyres', h: size.pitTyreRow},
  ];
  const cellOf = (c: PitColumn, key: string) => {
    switch (key) {
      case 'head':
        return (
          <>
            <Text variant='bodyStrong'>{c.title}</Text>
            <Text variant='dataSmall' tone='textMuted'>
              {c.after}
            </Text>
          </>
        );
      case 'in':
        return valueNote(c.inTank.value, c.inTank.note);
      case 'added':
        return valueNote(c.added.value, c.added.note);
      case 'veOut':
        return c.veOut ? (
          <>
            {valueNote(c.veOut.value, c.veOut.note)}
            <SplitBar
              width={barW}
              total={100}
              parts={[
                {value: c.veOut.leftPct, ink: 'bright'},
                {value: c.veOut.addedPct, ink: 'dim'},
              ]}
              label={`VE out ${c.veOut.value}: ${Math.round(
                c.veOut.leftPct,
              )} % left and ${Math.round(c.veOut.addedPct)} % added`}
            />
          </>
        ) : (
          dash()
        );
      case 'lane':
        return c.lane ? (
          <>
            {valueNote(c.lane.value, c.lane.note)}
            <SplitBar
              width={barW}
              total={laneMax}
              parts={
                c.lane.refuelS != null
                  ? [
                      {value: c.lane.refuelS, ink: 'bright'},
                      {value: c.lane.laneS - c.lane.refuelS, ink: 'dim'},
                    ]
                  : [{value: c.lane.laneS, ink: 'dim'}]
              }
              label={`Pit lane ${c.lane.value}`}
            />
          </>
        ) : (
          dash()
        );
      default:
        return c.tyres ? (
          <>
            <Text variant='dataStrong'>{c.tyres}</Text>
            {c.wheels ? <WheelGrid wheels={c.wheels} /> : null}
          </>
        ) : (
          dash()
        );
    }
  };
  const columns = card.columns.map(c => (
    <View
      key={c.key}
      style={[
        scroll ? {width: size.pitCol} : styles.flexCol,
        styles.col,
        {borderColor: color.line},
        c.lapIndex === focusLapIndex && {backgroundColor: color.surfaceRaised},
      ]}>
      {rows.map(r => (
        <View
          key={r.key}
          style={[styles.cell, {minHeight: r.h, borderColor: color.line}]}>
          {cellOf(c, r.key)}
        </View>
      ))}
    </View>
  ));
  return (
    <View>
      <View style={styles.table}>
        <View style={{width: size.pitKey}}>
          {rows.map(r => (
            <View
              key={r.key}
              style={[styles.cell, {minHeight: r.h, borderColor: color.line}]}>
              <Text variant='label' tone='textMuted'>
                {r.label}
              </Text>
            </View>
          ))}
        </View>
        {scroll ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.flexCol}>
            {columns}
          </ScrollView>
        ) : (
          columns
        )}
      </View>
      {card.key.map(line => (
        <Text key={line} variant='dataSmall' tone='textMuted'>
          {line}
        </Text>
      ))}
      {card.refuelScope ? (
        <Text variant='dataSmall' tone='textMuted'>
          {card.refuelScope}
        </Text>
      ) : null}
      {card.end ? (
        <View style={[styles.end, {borderColor: color.line}]}>
          <Text variant='bodyStrong'>{card.end.title}</Text>
          <Text variant='dataSmall' tone='textMuted'>
            the last whole lap
          </Text>
          <Text variant='label' tone='textMuted'>
            Spare
          </Text>
          <Text variant='dataStrong'>{card.end.spare}</Text>
          {card.end.last ? (
            <>
              <Text variant='label' tone='textMuted'>
                Last stop
              </Text>
              <Text variant='dataSmall' tone='textSecondary'>
                {card.end.last}
              </Text>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// Tyre left per wheel, in % of a new tyre (it counts down), laid out as the
// car: fronts on top. A wheel with a new tyre shows "before → after" in the
// bright ink; a kept wheel is one muted number; no reading is a gap. A "*" is
// the last valid reading from an earlier lap, for a sensor dead at the stop.
function WheelGrid({wheels}: {wheels: WheelWear[]}) {
  const pct = (v: number | null) => (v == null ? '—' : String(Math.round(v)));
  const text = (w: WheelWear) => {
    const star = w.beforeLapIndex != null ? '*' : '';
    return w.changed
      ? `${pct(w.beforePct)}${star}→${pct(w.afterPct)}`
      : `${pct(w.beforePct ?? w.afterPct)}${star}`;
  };
  const label = (w: WheelWear) =>
    `${w.wheel} ${w.changed ? 'new tyre' : 'kept'}, ${text(w).replace(
      '→',
      ' to ',
    )} percent left${
      w.beforeLapIndex != null
        ? `, last valid reading from lap ${w.beforeLapIndex}`
        : ''
    }`;
  return (
    <View style={styles.wheels}>
      {wheels.map(w => (
        <View
          key={w.wheel}
          style={styles.wheel}
          accessible
          accessibilityLabel={label(w)}>
          <Text variant='label' tone='textMuted'>
            {w.wheel}
          </Text>
          <Text variant='dataSmall' tone={w.changed ? 'text' : 'textMuted'}>
            {text(w)}
          </Text>
        </View>
      ))}
    </View>
  );
}

// A bold value and, muted under it, its second line.
function valueNote(value: string, note: string | null) {
  return (
    <>
      <Text variant='dataStrong'>{value}</Text>
      {note ? (
        <Text variant='dataSmall' tone='textMuted'>
          {note}
        </Text>
      ) : null}
    </>
  );
}

// A measure the stop has no reading of: an honest gap, never a zero.
function dash() {
  return (
    <Text variant='dataSmall' tone='textMuted'>
      —
    </Text>
  );
}

const styles = StyleSheet.create({
  card: {gap: space.xs},
  title: {flexDirection: 'row', alignItems: 'center', gap: space.sm},
  table: {flexDirection: 'row'},
  col: {paddingHorizontal: space.xs},
  flexCol: {flex: 1},
  cell: {
    justifyContent: 'center',
    gap: space.xxs,
    paddingVertical: space.xs,
    borderTopWidth: 1,
  },
  wheels: {flexDirection: 'row', flexWrap: 'wrap'},
  wheel: {width: '50%', paddingVertical: space.xxs},
  fuelRow: {gap: space.xxs, paddingVertical: space.md, borderTopWidth: 1},
  bar: {gap: space.xs},
  end: {
    gap: space.xxs,
    paddingVertical: space.md,
    borderTopWidth: 1,
  },
  plan: {marginTop: space.lg, paddingTop: space.md, borderTopWidth: 2},
});
