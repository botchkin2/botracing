// Short track names for tight rows (Sessions list). The Session header shows
// the full name and layout. Keys are the names the API serves.
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

/** "Michelin Raceway Road Atlanta" → "Road Atlanta". Unknown names pass through. */
export function shortTrackName(name: string): string {
  return SHORT_NAMES[name] ?? name;
}
