// LMU writes a car's class as a string per session ("Hyper", "LMP2", "GT3").
// One mapping to the three classes the app draws, shared by the Race screen
// and the uploader's class lap stats (tools/sessions/classLaps.mjs), so a
// class never splits between two spellings. Plain TypeScript, no imports:
// Node can run it.

export type ClassKey = 'hypercar' | 'lmp2' | 'gt3' | 'other';

/** LMU's class strings ("Hyper", "LMP2", "GT3") to the three the design colours. */
export function classKey(carClass: string): ClassKey {
  const c = carClass.toLowerCase();
  if (c.startsWith('hyper')) return 'hypercar';
  if (c.startsWith('lmp2')) return 'lmp2';
  if (c.startsWith('gt3') || c.includes('gte')) return 'gt3';
  return 'other';
}
