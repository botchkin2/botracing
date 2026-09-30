// Run: node --test tools/sessions/
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {reusableInfo} from './describeCache.mjs';
import {describeVersion} from './lmu.mjs';

const stat = {size: 1000, mtimeMs: 5};
// What a file described before #144 carries: a fuel setup with the LMP2 gallons
// string read as litres (fillLimitL 1980).
const stale = {fuelSetup: {fillLimitL: 1980, tankL: 71}};

test('an entry with no describe version is described again (the stale 1980 case)', () => {
  const known = {size: 1000, mtimeMs: 5, info: stale};
  assert.equal(reusableInfo(known, stat, describeVersion), null);
});

test('an entry from an older describe version is described again', () => {
  const known = {
    size: 1000,
    mtimeMs: 5,
    describeVersion: describeVersion - 1,
    info: stale,
  };
  assert.equal(reusableInfo(known, stat, describeVersion), null);
});

test('an unchanged file described by this version is reused', () => {
  const info = {fuelSetup: {fillLimitL: 75, tankL: 71}};
  const known = {size: 1000, mtimeMs: 5, describeVersion, info};
  assert.equal(reusableInfo(known, stat, describeVersion), info);
});

test('a changed file is described again, whatever the version', () => {
  const info = {fuelSetup: {fillLimitL: 75}};
  const known = {size: 900, mtimeMs: 5, describeVersion, info};
  assert.equal(reusableInfo(known, stat, describeVersion), null);
  assert.equal(
    reusableInfo({...known, size: 1000, mtimeMs: 6}, stat, describeVersion),
    null,
  );
});

test('a file never described has nothing to reuse', () => {
  assert.equal(reusableInfo(undefined, stat, describeVersion), null);
  assert.equal(
    reusableInfo(
      {size: 1000, mtimeMs: 5, describeVersion},
      stat,
      describeVersion,
    ),
    null,
  );
});

test('the describe version is a positive whole number, past the unversioned 1', () => {
  assert.ok(Number.isInteger(describeVersion) && describeVersion >= 2);
});
