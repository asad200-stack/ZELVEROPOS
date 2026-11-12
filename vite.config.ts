/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import emulatorIsolated from './config/emulator-isolated.json' with { type: 'json' };
import isolation from './config/firebase-isolation.json' with { type: 'json' };
import { assertStagingViteMode } from './scripts/staging-build.mjs';
import { validateEmulatorIsolatedEnv } from './src/firebase/emulatorIsolated.ts';
import { validateFirebaseEnv } from './src/firebase/isolation.ts';
import { serviceWorkerPlugin } from './tools/serviceWorkerPlugin.ts';

/**
 * Fails `vite dev` / `vite build` immediately when the environment points at the old
 * CATCH POS Firebase project (or is otherwise unsafe). Runtime re-checks in src/firebase/config.ts.
 */
const STAGING_ISOLATION = '\0zelvero-client-isolation';
const STAGING_EMULATOR = '\0zelvero-client-emulator';

/** Staging bundles keep the client block list and drop production project ids from shipped JSON. */
function stagingClientIsolation(): Plugin {
  return {
    name: 'zelvero-staging-client-isolation',
    enforce: 'pre',
    resolveId(source) {
      const normalized = source.replaceAll('\\', '/');
      if (normalized.endsWith('config/firebase-isolation.json')) return STAGING_ISOLATION;
      if (normalized.endsWith('config/emulator-isolated.json')) return STAGING_EMULATOR;
      return null;
    },
    load(id) {
      if (id === STAGING_ISOLATION) {
        const client = {
          blocked: isolation.blocked,
          placeholderProjectIds: isolation.placeholderProjectIds,
          emulatorProjectPrefix: isolation.emulatorProjectPrefix,
        };
        return `export default ${JSON.stringify(client)};`;
      }
      if (id === STAGING_EMULATOR) {
        const client = { ...emulatorIsolated, blockedCloudProjectIds: [] };
        return `export default ${JSON.stringify(client)};`;
      }
      return null;
    },
  };
}

function stagingModeLock(mode: string): Plugin {
  return {
    name: 'zelvero-staging-mode-lock',
    config() {
      if (mode !== 'staging') return;
      assertStagingViteMode();
    },
  };
}

function firebaseIsolationGuard(mode: string): Plugin {
  return {
    name: 'zelvero-firebase-isolation-guard',
    configResolved(config) {
      if (config.mode === 'test') return;
      const envDir = mode === 'emulator-isolated' ? isolatedEnvDir : process.cwd();
      const env = loadEnv(mode, envDir, 'VITE_');
      const problems = [
        ...validateFirebaseEnv(env, { requireComplete: config.command === 'build' }),
        ...validateEmulatorIsolatedEnv(env),
      ];
      if (mode === 'emulator-isolated') {
        if (String(env.VITE_EMULATOR_ISOLATED || '').toLowerCase() !== 'true') {
          problems.push({
            message: 'Vite mode emulator-isolated requires VITE_EMULATOR_ISOLATED=true in config/emulator-isolated-env.',
            fatal: true,
          });
        }
        for (const id of ['zelvoropos', 'zelvoropos-stage'] as const) {
          const blob = JSON.stringify(env).toLowerCase();
          if (blob.includes(id)) {
            problems.push({
              message: `Isolated emulator Vite mode detected cloud project "${id}" in env; refusing to start.`,
              fatal: true,
            });
          }
        }
      }
      const sha = (v: string) => createHash('sha256').update(v).digest('hex');
      if (env.VITE_FIREBASE_API_KEY && isolation.blocked.apiKeySha256.includes(sha(env.VITE_FIREBASE_API_KEY))) {
        problems.push({ message: 'VITE_FIREBASE_API_KEY belongs to the OLD CATCH POS project.', fatal: true });
      }
      if (env.VITE_FIREBASE_APP_ID && isolation.blocked.appIdSha256.includes(sha(env.VITE_FIREBASE_APP_ID))) {
        problems.push({ message: 'VITE_FIREBASE_APP_ID belongs to the OLD CATCH POS project.', fatal: true });
      }
      const fatal = problems.filter((p) => p.fatal || config.command === 'build');
      if (fatal.length) {
        throw new Error(
          '\n\u26D4 Firebase isolation guard blocked this run:\n' +
            fatal.map((p) => `  - ${p.message}`).join('\n') +
            '\nSee .env.example and docs/FIREBASE_SETUP.md.\n',
        );
      }
      for (const p of problems) config.logger.warn(`[firebase] ${p.message}`);
    },
  };
}

const isolatedEnvDir = fileURLToPath(new URL('./config/emulator-isolated-env', import.meta.url));

export default defineConfig(({ mode }) => ({
  base: process.env.ZELVERO_BASE || '/',
  // Isolated harness loads ONLY config/emulator-isolated-env — never root .env.staging / .env.production.
  envDir: mode === 'emulator-isolated' ? isolatedEnvDir : undefined,
  plugins: [
    react(),
    ...(mode === 'staging' ? [stagingClientIsolation(), stagingModeLock(mode)] : []),
    firebaseIsolationGuard(mode),
    serviceWorkerPlugin(),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) return 'firebase';
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react';
          if (id.includes('node_modules/@huggingface/transformers') || id.includes('node_modules/onnxruntime')) {
            return 'speech-local';
          }
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
  },
}));
