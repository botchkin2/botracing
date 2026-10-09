import {describe, expect, it} from '@jest/globals';

import {trayCard} from './trayCard';

describe('trayCard', () => {
  it('offers the download of a release, with its version', () => {
    expect(
      trayCard({
        isPending: false,
        isError: false,
        data: {version: '0.2.0', notes: ''},
      }),
    ).toEqual({status: 'v0.2.0', version: '0.2.0'});
  });

  it('says why there is nothing to download', () => {
    const none = {isPending: false, isError: false, data: null};
    expect(trayCard(none)).toEqual({status: 'Not released yet', version: null});
    expect(trayCard({...none, isPending: true, data: undefined}).status).toBe(
      'Checking…',
    );
    expect(trayCard({...none, isError: true, data: undefined}).status).toBe(
      'Couldn’t check for the Windows app',
    );
  });
});
