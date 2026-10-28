// What a session recorded about the other cars, as one state that the Session head and the
// Race tab both word (pit wall thread 111, chassis #7797, livery #7798). Three places say
// something about other cars (the head's "Other cars" fact, the Class pace block's gate and
// the Race tab's empty state); this is the one rule they read, so "not recorded" cannot be on
// one screen while another lists the cars.
import {type ClassPaceDoc, hasOtherDrivers} from './classPace';

export type OtherCarsState =
  /** The 5 Hz field is stored: the Race tab replays the cars. */
  | {kind: 'field'}
  /** No field, but the game's results file gave the other drivers' laps (the Class pace block lists them): positions on track were not recorded. */
  | {kind: 'drivers'}
  /** Nothing about other cars was recorded; `why` is the stored `fieldMissing` line. */
  | {kind: 'none'; why: string | null};

export function otherCarsState(session: {
  field: unknown | null;
  fieldMissing: string | null;
  classPace: ClassPaceDoc | null;
}): OtherCarsState {
  if (session.field != null) return {kind: 'field'};
  if (hasOtherDrivers(session.classPace)) return {kind: 'drivers'};
  return {kind: 'none', why: session.fieldMissing};
}
