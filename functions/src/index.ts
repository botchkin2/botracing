import * as admin from 'firebase-admin';

export {dataApi, lmuApi} from './dataApi';
export {trayApi} from './trayApi';
export {androidApi} from './androidApi';
export {traySignInApi} from './traySignInApi';
export {handoffApi} from './handoffApi';
export {fuelPresetsApi} from './fuelPresetsApi';
export {uploadApi} from './uploadApi';
export {analyzeApi} from './analyzeApi';
export {liveAnalyze} from './liveAnalyze';

if (!admin.apps.length) {
  admin.initializeApp();
}
