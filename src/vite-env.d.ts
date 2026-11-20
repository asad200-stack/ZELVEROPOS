/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_EXPECTED_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_FUNCTIONS_REGION?: string;
  readonly VITE_FIREBASE_APPCHECK_SITE_KEY?: string;
  readonly VITE_USE_FIREBASE_EMULATORS?: string;
  /** When true, use isolated alternate emulator ports (demo-zelvero harness only). */
  readonly VITE_EMULATOR_ISOLATED?: string;
  readonly VITE_FIREBASE_EMULATOR_HOST?: string;
  readonly VITE_FIREBASE_AUTH_EMULATOR_PORT?: string;
  readonly VITE_FIREBASE_FIRESTORE_EMULATOR_PORT?: string;
  readonly VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT?: string;
  readonly VITE_FIREBASE_STORAGE_EMULATOR_PORT?: string;
  readonly VITE_SUPPORT_PHONE?: string;
  /** `preview` serves the canonical POS locally and refuses a production Firebase project. */
  readonly VITE_APP_CHANNEL?: string;
  /** Versioned Super Admin preview. Customer builds leave this unset. */
  readonly VITE_ADMIN_PREVIEW?: string;
  /** Optional loopback URL for a local llama.cpp server. Never a paid AI API. */
  readonly VITE_ZELVERO_AI_URL?: string;
  /** 'true' lets a shop's own domain open its storefront (see CustomDomainStore.tsx). */
  readonly VITE_STORE_CUSTOM_DOMAINS?: string;
  /** Comma-separated hosts that always open the POS app, never a storefront. */
  readonly VITE_APP_HOSTS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
