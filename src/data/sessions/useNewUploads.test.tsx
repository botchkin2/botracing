import {afterEach, describe, expect, it} from '@jest/globals';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, create} from 'react-test-renderer';

import {type Uploader, uploaderKeys} from '../uploaders';

import {sessionKeys} from './keys';
import {uploadSignature, useNewUploads} from './useNewUploads';

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
