import {describe, expect, it} from '@jest/globals';

import {GEAR_UNKNOWN, tightNumberRows} from './numbersRows';

const texts = (rows: ReturnType<typeof tightNumberRows>) => rows.map(r => r.map(c => c.text));

describe('tightNumberRows: the phone numbers box is two rows, with no gaps (the strip above has them)', () => {
  it('the place, and the gear on the speed row', () => {
    const rows = tightNumberRows({place: 'GT3 P6', gear: '3', speed: '145'});
    expect(texts(rows)).toEqual([['GT3 P6'], ['3', '145', 'km/h']]);
    expect(rows).toHaveLength(2);
  });

  it('no row prints a gap', () => {
    const rows = tightNumberRows({place: 'GT3 P6', gear: '3', speed: '145'});
    expect(rows.flat().some(c => /[▲▼]/.test(c.text))).toBe(false);
  });

  it('the figures are strong, the unit muted', () => {
    const rows = tightNumberRows({place: 'GT3 P6', gear: 'N', speed: '0'});
    expect(rows[0][0].tone).toBe('strong');
    expect(rows[1].map(c => c.tone)).toEqual(['strong', 'strong', 'muted']);
  });

  it('a car whose inputs are not known has no gear: the speed row is the speed alone', () => {
    expect(texts(tightNumberRows({place: 'GT3 P2', gear: null, speed: '212'}))[1]).toEqual(['212', 'km/h']);
  });

  it('without the standings only the speed row is left', () => {
    expect(texts(tightNumberRows({place: null, gear: '5', speed: '180'}))).toEqual([['5', '180', 'km/h']]);
  });

  it('the speed cell reserves three figures, whatever the speed, so 99 to 100 moves nothing', () => {
    for (const speed of ['0', '9', '99', '100', '300']) {
      const row = tightNumberRows({place: 'GT3 P6', gear: '3', speed})[1];
      expect(row.find(c => c.text === speed)?.minCh).toBe(3);
    }
  });

  it('the gear is one character wide, known or not, so the box does not move as the player inputs come and go', () => {
    const known = tightNumberRows({place: 'GT3 P6', gear: '6', speed: '243'})[1];
    const unknown = tightNumberRows({place: 'GT3 P6', gear: GEAR_UNKNOWN, speed: '243'})[1];
    expect(known.map(c => c.minCh)).toEqual(unknown.map(c => c.minCh));
    expect(unknown[0]).toEqual({text: GEAR_UNKNOWN, tone: 'strong', minCh: 1, ruleAfter: true});
    expect(known[0].tone).toBe(unknown[0].tone);
  });

  it('the unit is as wide as its text', () => {
    const row = tightNumberRows({place: 'GT3 P6', gear: 'N', speed: '0'})[1];
    expect(row.filter(c => c.minCh === undefined).map(c => c.text)).toEqual(['km/h']);
  });

  it('a rule follows the gear, known or not, so it never reads as the thousands of the speed', () => {
    for (const gear of ['2', 'N', 'R', GEAR_UNKNOWN]) {
      const row = tightNumberRows({place: 'GT3 P6', gear, speed: '126'})[1];
      expect(row.filter(c => c.ruleAfter).map(c => c.text)).toEqual([gear]);
    }
  });

  it('no rule when there is no gear: nothing to divide', () => {
    expect(tightNumberRows({place: null, gear: null, speed: '126'})[0].some(c => c.ruleAfter)).toBe(false);
  });
});
