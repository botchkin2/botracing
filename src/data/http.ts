import {Platform} from 'react-native';

import {authHeaders, reportUnauthorized} from './tokenSource';

// The lap API (docs/API.md). Same origin on the deployed web app; otherwise
// EXPO_PUBLIC_API_BASE, else production.
const PRODUCTION_API = 'https://botracing-61.web.app/api';

export const apiBaseUrl: string =
  process.env.EXPO_PUBLIC_API_BASE ||
  (Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  window.location?.protocol === 'https:'
    ? `${window.location.origin}/api`
    : PRODUCTION_API);

/**
 * The release routes (/api/tray/*, /api/android/*), next to the lap API: the
 * same origin on the deployed app, production otherwise. Their /latest and
 * /download answer without a sign-in.
 */
const apiRoot = apiBaseUrl.endsWith('/api')
  ? apiBaseUrl
  : 'https://botracing-61.web.app/api';
export const releaseApiUrl = (kind: 'tray' | 'android', path: string): string =>
  `${apiRoot}/${kind}${path}`;

/** POST /api/analyze/{id}: a stale session analysed again (analyzeApi). */
export const analyzeUrl = (sessionId: string): string =>
  `${apiRoot}/analyze/${encodeURIComponent(sessionId)}`;

export class HttpError extends Error {
  constructor(readonly status: number, readonly path: string) {
    super(`GET ${path} → ${status}`);
  }
}

/**
 * fetch to the lap API as the signed-in person (their ID token, when there
 * is one). A 401 is reported so the app can ask them to sign in; it still
 * throws, like any other failure.
 */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return apiFetchAt(`${apiBaseUrl}${path}`, init);
}

// When the API last answered, on any route and with any status: a read that
// got no answer while others did is a broken route, not the network
// (queryState.ts isOffline, pit-wall thread 1 #5220).
let answeredAt = 0;
export const lastApiAnswerAt = (): number => answeredAt;

/**
 * How long the API may take to start answering. Only the wait for the response
 * headers is timed: a slow body (a 2 h race's field is ~49 MB) is never cut.
 * The analyze POST is a whole run on the server (its limit is 120 s, analyzeApi).
 */
export const ANSWER_TIMEOUT_MS = 20_000;
export const ANALYZE_ANSWER_TIMEOUT_MS = 130_000;

export class NoAnswerError extends Error {
  constructor(readonly url: string, readonly afterMs: number) {
    super(`no answer from ${url} in ${afterMs / 1000} s`);
  }
}

/** apiFetch to a full URL beside the lap API (analyzeUrl). */
export async function apiFetchAt(
  url: string,
  init?: RequestInit,
  answerTimeoutMs: number = ANSWER_TIMEOUT_MS,
): Promise<Response> {
  const headers = {...(await authHeaders()), ...init?.headers};
  // Hermes has no AbortSignal.timeout or .any: one controller, fed by the
  // caller's signal and by the timer.
  const controller = new AbortController();
  const caller = init?.signal;
  const forward = () => controller.abort();
  if (caller?.aborted) forward();
  else caller?.addEventListener('abort', forward);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, answerTimeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {...init, headers, signal: controller.signal});
  } catch (error) {
    if (timedOut) throw new NoAnswerError(url, answerTimeoutMs);
    throw error;
  } finally {
    // Only the timer ends here: the caller's abort still reaches the body
    // read after the headers, so leaving a screen stops a big download.
    clearTimeout(timer);
  }
  answeredAt = Date.now();
  if (response.status === 401) reportUnauthorized();
  return response;
}

export async function getJson<T>(
  path: string,
  signal?: AbortSignal,
  init?: Pick<RequestInit, 'cache'>,
): Promise<T> {
  const response = await apiFetch(path, {...init, signal});
  if (!response.ok) throw new HttpError(response.status, path);
  return (await response.json()) as T;
}

/** 4xx won't change on retry. */
export const retryUnlessClientError = (failureCount: number, error: unknown) =>
  !(error instanceof HttpError && error.status >= 400 && error.status < 500) &&
  failureCount < 3;
