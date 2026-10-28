// GET /me (pit-wall thread 112 #7908): what this account may see. Raw documents
// stop here; screens see AccountFlags.

export type AccountFlags = {
  /** The "Send a note" link: his account only, from the account's own doc, never a uid in the bundle. */
  canSendNote: boolean;
};

/** Anything but a literal true is off, and a body that is not an object reads as off. */
export function toAccountFlags(raw: unknown): AccountFlags {
  const doc = typeof raw === 'object' && raw !== null ? raw : {};
  return {canSendNote: (doc as {canSendNote?: unknown}).canSendNote === true};
}
