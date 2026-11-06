import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// The tier-5 suite calls a real model through LiveKit Inference, so it needs
// the repo's .env. Loaded here rather than via a CLI flag so `pnpm test` works
// unchanged; the suite skips itself when the credentials are absent.
const envFile = resolve(__dirname, '../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    // Tier 4 is pure functions, but tier 5 boots an AgentSession and waits on
    // a model, and the first @livekit/agents import is slow on a 9p mount.
    testTimeout: 90_000,
    hookTimeout: 120_000,
    env: {
      LIVEKIT_URL: process.env['LIVEKIT_URL'] ?? '',
      LIVEKIT_API_KEY: process.env['LIVEKIT_API_KEY'] ?? '',
      LIVEKIT_API_SECRET: process.env['LIVEKIT_API_SECRET'] ?? '',
      EVAL_LLM_MODEL: process.env['EVAL_LLM_MODEL'] ?? '',
    },
  },
});
