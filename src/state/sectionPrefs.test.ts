import {beforeEach, describe, expect, it} from '@jest/globals';

import {sectionModeOf, useSectionPrefs} from './sectionPrefs';

describe('sectionModeOf', () => {
  it('is turns unless the sectors were chosen', () => {
    expect(sectionModeOf('sectors')).toBe('sectors');
    expect(sectionModeOf('turns')).toBe('turns');
    expect(sectionModeOf(undefined)).toBe('turns');
    expect(sectionModeOf('S1')).toBe('turns');
  });
});

describe('useSectionPrefs', () => {
  beforeEach(() => {
    useSectionPrefs.setState({mode: 'turns'});
  });

  it('opens on turns and keeps the choice', () => {
    expect(useSectionPrefs.getState().mode).toBe('turns');
    useSectionPrefs.getState().setMode('sectors');
    expect(useSectionPrefs.getState().mode).toBe('sectors');
  });
});
