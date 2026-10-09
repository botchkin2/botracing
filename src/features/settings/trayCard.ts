import {type TrayRelease} from '@/src/data/tray';

// The Windows app card on Settings (pit-wall thread 54): what the Download
// button says, from the state of the release query. Pure, so each state is
// tested. Settings is behind the sign-in, so the card is signed-in only.

export type TrayCard = {
  /** "v0.2.0", or why there is nothing to download. */
  status: string;
  /** The version a download offers; null when there is none. */
  version: string | null;
};

export function trayCard(q: {
  isPending: boolean;
  isError: boolean;
  data: TrayRelease | null | undefined;
}): TrayCard {
  if (q.data) return {status: `v${q.data.version}`, version: q.data.version};
  if (q.isPending) return {status: 'Checking…', version: null};
  if (q.isError)
    return {status: 'Couldn’t check for the Windows app', version: null};
  return {status: 'Not released yet', version: null};
}
