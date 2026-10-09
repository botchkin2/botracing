// GET /api/android/latest and /api/android/download: the Android APK for the
// Settings Download card. The rules are in androidCore.ts, the HTTP side in
// releaseApi.ts. Anonymous and read-only.
import {releaseFunction} from './releaseApi';
import {handleAndroid} from './androidCore.ts';

export const androidApi = releaseFunction('/api/android', handleAndroid);
