import rawTracks from '@/tools/track-info/tracks.json';

import {type NamedPoint} from '@/src/analysis/cornerNames';

// Facts for the Track page, one entry per layout (trackId). They are
// checked in at tools/track-info/tracks.json (fetch.py writes it; sources
// and licences are in its README) and bundled with the app, so they change
// through a reviewed PR. Every fetched field is optional: a missing fact
// hides its tile (Track page handoff, "States").

export type TrackSummary = {
  extract: string;
  url: string;
  /** "Wikipedia, CC BY-SA 4.0": must be shown next to the text. */
  attribution: string;
};

export type TrackInfo = {
  trackId: string;
  /** The game's layout name. */
  layout: string;
  /** The circuit, shared by its layouts. */
  location: string;
  /** The game's lap length (longest Lap Dist recorded), metres. */
  lengthM: number | null;
  openedYear: number | null;
  country: string | null;
  /** ISO 3166 alpha-2, for the country chip. */
  countryCode: string | null;
  place: string | null;
  summary: TrackSummary | null;
  osmNames: NamedPoint[];
};

// Wikidata gives the country name only; the chip wants the code.
const COUNTRY_CODES: Record<string, string> = {
  Bahrain: 'BH',
  Belgium: 'BE',
  Brazil: 'BR',
  France: 'FR',
  Italy: 'IT',
  Japan: 'JP',
  Portugal: 'PT',
  Qatar: 'QA',
  Spain: 'ES',
  'United Kingdom': 'GB',
  'United States': 'US',
};

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null;
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

function toSummary(raw: unknown): TrackSummary | null {
  const x = obj(raw);
  const extract = str(x.extract);
  const url = str(x.url);
  if (!extract || !url) return null;
  return {
    extract,
    url,
    attribution: str(x.attribution) ?? 'Wikipedia, CC BY-SA 4.0',
  };
}

// OSM also names bike-only chicanes ("Motorcycle Turn 12" at Road Atlanta),
// which the cars never drive; they must not name a car corner.
const NOT_A_CAR_CORNER = /motorcycle|moto|bike/i;

function toNamedPoints(raw: unknown): NamedPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(p => {
    const x = obj(p);
    const name = str(x.name);
    if (name && NOT_A_CAR_CORNER.test(name)) return [];
    const lat = num(x.lat);
    const lon = num(x.lon);
    return name && lat != null && lon != null ? [{name, lat, lon}] : [];
  });
}

export function toTrackInfo(trackId: string, raw: unknown): TrackInfo {
  const x = obj(raw);
  const layout = str(x.layout) ?? trackId;
  const country = str(x.country);
  return {
    trackId,
    layout,
    location: str(x.location) ?? layout,
    lengthM: num(x.lengthM),
    openedYear: num(x.openedYear),
    country,
    countryCode: country ? COUNTRY_CODES[country] ?? null : null,
    place: str(x.place),
    summary: toSummary(x.summary),
    osmNames: toNamedPoints(x.osmNames),
  };
}

const CATALOG: TrackInfo[] = Object.entries(
  rawTracks as Record<string, unknown>,
)
  .map(([id, raw]) => toTrackInfo(id, raw))
  .sort((a, b) => a.layout.localeCompare(b.layout));

/** Every layout with facts, by layout name. */
export function trackCatalog(): TrackInfo[] {
  return CATALOG;
}

export function trackInfo(trackId: string): TrackInfo | null {
  return CATALOG.find(t => t.trackId === trackId) ?? null;
}

/** The other layouts of the same circuit, this one included, by name. */
export function layoutsOf(trackId: string): TrackInfo[] {
  const self = trackInfo(trackId);
  if (!self) return [];
  return CATALOG.filter(t => t.location === self.location);
}
