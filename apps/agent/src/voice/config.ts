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
const INFERENCE_VENDORS = {
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
  // cartesia/sonic-3 rather than elevenlabs: Inference does not serve
  // elevenlabs at all, so the old default could never have worked.
  const ttsModel = env['VOICE_TTS_MODEL']?.trim() || 'cartesia/sonic-3';

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
