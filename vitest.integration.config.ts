import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Cloud Functions integration tests; run through `npm run test:integration` (inside the emulators). */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['tests/integration/concurrency.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
