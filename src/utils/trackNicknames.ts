import type {TrackInfo} from '@/src/types';

/** Normalize for search: lowercase and strip accents (é -> e, ó -> o) so "interlagos" matches "Interlagos", "jose" matches "José". */
function normalizeForSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/**
 * Common nicknames / search terms that match track names.
 * Key = search term (lowercase), value = substrings that identify the track (lowercase, accents optional).
 * When the user types a key, we match any track whose name or variant contains any of the value strings.
 */
export const TRACK_SEARCH_NICKNAMES: Record<string, string[]> = {
  interlagos: [
    'interlagos',
    'jose carlos pace',
    'josé carlos pace',
    'autodromo jose carlos pace',
    'autódromo josé carlos pace',
  ],
  barcelona: ['barcelona', 'catalunya'],
  catalunya: ['barcelona', 'catalunya'],
  spa: ['spa', 'francorchamps'],
  nürburgring: ['nürburgring', 'nurburgring'],
  nurburgring: ['nürburgring', 'nurburgring'],
  nordschleife: ['nordschleife', 'nürburgring', 'nurburgring'],
  monza: ['monza'],
  silverstone: ['silverstone'],
  monaco: ['monaco'],
  suzuka: ['suzuka'],
  'laguna seca': ['laguna seca'],
  'road america': ['road america'],
  'watkins glen': ['watkins glen', 'watkins glen'],
  sebring: ['sebring'],
  daytona: ['daytona'],
  indy: ['indianapolis', 'ims', 'indianapolis motor speedway'],
  cota: ['circuit of the americas', 'cota', 'americas'],
  imola: ['imola', 'enzo e dino ferrari'],
  'brands hatch': ['brands hatch'],
  donington: ['donington'],
  'oulton park': ['oulton park'],
  charlotte: ['charlotte'],
  roval: ['roval'],
  'long beach': ['long beach'],
  'road atlanta': ['road atlanta'],
  'virginia international': ['virginia international', 'vir'],
  barber: ['barber'],
  austin: ['austin', 'americas', 'cota'],
  zandvoort: ['zandvoort'],
  'red bull ring': ['red bull ring', 'spielberg'],
  spielberg: ['red bull ring', 'spielberg'],
  hungaroring: ['hungaroring', 'hungary'],
  istanbul: ['istanbul', 'turkey'],
  portimão: ['portimão', 'portimao', 'algarve'],
  portimao: ['portimão', 'portimao', 'algarve'],
  'mount panorama': ['mount panorama', 'bathurst'],
  bathurst: ['mount panorama', 'bathurst'],
  'willow springs': ['willow springs', 'big willow'],
  sonoma: ['sonoma', 'sears point'],
  thunderhill: ['thunderhill'],
  'phillip island': ['phillip island', 'phillip island'],
  kyalami: ['kyalami'],
  shanghai: ['shanghai'],
  'yas marina': ['yas marina', 'abu dhabi'],
  'marina bay': ['marina bay', 'singapore'],
  sochi: ['sochi'],
  jeddah: ['jeddah'],
  miami: ['miami'],
  vegas: ['vegas', 'las vegas'],
  'las vegas': ['vegas', 'las vegas'],
};

/**
 * Get all searchable terms for a track (name, variant, and any matching nicknames).
 * Uses accent-insensitive matching so "jose" matches "José".
 */
export function getTrackSearchTerms(track: TrackInfo): string[] {
  const name = normalizeForSearch(track.name);
  const variant = normalizeForSearch(
    track.variant ?? track.configuration ?? '',
  );
  const terms = new Set<string>([name, variant].filter(Boolean));

  for (const [, patterns] of Object.entries(TRACK_SEARCH_NICKNAMES)) {
    const matchesTrack = patterns.some(
      p =>
        name.includes(normalizeForSearch(p)) ||
        variant.includes(normalizeForSearch(p)),
    );
    if (matchesTrack) {
      patterns.forEach(p => terms.add(normalizeForSearch(p)));
    }
  }

  return Array.from(terms);
}

/**
 * Returns true if the track matches the search query (including nicknames).
 * Accent-insensitive: "interlagos" matches "Interlagos" or "Autódromo José Carlos Pace".
 */
export function trackMatchesSearch(track: TrackInfo, query: string): boolean {
  const q = normalizeForSearch(query.trim());
  if (!q) return true;
  const terms = getTrackSearchTerms(track);
  return terms.some(term => term.includes(q));
}
