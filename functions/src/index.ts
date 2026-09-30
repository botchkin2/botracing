import * as admin from 'firebase-admin';

export {lmuApi} from './lmuApi';

if (!admin.apps.length) {
  admin.initializeApp();
}
