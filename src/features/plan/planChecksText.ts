// The Plan's facts line and its notes, in the words chief wrote (pit-wall
// thread 104 #7391): "Max fuel 73 L · Fuel 3.57 L a lap · VE 5.7 % a lap",
// each with whether two sources agree. Pure.
import {formatDayMonth, oneDecimal} from '@/src/design/format';

import type {CheckState, PlanChecks} from './planChecks';
import {TYPE_WORD} from './planEvent';

export type FactLine = {
  text: string;
  /** "checked", "1 source" or "disagrees"; null when the fact is not known. */
  status: string | null;
  /** The two sources disagree: drawn stronger. */
  flag: boolean;
};

export type ChecksText = {facts: FactLine[]; notes: string[]};

const STATUS: Record<CheckState, string> = {
  checked: 'checked',
  'one-source': '1 source',
  disagrees: 'disagrees',
};

const litres = (v: number) => `${Math.round(v * 10) / 10}`;

export function checksText(c: PlanChecks): ChecksText {
  const facts: FactLine[] = [];
  const notes: string[] = [];
  const add = (text: string, state: CheckState | null) =>
    facts.push({
      text,
      status: state ? STATUS[state] : null,
      flag: state === 'disagrees',
    });

  if (c.maxFuelL.value == null) add('Max fuel: not in this recording', null);
  else add(`Max fuel ${litres(c.maxFuelL.value)} L`, c.maxFuelL.state);
  if (c.fuelPerLapL.value != null)
    add(`Fuel ${c.fuelPerLapL.value.toFixed(2)} L a lap`, c.fuelPerLapL.state);
  if (c.vePerLapPct.value != null)
    add(`VE ${oneDecimal(c.vePerLapPct.value)} % a lap`, c.vePerLapPct.state);

  if (c.vePerLapPct.state === 'disagrees' && c.vePerLapPct.lmuPct != null)
    notes.push(
      `VE a lap doesn't match LMU's setup (${oneDecimal(
        c.vePerLapPct.lmuPct,
      )} %). Check before you race.`,
    );
  if (c.offline?.kind === 'matched') {
    const {startedAt, sessionType} = c.offline.online;
    notes.push(
      `Offline matched your online ${TYPE_WORD[sessionType]}, ${formatDayMonth(
        startedAt,
      )}.`,
    );
  } else if (c.offline?.kind === 'not-compared')
    notes.push('Offline practice: not yet compared with an online session.');
  return {facts, notes};
}
