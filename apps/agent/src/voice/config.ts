import { z } from 'zod';

export const SttProvider = z.enum(['inference', 'deepgram', 'assemblyai', 'cartesia']);
export const LlmProvider = z.enum(['inference', 'anthropic', 'openai', 'google']);
export const TtsProvider = z.enum(['inference', 'elevenlabs', 'cartesia', 'deepgram', 'rime']);

export type SttProvider = z.infer<typeof SttProvider>;
export type LlmProvider = z.infer<typeof LlmProvider>;
export type TtsProvider = z.infer<typeof TtsProvider>;

/** Which env var holds the key for each direct plugin. */
const VENDOR_KEYS: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
  deepgram: 'DEEPGRAM_API_KEY',
  assemblyai: 'ASSEMBLYAI_API_KEY',
  cartesia: 'CARTESIA_API_KEY',
  elevenlabs: 'ELEVENLABS_API_KEY',
  rime: 'RIME_API_KEY',
};

export interface VoiceConfig {
  livekit: { url: string; apiKey: string; apiSecret: string };
  agentName: string;
  language: string;
  stt: { provider: SttProvider; model: string };
  llm: { provider: LlmProvider; model: string; temperature: number };
  tts: { provider: TtsProvider; model: string; voice: string | null };
  vadProvider: 'silero';
  api: { url: string; serviceToken: string };
}

/**
 * The vendors LiveKit Inference will actually serve, per stage.
 *
 * Taken from the model unions in @livekit/agents 1.9.5
 * (src/inference/{llm,stt,tts}.ts). Every one of those unions ends in
 * `AnyString`, so *any* "vendor/model" string typechecks and reaches the
 * gateway, which answers an unsupported vendor with an error carrying no
 * message at all:
 *
 *   ERROR  AgentSession is closing due to an unrecoverable error
 *          type: "tts_error"  error: "LiveKit TTS returned error: undefined"
 *
 * Two live calls were lost to this — anthropic on the LLM side, elevenlabs on
 * the TTS side — so the check is a startup failure with a named fix instead.
 *
 * Re-read these lists when bumping @livekit/agents; new vendors get added.
 */
export const INFERENCE_VENDORS = {
  stt: ['assemblyai', 'cartesia', 'deepgram', 'google', 'inworld', 'speechmatics', 'xai'],
  llm: ['deepseek-ai', 'google', 'moonshotai', 'openai', 'xai', 'zai'],
  tts: ['assemblyai', 'cartesia', 'deepgram', 'fishaudio', 'inworld', 'rime', 'xai'],
} as const;

type Stage = keyof typeof INFERENCE_VENDORS;

const ENV_VAR: Record<Stage, string> = {
  stt: 'VOICE_STT_MODEL',
  llm: 'VOICE_LLM_MODEL',
  tts: 'VOICE_TTS_MODEL',
};

/**
 * Anthropic gets its own message because its failure is the confusing one: the
 * gateway accepts the request and streams zero chunks rather than erroring, so
 * the agent connects, transcribes, and never speaks.
 */
function assertRoutable(stage: Stage, provider: string, model: string): void {
  if (provider !== 'inference') return;

  if (stage === 'llm' && /anthropic|claude/i.test(model)) {
    throw new Error(
      `VOICE_LLM_MODEL="${model}" cannot be served by LiveKit Inference: the gateway ` +
        'accepts anthropic/claude models and then streams zero chunks, so the agent ' +
        'would connect and never speak. Either use a served model ' +
        '(e.g. google/gemini-2.5-flash, openai/gpt-4.1-mini), or set ' +
        'VOICE_LLM_PROVIDER=anthropic with ANTHROPIC_API_KEY to call Anthropic directly.',
    );
  }

  // No slash means no vendor to check, and the gateway accepts some bare
  // values (STT takes 'auto'). Only reject what is recognisably wrong.
  const slash = model.indexOf('/');
  if (slash < 0) return;

  const vendor = model.slice(0, slash).toLowerCase();
  const served: readonly string[] = INFERENCE_VENDORS[stage];
  if (served.includes(vendor)) return;

  throw new Error(
    `${ENV_VAR[stage]}="${model}" cannot be served by LiveKit Inference: it does not ` +
      `offer "${vendor}" for ${stage.toUpperCase()}, and rejects the request with an ` +
      'empty error message, so the call dies mid-session. Served vendors are ' +
      `${served.join(', ')}. To use ${vendor} directly instead, set ` +
      `VOICE_${stage.toUpperCase()}_PROVIDER=${vendor} and supply its API key.`,
  );
}

/** The SDK's own default, which prewarm cannot reliably meet. */
const SDK_INITIALIZE_TIMEOUT_MS = 10_000;

/**
 * How many prewarmed job processes to keep idle.
 *
 * The SDK's default is `min(cores, 4)` in production and **0 in dev mode**, and
 * 0 means every call forks a cold process first: load tsx, import every plugin,
 * load Silero, then start. Measured on a demo call, that was 8.5 seconds
 * between "received job request" and "initializing job runner" — before the
 * entry function ran a single line, so no amount of work on the profile fetch
 * or the voice stack can touch it.
 *
 * One is right for a demo: a second concurrent call still gets served, it just
 * pays the cold start the first call no longer does. Raise it to match expected
 * concurrency, at roughly a Node process and one Silero model each.
 */
const IDLE_PROCESSES = 1;

