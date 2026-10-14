import {describe, expect, it} from '@jest/globals';

import {
  androidCard,
  androidSurface,
  publishedOf,
  runningLine,
  runningLineOf,
} from './androidCard';

const release = {version: '1.0.1', versionCode: 8};
const idle = {isPending: false, isError: false};

describe('androidSurface', () => {
  it('is the app on Android, the browser on an Android phone, else none', () => {
    expect(androidSurface('android', undefined)).toBe('app');
    expect(
      androidSurface(
        'web',
        'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36',
      ),
    ).toBe('browser');
    expect(
      androidSurface(
        'web',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130',
      ),
    ).toBe('none');
    expect(androidSurface('web', undefined)).toBe('none');
    expect(androidSurface('ios', undefined)).toBe('none');
  });
});

describe('androidCard in the installed app', () => {
  const app = {surface: 'app' as const, ...idle, data: release};

  it('offers an update when the release has a higher versionCode', () => {
    expect(androidCard({...app, installedVersionCode: 7})).toEqual({
      status: 'v1.0.1',
      version: '1.0.1',
    });
  });

  it('shows nothing for the same or an older release', () => {
    expect(androidCard({...app, installedVersionCode: 8})).toBeNull();
    expect(androidCard({...app, installedVersionCode: 9})).toBeNull();
  });

  it('compares on versionCode, not on the name', () => {
    expect(
      androidCard({
        ...app,
        data: {version: '1.0.0', versionCode: 8},
        installedVersionCode: 7,
      }),
    ).not.toBeNull();
  });

  it('shows nothing while it cannot tell: checking, failed, none, or no installed versionCode', () => {
    expect(androidCard({...app, installedVersionCode: null})).toBeNull();
    expect(
      androidCard({
        ...app,
        isPending: true,
        data: undefined,
        installedVersionCode: 7,
      }),
    ).toBeNull();
    expect(
      androidCard({
        ...app,
        isError: true,
        data: undefined,
        installedVersionCode: 7,
      }),
    ).toBeNull();
    expect(
      androidCard({...app, data: null, installedVersionCode: 7}),
    ).toBeNull();
  });
});

describe('androidCard in a phone browser', () => {
  const web = {
    surface: 'browser' as const,
    installedVersionCode: null,
    ...idle,
  };

  it('offers the download of a release, with its version', () => {
    expect(androidCard({...web, data: release})).toEqual({
      status: 'v1.0.1',
      version: '1.0.1',
    });
  });

  it('says why there is nothing to download', () => {
    expect(androidCard({...web, data: null})).toEqual({
      status: 'Not released yet',
      version: null,
    });
    expect(
      androidCard({...web, isPending: true, data: undefined})?.status,
    ).toBe('Checking…');
    expect(androidCard({...web, isError: true, data: undefined})?.status).toBe(
      'Couldn’t check for the Android app',
    );
  });
});

it('has no card off Android', () => {
  expect(
    androidCard({
      surface: 'none',
      installedVersionCode: null,
      ...idle,
      data: release,
    }),
  ).toBeNull();
});

// Local-time constructor, so the tests do not depend on the machine's zone.
const publishedAt = new Date(2026, 9, 12, 14, 5);

describe('publishedOf', () => {
  it('reads day, month and 24 h time', () => {
    expect(publishedOf(publishedAt)).toBe('12 Oct 14:05');
    expect(publishedOf(new Date(2026, 0, 3, 7, 0))).toBe('3 Jan 07:00');
  });
});

const build = {
  version: '1.0.2',
  versionCode: 8,
  runtimeVersion: 'cdf505f59da36800a8966cc251197d0c488b2a52',
  channel: 'production',
  updateId: 'd83c26a3-5f0e-4b1a-9c2d-0a1b2c3d4e5f',
  publishedAt,
};
const nothing = {
  version: null,
  versionCode: null,
  runtimeVersion: null,
  channel: null,
  updateId: null,
  publishedAt: null,
};

describe('runningLineOf', () => {
  it('shows version, versionCode, runtime (first 8), channel and publish date', () => {
    expect(runningLineOf(build)).toBe(
      'App 1.0.2 (8) · runtime cdf505f5 · production · update d83c26a3 · 12 Oct 14:05',
    );
  });

  it("says 'built-in' when the app runs its own bundle", () => {
    expect(runningLineOf({...build, updateId: null, publishedAt: null})).toBe(
      'App 1.0.2 (8) · runtime cdf505f5 · production · built-in',
    );
  });

  it('leaves out what the phone does not report', () => {
    expect(runningLineOf(nothing)).toBe('App · built-in');
    expect(runningLineOf({...nothing, version: '1.0.2'})).toBe(
      'App 1.0.2 · built-in',
    );
  });
});

describe('runningLine', () => {
  it('shows nothing outside the installed app, so a phone browser never reads built-in', () => {
    expect(
      runningLine({...nothing, surface: 'browser', isEmbeddedLaunch: false}),
    ).toBeNull();
  });

  it('reads built-in on a release build, even though its embedded bundle has a createdAt', () => {
    expect(
      runningLine({...build, surface: 'app', isEmbeddedLaunch: true}),
    ).toBe('App 1.0.2 (8) · runtime cdf505f5 · production · built-in');
  });

  it('shows the publish date when the launch is an OTA', () => {
    expect(
      runningLine({...build, surface: 'app', isEmbeddedLaunch: false}),
    ).toBe(
      'App 1.0.2 (8) · runtime cdf505f5 · production · update d83c26a3 · 12 Oct 14:05',
    );
  });
});

describe('androidCard offline (roadmap 6b)', () => {
  it('says Offline, not that the check failed, when there was no network', () => {
    const q = {
      surface: 'browser' as const,
      installedVersionCode: null,
      isPending: false,
      isError: true,
      data: undefined,
    };
    expect(androidCard({...q, offline: true})?.status).toBe('Offline');
    expect(androidCard(q)?.status).toBe('Couldn’t check for the Android app');
  });
});
