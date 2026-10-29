// Short track names for tight rows (Sessions list). The Session header shows
// the full name and layout. Keys are the names the API serves; the lookup also takes the form iRacing writes.
const SHORT_NAMES: Record<string, string> = {
  'Daytona International Speedway': 'Daytona',
  'Michelin Raceway Road Atlanta': 'Road Atlanta',
  'Circuit de la Sarthe': 'Le Mans',
  'Circuit de Barcelona': 'Barcelona',
  'Silverstone Circuit': 'Silverstone',
  'Autodromo Enzo e Dino Ferrari': 'Imola',
  'Autodromo Nazionale Monza': 'Monza',
  'WeatherTech Raceway Laguna Seca': 'Laguna Seca',
  'Circuit of the Americas': 'COTA',
  'Sebring International Raceway': 'Sebring',
  'Bahrain International Circuit': 'Bahrain',
  'Circuit de Spa-Francorchamps': 'Spa',
  'Lusail International Circuit': 'Lusail',
  'Fuji Speedway': 'Fuji',
  'Algarve International Circuit': 'Portimão',
  'Autódromo José Carlos Pace': 'Interlagos',
};

/**
 * The letters of a name and nothing else: ASCII only, case-folded, spaces gone. iRacing writes its names with each
 * accented letter replaced by a space ("Aut dromo Jos  Carlos Pace" for Autódromo José Carlos Pace; checked on the
 * bytes of an .ibt file and on 16 stored sessions), so the broken and the accented form only agree once the letters
 * the sim dropped are dropped from the accented one too (ticket 81).
 */
export function trackNameKey(name: string): string {
  return name.replace(/[^A-Za-z]/g, '').toLowerCase();
}

const SHORT_BY_KEY = new Map(Object.entries(SHORT_NAMES).map(([name, short]) => [trackNameKey(name), short]));

/** "Michelin Raceway Road Atlanta" → "Road Atlanta". Unknown names pass through. */
export function shortTrackName(name: string): string {
  return SHORT_BY_KEY.get(trackNameKey(name)) ?? name;
}
