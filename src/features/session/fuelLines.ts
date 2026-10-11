// The Session screen's fuel and Virtual Energy text, from the uploader's
// facts (tools/sessions/fuelFacts.mjs). Pure. Numbers, units and what they
// were measured against, never advice (CODE_STANDARDS §7).
import type {Lap, PitStop} from '@/src/data/sessions';
import {oneDecimal} from '@/src/design';

import {greenLaps, median} from './fuelUse';

const litres = (v: number) => `${v.toFixed(1)} L`;
const pct = (v: number) => `${Math.round(v)} %`;
const laps = (v: number) => `${v.toFixed(1)} ${v === 1 ? 'lap' : 'laps'}`;

/**
 * The line under a pit-in lap: what was left when the car came in, in laps at
 * the stint's median use (the smaller of fuel and VE), and what the stop
 * added. Null without the fuel channels.
 * "Pit: 33.3 L / 40 % VE left (11.1 laps) · +41.7 L · 91 s"
 */
export function pitLine(stop: PitStop): string | null {
  const {fuelL, vePct} = stop.atEntry;
  if (fuelL == null && vePct == null) return null;
  const left = [
    fuelL != null && litres(fuelL),
    vePct != null && `${pct(vePct)} VE`,
  ].filter(Boolean);
  const {fuel, ve} = stop.lapsLeftAtEntry;
  const lapsLeft = [fuel, ve].filter((v): v is number => v != null);
  const head = `Pit: ${left.join(' / ')} left${
    lapsLeft.length ? ` (${laps(Math.min(...lapsLeft))})` : ''
  }`;
  const added = stop.added.fuelL;
  const time = stop.inPitS != null ? ` · ${stop.inPitS.toFixed(0)} s` : '';
  if (added == null) return `${head}${time}`;
  // "+0.0 L" for a stop that took none (a drive-through or a penalty): the same
  // length as "+33.2 L", where 'no fuel added' was cut off on the phone row
  // (measured at 375 pt, apex #1084).
  return `${head} · +${litres(added)}${time}`;
}

/**
 * The line under a stint header: its median use per lap, over the stint's
 * green laps (the same set the fuel card uses, so the two agree).
 * Null under 3 such laps, so the line is left out.
 * "Fuel 2.40 L/lap · VE 3.6 %/lap"
 */
export function stintFuelLine(stintLaps: Lap[]): string | null {
  const usable = greenLaps(stintLaps);
  if (usable.length < MIN_NOTE_LAPS) return null;
  const fuelL = median(usable.map(l => l.fuel!.usedL as number));
  const ve = usable
    .map(l => l.fuel!.veUsedPct)
    .filter((v): v is number => v != null && v > 0);
  const vePct = ve.length >= MIN_NOTE_LAPS ? median(ve) : null;
  const parts = [
    fuelL != null && `Fuel ${fuelL.toFixed(2)} L/lap`,
    vePct != null && `VE ${oneDecimal(vePct)} %/lap`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

const MIN_NOTE_LAPS = 3;

/**
 * The lap's fuel and VE lines for the detail panel: used, left, and laps left
 * at the stint's median.
 * "Fuel 2.36 L used · 33.29 L left · 13.9 laps at the median"
 */
export function lapFuelLines(lap: Lap): string[] {
  const f = lap.fuel;
  if (!f) return [];
  const line = (
    name: string,
    used: number | null,
    unit: string,
    left: number | null,
    lapsAtMedian: number | null,
    digits: number,
  ) => {
    if (used == null && left == null) return null;
    return [
      used != null && `${name} ${used.toFixed(digits)} ${unit} used`,
      left != null && `${left.toFixed(digits)} ${unit} left`,
      lapsAtMedian != null && `${laps(lapsAtMedian)} at the median`,
    ]
      .filter(Boolean)
      .join(' · ');
  };
  const out = [
    line('Fuel', f.usedL, 'L', f.endL, f.lapsLeftFuel, 2),
    line('VE', f.veUsedPct, '%', f.veEndPct, f.lapsLeftVe, 1),
  ];
  const stop = lap.pitStop;
  if (stop) {
    const {fuelL, vePct} = stop.added;
    out.push(
      [
        `Stop${
          stop.inPitS != null ? ` ${stop.inPitS.toFixed(0)} s` : ''
        } in the pits`,
        fuelL != null && `+${fuelL.toFixed(1)} L`,
        vePct != null && `+${vePct.toFixed(1)} % VE`,
      ]
        .filter(Boolean)
        .join(' · '),
    );
  }
  return out.filter((l): l is string => l != null);
}
