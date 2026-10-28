// What the signed-in account may see, from its `users/{uid}` doc. Only an admin
// writes that doc (docs/API.md, uploadCore.ts), so a flag on it is the
// account's own and a client cannot set it. No Firebase imports: node --test
// runs it (functions/test/accountFlags.test.mjs); dataApi.ts binds it.

export interface AccountFlags {
  /** The "Send a note" link in the app: his account only (pit-wall thread 112 #7908). Absent on the doc reads false. */
  canSendNote: boolean;
}

/** The flags of a `users/{uid}` doc's data; anything but a literal true is false. */
export function accountFlags(data: unknown): AccountFlags {
  const doc = typeof data === 'object' && data !== null ? data : {};
  return {canSendNote: (doc as {canSendNote?: unknown}).canSendNote === true};
}
