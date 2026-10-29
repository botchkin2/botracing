import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {describe, expect, it} from '@jest/globals';

import {fullTrackName, shortTrackName, trackNameKey} from './trackNames';

// Every layout and location the curated catalogue names, as the app receives them.
type CatalogueTrack = {layout: string; location: string};
const catalogue = JSON.parse(readFileSync(resolve(__dirname, '../../tools/track-info/tracks.json'), 'utf8')) as
  | CatalogueTrack[]
  | Record<string, CatalogueTrack>;
const tracks: CatalogueTrack[] = Array.isArray(catalogue) ? catalogue : Object.values(catalogue);

// What iRacing writes for the accented names (an .ibt's session info has a space where each accented letter was).
const IRACING_FORM: Record<string, string> = {
  'Autódromo José Carlos Pace': 'Aut dromo Jos  Carlos Pace',
};

describe('shortTrackName: Interlagos', () => {
  it('reads Interlagos from the accented name and from the form iRacing writes', () => {
    expect(shortTrackName('Autódromo José Carlos Pace')).toBe('Interlagos');
    expect(shortTrackName('Aut dromo Jos  Carlos Pace')).toBe('Interlagos');
  });

  it('every accented catalogue name reads the same from the iRacing form of it', () => {
    const accented = tracks.flatMap(t => [t.layout, t.location]).filter(n => /[^\x00-\x7f]/.test(n));
    expect(accented.length).toBeGreaterThan(0);
    for (const name of accented) {
      const broken = IRACING_FORM[name] ?? name.replace(/[^\x00-\x7f]/g, ' ');
      expect(shortTrackName(broken)).toBe(shortTrackName(name));
    }
  });

  it('the full name gets its accents back from the iRacing form; unknown names pass through', () => {
    expect(fullTrackName('Aut dromo Jos  Carlos Pace')).toBe('Autódromo José Carlos Pace');
    expect(fullTrackName('Autódromo José Carlos Pace')).toBe('Autódromo José Carlos Pace');
    expect(fullTrackName('Watkins Glen')).toBe('Watkins Glen');
  });

  it('unknown names pass through, and no two catalogue names share a key', () => {
    expect(shortTrackName('Circuit des 24 Heures du Mans')).toBe('Circuit des 24 Heures du Mans');
    const byKey = new Map<string, string>();
    for (const name of tracks.flatMap(t => [t.layout, t.location])) {
      const key = trackNameKey(name);
      expect([key, byKey.get(key) ?? name]).toEqual([key, name]);
      byKey.set(key, name);
    }
  });
});
