import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    // Every suite boots its own PGlite instance; the first WASM image in a run
    // takes several seconds.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
