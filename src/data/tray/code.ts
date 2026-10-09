import {trayApiUrl} from '../http';
import {authHeaders} from '../tokenSource';

// POST /api/tray/code: the tray's sign-in through the web app. The signed-in
// person asks for a one-time code for the challenge the tray made; the code is
// useless without the tray's verifier (functions/src/trayCodeCore.ts).

export type CodeResult =
  | {kind: 'ok'; code: string}
  | {kind: 'rate-limited'}
  | {kind: 'failed'};

export async function requestTrayCode(challenge: string): Promise<CodeResult> {
  try {
    const response = await fetch(trayApiUrl('/code'), {
      method: 'POST',
      cache: 'no-store',
      headers: {...(await authHeaders()), 'Content-Type': 'application/json'},
      body: JSON.stringify({challenge}),
    });
    if (response.status === 429) return {kind: 'rate-limited'};
    if (!response.ok) return {kind: 'failed'};
    const body = (await response.json()) as {code?: unknown};
    return typeof body.code === 'string'
      ? {kind: 'ok', code: body.code}
      : {kind: 'failed'};
  } catch {
    return {kind: 'failed'};
  }
}
