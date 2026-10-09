import * as admin from 'firebase-admin';

export {lmuApi} from './lmuApi';
export {uploadApi} from './uploadApi';

if (!admin.apps.length) {
  admin.initializeApp();
}
