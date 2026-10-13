import {afterEach, beforeEach, describe, expect, it} from '@jest/globals';
import {QueryClientProvider} from '@tanstack/react-query';
import {act, create} from 'react-test-renderer';

import {queryClient} from '@/src/utils/queryClient';

import {sessionKeys} from './keys';
import {useSessions} from './queries';

// Thread 1 #4983/#4997: the app's QueryClient never refetches on mount, so the
// Sessions list kept the list it first read until the app restarted ("I had to
// filter to LMU to find the live one": a new filter is a new key).
const realFetch = globalThis.fetch;
let asked: string[];

beforeEach(() => {
  asked = [];
  queryClient.clear();
  globalThis.fetch = (async (url: string) => {
    asked.push(String(url));
    return new Response(JSON.stringify({items: [], total: 0}), {
      status: 200,
      headers: {'content-type': 'application/json'},
    });
  }) as typeof fetch;
});
afterEach(() => {
  queryClient.clear();
  globalThis.fetch = realFetch;
});

describe('useSessions on the app QueryClient', () => {
  it('reads a stale list again when the screen opens again', async () => {
    function Probe() {
      useSessions({});
      return null;
    }
    const mount = async () => {
      let tree!: ReturnType<typeof create>;
      await act(async () => {
        tree = create(
          <QueryClientProvider client={queryClient}>
            <Probe />
          </QueryClientProvider>,
        );
        await new Promise(r => setTimeout(r, 30));
      });
      return tree;
    };
    const first = await mount();
    await act(async () => first.unmount());
    expect(asked).toHaveLength(1);
    // A fresh list is not asked for again...
    const second = await mount();
    await act(async () => second.unmount());
    expect(asked).toHaveLength(1);
    // ...a stale one is.
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: sessionKeys.list({}),
        refetchType: 'none',
      });
    });
    const third = await mount();
    await act(async () => third.unmount());
    expect(asked).toHaveLength(2);
  });
});
