import {apiFetch, HttpError} from './http';

/**
 * POST /api/auth/handoff (functions/src/handoffApi.ts): a custom token for the signed-in person, so the 3D page in
 * the app's WebView signs in as the same user without asking. The answer is a credential: held in memory for the one
 * address it goes into, never stored or logged.
 */
export async function fetchHandoffToken(): Promise<string> {
  const response = await apiFetch('/auth/handoff', {method: 'POST'});
  if (!response.ok) throw new HttpError(response.status, '/auth/handoff');
  const body = (await response.json()) as {token?: unknown};
  if (typeof body.token !== 'string' || body.token === '') throw new Error('the hand-off answered with no token');
  return body.token;
}
