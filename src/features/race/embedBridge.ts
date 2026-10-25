// The messages between the Android app and the 3D page in its WebView (pit-wall thread 94, gauge #6506, spec #6325
// item 5). One clock, the app's: it tells the page where race time is, and the page answers that its first frame is
// drawn and, while a finger drags vertically in the 3D box, how far the app's page is to scroll (ticket #46). Nothing
// else crosses, in either direction: no token, no user data. Plain TypeScript, no imports but the rates.

import {RACE_RATES, type RaceRate} from './clock';

/** App to page: where the race clock is. */
export type ClockMessage = {t: 'clock'; timeS: number; playing: boolean; rate: RaceRate};

/** Page to app: the first frame is drawn. */
export const READY_MESSAGE = '{"t":"ready"}';

/** True for exactly the ready message. */
export function isReadyMessage(raw: unknown): boolean {
  return raw === READY_MESSAGE;
}

/**
 * Page to app: a vertical drag in the 3D box is the page's to scroll (analysis/panGesture). `dy` is the finger's
 * vertical travel in px since the last message, summed over one animation frame: down is positive, so the page
 * scrolls by -dy. Ready and pan are the only messages the app accepts from the page; anything else is ignored.
 */
export type PanMessage = {t: 'pan'; dy: number};

/** One message never moves the page further than this: a frame's travel is a few dozen px, a fling's first frame under a hundred. */
export const PAN_MAX_DY = 1000;

export function panMessage(dy: number): string {
  const msg: PanMessage = {t: 'pan', dy};
  return JSON.stringify(msg);
}

/** What the app makes of a message from the page: a pan with a finite dy (clamped to ±PAN_MAX_DY), or null. */
export function parsePanMessage(raw: unknown): PanMessage | null {
  if (typeof raw !== 'string' || raw.length > 60) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const m = value as Record<string, unknown>;
  if (m.t !== 'pan' || typeof m.dy !== 'number' || !Number.isFinite(m.dy)) return null;
  return {t: 'pan', dy: Math.min(Math.max(m.dy, -PAN_MAX_DY), PAN_MAX_DY)};
}

/** The text the app posts to the page. */
export function clockMessage(timeS: number, playing: boolean, rate: RaceRate): string {
  const msg: ClockMessage = {t: 'clock', timeS, playing, rate};
  return JSON.stringify(msg);
}

/**
 * What the page makes of a message: a clock message with a finite time (clamped to the race), a boolean `playing` and a
 * rate from the allowed set, or null. Anything else is dropped, never evaluated.
 */
export function parseClockMessage(raw: unknown, endS: number): ClockMessage | null {
  if (typeof raw !== 'string' || raw.length > 200) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const m = value as Record<string, unknown>;
  if (m.t !== 'clock') return null;
  if (typeof m.timeS !== 'number' || !Number.isFinite(m.timeS)) return null;
  if (typeof m.playing !== 'boolean') return null;
  const rate = RACE_RATES.find(r => r === m.rate);
  if (rate === undefined) return null;
  return {t: 'clock', timeS: Math.min(Math.max(0, m.timeS), Math.max(0, endS)), playing: m.playing, rate};
}

/** The last clock the app sent, and when (wall milliseconds). */
export type SentClock = {timeS: number; atMs: number; playing: boolean; rate: RaceRate};

/** How far the page's own running clock may drift from the app's before the app tells it again: a seek is far more. */
export const SEEK_TOLERANCE_S = 0.75;

/**
 * Whether the app's clock changed in a way the page's own clock cannot follow by itself: no message yet, play, pause
 * or rate changed, a seek while paused, or a jump while playing (a time the page's running clock would not have reached).
 * A steady play is covered by the page's clock, with a once-a-second resync on top.
 */
export function clockNeedsSending(last: SentClock | null, now: SentClock): boolean {
  if (last === null) return true;
  if (last.playing !== now.playing || last.rate !== now.rate) return true;
  if (!now.playing) return now.timeS !== last.timeS;
  const expected = last.timeS + ((now.atMs - last.atMs) / 1000) * last.rate;
  return Math.abs(now.timeS - expected) > SEEK_TOLERANCE_S;
}
