// GET /api/tray/latest and /api/tray/download: the tray's update manifest and
// the installer download. The rules are in trayCore.ts, the HTTP side in
// releaseApi.ts. Anonymous and read-only.
import {releaseFunction} from './releaseApi';
import {handleTray} from './trayCore.ts';

export const trayApi = releaseFunction('/api/tray', handleTray);
