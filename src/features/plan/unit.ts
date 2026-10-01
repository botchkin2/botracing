// The one unit the Plan speaks in at a time (Botkin, pit-wall thread 44
// #1826): VE in LMU, where VE always runs out first; fuel where the car has no
// VE data. Both meters still decide the stint lengths; this picks only what is
// printed.

export type Unit = 've' | 'fuel';

export const UNITS = [
  {value: 've', label: 'VE'},
  {value: 'fuel', label: 'Fuel'},
] as const;

/** VE asked for without VE data is fuel: there is nothing to print in VE. */
export function effectiveUnit(asked: Unit, hasVe: boolean): Unit {
  return asked === 've' && hasVe ? 've' : 'fuel';
}
