import {describe, expect, it} from '@jest/globals';

import {type SessionSummary} from '@/src/data/sessions';
import {toTrackInfo} from '@/src/data/tracks';

import {buildTracksModel} from './model';

const s = (trackId: string, startedAt: string) =>
  ({trackId, startedAt} as SessionSummary);

describe('buildTracksModel', () => {
  it('puts driven layouts first, most recent first, then the rest by name', () => {
    const rows = buildTracksModel(
      [
        toTrackInfo('a', {layout: 'Alpha', place: 'Here', country: 'Italy'}),
        toTrackInfo('b', {layout: 'Bravo'}),
        toTrackInfo('c', {layout: 'Charlie'}),
      ],
      [
        s('c', '2026-09-01T10:00:00Z'),
        s('b', '2026-09-10T10:00:00Z'),
        s('c', '2026-08-01T10:00:00Z'),
      ],
    );
    expect(rows.map(r => r.name)).toEqual(['Bravo', 'Charlie', 'Alpha']);
    expect(rows[1].driven).toMatch(/^2 sessions · /);
    expect(rows[2]).toMatchObject({driven: null, place: 'Here, Italy'});
  });
});
