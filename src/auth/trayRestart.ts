import {trayInvoke} from './traySignIn';

/**
 * The tray window's "restart into the waiting update" (the `restart_to_update`
 * command), or null anywhere else: a phone or a browser cannot restart a PC.
 */
export function trayRestart(win: unknown): (() => Promise<string | null>) | null {
  const invoke = trayInvoke(win);
  if (!invoke) return null;
  return async () => {
    try {
      await invoke('restart_to_update');
      return null;
    } catch (error) {
      return String(error);
    }
  };
}
