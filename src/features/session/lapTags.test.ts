import {describe, expect, it} from '@jest/globals';

import {type LapTraffic} from '@/src/data/sessions';

import {lapTraffic, orderTags, trafficTags} from './lapTags';

const none: LapTraffic = {
  draftS: 0,
  trafficAheadS: 0,
  trafficBehindS: 0,
  blueFlagS: 0,
  passesMade: 0,
  passesSuffered: 0,
  passesMadeAll: 0,
  passesSufferedAll: 0,
  battleS: 0,
  overtakes: [],
};

describe('trafficTags', () => {
  it('gives nothing without a field, or on a clean lap', () => {
    expect(trafficTags(null)).toEqual([]);
    expect(trafficTags(none)).toEqual([]);
  });

  it('shows TOW from 1.0 s, TRAF from 2 s, BLUE for each faster-class pass, BTL from 5 s', () => {
    expect(trafficTags({...none, draftS: 0.9})).toEqual([]);
    expect(trafficTags({...none, draftS: 6.14})).toEqual([{code: 'TOW 6.1'}]);
    expect(trafficTags({...none, trafficAheadS: 1.9})).toEqual([]);
    expect(trafficTags({...none, trafficAheadS: 4.2})).toEqual([
      {code: 'TRAF 4.2'},
    ]);
    // Seconds with a faster car close behind are a fact in the lap detail, not a tag.
    expect(trafficTags({...none, blueFlagS: 3.5})).toEqual([]);
    expect(
      trafficTags({...none, overtakes: [{cls: 'Hyper', atM: 900}]}),
    ).toEqual([{code: 'BLUE 1'}]);
    expect(trafficTags({...none, battleS: 4.9})).toEqual([]);
    expect(trafficTags({...none, battleS: 33.6})).toEqual([{code: 'BTL 34'}]);
  });

  it('PASS reads the own-class counts, with the sign only where there is a count', () => {
    expect(trafficTags({...none, passesMade: 1, passesSuffered: 2})).toEqual([
      {code: 'PASS +1 \u22122'},
    ]);
    expect(trafficTags({...none, passesMade: 2})).toEqual([{code: 'PASS +2'}]);
    expect(trafficTags({...none, passesSuffered: 3})).toEqual([
      {code: 'PASS \u22123'},
    ]);
    // A Hypercar lapping a GT3: all-car passes, none in class: no tag.
    expect(trafficTags({...none, passesSufferedAll: 6})).toEqual([]);
  });
});

describe('orderTags', () => {
  it('follows the R3 priority, so a towed best lap shows TOW first', () => {
    const codes = (tags: {code: string}[]) => orderTags(tags).map(t => t.code);
    expect(
      codes([
        {code: 'BEST'},
        {code: 'HIT'},
        {code: 'TOW 6.1'},
        {code: 'PASS +1'},
        {code: 'OFF 2.0'},
        {code: 'SLOW'},
      ]),
    ).toEqual(['SLOW', 'TOW 6.1', 'BEST', 'OFF 2.0', 'HIT', 'PASS +1']);
    expect(codes([{code: 'BLUE 2.0'}, {code: 'TRAF'}, {code: 'OUT'}])).toEqual([
      'OUT',
      'TRAF',
      'BLUE 2.0',
    ]);
  });
});

describe('lapTraffic', () => {
  it('towed from 1 s, hollow from 5 s, held up from 4 s, tick for blue too', () => {
    expect(lapTraffic(null)).toEqual({
      towed: false,
      hollow: false,
      heldUp: false,
      tick: false,
    });
    expect(lapTraffic({...none, draftS: 1})).toMatchObject({
      towed: true,
      hollow: false,
    });
    expect(lapTraffic({...none, draftS: 5})).toMatchObject({hollow: true});
    expect(lapTraffic({...none, blueFlagS: 1})).toMatchObject({
      heldUp: false,
      tick: true,
    });
    expect(lapTraffic({...none, trafficAheadS: 4})).toMatchObject({
      heldUp: true,
      tick: true,
    });
  });
});
