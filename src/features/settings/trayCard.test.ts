import {describe, expect, it} from '@jest/globals';

import {type Uploader} from '@/src/data/uploaders';

import {compareVersions, pcLine, trayCard} from './trayCard';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const pc = (over: Partial<Uploader>): Uploader =>
  ({
    hostId: 'ab12cd34',
    host: 'Race PC',
    version: '0.1.2',
    lastSeenAt: NOW - 60_000,
    ...over,
  } as Uploader);

describe('trayCard', () => {
  it('offers the download of a release, with its version', () => {
    expect(
      trayCard({
        isPending: false,
        isError: false,
        data: {version: '0.2.0', notes: ''},
      }),
    ).toEqual({status: 'Latest v0.2.0', version: '0.2.0', pcs: []});
  });

  it('says why there is nothing to download', () => {
    const none = {isPending: false, isError: false, data: null};
    expect(trayCard(none)).toEqual({
      status: 'Not released yet',
      version: null,
      pcs: [],
    });
    expect(trayCard({...none, isPending: true, data: undefined}).status).toBe(
      'Checking…',
    );
    expect(trayCard({...none, isError: true, data: undefined}).status).toBe(
      'Couldn’t check for the Windows app',
    );
  });

  it('compares x.y.z versions and nothing else', () => {
    expect(compareVersions('0.1.2', '0.1.3')).toBeLessThan(0);
    expect(compareVersions('0.2.0', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('0.1.3', '0.1.3')).toBe(0);
    expect(compareVersions('0.1.3-rc.1', '0.1.3')).toBe(0);
    expect(compareVersions('4dda01b', '0.1.3')).toBeNull();
    expect(compareVersions('', '0.1.3')).toBeNull();
  });

  it('says per PC: version, then not reporting, or update available, or latest', () => {
    expect(pcLine(pc({}), '0.1.3', NOW, false)).toBe(
      'v0.1.2 · v0.1.3 available',
    );
    expect(pcLine(pc({version: '0.1.3'}), '0.1.3', NOW, false)).toBe(
      'v0.1.3 · latest',
    );
    expect(pcLine(pc({version: '0.2.0'}), '0.1.3', NOW, false)).toBe(
      'v0.2.0 · latest',
    );
    expect(
      pcLine(pc({lastSeenAt: NOW - 11 * 60_000}), '0.1.3', NOW, false),
    ).toBe('v0.1.2 · not reporting');
    expect(pcLine(pc({lastSeenAt: null}), '0.1.3', NOW, false)).toBe(
      'v0.1.2 · not reporting',
    );
    expect(pcLine(pc({version: '4dda01b'}), '0.1.3', NOW, false)).toBe(
      'v4dda01b',
    );
    expect(pcLine(pc({}), null, NOW, false)).toBe('v0.1.2');
    expect(pcLine(pc({}), '0.1.3', NOW, true)).toBe(
      'Race PC · v0.1.2 · v0.1.3 available',
    );
  });

  it('lists every PC newest first, and says when none has reported', () => {
    const q = {
      isPending: false,
      isError: false,
      data: {version: '0.1.3', notes: ''},
      nowMs: NOW,
    };
    expect(trayCard({...q, pcs: []}).pcs).toEqual(['No PC reporting']);
    expect(trayCard(q).pcs).toEqual([]);
    expect(
      trayCard({
        ...q,
        pcs: [
          pc({host: 'Old PC', lastSeenAt: NOW - 3_600_000}),
          pc({host: 'Race PC', version: '0.1.3'}),
        ],
      }).pcs,
    ).toEqual(['Race PC · v0.1.3 · latest', 'Old PC · v0.1.2 · not reporting']);
  });
});
