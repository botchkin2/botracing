import {describe, expect, it} from '@jest/globals';

import {toAndroidRelease} from './adapters';

// What /api/android/latest answers (functions/test/androidCore.test.mjs).
const latest = {
  version: '1.0.0',
  versionCode: 7,
  sha256: 'a'.repeat(64),
  published_at: '2026-10-09T20:00:00Z',
  url: 'https://storage.example/android/1.0.0/BotRacing-1.0.0.apk?sig=abc',
};

describe('toAndroidRelease', () => {
  it('reads the version and the versionCode', () => {
    expect(toAndroidRelease(latest)).toEqual({
      version: '1.0.0',
      versionCode: 7,
    });
  });

  it('is null without a version, a whole versionCode or a URL', () => {
    for (const bad of [
      {...latest, version: ''},
      {...latest, versionCode: 0},
      {...latest, versionCode: 1.5},
      {...latest, versionCode: '7'},
      {...latest, url: undefined},
    ])
      expect(toAndroidRelease(bad)).toBeNull();
    expect(toAndroidRelease(null)).toBeNull();
    expect(toAndroidRelease('x')).toBeNull();
  });
});
