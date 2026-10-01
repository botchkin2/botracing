import {StyleSheet, View} from 'react-native';

import {space, useTheme} from '@/src/design';
import {Explainer, Text, useHowToRead} from '@/src/ui';

import {
  type Cell,
  type SectionWindowModel,
  type SectionWindowRow,
} from './sectionWindow';
import {SECTION_WINDOW_HELP} from './sectionWindowHelp';

/**
 * The section's window (pit-wall thread 45): the time boundary to boundary,
 * split into run-in, corner and exit, with the four speeds and the brake
 * applications under each lap. A lap cut at other boundaries is a line saying
 * re-analysis is pending, never a number in the comparison; a window the pit
 * lane crosses is muted on its own. Renders what the model hands it.
 */
export function SectionWindowCard({window}: {window: SectionWindowModel}) {
  const {color} = useTheme();
  const help = useHowToRead('the corner window', SECTION_WINDOW_HELP);
  return (
    <View style={styles.card}>
      <View style={styles.title}>
        <Text variant='label'>Window · {window.label}</Text>
        {help.button}
      </View>
      <Explainer>
        {`${window.span}, boundary to boundary: time split into run-in, corner and exit.`}
      </Explainer>
      {help.panel}
      {window.parts.length > 0 ? (
        <Text variant='dataSmall' tone='textMuted'>
          {window.parts.map(p => p.label).join(' · ')} inside
        </Text>
      ) : null}
      {window.referenceNote ? (
        <Text variant='dataSmall' tone='textSecondary'>
          {window.referenceNote}
        </Text>
      ) : null}
      {window.optimum.map(o => (
        <Text
          key={o.label}
          variant='dataSmall'
          tone='textSecondary'
          accessibilityLabel={`${o.label}: best ${o.best} seconds, median ${o.median} seconds, ${o.gap}, over ${o.n}`}>
          {`${o.label} · best ${o.best} · median ${o.median} · ${o.gap} · ${o.n}`}
        </Text>
      ))}
      {window.rows.map(row => (
        <View
          key={row.lapId}
          style={[styles.lap, {borderColor: color.line}]}
          accessible
          accessibilityLabel={`${row.label}, ${labelOf(row)}`}>
          <WindowRow row={row} />
        </View>
      ))}
    </View>
  );
}

function labelOf(row: SectionWindowRow): string {
  if (row.state === 'stale') return 're-analysis pending';
  const t = `time ${row.time.value} seconds${
    row.time.gap ? `, ${row.time.gap}` : ''
  }`;
  return row.state === 'pit' ? `pit lane in this window, ${t}` : t;
}

function WindowRow({row}: {row: SectionWindowRow}) {
  if (row.state === 'stale')
    return (
      <View style={styles.line}>
        <Text variant='bodyStrong'>{row.label}</Text>
        <Text variant='dataSmall' tone='textMuted'>
          re-analysis pending
        </Text>
      </View>
    );
  const muted = row.state === 'pit';
  return (
    <>
      <View style={styles.line}>
        <Text variant='bodyStrong' tone={muted ? 'textMuted' : 'text'}>
          {row.label}
        </Text>
        <Measure cell={row.time} strong muted={muted} />
        {muted ? (
          <Text variant='dataSmall' tone='textMuted'>
            pit lane in this window
          </Text>
        ) : null}
      </View>
      <View style={styles.split}>
        <Part name='Run-in' cell={row.runIn} muted={muted} />
        <Part name='Corner' cell={row.corner} muted={muted} />
        <Part name='Exit' cell={row.exit} muted={muted} />
      </View>
      <Text variant='dataSmall' tone='textMuted'>
        {`In ${row.speeds.onset} · min ${row.speeds.min} · full throttle ${row.speeds.fullThrottle} · end ${row.speeds.end}`}
      </Text>
      {row.brakes.map(b => (
        <Text key={b.label} variant='dataSmall' tone='textSecondary'>
          {`${b.label} · ${b.onset} · peak ${b.peak}`}
        </Text>
      ))}
    </>
  );
}

function Part({name, cell, muted}: {name: string; cell: Cell; muted: boolean}) {
  return (
    <View style={styles.part}>
      <Text variant='label' tone='textMuted'>
        {name}
      </Text>
      <Measure cell={cell} muted={muted} />
    </View>
  );
}

// A time in seconds with its signed gap to the reference; faster is green
// and slower red only where there is a gap, always with the sign.
function Measure({
  cell,
  strong,
  muted,
}: {
  cell: Cell;
  strong?: boolean;
  muted: boolean;
}) {
  return (
    <View style={styles.measure}>
      <Text
        variant={strong ? 'dataStrong' : 'dataSmall'}
        tone={muted ? 'textMuted' : 'text'}>
        {cell.value} s
      </Text>
      {cell.gap && !muted ? (
        <Text variant='dataSmall' tone={cell.better ? 'faster' : 'slower'}>
          {cell.gap}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {gap: space.xs},
  title: {flexDirection: 'row', alignItems: 'center', gap: space.sm},
  lap: {gap: space.xxs, paddingVertical: space.sm, borderTopWidth: 1},
  line: {flexDirection: 'row', alignItems: 'baseline', gap: space.md},
  split: {flexDirection: 'row', gap: space.lg},
  part: {gap: space.xxs},
  measure: {flexDirection: 'row', alignItems: 'baseline', gap: space.xs},
});
