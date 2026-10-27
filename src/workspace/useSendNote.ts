import {useQueryClient} from '@tanstack/react-query';
import Constants from 'expo-constants';
import {usePathname} from 'expo-router';
import {useEffect} from 'react';
import {Linking} from 'react-native';

import {useAccountFlags} from '@/src/data/account';
import {
  fetchUploaders,
  type Uploader,
  uploaderKeys,
} from '@/src/data/uploaders';
import {useLayout} from '@/src/design';

import {noteUrl, screenName, sessionIdOf, trayVersionOf} from './noteLink';

/**
 * The "Send a note" action, or null for anyone the API does not say may use
 * it (his account only). Pressing it opens GitHub's his-note form with the
 * facts of this moment. The link opens inside the press, never after an await:
 * a browser lets `window.open` through only within the tap's user activation
 * (Safari not at all after a wait), so the tray version is read from the cache
 * and reads "tray unknown" when it is not there. For his account the uploaders
 * are fetched once when the hook mounts, so the cache is warm by the first tap.
 */
export function useSendNote(): (() => void) | null {
  const {canSendNote} = useAccountFlags();
  const pathname = usePathname();
  const {isDesktop} = useLayout();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!canSendNote) return;
    queryClient
      .prefetchQuery({
        queryKey: uploaderKeys.all,
        queryFn: ({signal}) => fetchUploaders(signal),
        staleTime: 60_000,
      })
      .catch(() => undefined);
  }, [canSendNote, queryClient]);
  if (!canSendNote) return null;
  return () => {
    const uploaders = queryClient.getQueryData<Uploader[]>(uploaderKeys.all);
    void Linking.openURL(
      noteUrl({
        screen: screenName(pathname),
        sessionId: sessionIdOf(pathname),
        appVersion: Constants.expoConfig?.version ?? '',
        trayVersion: uploaders ? trayVersionOf(uploaders) : null,
        device: isDesktop ? 'desktop' : 'phone',
      }),
    );
  };
}
