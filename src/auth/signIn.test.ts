import {beforeEach, describe, expect, it, jest} from '@jest/globals';

import {nativeSignInFailure} from './signInResult';

// The native Google module and Firebase cannot run in Node: they are replaced,
// so what is tested is OUR sequence and the way it answers.
type Any = (...args: unknown[]) => unknown;
type AnyAsync = (...args: unknown[]) => Promise<unknown>;
const mockGoogle = {
  configure: jest.fn<Any>(),
  hasPlayServices: jest.fn<AnyAsync>(),
  signIn: jest.fn<AnyAsync>(),
  signOut: jest.fn<AnyAsync>(),
};
const mockFirebase = {
  signInWithCredential: jest.fn<AnyAsync>(),
  signOut: jest.fn<AnyAsync>(),
  credential: jest.fn((token: string) => ({credentialFor: token})),
};
let mockClientId = 'client-id.apps.googleusercontent.com';

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: (...a: unknown[]) => mockGoogle.configure(...a),
    hasPlayServices: (...a: unknown[]) => mockGoogle.hasPlayServices(...a),
    signIn: (...a: unknown[]) => mockGoogle.signIn(...a),
    signOut: (...a: unknown[]) => mockGoogle.signOut(...a),
  },
  isSuccessResponse: (r: {type: string}) => r.type === 'success',
  isErrorWithCode: (e: unknown) =>
    typeof e === 'object' && e !== null && 'code' in e,
}));
jest.mock('firebase/auth', () => ({
  GoogleAuthProvider: {credential: (t: string) => mockFirebase.credential(t)},
  signInWithCredential: (...a: unknown[]) =>
    mockFirebase.signInWithCredential(...a),
  signOut: (...a: unknown[]) => mockFirebase.signOut(...a),
}));
jest.mock('./firebase', () => ({firebaseAuth: () => ({auth: true})}));
jest.mock('./googleClient', () => ({
  get GOOGLE_WEB_CLIENT_ID() {
    return mockClientId;
  },
}));

// eslint-disable-next-line import/first
import {signIn, signOut} from './signIn';

beforeEach(() => {
  jest.clearAllMocks();
  mockClientId = 'client-id.apps.googleusercontent.com';
  mockGoogle.hasPlayServices.mockResolvedValue(true);
  mockFirebase.signInWithCredential.mockResolvedValue({});
});

describe('Android sign-in', () => {
  it('says so, and never touches Google, when this build has no client id', async () => {
    mockClientId = '';
    const result = await signIn();
    expect(result.kind).toBe('unavailable');
    expect(result).toMatchObject({
      message: expect.stringMatching(/no Google client id/),
    });
    expect(mockGoogle.signIn).not.toHaveBeenCalled();
    expect(mockFirebase.signInWithCredential).not.toHaveBeenCalled();
  });

  it('turns the Google ID token into the Firebase user', async () => {
    mockGoogle.signIn.mockResolvedValue({
      type: 'success',
      data: {idToken: 'g-token'},
    });
    expect(await signIn()).toEqual({kind: 'ok'});
    expect(mockGoogle.configure).toHaveBeenCalledWith({
      webClientId: mockClientId,
    });
    expect(mockFirebase.signInWithCredential).toHaveBeenCalledWith(
      {auth: true},
      {credentialFor: 'g-token'},
    );
  });

  it('a person who backs out is cancelled, not an error, and Firebase is not asked', async () => {
    mockGoogle.signIn.mockResolvedValue({type: 'cancelled', data: null});
    expect(await signIn()).toEqual({kind: 'cancelled'});
    expect(mockFirebase.signInWithCredential).not.toHaveBeenCalled();
  });

  it('a Google answer without an ID token is a failure that says so', async () => {
    mockGoogle.signIn.mockResolvedValue({
      type: 'success',
      data: {idToken: null},
    });
    const result = await signIn();
    expect(result).toEqual({
      kind: 'failed',
      message: 'Google did not return an ID token.',
    });
    expect(mockFirebase.signInWithCredential).not.toHaveBeenCalled();
  });

  it('an app Google does not know quotes the cause', async () => {
    mockGoogle.signIn.mockRejectedValue(
      Object.assign(new Error('x'), {code: '10'}),
    );
    const result = await signIn();
    expect(result).toMatchObject({kind: 'failed'});
    expect(JSON.stringify(result)).toMatch(/DEVELOPER_ERROR/);
  });

  it('a Firebase refusal is shown with its message', async () => {
    mockGoogle.signIn.mockResolvedValue({
      type: 'success',
      data: {idToken: 'g'},
    });
    mockFirebase.signInWithCredential.mockRejectedValue(
      new Error('auth/user-disabled'),
    );
    expect(await signIn()).toEqual({
      kind: 'failed',
      message: 'auth/user-disabled',
    });
  });

  it('sign-out leaves Google and Firebase, even when Google was not signed in', async () => {
    mockGoogle.signOut.mockRejectedValue(new Error('not signed in'));
    await signOut();
    expect(mockGoogle.signOut).toHaveBeenCalled();
    expect(mockFirebase.signOut).toHaveBeenCalledWith({auth: true});
  });
});

describe('nativeSignInFailure', () => {
  it('maps what Google Play services says to a line a person can act on', () => {
    expect(nativeSignInFailure('12501', 'm')).toEqual({kind: 'cancelled'});
    expect(nativeSignInFailure('SIGN_IN_CANCELLED', 'm')).toEqual({
      kind: 'cancelled',
    });
    expect(nativeSignInFailure('ASYNC_OP_IN_PROGRESS', 'm')).toEqual({
      kind: 'cancelled',
    });
    expect(JSON.stringify(nativeSignInFailure('7', 'm'))).toMatch(
      /No connection/,
    );
    expect(JSON.stringify(nativeSignInFailure('10', 'm'))).toMatch(
      /DEVELOPER_ERROR 10/,
    );
    expect(
      JSON.stringify(nativeSignInFailure('PLAY_SERVICES_NOT_AVAILABLE', 'm')),
    ).toMatch(/Play services/);
  });

  it('quotes an unknown code and message as they came', () => {
    expect(nativeSignInFailure('999', 'odd thing')).toEqual({
      kind: 'failed',
      message: 'odd thing (code 999)',
    });
    expect(nativeSignInFailure('', 'plain')).toEqual({
      kind: 'failed',
      message: 'plain',
    });
  });
});
