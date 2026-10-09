// What the tray sign-in page accepts from its address, and where it sends the
// browser. Pure: the page takes only a port (never a host or a URL), checks
// every value's shape, and builds the loopback address itself, so the link the
// tray opens cannot be bent into an open redirect (pit-wall thread 54, chief).

export type TrayLinkRequest = {
  /** The tray's loopback port, 1024-65535. */
  port: number;
  /** 16 random bytes, base64url: echoed back so the tray knows the answer is for it. */
  state: string;
  /** base64url(sha256(verifier)), 43 characters. */
  challenge: string;
};

const B64URL = /^[A-Za-z0-9_-]+$/;

/** The request, or null when anything is missing or not the right shape. */
export function parseTrayLink(params: {
  port?: string | string[];
  state?: string | string[];
  challenge?: string | string[];
}): TrayLinkRequest | null {
  const one = (v: string | string[] | undefined) =>
    typeof v === 'string' ? v : undefined;
  const portText = one(params.port);
  const state = one(params.state);
  const challenge = one(params.challenge);
  if (!portText || !/^\d{4,5}$/.test(portText)) return null;
  const port = Number(portText);
  if (port < 1024 || port > 65535) return null;
  if (!state || state.length !== 22 || !B64URL.test(state)) return null;
  if (!challenge || challenge.length !== 43 || !B64URL.test(challenge))
    return null;
  return {port, state, challenge};
}

/** Where the browser goes with the code: this PC's tray, nothing else. */
export function callbackUrl(request: TrayLinkRequest, code: string): string {
  return `http://127.0.0.1:${request.port}/callback?code=${encodeURIComponent(
    code,
  )}&state=${encodeURIComponent(request.state)}`;
}
