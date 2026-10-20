// The 3D page inside the Android app's WebView (pit-wall thread 94, gauge #6325): the race page with `embed=3d`, at
// the same race selection, signed in by a custom token in the address FRAGMENT (never sent to a server, taken out of
// the address by the page at once). Plain TypeScript, no imports.

/** The hosted web app: the only origin the WebView may show. */
export const EMBED_ORIGIN = 'https://botracing-61.web.app';

/** The query the race page opens on, carried over from the native Race screen so the 3D opens where the app is. */
const CARRIED = ['laps', 'ref', 'hl', 'c', 't'] as const;

export function embedUrl(
  origin: string,
  sessionId: string,
  params: Partial<Record<(typeof CARRIED)[number], string | undefined>>,
  token: string,
): string {
  const query = new URLSearchParams({embed: '3d'});
  for (const key of CARRIED) {
    const value = params[key];
    if (value) query.set(key, value);
  }
  return `${origin}/session/${encodeURIComponent(sessionId)}/race?${query.toString()}#ct=${encodeURIComponent(token)}`;
}

/** The WebView follows links on its own origin only; anything else is refused (and never opens inside the app). */
export function allowsNavigation(origin: string, url: string): boolean {
  return url === origin || url.startsWith(`${origin}/`) || url === 'about:blank';
}
