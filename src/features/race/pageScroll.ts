// Where the app's page scrolls to when the 3D page forwards a vertical drag (embedBridge.ts, pit-wall thread 106).
// Pure; usePageScroll.ts holds the ScrollView around it.

/** After the last forwarded pan the offset is ours; then the ScrollView's own reports are believed again. */
export const SETTLE_MS = 150;

/** The page's scroll offset after the finger travelled `fingerDy` px down: the content follows the finger, so it moves up by that much, within the page. */
export function nextScrollY(y: number, fingerDy: number, maxY: number): number {
  const target = y - fingerDy;
  if (!Number.isFinite(target)) return y;
  return Math.min(Math.max(0, target), Math.max(0, maxY));
}

/** How far the page can scroll: its content less its window, never negative. */
export function maxScrollY(contentH: number, viewH: number): number {
  return Math.max(0, contentH - viewH);
}

/**
 * The page's offset as the app tracks it. A pan moves it at once (scrollTo is asynchronous, so the next pan cannot
 * wait for the ScrollView to say where it got to); the ScrollView's own reports (`reported`) set it only when no pan
 * happened in the last `SETTLE_MS`, so a report that lags the last pan never pulls the page back, and a scroll the
 * user made anywhere else is believed. Times are the caller's clock in ms.
 */
export function createPageScroll() {
  let offsetY = 0;
  let contentH = 0;
  let viewH = 0;
  let lastPanAt = -Infinity;
  return {
    size(content: number, view: number): void {
      contentH = content;
      viewH = view;
    },
    /** Moves the offset by a finger's travel and returns where the page is to scroll to. */
    pan(fingerDy: number, nowMs: number): number {
      offsetY = nextScrollY(offsetY, fingerDy, maxScrollY(contentH, viewH));
      lastPanAt = nowMs;
      return offsetY;
    },
    reported(y: number, nowMs: number): void {
      if (nowMs - lastPanAt > SETTLE_MS) offsetY = y;
    },
    get offset(): number {
      return offsetY;
    },
  };
}
