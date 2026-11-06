import type { FastifyInstance } from 'fastify';
import type { SqlClient, TicketProvider } from '@tca/contracts';
import { createTestDatabase } from '@tca/test-helpers';
import { DemoTicketProvider, migrate } from '@tca/ticket-providers';
import { buildApp } from '../src/app.js';
import type { ApiConfig } from '../src/config.js';
import { migrateApi } from '../src/db/schema.js';
import { seedDemoUsers } from '../src/db/seed.js';
import { SqlCallerDirectory } from '../src/auth/directory.js';
import { DemoJwtIdentityProvider, signDemoToken } from '../src/auth/demo-jwt.js';
import { SqlTranscriptStore } from '../src/db/transcripts.js';

export const TEST_SERVICE_TOKEN = 'test-service-token-0123456789abcdef';
const TEST_JWT_SECRET = 'test-demo-jwt-secret-0123456789abcdef';

export const TEST_CONFIG: ApiConfig = {
  host: '127.0.0.1',
  port: 0,
  logLevel: 'silent',
  publicBaseUrl: 'http://127.0.0.1:8080',
  livekit: {
    url: 'wss://test-project.livekit.cloud',
    apiKey: 'devkey',
    apiSecret: 'test-livekit-secret-0123456789abcdef',
    agentName: 'ticket-agent',
  },
  identityProvider: 'demo-jwt',
  ticketProvider: 'demo',
  demoJwtSecret: TEST_JWT_SECRET,
  serviceToken: TEST_SERVICE_TOKEN,
};

export interface TestApi {
  app: FastifyInstance;
  sql: SqlClient;
  provider: TicketProvider;
  /** An app JWT for a seeded demo user, as the mobile app would hold. */
  callerToken(subject: string): Promise<string>;
  serviceToken: string;
  close(): Promise<void>;
}

/**
 * A fully wired API over an in-process Postgres.
 *
 * Real routes, real auth, real SQL — only the LiveKit credentials are fake,
 * because minting a token is pure signing and needs no network.
 */
export async function buildTestApi(
  over: Partial<ApiConfig> = {},
): Promise<TestApi> {
  const { sql, teardown } = await createTestDatabase();

  await migrate(sql);
  await migrateApi(sql);
  await seedDemoUsers(sql);

  const config: ApiConfig = { ...TEST_CONFIG, ...over };
  const provider = new DemoTicketProvider(sql);

  const app = await buildApp({
    config,
    ticketProvider: provider,
    identityProvider: new DemoJwtIdentityProvider(config.demoJwtSecret),
    directory: new SqlCallerDirectory(sql, provider),
    transcripts: new SqlTranscriptStore(sql),
  });
  await app.ready();

  return {
    app,
    sql,
    provider,
    callerToken: (subject: string) => signDemoToken(config.demoJwtSecret, { subject }),
    serviceToken: config.serviceToken,
    close: async () => {
      await app.close();
      await teardown();
    },
  };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
