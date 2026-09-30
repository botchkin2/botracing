// Every in-app URL is built here. The URL owns the selection (laps with the
// reference first, highlighted lap, open corner, cursor), so a link carries
// the whole view. Pure: imports nothing, importable from features and routes.

export type LapSelectionParams = {
  /** Lap ids; the first is the reference. */
  laps?: string[];
  /** Highlighted lap id. */
  hl?: string | null;
  /** Open corner number. */
  corner?: number | null;
  /** Cursor distance, metres from the line. */
  cursorM?: number | null;
};

type Href = {pathname: string; params: Record<string, string>};

function selectionParams(sel: LapSelectionParams): Record<string, string> {
  const p: Record<string, string> = {};
  if (sel.laps?.length) p.laps = sel.laps.join(',');
  if (sel.hl) p.hl = sel.hl;
  if (sel.corner != null) p.c = String(sel.corner);
  if (sel.cursorM != null) p.t = String(Math.round(sel.cursorM));
  return p;
}

export const sessionsHref = (): Href => ({pathname: '/', params: {}});

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
  params: {id: sessionId, ...selectionParams(sel)},
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
  hl?: string;
  c?: string;
  t?: string;
}): Required<LapSelectionParams> {
  const corner = params.c ? Number(params.c) : NaN;
  const cursorM = params.t ? Number(params.t) : NaN;
  return {
    laps: params.laps ? params.laps.split(',').filter(Boolean) : [],
    hl: params.hl || null,
    corner: Number.isFinite(corner) ? corner : null,
    cursorM: Number.isFinite(cursorM) ? cursorM : null,
  };
}
