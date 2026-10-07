import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Browser end-to-end tests against the local emulators; run through `npm run test:e2e`. */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.e2e.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
