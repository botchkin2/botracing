// The Plan's first line (pit-wall thread 99, row PLN, #6684 item 1): use per
// lap, VE first for a VE car, then its p90, the laps a full load lasts and the
// litres one % of VE is worth. The Per tank card's number lives here now. Pure.
import {type FuelPlan, type PlanRules} from '@/src/analysis/fuelPlan';

export type PerLapStrip = {
  /** "VE" or "Fuel". */
  label: string;
  /** The hero: "5.02 %/lap" or "3.49 L/lap". */
  value: string;
  /** "p90 5.21 · 19.9 laps a tank · 0.68 L/%"; the parts the plan has. */
  detail: string;
};

export function perLapStrip(
  plan: FuelPlan,
  rules: PlanRules,
  meter: 've' | 'fuel',
  ratioPerPctL: number | null,
): PerLapStrip | null {
  const use = meter === 've' ? plan.perLap.ve : plan.perLap.fuel;
  if (!use || !(use.median > 0)) return null;
  const unit = meter === 've' ? '%' : 'L';
  const full = meter === 've' ? rules.vePct : rules.fuelL;
  const parts = [`p90 ${use.p90.toFixed(2)}`];
  if (full > 0) parts.push(`${(full / use.median).toFixed(1)} laps a tank`);
  if (meter === 've' && ratioPerPctL != null)
    parts.push(`${ratioPerPctL.toFixed(2)} L/%`);
  return {
    label: meter === 've' ? 'VE' : 'Fuel',
    value: `${use.median.toFixed(2)} ${unit}/lap`,
    detail: parts.join(' · '),
  };
}
