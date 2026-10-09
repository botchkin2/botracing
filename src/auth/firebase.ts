import AsyncStorage from '@react-native-async-storage/async-storage';
import {type FirebaseApp, getApp, getApps, initializeApp} from 'firebase/app';
import * as firebaseAuthModule from 'firebase/auth';
import {
  type Auth,
  type Persistence,
  getAuth,
  initializeAuth,
} from 'firebase/auth';

// The React Native entry of the SDK (what Metro resolves) exports this; the
// typings TypeScript finds for 'firebase/auth' are the browser's and leave it
// out, so it is read through a typed cast.
const {getReactNativePersistence} = firebaseAuthModule as unknown as {
  getReactNativePersistence: (storage: typeof AsyncStorage) => Persistence;
};

// The web app config of project botracing-61 (Firebase console, Project
// settings). It names the project to the SDK and is public by design; access
// is decided by the Auth rules and the API, not by hiding these. The web build
// reads the same values in firebase.web.ts.
const config = {
  apiKey: 'AIzaSyBR6G55O4qJhLwaKAj6rybIedwWfPKHpw8',
  authDomain: 'botracing-61.firebaseapp.com',
  projectId: 'botracing-61',
  appId: '1:702873435846:web:b72c2402fa63a94c12e1c7',
};

/**
 * The Android app's Auth instance. Without a persistence layer the SDK forgets
 * the sign-in whenever the app is closed; AsyncStorage keeps it, so the
 * person signs in once, not on every launch.
 */
export function firebaseAuth(): Auth {
  const app: FirebaseApp = getApps().length ? getApp() : initializeApp(config);
  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    // Already initialized: initializeAuth may only run once per app.
    return getAuth(app);
  }
}
