/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { assertStagingViteMode } from '../../scripts/staging-build.mjs';

function stagingModeLock(mode: string): Plugin {
  return {
    name: 'zelvero-staging-mode-lock',
    config() {
      if (mode !== 'staging') return;
      assertStagingViteMode();
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), stagingModeLock(mode)],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/three') || id.includes('node_modules/@react-three')) return 'three';
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
