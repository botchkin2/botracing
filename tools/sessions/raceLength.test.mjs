import assert from 'node:assert/strict';
import {test} from 'node:test';
import {raceLengthFromYaml, raceLengthOf} from './raceLength.mjs';

test('the minutes from the green flag to the end time', () => {
  // The 3 Oct Road Atlanta race: green from 159.4 s, ends at 2559 s.
  assert.deepEqual(raceLengthOf({endEt: 2559, greenStartEt: 159.4}), {
    minutes: 40,
  });
  assert.deepEqual(raceLengthOf({endEt: 7370, greenStartEt: 170}), {
    minutes: 120,
  });
});

test('says nothing when the numbers do not say', () => {
  assert.equal(raceLengthOf({endEt: NaN, greenStartEt: 100}), null);
  assert.equal(raceLengthOf({endEt: 50, greenStartEt: 100}), null); // ends before the green
  assert.equal(raceLengthOf({endEt: NaN, greenStartEt: NaN}), null);
  // The game's "not set" end time (-2147483648) is not a length.
  assert.equal(raceLengthOf({endEt: -2147483648, greenStartEt: 100}), null);
});

// The Sessions block of a real .ibt (toyotagr86_zandvoort 2023 gp, 27 Oct 2024),
// trimmed to the keys read. Every file of the event carries all three sessions.
const ZANDVOORT = `SessionInfo:
 Sessions:
 - SessionNum: 0
   SessionLaps: unlimited
   SessionTime: 180.0000 sec
   SessionType: Practice
   SessionName: PRACTICE
 - SessionNum: 1
   SessionLaps: 2
   SessionTime: 480.0000 sec
   SessionType: Lone Qualify
   SessionName: QUALIFY
 - SessionNum: 2
   SessionLaps: unlimited
   SessionTime: 900.0000 sec
   SessionType: Race
   SessionName: RACE
`;

test('iRacing: the Race entry of the session info, in minutes', () => {
  assert.deepEqual(raceLengthFromYaml(ZANDVOORT), {minutes: 15});
  assert.deepEqual(
    raceLengthFromYaml(ZANDVOORT.replace('900.0000 sec', '2700.0000 sec')),
    {minutes: 45},
  );
});

test('iRacing: unlimited time, no Race entry or a practice-only file is unknown, not zero', () => {
  assert.equal(
    raceLengthFromYaml(ZANDVOORT.replace('900.0000 sec', 'unlimited')),
    null,
  );
  const practiceOnly = `SessionInfo:
 Sessions:
 - SessionNum: 0
   SessionLaps: unlimited
   SessionTime: 3600.0000 sec
   SessionType: Practice
   SessionName: PRACTICE
`;
  assert.equal(raceLengthFromYaml(practiceOnly), null);
  assert.equal(raceLengthFromYaml(''), null);
});

test('iRacing: a heat event takes the race of the own session, never the first one', () => {
  const heats = `SessionInfo:
 CurrentSessionNum: 3
 Sessions:
 - SessionNum: 2
   SessionTime: 600.0000 sec
   SessionType: Race
 - SessionNum: 3
   SessionTime: 1800.0000 sec
   SessionType: Race
`;
  const withCurrent = n => heats.replace('CurrentSessionNum: 3', `CurrentSessionNum: ${n}`);
  assert.deepEqual(raceLengthFromYaml(withCurrent(2)), {minutes: 10});
  // Practice is the current session and two races are listed: not guessed.
  assert.equal(raceLengthFromYaml(withCurrent(0)), null);
  // No current number and two races: not guessed.
  assert.equal(raceLengthFromYaml(heats.replace(' CurrentSessionNum: 3\n', '')), null);
});
