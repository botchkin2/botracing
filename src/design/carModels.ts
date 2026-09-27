// LMU records the entry name ("Manthey DK Engineering 2026 #91:LM"), not the
// car model. This maps entry names to the model and a short entry label.
// Mapping agreed in pit-wall thread 24 (#240); Botkin corrects any wrong rows.
// Later the trace log's car code (e.g. 397_25_911GT3R) can make this exact.

/** `model` for headers, `shortModel` (no brand) for tight rows. */
export type CarLabel = {
  model: string;
  shortModel: string;
  entry: string | null;
};

const PORSCHE = {model: 'Porsche 911 GT3 R', shortModel: '911 GT3 R'};
const MUSTANG = {model: 'Ford Mustang GT3', shortModel: 'Mustang GT3'};
const MCLAREN = {model: 'McLaren 720S GT3 Evo', shortModel: '720S GT3 Evo'};

// First match wins. `team` is the short team label; the car number is appended.
const ENTRIES: {
  pattern: RegExp;
  model: {model: string; shortModel: string};
  team: string;
}[] = [
  {pattern: /^911GT3R Custom Team/i, model: PORSCHE, team: 'Custom'},
  {pattern: /^Mustang Custom Team/i, model: MUSTANG, team: 'Custom'},
  {pattern: /^Manthey/i, model: PORSCHE, team: 'Manthey'},
  {pattern: /^Iron Dames/i, model: PORSCHE, team: 'Iron Dames'},
  {pattern: /^Proton (Competition|Racing)/i, model: MUSTANG, team: 'Proton'},
  {pattern: /^United Autosports/i, model: MCLAREN, team: 'United'},
];

/** "Manthey DK Engineering 2026 #91:LM" → {model: "Porsche 911 GT3 R", shortModel: "911 GT3 R", entry: "Manthey #91"}. */
export function carLabel(entryName: string): CarLabel {
  const match = ENTRIES.find(e => e.pattern.test(entryName));
  if (!match) return {model: entryName, shortModel: entryName, entry: null};
  const number = entryName.match(/#(\d+)/)?.[1];
  return {
    ...match.model,
    entry: number ? `${match.team} #${number}` : match.team,
  };
}
