import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
  carClasses,
  classLabel,
  driversOfYaml,
  relabelField,
} from './irClasses.mjs';

// The seat-test Sebring drive's DriverInfo, cut down: offline, so no short
// names; three classes and the safety car.
const YAML = `---
DriverInfo:
 DriverCarIdx: 0
 Drivers:
 - CarIdx: 0
   UserName: A
   CarScreenName: Ford Mustang GT3
   CarClassID: 4011
   CarClassShortName:
   CarIsPaceCar: 0
 - CarIdx: 1
   UserName: B
   CarScreenName: Dallara P217 LMP2
   CarClassID: 2523
   CarClassShortName:
   CarIsPaceCar: 0
 - CarIdx: 2
   UserName: C
   CarScreenName: Porsche 963 GTP
   CarClassID: 4029
   CarClassShortName:
   CarIsPaceCar: 0
 - CarIdx: 3
   UserName: Pace Car
   CarScreenName: safety pcsedan
   CarClassID: 11
   CarClassShortName:
   CarIsPaceCar: 1
`;

test('reads every car of the DriverInfo but the pace car', () => {
  assert.deepEqual(driversOfYaml(YAML), [
    {carIdx: 0, classId: 4011, className: '', carName: 'Ford Mustang GT3'},
    {carIdx: 1, classId: 2523, className: '', carName: 'Dallara P217 LMP2'},
    {carIdx: 2, classId: 4029, className: '', carName: 'Porsche 963 GTP'},
  ]);
  assert.deepEqual(driversOfYaml(''), []);
});

test('the driver list ends at the next top-level key', () => {
  const withNext = `${YAML}SplitTimeInfo:
 Sectors:
 - SectorNum: 0
CarSetup:
 CarScreenName: Not a driver
 CarClassID: 77
`;
  const drivers = driversOfYaml(withNext);
  assert.equal(drivers.length, 3);
  assert.deepEqual(drivers.at(-1), {
    carIdx: 2,
    classId: 4029,
    className: '',
    carName: 'Porsche 963 GTP',
  });
});

test('a known id is named by its class, never by a model', () => {
  const cars = [
    {classId: 4029, className: '', carName: 'Porsche 963 GTP'},
    {classId: 4029, className: '', carName: 'Porsche 963 GTP'},
    {classId: 4029, className: '', carName: 'Cadillac V-Series.R'},
  ];
  assert.equal(classLabel(4029, cars), 'GTP');
  // iRacing's own short name for the 2023 IMSA GT3s is not the label either.
  assert.equal(
    classLabel(4011, [{classId: 4011, className: 'IMSA23', carName: 'x'}]),
    'GT3',
  );
});

test('an unknown id: the sim name, one model, or the most common model +N', () => {
  assert.equal(
    classLabel(9, [{classId: 9, className: 'Cup', carName: 'x'}]),
    'Cup',
  );
  assert.equal(
    classLabel(9, [
      {classId: 9, className: '', carName: 'Mazda MX-5 Cup'},
      {classId: 9, className: '', carName: 'Mazda MX-5 Cup'},
    ]),
    'Mazda MX-5 Cup',
  );
  assert.equal(
    classLabel(9, [
      {classId: 9, className: '', carName: 'B'},
      {classId: 9, className: '', carName: 'A'},
      {classId: 9, className: '', carName: 'A'},
      {classId: 9, className: '', carName: 'C'},
    ]),
    'A +2',
  );
  assert.equal(classLabel(9, []), '');
});

test('class ids come from the capture when it has them, else from the .ibt', () => {
  const ibt = driversOfYaml(YAML);
  // A capture from before #370: no class ids.
  const old = [{carIdx: 0, className: '', carName: 'Ford Mustang GT3'}];
  assert.deepEqual(carClasses(old, ibt).get(2), {
    classId: 4029,
    classLabel: 'GTP',
  });
  assert.equal(carClasses(old, ibt).has(3), false, 'the pace car has no class');
  const meta = [
    {carIdx: 5, classId: 2523, className: '', carName: 'Dallara P217 LMP2'},
  ];
  assert.deepEqual(
    [...carClasses(meta, ibt)],
    [[5, {classId: 2523, classLabel: 'LMP2'}]],
  );
  assert.equal(carClasses([], []).size, 0);
});

test('a stored field without classes takes them from the .ibt by model', () => {
  const ibt = driversOfYaml(YAML);
  const field = {
    v: 2,
    cars: [
      {i: 0, class: '', vehicle: 'Ford Mustang GT3', player: true},
      {i: 1, class: '', vehicle: 'Porsche 963 GTP', player: false},
      {i: 2, class: '', vehicle: 'Unknown car', player: false},
    ],
  };
  const out = relabelField(field, ibt);
  assert.deepEqual(out.cars, [
    {
      i: 0,
      class: '',
      vehicle: 'Ford Mustang GT3',
      player: true,
      classId: 4011,
      classLabel: 'GT3',
    },
    {
      i: 1,
      class: '',
      vehicle: 'Porsche 963 GTP',
      player: false,
      classId: 4029,
      classLabel: 'GTP',
    },
    {i: 2, class: '', vehicle: 'Unknown car', player: false},
  ]);
  assert.equal(out.v, 2, 'the rest of the file is unchanged');
  assert.equal(
    relabelField(out, ibt),
    null,
    'a field with classes is left alone',
  );
  assert.equal(relabelField(field, []), null);
  // A model the .ibt puts in two classes gets none.
  const twice = [
    ...ibt,
    {carIdx: 9, classId: 2708, className: '', carName: 'Ford Mustang GT3'},
  ];
  assert.equal(relabelField(field, twice).cars[0].classId, undefined);
});
