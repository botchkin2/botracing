// What each tag in the lap table's Tags column stands for: the codes the rows
// draw (lapTags.ts) and the word for each, shown as a legend under the table.
export const TAG_KEY: {code: string; meaning: string}[] = [
  {code: 'OUT/IN', meaning: 'pit'},
  {code: 'PART', meaning: 'partial'},
  {code: 'PARK', meaning: 'parked'},
  {code: 'SLOW', meaning: 'outlier'},
  {code: 'OFF', meaning: 'off track'},
  {code: 'HIT', meaning: 'impact'},
  {code: 'TOW', meaning: 'slipstream'},
  {code: 'TRAF', meaning: 'traffic'},
  {code: 'BLUE', meaning: 'blue flag'},
  {code: 'PASS', meaning: 'passes'},
  {code: 'BTL', meaning: 'battle'},
];
