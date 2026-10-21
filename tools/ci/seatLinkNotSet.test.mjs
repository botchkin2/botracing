import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';

// EXPO_PUBLIC_SEAT_LINK=1 switches the emulator-only seat-test sign-in on (src/auth/devSeatLink.ts, app/+native-intent.tsx).
// Only a seat building an emulator APK by hand sets it. No workflow, EAS profile or app config may.
const FILES = [
  ...fs.readdirSync('.github/workflows').map(f => path.join('.github/workflows', f)),
  'eas.json',
  'app.json',
  ...['app.config.js', 'app.config.ts'].filter(f => fs.existsSync(f)),
];

test('no workflow, eas.json profile or app config sets EXPO_PUBLIC_SEAT_LINK', () => {
  const hits = FILES.filter(f => fs.readFileSync(f, 'utf8').includes('EXPO_PUBLIC_SEAT_LINK'));
  // the OTA workflow names it in a comment explaining the bundle check; setting it would be a `NAME:` or `NAME=` form
  const sets = hits.filter(f => /EXPO_PUBLIC_SEAT_LINK\s*[:=]/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(sets, []);
});
