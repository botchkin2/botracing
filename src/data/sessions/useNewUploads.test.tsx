import {afterEach, describe, expect, it} from '@jest/globals';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, create} from 'react-test-renderer';

import {type Uploader, uploaderKeys} from '../uploaders';

import {sessionKeys} from './keys';
import {
  sessionUploadMark,
  uploadSignature,
  useNewUploads,
  useSessionNewUploads,
} from './useNewUploads';

const up = (over: Partial<Uploader>) =>
  ({hostId: 'h', lastUploadAt: null, lastSessionId: null, ...over} as Uploader);

describe('uploadSignature', () => {
  it('changes with a new upload or session, not with nothing', () => {
    const a = uploadSignature([up({lastUploadAt: 1, lastSessionId: 's1'})]);
    expect(uploadSignature([up({lastUploadAt: 1, lastSessionId: 's1'})])).toBe(
      a,
    );
    expect(
      uploadSignature([up({lastUploadAt: 2, lastSessionId: 's1'})]),
    ).not.toBe(a);
    expect(
      uploadSignature([up({lastUploadAt: 1, lastSessionId: 's2'})]),
    ).not.toBe(a);
    expect(uploadSignature(undefined)).toBe('');
  });
});

describe('useNewUploads', () => {
  const clients: QueryClient[] = [];
  afterEach(() => clients.splice(0).forEach(c => c.clear()));

  it('reads the list again when an uploader reports a new upload, not before', async () => {
    const client = new QueryClient();
    clients.push(client);
    const listKey = sessionKeys.list({});
    client.setQueryData(listKey, {items: [], total: 0});
    client.setQueryData(uploaderKeys.all, [
      up({lastUploadAt: 1, lastSessionId: 's1'}),
    ]);
    function Probe() {
      useNewUploads();
      return null;
    }
    await act(async () => {
      create(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      );
      await new Promise(r => setTimeout(r, 20));
    });
    expect(client.getQueryState(listKey)?.isInvalidated).toBe(false);
    await act(async () => {
      client.setQueryData(uploaderKeys.all, [
        up({lastUploadAt: 2, lastSessionId: 's1'}),
      ]);
      await new Promise(r => setTimeout(r, 20));
    });
    expect(client.getQueryState(listKey)?.isInvalidated).toBe(true);
  });
});

describe('sessionUploadMark', () => {
  it('is the newest upload to this session, by any PC, else null', () => {
    expect(
      sessionUploadMark(
        [
          up({hostId: 'a', lastUploadAt: 5, lastSessionId: 's1'}),
          up({hostId: 'b', lastUploadAt: 9, lastSessionId: 's1'}),
          up({hostId: 'c', lastUploadAt: 99, lastSessionId: 's2'}),
        ],
        's1',
      ),
    ).toBe(9);
    expect(sessionUploadMark([up({lastSessionId: 's2'})], 's1')).toBeNull();
    expect(sessionUploadMark(undefined, 's1')).toBeNull();
  });
});

// A drive that went quiet and resumed into the open session (pit-wall #5290).
describe('useSessionNewUploads', () => {
  const clients: QueryClient[] = [];
  afterEach(() => clients.splice(0).forEach(c => c.clear()));

  async function mount(client: QueryClient, listen: boolean) {
    function Probe() {
      useSessionNewUploads('s1', listen);
      return null;
    }
    await act(async () => {
      create(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      );
      await new Promise(r => setTimeout(r, 20));
    });
  }

  it('reads the open session again when a PC uploads to it, not for another session', async () => {
    const client = new QueryClient();
    clients.push(client);
    const detail = sessionKeys.detail('s1');
    client.setQueryData(detail, {id: 's1'});
    client.setQueryData(uploaderKeys.all, [
      up({lastUploadAt: 1, lastSessionId: 's1'}),
    ]);
    await mount(client, true);
    expect(client.getQueryState(detail)?.isInvalidated).toBe(false);
    await act(async () => {
      client.setQueryData(uploaderKeys.all, [
        up({lastUploadAt: 2, lastSessionId: 's2'}),
      ]);
      await new Promise(r => setTimeout(r, 20));
    });
    expect(client.getQueryState(detail)?.isInvalidated).toBe(false);
    await act(async () => {
      client.setQueryData(uploaderKeys.all, [
        up({lastUploadAt: 3, lastSessionId: 's1'}),
      ]);
      await new Promise(r => setTimeout(r, 20));
    });
    expect(client.getQueryState(detail)?.isInvalidated).toBe(true);
  });

  it('does not ask or listen for an old session (not live in the last 2 h)', async () => {
    const client = new QueryClient();
    clients.push(client);
    const detail = sessionKeys.detail('s1');
    client.setQueryData(detail, {id: 's1'});
    client.setQueryData(uploaderKeys.all, [
      up({lastUploadAt: 1, lastSessionId: 's1'}),
    ]);
    await mount(client, false);
    await act(async () => {
      client.setQueryData(uploaderKeys.all, [
        up({lastUploadAt: 2, lastSessionId: 's1'}),
      ]);
      await new Promise(r => setTimeout(r, 20));
    });
    expect(client.getQueryState(detail)?.isInvalidated).toBe(false);
  });
});
