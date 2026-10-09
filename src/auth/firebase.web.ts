import {type FirebaseApp, getApp, getApps, initializeApp} from 'firebase/app';
import {type Auth, getAuth} from 'firebase/auth';

// The web app config of project botracing-61 (Firebase console, Project
// settings). It names the project to the SDK and is public by design; access
// is decided by the Auth rules and the API, not by hiding these.
const config = {
  apiKey: 'AIzaSyBR6G55O4qJhLwaKAj6rybIedwWfPKHpw8',
  authDomain: 'botracing-61.firebaseapp.com',
  projectId: 'botracing-61',
  appId: '1:702873435846:web:b72c2402fa63a94c12e1c7',
};

/** Only ever called from effects and handlers: the web export renders in Node. */
export function firebaseAuth(): Auth {
  const app: FirebaseApp = getApps().length ? getApp() : initializeApp(config);
  return getAuth(app);
}
