import {describe, expect, it} from '@jest/globals';

import {toTrayRelease} from './adapters';

const manifest = {
  version: '0.2.0',
  notes: 'Faster sync',
  pub_date: '2026-10-09T12:00:00Z',
  platforms: {'windows-x86_64': {signature: 's', url: 'https://x/y.exe'}},
};

describe('toTrayRelease', () => {
  it('reads the version and the notes of a Windows release', () => {
    expect(toTrayRelease(manifest)).toEqual({
      version: '0.2.0',
      notes: 'Faster sync',
    });
  });

  it('keeps notes optional', () => {
    expect(toTrayRelease({...manifest, notes: undefined})?.notes).toBe('');
  });

  it('is null without a version or a Windows installer', () => {
    expect(toTrayRelease({...manifest, version: ''})).toBeNull();
    expect(toTrayRelease({...manifest, platforms: {}})).toBeNull();
    expect(
      toTrayRelease({...manifest, platforms: {'windows-x86_64': {}}}),
    ).toBeNull();
    expect(toTrayRelease(null)).toBeNull();
    expect(toTrayRelease('x')).toBeNull();
  });
});
