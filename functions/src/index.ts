import * as admin from 'firebase-admin';

export {lmuApi} from './lmuApi';
export {trayApi} from './trayApi';
export {uploadApi} from './uploadApi';

if (!admin.apps.length) {
  admin.initializeApp();
}
