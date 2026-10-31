import {describe, expect, it} from '@jest/globals';

import {type Uploader} from '@/src/data/uploaders';

import {pcLine, trayCard} from './trayCard';

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
    ).toEqual({
      status: 'Latest v0.2.0',
      version: '0.2.0',
      pcs: [],
      canDownload: true,
    });
  });

  it('hides the download once a tray reports, or inside the tray', () => {
    const q = {
      isPending: false,
      isError: false,
      data: {version: '0.2.0', notes: ''},
    };
    expect(trayCard({...q, pcs: [pc({})], nowMs: NOW}).canDownload).toBe(false);
    expect(trayCard({...q, inTray: true}).canDownload).toBe(false);
    // A tray not heard from for 11 minutes is not connected: the download stays.
    expect(
      trayCard({...q, pcs: [pc({lastSeenAt: NOW - 11 * 60_000})], nowMs: NOW})
        .canDownload,
    ).toBe(true);
    expect(trayCard({...q, pcs: [], nowMs: NOW}).canDownload).toBe(true);
  });

  it('says why there is nothing to download', () => {
    const none = {isPending: false, isError: false, data: null};
    expect(trayCard(none)).toEqual({
      status: 'Not released yet',
      version: null,
      pcs: [],
      canDownload: false,
    });
    expect(trayCard({...none, isPending: true, data: undefined}).status).toBe(
      'Checking…',
    );
    expect(trayCard({...none, isError: true, data: undefined}).status).toBe(
      'Couldn’t check for the Windows app',
    );
  });

  it('says per PC: version, then not reporting, or update available, or latest', () => {
    expect(pcLine(pc({}), '0.1.3', NOW, false)).toBe(
      'v0.1.2 · v0.1.3 available · the PC fetches it within 30 min',
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
      'Race PC · v0.1.2 · v0.1.3 available · the PC fetches it within 30 min',
    );
  });

  it('says what happens next while an update is available but not downloaded, and what is ready once it is', () => {
    // Not downloaded: nothing can be pressed yet, the tray fetches it by itself.
    expect(pcLine(pc({}), '0.1.3', NOW, false, true)).toBe(
      'v0.1.2 · v0.1.3 available · fetched within 30 min, then Restart appears here',
    );
    // Downloaded (updateWaiting): the ready row and the banner take over.
    expect(pcLine(pc({updateWaiting: '0.1.3'}), '0.1.3', NOW, false)).toBe(
      'v0.1.2 · v0.1.3 ready',
    );
    // Never a promise for a PC that is not reporting.
    expect(
      pcLine(pc({lastSeenAt: NOW - 11 * 60_000}), '0.1.3', NOW, false, true),
    ).toBe('v0.1.2 · not reporting');
  });

  it('lists every PC newest first, and says when none has reported', () => {
    const q = {
      isPending: false,
      isError: false,
      data: {version: '0.1.3', notes: ''},
      nowMs: NOW,
    };
    expect(trayCard({...q, pcs: []}).pcs.map(r => r.text)).toEqual(['No PC reporting']);
    expect(trayCard(q).pcs).toEqual([]);
    expect(
      trayCard({
        ...q,
        pcs: [
          pc({host: 'Old PC', lastSeenAt: NOW - 3_600_000}),
          pc({host: 'Race PC', version: '0.1.3'}),
        ],
      }).pcs.map(r => r.text),
    ).toEqual(['Race PC · v0.1.3 · latest', 'Old PC · v0.1.2 · not reporting']);
  });

  it('keys each PC by its uploader id, so two PCs reading the same line are two rows (ticket 95)', () => {
    const q = {isPending: false, isError: false, data: {version: '0.1.3', notes: ''}, nowMs: NOW};
    const rows = trayCard({
      ...q,
      pcs: [pc({hostId: 'a', host: 'Race PC', version: '0.1.3'}), pc({hostId: 'b', host: 'Race PC', version: '0.1.3'})],
    }).pcs;
    expect(rows.map(r => r.text)[0]).toBe(rows.map(r => r.text)[1]);
    expect(new Set(rows.map(r => r.key)).size).toBe(2);
  });
});

describe('trayCard offline (roadmap 6b)', () => {
  it('says Offline, not that the check failed, when there was no network', () => {
    const q = {isPending: false, isError: true, data: undefined};
    expect(trayCard({...q, offline: true}).status).toBe('Offline');
    expect(trayCard(q).status).toBe('Couldn’t check for the Windows app');
  });
});
