import {describe, expect, it} from '@jest/globals';

import type {PlanChecks} from './planChecks';
import {checksText} from './planChecksText';

const checks = (over: Partial<PlanChecks> = {}): PlanChecks => ({
  maxFuelL: {value: 73, state: 'checked'},
  fuelPerLapL: {value: 3.57, state: 'checked'},
  vePerLapPct: {value: 5.7, state: 'checked', lmuPct: 5.41},
  offline: null,
  ...over,
});

describe('checksText', () => {
  it('prints the three facts with what each rests on', () => {
    const t = checksText(
      checks({fuelPerLapL: {value: 3.57, state: 'one-source'}}),
    );
    expect(t.facts.map(f => [f.text, f.status, f.flag])).toEqual([
      ['Max fuel 73 L', 'checked', false],
      ['Fuel 3.57 L a lap', '1 source', false],
      ['VE 5.7 % a lap', 'checked', false],
    ]);
    expect(t.notes).toEqual([]);
  });

  it("says a VE that does not match LMU's setup, with LMU's number", () => {
    const t = checksText(
      checks({vePerLapPct: {value: 5.14, state: 'disagrees', lmuPct: 5.41}}),
    );
    expect(t.facts[2]).toEqual({
      text: 'VE 5.1 % a lap',
      status: 'disagrees',
      flag: true,
    });
    expect(t.notes).toEqual([
      "VE a lap doesn't match LMU's setup (5.4 %). Check before you race.",
    ]);
  });

  it('says max fuel is not in a recording without the setup, and shows no status', () => {
    const t = checksText(checks({maxFuelL: {value: null, state: null}}));
    expect(t.facts[0]).toEqual({
      text: 'Max fuel: not in this recording',
      status: null,
      flag: false,
    });
  });

  it('words the offline line both ways', () => {
    expect(checksText(checks({offline: {kind: 'not-compared'}})).notes).toEqual(
      ['Offline practice: not yet compared with an online session.'],
    );
    expect(
      checksText(
        checks({
          offline: {
            kind: 'matched',
            online: {startedAt: '2026-10-28T20:00:00', sessionType: 'R'},
          },
        }),
      ).notes,
    ).toEqual(['Offline matched your online race, Oct 28.']);
  });

  it('leaves out the facts the plan does not have', () => {
    const t = checksText(
      checks({
        fuelPerLapL: {value: null, state: null},
        vePerLapPct: {value: null, state: null, lmuPct: null},
      }),
    );
    expect(t.facts.map(f => f.text)).toEqual(['Max fuel 73 L']);
  });
});
