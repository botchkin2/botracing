import {Platform} from 'react-native';

// The lap API (docs/API.md). Same origin on the deployed web app; otherwise
// EXPO_PUBLIC_LMU_API_BASE, else production.
const PRODUCTION_API = 'https://botracing-61.web.app/api/lmu';

export const apiBaseUrl: string =
  process.env.EXPO_PUBLIC_LMU_API_BASE ||
  (Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  window.location?.protocol === 'https:'
    ? `${window.location.origin}/api/lmu`
    : PRODUCTION_API);

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`GET ${path} → ${status}`);
  }
}

export async function getJson<T>(
  path: string,
  signal?: AbortSignal,
  init?: Pick<RequestInit, 'cache'>,
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {...init, signal});
  if (!response.ok) throw new HttpError(response.status, path);
  return (await response.json()) as T;
}

/** 4xx won't change on retry. */
export const retryUnlessClientError = (failureCount: number, error: unknown) =>
  !(error instanceof HttpError && error.status >= 400 && error.status < 500) &&
  failureCount < 3;
