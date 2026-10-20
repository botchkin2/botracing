import {describe, expect, it} from '@jest/globals';

import {runSliced, runSteps, type Steps} from './steps';

function* count(to: number, log: number[] = []): Steps<number> {
  for (let i = 0; i < to; i++) {
    log.push(i);
    yield;
  }
  return to;
}

// A clock the test moves: every chunk costs `chunkMs`.
function clock(chunkMs: number) {
  let t = 0;
  return {now: () => t, tick: () => (t += chunkMs)};
}

describe('runSteps', () => {
  it('runs the work to its end and returns its value', () => {
    expect(runSteps(count(5))).toBe(5);
  });
});

describe('runSliced', () => {
  it('gives the same result as running the work at once', async () => {
    const c = clock(1);
    const work = (function* () {
      for (let i = 0; i < 40; i++) {
        c.tick();
        yield;
      }
      return 'done';
    })();
    const r = await runSliced(work, {budgetMs: 8, now: c.now, yieldToLoop: async () => {}}, () => false);
    expect(r).toBe('done');
  });

  it('keeps each slice within the budget and yields between slices', async () => {
    const c = clock(2);
    const sliceSizes: number[] = [];
    let inSlice = 0;
    const work = (function* () {
      for (let i = 0; i < 20; i++) {
        c.tick();
        inSlice++;
        yield;
      }
      return 1;
    })();
    await runSliced(
      work,
      {
        budgetMs: 8,
        now: c.now,
        yieldToLoop: async () => {
          sliceSizes.push(inSlice);
          inSlice = 0;
        },
      },
      () => false,
    );
    // 2 ms a chunk, an 8 ms budget: a slice ends at the chunk that reaches it, 4 chunks
    expect(sliceSizes.length).toBeGreaterThanOrEqual(4);
    for (const s of sliceSizes) expect(s).toBeLessThanOrEqual(4);
  });

  it('drops the work when cancelled between slices: nothing more runs and the generator is closed', async () => {
    const c = clock(10);
    const log: number[] = [];
    let cancelled = false;
    const work = count(100, log);
    const r = await runSliced(
      work,
      {
        budgetMs: 8,
        now: () => c.tick(),
        yieldToLoop: async () => {
          cancelled = true;
        },
      },
      () => cancelled,
    );
    expect(r).toBeUndefined();
    const ran = log.length;
    expect(ran).toBeLessThan(100);
    expect(work.next().done).toBe(true);
    expect(log.length).toBe(ran);
  });
});
