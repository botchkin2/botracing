// Every in-app URL is built here. The URL owns the selection (checked laps,
// the Ref lap if one is set, highlighted lap, open corner, cursor), so a link
// carries the whole view. Pure: imports only ./lapRef, importable from features and routes.

import {isForeignLapId, ownLapIds} from './lapRef';

export type LapSelectionParams = {
  /** Checked lap ids. */
  laps?: string[];
  /** The Ref lap id; absent measures against the median of the checked laps. */
  ref?: string | null;
  /** Highlighted lap id. */
  hl?: string | null;
  /** Open corner number. */
  corner?: number | null;
  /** Cursor distance, metres from the line. */
  cursorM?: number | null;
};

type Href = {pathname: string; params: Record<string, string>};

// A lap of another session (`sessionId~lapId`) is only meaningful in Compare:
// Corner, Session and the rest would drop it or fetch a trace that is not
// there, so their links carry the session's own laps only.
function selectionParams(
  sel: LapSelectionParams,
  keepForeign = false,
): Record<string, string> {
  const p: Record<string, string> = {};
  const laps = keepForeign ? sel.laps : sel.laps && ownLapIds(sel.laps);
  if (laps?.length) p.laps = laps.join(',');
  if (sel.ref && (keepForeign || !isForeignLapId(sel.ref))) p.ref = sel.ref;
  if (sel.hl && (keepForeign || !isForeignLapId(sel.hl))) p.hl = sel.hl;
  if (sel.corner != null) p.c = String(sel.corner);
  if (sel.cursorM != null) p.t = String(Math.round(sel.cursorM));
  return p;
}

/** The Sessions list, optionally narrowed to a game and a track (ids as the data has them). */
export const sessionsHref = (
  filter: {game?: string | null; track?: string | null} = {},
): Href => ({
  pathname: '/',
  params: {
    ...(filter.game ? {game: filter.game} : {}),
    ...(filter.track ? {track: filter.track} : {}),
  },
});

export const settingsHref = (): Href => ({pathname: '/settings', params: {}});

export const sessionHref = (
  sessionId: string,
  sel: LapSelectionParams = {},
): Href => ({
  pathname: '/session/[id]',
  params: {id: sessionId, ...selectionParams(sel)},
});

export const compareHref = (
  sessionId: string,
  sel: LapSelectionParams = {},
): Href => ({
  pathname: '/session/[id]/compare',
  params: {id: sessionId, ...selectionParams(sel, true)},
});

export const raceHref = (
  sessionId: string,
  sel: LapSelectionParams = {},
): Href => ({
  pathname: '/session/[id]/race',
  params: {id: sessionId, ...selectionParams(sel)},
});

export const cornerHref = (
  sessionId: string,
  corner: number,
  sel: LapSelectionParams = {},
): Href => ({
  pathname: '/session/[id]/corner/[n]',
  params: {
    id: sessionId,
    n: String(corner),
    ...selectionParams({...sel, corner: null}),
  },
});

export const tracksHref = (): Href => ({pathname: '/tracks', params: {}});

/**
 * The Plan's key for a track and a car model (`carLabel(car).model`, not the
 * livery). The bar, the session screens and the planner all build it here, so
 * a link always lands on the combo it names. LMU keys carry no sim; any other
 * sim is prefixed (`iracing:`), so two sims never pool one combo and saved
 * LMU links keep working.
 */
export const planComboKey = (
  trackId: string,
  carModel: string,
  sim = 'lmu',
): string => (sim === 'lmu' ? '' : `${sim}:`) + `${trackId}|${carModel}`;

/** The planner, optionally opened on one track+car (a Plan combo key). */
export const planHref = (combo?: string): Href => ({
  pathname: '/plan',
  params: combo ? {combo} : {},
});

/** A layout's Track page, with an optional selected corner. */
export const trackHref = (
  trackId: string,
  corner: number | null = null,
): Href => ({
  pathname: '/track/[id]',
  params: {id: trackId, ...selectionParams({corner})},
});

/** Reads the shared params back; unknown or empty values drop out. */
export function parseSelection(params: {
  laps?: string;
  ref?: string;
  hl?: string;
  c?: string;
  t?: string;
}): Required<LapSelectionParams> {
  const corner = params.c ? Number(params.c) : NaN;
  const cursorM = params.t ? Number(params.t) : NaN;
  return {
    laps: params.laps ? params.laps.split(',').filter(Boolean) : [],
    ref: params.ref || null,
    hl: params.hl || null,
    corner: Number.isFinite(corner) ? corner : null,
    cursorM: Number.isFinite(cursorM) ? cursorM : null,
  };
}
