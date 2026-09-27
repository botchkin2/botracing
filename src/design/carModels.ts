// LMU records the entry name ("Manthey DK Engineering 2026 #91:LM"), not the
// car model. This maps entry names to the model and a short entry label.
// Mapping agreed in pit-wall thread 24 (#240); Botkin corrects any wrong rows.
// Later the trace log's car code (e.g. 397_25_911GT3R) can make this exact.

export type CarLabel = {model: string; entry: string | null};

const PORSCHE = 'Porsche 911 GT3 R';
const MUSTANG = 'Ford Mustang GT3';
const MCLAREN = 'McLaren 720S GT3 Evo';

// First match wins. `team` is the short team label; the car number is appended.
const ENTRIES: {pattern: RegExp; model: string; team: string}[] = [
  {pattern: /^911GT3R Custom Team/i, model: PORSCHE, team: 'Custom'},
  {pattern: /^Mustang Custom Team/i, model: MUSTANG, team: 'Custom'},
  {pattern: /^Manthey/i, model: PORSCHE, team: 'Manthey'},
  {pattern: /^Iron Dames/i, model: PORSCHE, team: 'Iron Dames'},
  {pattern: /^Proton (Competition|Racing)/i, model: MUSTANG, team: 'Proton'},
  {pattern: /^United Autosports/i, model: MCLAREN, team: 'United'},
];

/** "Manthey DK Engineering 2026 #91:LM" → {model: "Porsche 911 GT3 R", entry: "Manthey #91"}. */
export function carLabel(entryName: string): CarLabel {
  const match = ENTRIES.find(e => e.pattern.test(entryName));
  if (!match) return {model: entryName, entry: null};
  const number = entryName.match(/#(\d+)/)?.[1];
  return {
    model: match.model,
    entry: number ? `${match.team} #${number}` : match.team,
  };
}
