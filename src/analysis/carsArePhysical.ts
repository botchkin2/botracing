import {sessionKind} from './classLaps.ts';

/**
 * Whether the other cars in a session's field are on the track with the player,
 * so tow, gaps, passes, traffic and a clean median mean something. In a
 * qualifying they are not: LMU's field there is every driver's own lap, and
 * iRacing's is the same in a Lone Qualify (Botkin, 2026-10-25: "qualifying in
 * LMU doesn't actually have other cars… same for iracing"). His place and the
 * class times still read from the field; only what treats a car as a physical
 * neighbour asks this.
 *
 * Every qualifying says no, online or offline, because we do not know yet that
 * an Open Qualify or an offline one is different (pit wall thread 95 #7548,
 * #7554). The iRacing reader folds Lone and Open Qualify into 'Qualify'
 * (`mapSessionType`); when it keeps the raw type, this is the one place that
 * tells them apart. A consumer never spells `sessionType === 'Q'` itself.
 */
export function carsArePhysical(sessionType: string): boolean {
  return sessionKind(sessionType) !== 'qualify';
}
