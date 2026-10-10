import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Phase D concurrency / data-integrity suite. Run through `npm run test:concurrency` (emulators only). */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/concurrency.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
