import * as admin from 'firebase-admin';

export {lmuApi} from './lmuApi';
export {trayApi} from './trayApi';
export {androidApi} from './androidApi';
export {traySignInApi} from './traySignInApi';
export {uploadApi} from './uploadApi';

if (!admin.apps.length) {
  admin.initializeApp();
}
