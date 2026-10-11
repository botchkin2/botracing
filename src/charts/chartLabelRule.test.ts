import {describe, expect, test} from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

// The inside-the-box rule (labelBox.ts) holds only if chart text goes through
// ChartLabel. Map labels are placed on the track's own geometry, inside a
// transformed world, so the maps keep their own text.
const MAPS = new Set([
  'BrakeMap.tsx',
  'CarDots.tsx',
  'FollowMap.tsx',
  'TrackMap.tsx',
]);

function tsxUnder(dir: string): string[] {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return tsxUnder(p);
    return e.name.endsWith('.tsx') && !e.name.includes('.test.') ? [p] : [];
  });
}

describe('chart text', () => {
  test('is drawn through ChartLabel, outside the maps', () => {
    const src = path.join(__dirname, '..');
    const offenders = tsxUnder(src)
      .filter(f => !MAPS.has(path.basename(f)))
      .filter(f => path.basename(f) !== 'ChartLabel.tsx')
      .filter(f => fs.readFileSync(f, 'utf8').includes('<SvgText'))
      .map(f => path.relative(src, f));
    expect(offenders).toEqual([]);
  });
});
