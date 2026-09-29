/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import isolation from './config/firebase-isolation.json' with { type: 'json' };
import { validateFirebaseEnv } from './src/firebase/isolation.ts';

/**
 * Fails `vite dev` / `vite build` immediately when the environment points at the old
 * CATCH POS Firebase project (or is otherwise unsafe). Runtime re-checks in src/firebase/config.ts.
 */
function firebaseIsolationGuard(mode: string): Plugin {
  return {
    name: 'zelvero-firebase-isolation-guard',
    configResolved(config) {
      if (config.mode === 'test') return;
      const env = loadEnv(mode, process.cwd(), 'VITE_');
      const problems = validateFirebaseEnv(env, { requireComplete: config.command === 'build' });
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

export default defineConfig(({ mode }) => ({
  plugins: [react(), firebaseIsolationGuard(mode)],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
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
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}));
