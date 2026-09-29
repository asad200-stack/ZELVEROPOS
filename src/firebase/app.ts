import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { browserLocalPersistence, connectAuthEmulator, initializeAuth, type Auth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions';
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage';
import { resolveFirebaseConfig, type ResolvedFirebaseConfig } from './config';
import { isBlockedProjectId } from './isolation';

interface FirebaseServices {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  storage: FirebaseStorage;
  functions: Functions;
  config: ResolvedFirebaseConfig;
}

let services: FirebaseServices | null = null;

/**
 * Lazily initialises Firebase exactly once. Throws FirebaseConfigError when the configuration is
 * missing or unsafe; the app shell catches it and shows a setup screen instead of connecting.
 */
export function getFirebase(): FirebaseServices {
  if (services) return services;
  const config = resolveFirebaseConfig();
  const app = initializeApp(config.options);

  // Defence in depth: the initialised app must report the expected project.
  if (isBlockedProjectId(app.options.projectId ?? '')) {
    throw new Error('Refusing to connect: the initialised Firebase app targets the OLD CATCH POS project.');
  }

  if (config.appCheckSiteKey && !config.useEmulators) {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(config.appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }

  const auth = initializeAuth(app, { persistence: browserLocalPersistence });
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    ignoreUndefinedProperties: true,
  });
  const storage = getStorage(app);
  const functions = getFunctions(app, config.functionsRegion);

  if (config.useEmulators) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    connectStorageEmulator(storage, '127.0.0.1', 9199);
  }

  services = { app, auth, db, storage, functions, config };
  return services;
}

export const firebase = {
  get auth() {
    return getFirebase().auth;
  },
  get db() {
    return getFirebase().db;
  },
  get storage() {
    return getFirebase().storage;
  },
  get functions() {
    return getFirebase().functions;
  },
  get projectId() {
    return getFirebase().config.projectId;
  },
};
