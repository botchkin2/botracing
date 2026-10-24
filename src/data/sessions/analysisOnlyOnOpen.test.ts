import {expect, it} from '@jest/globals';
import {readdirSync, readFileSync, statSync} from 'fs';
import {join, sep} from 'path';

// Botkin, 2026-10-24: "do not re-analyze my session". The cloud analyses a session only when he opens that session:
// useSession is the one caller of analyzeOnce, so no list, day or plan can start an analysis.
const ROOTS = ['src', 'app'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

it('useSession is the only caller of analyzeOnce', () => {
  const callers: string[] = [];
  for (const root of ROOTS) {
    for (const file of sourceFiles(root)) {
      if (file.endsWith('analysisOnOpen.ts')) continue;
      const text = readFileSync(file, 'utf8');
      let at = text.indexOf('analyzeOnce(');
      while (at !== -1) {
        // the exported function the call sits in
        const before = text.slice(0, at);
        const owner = [...before.matchAll(/export function (\w+)/g)].pop()?.[1] ?? '(module)';
        callers.push(`${file.split(sep).join('/')}: ${owner}`);
        at = text.indexOf('analyzeOnce(', at + 1);
      }
    }
  }
  expect(callers).toEqual(['src/data/sessions/queries.ts: useSession']);
});
