// The Plan's first line (pit-wall thread 99, row PLN, #6684 item 1): use per
// lap, VE first for a VE car, then its p90. The load and the litres one % of
// VE is worth are not here: the checked facts line carries the max fuel, and
// the litres a % is no number he reads (pit-wall thread 104, ticket 47). Pure.
import {type FuelPlan} from '@/src/analysis/fuelPlan';

export type PerLapStrip = {
  /** "VE" or "Fuel". */
  label: string;
  /** The hero: "5.02 %/lap" or "3.49 L/lap". */
  value: string;
  /** "p90 5.21". */
  detail: string;
};

export function perLapStrip(
  plan: FuelPlan,
  meter: 've' | 'fuel',
): PerLapStrip | null {
  const use = meter === 've' ? plan.perLap.ve : plan.perLap.fuel;
  if (!use || !(use.median > 0)) return null;
  const unit = meter === 've' ? '%' : 'L';
  return {
    label: meter === 've' ? 'VE' : 'Fuel',
    value: `${use.median.toFixed(2)} ${unit}/lap`,
    detail: `p90 ${use.p90.toFixed(2)}`,
  };
}
