import {afterEach, beforeEach, describe, expect, it} from '@jest/globals';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, create} from 'react-test-renderer';

import {useTrackMap} from './queries';

// A layout with no map (iRacing before its map is made) answers 404. The
// screens must get "no map" once and stop asking: on the phone Compare asked
// about seven times a second and drew nothing.

const realFetch = globalThis.fetch;
let asked: string[];

beforeEach(() => {
  asked = [];
  globalThis.fetch = (async (url: string) => {
    asked.push(url);
    return new Response('not found', {status: 404});
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('useTrackMap on a layout with no map (404)', () => {
  it('settles on no data without an error, and asks once across remounts', async () => {
    const client = new QueryClient();
    let seen: {isPending: boolean; isError: boolean; data: unknown} | null =
      null;
    function Probe() {
      const q = useTrackMap('iracing-95-international');
      seen = {isPending: q.isPending, isError: q.isError, data: q.data};
      return null;
    }
    const mount = async () => {
      let tree!: ReturnType<typeof create>;
      await act(async () => {
        tree = create(
          <QueryClientProvider client={client}>
            <Probe />
          </QueryClientProvider>,
        );
        await new Promise(r => setTimeout(r, 20));
      });
      return tree;
    };
    for (let i = 0; i < 4; i++) {
      const tree = await mount();
      await act(async () => tree.unmount());
    }
    expect(seen).toEqual({isPending: false, isError: false, data: null});
    expect(asked).toHaveLength(1);
  });
});
