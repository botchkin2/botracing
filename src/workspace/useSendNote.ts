import Constants from 'expo-constants';
import {usePathname} from 'expo-router';
import {Linking} from 'react-native';
import {useQueryClient} from '@tanstack/react-query';

import {useAccountFlags} from '@/src/data/account';
import {fetchUploaders, uploaderKeys} from '@/src/data/uploaders';
import {useLayout} from '@/src/design';

import {noteUrl, screenName, sessionIdOf, trayVersionOf} from './noteLink';

/**
 * The "Send a note" action, or null for anyone the API does not say may use
 * it (his account only). Pressing it opens GitHub's his-note form with the
 * facts of this moment; the tray version is read then (one cached read of the
 * uploaders), so the top bar never polls for it.
 */
export function useSendNote(): (() => void) | null {
  const {canSendNote} = useAccountFlags();
  const pathname = usePathname();
  const {isDesktop} = useLayout();
  const queryClient = useQueryClient();
  if (!canSendNote) return null;
  return () => {
    void (async () => {
      let trayVersion: string | null = null;
      try {
        const uploaders = await queryClient.fetchQuery({
          queryKey: uploaderKeys.all,
          queryFn: ({signal}) => fetchUploaders(signal),
          staleTime: 60_000,
        });
        trayVersion = trayVersionOf(uploaders);
      } catch {
        // No tray reading is a fact too: the form says "tray unknown".
      }
      void Linking.openURL(
        noteUrl({
          screen: screenName(pathname),
          sessionId: sessionIdOf(pathname),
          appVersion: Constants.expoConfig?.version ?? '',
          trayVersion,
          device: isDesktop ? 'desktop' : 'phone',
        }),
      );
    })();
  };
}
