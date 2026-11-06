import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    // Tier 4 is pure functions, but tier 5 boots an AgentSession.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