/**
 * Keeps the greeting off the critical path of process startup.
 *
 * Overridable because the memory cost is per process and a laptop running the
 * API, the agent and Metro at once may not want several.
 */
export function resolveIdleProcesses(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = Number(env['AGENT_IDLE_PROCESSES']?.trim());
  if (!Number.isInteger(raw) || raw < 1) return IDLE_PROCESSES;

  // Note there is no way to ask for none: the SDK stores
  // `numIdleProcesses || Default.numIdleProcesses(production)`, so a 0 reverts
  // to its default — which is 0 in dev but min(cores, 4) under `start`. Values
  // below 1 therefore fall back to ours, where at least the behaviour is the
  // same in both modes.
  return raw;
}

/** Ours: generous enough to load Silero on a loaded machine or a cold cache. */
const INITIALIZE_TIMEOUT_MS = 60_000;

/**
 * How long the job subprocess has to signal ready.
 *
 * prewarm loads Silero's ONNX model inside this window. The SDK allows
 * ${SDK_INITIALIZE_TIMEOUT_MS}ms, which is not enough on a machine under load
 * or on a first run that still has to fetch the model file; the worker then
 * logs "runner initialization timed out" and no agent joins the room at all,
 * which looks identical to a dispatch problem from the caller's side.
 *
 * Raising a timeout is normally the wrong instinct, but the work here is a
 * genuine one-off model load, and the cost of being wrong is asymmetric: too
 * low means the agent never arrives, while too high only delays the error
 * message for a job that was already broken.
 */
export function resolveInitializeProcessTimeout(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = Number(env['AGENT_INIT_TIMEOUT_MS']?.trim());
  if (!Number.isFinite(raw) || raw <= 0) return INITIALIZE_TIMEOUT_MS;

  return Math.max(raw, SDK_INITIALIZE_TIMEOUT_MS);
}

/**
 * Parses the voice stack out of the environment.
 *
 * Every stage defaults to `inference`, which authenticates with the LiveKit
 * credentials the project already has — so the whole thing runs with no vendor
 * keys at all. A direct plugin is selected per stage and must bring its own
 * key, checked here so a missing key fails at startup rather than on the first
 * word of the first call.
 */
export function loadVoiceConfig(env: Record<string, string | undefined> = process.env): VoiceConfig {
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is required but not set.`);
    return value;
  };

  const stage = <T extends string>(
    valid: readonly T[],
    name: string,
    fallback: T,
  ): T => {
    const raw = (env[name]?.trim() || fallback) as T;
    if (!valid.includes(raw)) {
      throw new Error(
        `${name}="${raw}" is not a known provider. Valid values: ${valid.join(', ')}.`,
      );
    }
    return raw;
  };

  const sttProvider = stage(SttProvider.options, 'VOICE_STT_PROVIDER', 'inference');
  const llmProvider = stage(LlmProvider.options, 'VOICE_LLM_PROVIDER', 'inference');
  const ttsProvider = stage(TtsProvider.options, 'VOICE_TTS_PROVIDER', 'inference');

  for (const provider of [sttProvider, llmProvider, ttsProvider]) {
    if (provider === 'inference') continue;

    const keyName = VENDOR_KEYS[provider];
    if (keyName && !env[keyName]?.trim()) {
      throw new Error(
        `Provider "${provider}" needs ${keyName}, which is not set. ` +
          'Set it, or use the LiveKit Inference gateway instead, which authenticates ' +
          'with LIVEKIT_API_KEY.',
      );
    }
  }

  const sttModel = env['VOICE_STT_MODEL']?.trim() || 'deepgram/nova-3';
  const llmModel = env['VOICE_LLM_MODEL']?.trim() || 'google/gemini-2.5-flash';
  // deepgram/aura-2 rather than elevenlabs, which Inference does not serve at
  // all. Chosen on measured time-to-first-audio through the gateway, since the
  // whole mouth-to-ear budget is ~900ms: aura-2 230ms, inworld-tts-1.5 215ms,
  // rime/mistv2 396ms, cartesia/sonic-3 786ms. Deepgram is also already the
  // STT vendor, so this adds no new one.
  const ttsModel = env['VOICE_TTS_MODEL']?.trim() || 'deepgram/aura-2';

  assertRoutable('stt', sttProvider, sttModel);
  assertRoutable('llm', llmProvider, llmModel);
  assertRoutable('tts', ttsProvider, ttsModel);

  return {
    livekit: {
      url: required('LIVEKIT_URL'),
      apiKey: required('LIVEKIT_API_KEY'),
      apiSecret: required('LIVEKIT_API_SECRET'),
    },
    agentName: env['LIVEKIT_AGENT_NAME']?.trim() || 'ticket-agent',
    language: env['VOICE_LANGUAGE']?.trim() || 'en',
    stt: {
      provider: sttProvider,
      model: sttModel,
    },
    llm: {
      provider: llmProvider,
      model: llmModel,
      temperature: Number(env['VOICE_LLM_TEMPERATURE']?.trim() || '0.3'),
    },
    tts: {
      provider: ttsProvider,
      model: ttsModel,
      voice: env['VOICE_TTS_VOICE']?.trim() || null,
    },
    vadProvider: 'silero',
    api: {
      url: required('TICKET_API_URL'),
      serviceToken: required('TICKET_API_SERVICE_TOKEN'),
    },
  };
}
