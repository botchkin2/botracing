import {beforeEach, describe, expect, it, jest} from '@jest/globals';

// firebase/auth cannot run in Node: replaced, so what is tested is that OUR
// provider asks for the account chooser and what happens when the popup fails.
const mockProviders: {params: Record<string, string>}[] = [];
const mockCalls = {
  popup: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
  redirect: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
};

jest.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {
    params: Record<string, string> = {};
    constructor() {
      mockProviders.push(this);
    }
    setCustomParameters(params: Record<string, string>) {
      this.params = params;
    }
  },
  signInWithPopup: (...a: unknown[]) => mockCalls.popup(...a),
  signInWithRedirect: (...a: unknown[]) => mockCalls.redirect(...a),
  getRedirectResult: jest.fn(),
  signOut: jest.fn(),
}));
jest.mock('./firebase', () => ({firebaseAuth: () => ({auth: true})}));

// eslint-disable-next-line import/first
import {signIn} from './signIn.web';

beforeEach(() => {
  jest.clearAllMocks();
  mockProviders.length = 0;
  mockCalls.popup.mockResolvedValue({});
  mockCalls.redirect.mockResolvedValue(undefined);
});

describe('web sign-in', () => {
  it('always asks Google for the account chooser', async () => {
    expect(await signIn()).toEqual({kind: 'ok'});
    expect(mockProviders).toHaveLength(1);
    expect(mockProviders[0].params).toEqual({prompt: 'select_account'});
  });

  it('uses the same provider, with the chooser, for the redirect fallback', async () => {
    mockCalls.popup.mockRejectedValue(
      Object.assign(new Error('blocked'), {code: 'auth/popup-blocked'}),
    );
    expect(await signIn()).toEqual({kind: 'redirecting'});
    const [, provider] = mockCalls.redirect.mock.calls[0] as [
      unknown,
      {params: Record<string, string>},
    ];
    expect(provider.params).toEqual({prompt: 'select_account'});
  });

  it('a closed popup is cancelled, anything else is a failure with its message', async () => {
    mockCalls.popup.mockRejectedValue(
      Object.assign(new Error('x'), {code: 'auth/popup-closed-by-user'}),
    );
    expect(await signIn()).toEqual({kind: 'cancelled'});
    mockCalls.popup.mockRejectedValue(
      Object.assign(new Error('Network down'), {
        code: 'auth/network-request-failed',
      }),
    );
    expect(await signIn()).toEqual({kind: 'failed', message: 'Network down'});
    expect(mockCalls.redirect).not.toHaveBeenCalled();
  });
});
