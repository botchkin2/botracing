import {describe, expect, it} from '@jest/globals';

import {androidCard, androidSurface, runningLine, runningLineOf} from './androidCard';

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

describe('runningLineOf', () => {
  it('shows the version and the update id, first 8 characters', () => {
    expect(runningLineOf('1.0.2', 'd83c26a3-5f0e-4b1a-9c2d-0a1b2c3d4e5f')).toBe(
      'App 1.0.2 · update d83c26a3',
    );
  });

  it("says 'built-in' when the app runs its own bundle", () => {
    expect(runningLineOf('1.0.2', null)).toBe('App 1.0.2 · built-in');
  });

  it('names the app without a version when none is known', () => {
    expect(runningLineOf(null, null)).toBe('App · built-in');
  });
});

describe('runningLine', () => {
  it('shows nothing outside the installed app, so a phone browser never reads built-in', () => {
    expect(
      runningLine({
        surface: 'browser',
        version: null,
        updateId: null,
        isEmbeddedLaunch: false,
      }),
    ).toBeNull();
  });

  it('reads built-in on a release build, even though its embedded bundle has an updateId', () => {
    expect(
      runningLine({
        surface: 'app',
        version: '1.0.2',
        updateId: 'd83c26a3-5f0e-4b1a-9c2d-0a1b2c3d4e5f',
        isEmbeddedLaunch: true,
      }),
    ).toBe('App 1.0.2 · built-in');
  });

  it('shows the update it runs when the launch is an OTA', () => {
    expect(
      runningLine({
        surface: 'app',
        version: '1.0.2',
        updateId: 'd83c26a3-5f0e-4b1a-9c2d-0a1b2c3d4e5f',
        isEmbeddedLaunch: false,
      }),
    ).toBe('App 1.0.2 · update d83c26a3');
  });
});
