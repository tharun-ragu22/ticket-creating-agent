import { z } from 'zod';

const Env = z.object({
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(8080),
  API_LOG_LEVEL: z.string().default('info'),
  API_PUBLIC_BASE_URL: z.string().default('http://127.0.0.1:8080'),

  LIVEKIT_URL: z.string().min(1),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  LIVEKIT_AGENT_NAME: z.string().default('ticket-agent'),

  IDENTITY_PROVIDER: z.enum(['demo-jwt', 'oidc']).default('demo-jwt'),
  TICKET_PROVIDER: z.enum(['demo', 'synergy-interact']).default('demo'),

  DEMO_JWT_SECRET: z.string().min(16),
  TICKET_API_SERVICE_TOKEN: z.string().min(16),
});

export interface ApiConfig {
  host: string;
  port: number;
  logLevel: string;
  /** Used to build transcript URIs that resolve from outside the process. */
  publicBaseUrl: string;
  livekit: { url: string; apiKey: string; apiSecret: string; agentName: string };
  identityProvider: 'demo-jwt' | 'oidc';
  ticketProvider: 'demo' | 'synergy-interact';
  demoJwtSecret: string;
  serviceToken: string;
}

/**
 * Fails loudly on a bad environment rather than booting half-configured.
 *
 * An API that starts with a missing LIVEKIT_API_SECRET mints tokens nobody can
 * use, and the symptom surfaces as "the agent never joins" three layers away.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = Env.safeParse(env);

  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid API environment:\n  ${missing.join('\n  ')}`);
  }
  const e = parsed.data;

  return {
    host: e.API_HOST,
    port: e.API_PORT,
    logLevel: e.API_LOG_LEVEL,
    publicBaseUrl: e.API_PUBLIC_BASE_URL.replace(/\/$/, ''),
    livekit: {
      url: e.LIVEKIT_URL,
      apiKey: e.LIVEKIT_API_KEY,
      apiSecret: e.LIVEKIT_API_SECRET,
      agentName: e.LIVEKIT_AGENT_NAME,
    },
    identityProvider: e.IDENTITY_PROVIDER,
    ticketProvider: e.TICKET_PROVIDER,
    demoJwtSecret: e.DEMO_JWT_SECRET,
    serviceToken: e.TICKET_API_SERVICE_TOKEN,
  };
}
