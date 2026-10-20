// Work written as a generator that yields between small chunks (each a fraction of a millisecond), so the same code runs
// to the end at once (tests, Node) or in time-sliced steps in a page that must stay responsive. Plain TypeScript with
// erasable syntax only: Node can run it.

export type Steps<T> = Generator<void, T, void>;

/** Run the work to its end in one go. */
export function runSteps<T>(work: Steps<T>): T {
  for (;;) {
    const r = work.next();
    if (r.done) return r.value;
  }
}

export interface SliceOptions {
  /** Longest one slice may keep the thread, milliseconds; the chunk that crosses it is the last of the slice. */
  budgetMs: number;
  now: () => number;
  /** Gives the thread back (a timer, a message): resolves after the browser has had its turn. */
  yieldToLoop: () => Promise<void>;
}

/**
 * Drive the work in slices of at most `budgetMs`, giving the thread back between them. `cancelled()` is read before every
 * slice: once it is true the work is dropped (the generator is closed) and the promise resolves to `undefined`.
 */
export async function runSliced<T>(work: Steps<T>, opts: SliceOptions, cancelled: () => boolean): Promise<T | undefined> {
  for (;;) {
    if (cancelled()) {
      work.return(undefined as never);
      return undefined;
    }
    const start = opts.now();
    do {
      const r = work.next();
      if (r.done) return r.value;
    } while (opts.now() - start < opts.budgetMs);
    await opts.yieldToLoop();
  }
}
