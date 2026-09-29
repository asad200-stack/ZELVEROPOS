import { defineConfig } from 'vitest/config';

/** Security-rules tests; run through `npm run test:rules` (inside the Firebase emulators). */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
