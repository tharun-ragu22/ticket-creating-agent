import { createTicketProvider, migrate } from '@tca/ticket-providers';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { isLoopbackOnly, reachableUrls } from './net.js';
import { DemoJwtIdentityProvider } from './auth/demo-jwt.js';
import { SqlCallerDirectory } from './auth/directory.js';
import { createSqlClient } from './db/client.js';
import { migrateApi } from './db/schema.js';
import { seedDemoUsers } from './db/seed.js';
import { SqlTranscriptStore } from './db/transcripts.js';

async function main(): Promise<void> {
  const config = loadConfig();

  if (config.identityProvider === 'oidc') {
    // Better to refuse to start than to boot an API that mints LiveKit tokens
    // for callers it cannot actually authenticate.
    throw new Error(
      'IDENTITY_PROVIDER=oidc is not implemented yet. ' +
        'Set IDENTITY_PROVIDER=demo-jwt, or implement an OidcIdentityProvider ' +
        'against the IdentityProvider interface in @tca/contracts.',
    );
  }

  const databaseUrl = process.env['DATABASE_URL'] ?? 'pglite://./data/tca';
  const db = await createSqlClient(databaseUrl);

  await migrate(db.sql);
  await migrateApi(db.sql);
  await seedDemoUsers(db.sql);

  const ticketProvider = createTicketProvider(
    config.ticketProvider === 'demo'
      ? { provider: 'demo', sql: db.sql }
      : { provider: 'synergy-interact' },
  );

  const app = await buildApp({
    config,
    ticketProvider,
    identityProvider: new DemoJwtIdentityProvider(config.demoJwtSecret),
    directory: new SqlCallerDirectory(db.sql, ticketProvider),
    transcripts: new SqlTranscriptStore(db.sql),
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void app
        .close()
        .then(() => db.close())
        .then(() => process.exit(0));
    });
  }

  await app.listen({ host: config.host, port: config.port });

  /*
   * reachableAt, not just the configured base URL. The mobile app derives its
   * API host from whichever machine served the bundle, so the question when it
   * cannot sign in is always "does that address appear here?" — and the old
   * line answered with API_PUBLIC_BASE_URL, a string that says 127.0.0.1 no
   * matter what the socket is bound to.
   */
  app.log.info(
    {
      ticketProvider: ticketProvider.name,
      board: `${config.publicBaseUrl}/board`,
      reachableAt: reachableUrls(config.host, config.port),
    },
    'API ready',
  );

  if (isLoopbackOnly(config.host)) {
    app.log.warn(
      { host: config.host },
      'API_HOST is loopback, so nothing off this machine can reach the API — ' +
        'a phone will time out signing in. Set API_HOST=0.0.0.0.',
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
