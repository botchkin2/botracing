// Why a new recording file started within a session, for the stint it opens.
//
// A reset to the garage ends LMU's recording mid-lap, and the next file
// starts in the pits a few seconds later (pit wall thread 32). Across the
// archive's 149 file changes, 140 had the car on track; in 128 of them the
// next file started in the pits within 0-300 s (63 within 15 s, 48 within
// 15-60 s, 18 within 60-300 s). The other 12 restarted the game clock or
// started outside the pits, so they are only a 'gap'. A disconnect that ends
// the session leaves no next file, so it gets no marker at all.
export const RESET_MAX_GAP_S = 300;

// lastLap: the previous file's last lap, or null for the session's first
// file. gapS: seconds from that file's end to this one's start.
// Returns 'session', 'pit', 'reset' or 'gap'.
export function fileChange({lastLap, gapS, startsInPits}) {
  if (!lastLap) return 'session';
  if (lastLap.pitIn) return 'pit';
  const reset =
    lastLap.partial && startsInPits && gapS >= 0 && gapS <= RESET_MAX_GAP_S;
  return reset ? 'reset' : 'gap';
}
