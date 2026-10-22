// An incoming link the router would take for a screen. The dev seat-test sign-in link (src/auth/devSeatLink.ts) is not a
// screen: the sign-in listens for it itself, so in an emulator build the router is sent to the home screen instead of an
// "Unmatched Route" that would print the link. The same gate as the sign-in: a real build has none of this, and any other
// link goes through unchanged.
export function redirectSystemPath({path}: {path: string; initial: boolean}): string {
  if ((__DEV__ || process.env.EXPO_PUBLIC_SEAT_LINK === '1') && path.includes('dev-seat')) return '/';
  return path;
}
