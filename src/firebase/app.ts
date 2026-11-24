import { initializeApp, type FirebaseApp } from 'firebase/app';
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
import { customStoreHost } from '@/features/onlineStore/customStoreHost';
import { initAppCheck, isPublicStorePath } from './appCheck';
import { isolatedProjectAllowed } from './emulatorIsolated';
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

/** Primary (stock) Emulator Suite ports from firebase.json — unchanged for `emulator` mode. */
const PRIMARY_EMULATOR = {
  authOrigin: 'http://127.0.0.1:9099',
  firestoreHost: '127.0.0.1',
  firestorePort: 8080,
  functionsHost: '127.0.0.1',
  functionsPort: 5001,
  storageHost: '127.0.0.1',
  storagePort: 9199,
} as const;

let services: FirebaseServices | null = null;

/**
 * Connects SDK services to either the isolated alternate-port harness or the primary local suite.
 * Cloud paths never enter here (`useEmulators` is false).
 */
export function connectFirebaseEmulators(
  auth: Auth,
  db: Firestore,
  functions: Functions,
  storage: FirebaseStorage,
  config: ResolvedFirebaseConfig,
): void {
  if (!config.useEmulators) {
    throw new Error('Refusing emulator connect: useEmulators is false.');
  }

  if (config.isolatedEmulators) {
    const endpoints = config.isolatedEndpoints;
    if (!endpoints) {
      throw new Error('Isolated emulator mode is enabled but endpoints are missing.');
    }
    if (!isolatedProjectAllowed(config.projectId, config.isolatedAllowProject)) {
      throw new Error(`Isolated emulator connect refused for project "${config.projectId}".`);
    }
    connectAuthEmulator(auth, endpoints.authOrigin, { disableWarnings: true });
    connectFirestoreEmulator(db, endpoints.firestoreHost, endpoints.firestorePort);
    connectFunctionsEmulator(functions, endpoints.functionsHost, endpoints.functionsPort);
    connectStorageEmulator(storage, endpoints.storageHost, endpoints.storagePort);
    return;
  }

  // Existing primary emulator path (dev:emulators / .env.emulator) — unchanged ports.
  connectAuthEmulator(auth, PRIMARY_EMULATOR.authOrigin, { disableWarnings: true });
  connectFirestoreEmulator(db, PRIMARY_EMULATOR.firestoreHost, PRIMARY_EMULATOR.firestorePort);
  connectFunctionsEmulator(functions, PRIMARY_EMULATOR.functionsHost, PRIMARY_EMULATOR.functionsPort);
  connectStorageEmulator(storage, PRIMARY_EMULATOR.storageHost, PRIMARY_EMULATOR.storagePort);
}

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
  if (config.isolatedEmulators && !isolatedProjectAllowed(app.options.projectId ?? '', config.isolatedAllowProject)) {
    throw new Error('Refusing to connect: isolated emulator harness only allows demo-zelvero.');
  }

  const publicStore =
    typeof location !== 'undefined' && (isPublicStorePath(location.pathname) || customStoreHost(import.meta.env, location.hostname) !== null);
  if (!publicStore) initAppCheck(app, config);

  const auth = initializeAuth(app, { persistence: browserLocalPersistence });
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    ignoreUndefinedProperties: true,
  });
  const storage = getStorage(app);
  const functions = getFunctions(app, config.functionsRegion);

  if (config.useEmulators) {
    connectFirebaseEmulators(auth, db, functions, storage, config);
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
