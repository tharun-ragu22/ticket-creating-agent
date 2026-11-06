import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // PGlite boots a Postgres WASM image; the first one in a run is slow.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
