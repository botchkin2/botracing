// Sessions uploaded before the game's results were kept, whose results file is
// still on the PC: the input goes up once, by itself, and the session is marked
// stale so the next open analyses it again with the game's rulings (thread 70,
// design #5521 point 8). Recorded in state.resultsInputs so a session is looked
// at once: 'sent', 'none' (no file for it) or 'with-session' (it went up with the
// session itself).
import {resultsInput} from './resultsInput.mjs';

/**
 * @param {object} p
 * @param {{id: string, files: {info: object}[]}[]} p.sessions
 * @param {{sessions: Record<string, unknown>, resultsInputs?: Record<string, string>}} p.state
 * @param {{putResultsInput: Function, markStale: Function}} p.store
 * @param {string} p.ownerId
 * @param {(s: object) => {startMs: number, endMs: number}} p.spanOf
 * @param {(span: object, driver: string, sessionType: string) => object} p.resultsForSpan
 * @param {() => void} p.saveState
 * @param {(line: string) => void} p.log
 */
export async function uploadResultsBacklog({
  sessions,
  state,
  store,
  ownerId,
  spanOf,
  resultsForSpan,
  saveState,
  log,
}) {
  state.resultsInputs ??= {};
  let sent = 0;
  for (const s of sessions) {
    if (!state.sessions[s.id] || state.resultsInputs[s.id]) continue;
    const first = s.files[0].info;
    // The game's results file is LMU's.
    if (first.sim !== 'lmu') continue;
    const input = resultsInput(
      resultsForSpan(spanOf(s), first.driver, first.sessionType),
    );
    if (input) {
      await store.putResultsInput(ownerId, s.id, input);
      await store.markStale(s.id, ownerId);
      sent++;
    }
    // Saved per session, so a run stopped mid-backlog resumes where it was.
    state.resultsInputs[s.id] = input ? 'sent' : 'none';
    saveState();
  }
  if (sent) log(`game results kept for ${sent} uploaded session(s)`);
  return sent;
}
