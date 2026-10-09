/**
 * Runs onHide after idleMs unless the returned cancel is called first. The
 * caller cancels and schedules again on each touch, so the countdown restarts.
 */
export function scheduleHide(idleMs: number, onHide: () => void): () => void {
  const timer = setTimeout(onHide, idleMs);
  return () => clearTimeout(timer);
}
