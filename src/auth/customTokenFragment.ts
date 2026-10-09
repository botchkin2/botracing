// A seat's way in without a Google account: open the app at `#ct=<custom
// token>` (minted by functions/scripts/mintTestToken.mjs for the test user).
// The token travels in the URL fragment, which never reaches a server, a log
// or a referrer; it is taken out of the address at once so it is not kept in
// history, bookmarks or a shared screenshot. Pure over the window it is given.

const KEY = 'ct';

type WindowLike = {
  location: {pathname: string; search: string; hash: string};
  history: {replaceState: (state: null, title: string, url: string) => void};
};

/**
 * Returns the custom token in the address fragment, if any, and removes it
 * from the address. Other fragment parameters stay.
 */
export function consumeCustomToken(win: WindowLike): string | null {
  const params = new URLSearchParams(win.location.hash.replace(/^#/, ''));
  const token = params.get(KEY);
  if (token === null) return null;
  params.delete(KEY);
  const rest = params.toString();
  win.history.replaceState(
    null,
    '',
    `${win.location.pathname}${win.location.search}${rest ? `#${rest}` : ''}`,
  );
  return token || null;
}
