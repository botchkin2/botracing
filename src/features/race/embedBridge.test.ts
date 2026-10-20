import {describe, expect, it} from '@jest/globals';

import {clockMessage, clockNeedsSending, isReadyMessage, parseClockMessage, READY_MESSAGE, type SentClock} from './embedBridge';

const END = 3000;

describe('parseClockMessage', () => {
  it('reads what clockMessage builds', () => {
    expect(parseClockMessage(clockMessage(123.4, true, 4), END)).toEqual({t: 'clock', timeS: 123.4, playing: true, rate: 4});
  });
  it('clamps the time to the race', () => {
    expect(parseClockMessage(clockMessage(-5, false, 1), END)?.timeS).toBe(0);
    expect(parseClockMessage(clockMessage(99999, false, 1), END)?.timeS).toBe(END);
  });
  it('drops everything else, quietly', () => {
    const bad: unknown[] = [
      undefined,
      null,
      42,
      {t: 'clock', timeS: 1, playing: true, rate: 1},
      '',
      'not json',
      '[]',
      'null',
      '{"t":"ready"}',
      '{"t":"clock","timeS":"1","playing":true,"rate":1}',
      '{"t":"clock","timeS":1e999,"playing":true,"rate":1}',
      '{"t":"clock","timeS":null,"playing":true,"rate":1}',
      '{"t":"clock","timeS":1,"playing":"yes","rate":1}',
      '{"t":"clock","timeS":1,"playing":true,"rate":3}',
      '{"t":"clock","timeS":1,"playing":true}',
      '{"t":"eval","timeS":1,"playing":true,"rate":1}',
      JSON.stringify({t: 'clock', timeS: 1, playing: true, rate: 1, pad: 'x'.repeat(300)}),
    ];
    for (const raw of bad) expect(parseClockMessage(raw, END)).toBeNull();
  });
  it('ignores extra fields on an otherwise good message', () => {
    expect(parseClockMessage('{"t":"clock","timeS":5,"playing":false,"rate":2,"x":1}', END)).toEqual({t: 'clock', timeS: 5, playing: false, rate: 2});
  });
});

describe('isReadyMessage', () => {
  it('accepts the one literal and nothing else', () => {
    expect(isReadyMessage(READY_MESSAGE)).toBe(true);
    for (const raw of ['{"t":"ready","x":1}', '{ "t":"ready" }', 'ready', '', null, undefined, {t: 'ready'}, '{"t":"clock"}'])
      expect(isReadyMessage(raw)).toBe(false);
  });
});

describe('clockNeedsSending', () => {
  const at = (timeS: number, atMs: number, playing = true, rate: SentClock['rate'] = 1): SentClock => ({timeS, atMs, playing, rate});
  it('sends the first state', () => {
    expect(clockNeedsSending(null, at(0, 0, false))).toBe(true);
  });
  it('sends a play, pause or rate change', () => {
    expect(clockNeedsSending(at(10, 0, false), at(10, 100, true))).toBe(true);
    expect(clockNeedsSending(at(10, 0, true), at(10.1, 100, false))).toBe(true);
    expect(clockNeedsSending(at(10, 0, true, 1), at(10.1, 100, true, 4))).toBe(true);
  });
  it('lets a steady play run on the page, and sends a jump', () => {
    expect(clockNeedsSending(at(10, 0, true, 2), at(12.1, 1000, true, 2))).toBe(false);
    expect(clockNeedsSending(at(10, 0, true, 2), at(300, 1000, true, 2))).toBe(true);
    expect(clockNeedsSending(at(10, 0, true, 1), at(5, 1000, true, 1))).toBe(true);
  });
  it('sends a seek while paused, and nothing when it has not moved', () => {
    expect(clockNeedsSending(at(10, 0, false), at(10, 5000, false))).toBe(false);
    expect(clockNeedsSending(at(10, 0, false), at(11, 5000, false))).toBe(true);
  });
});
