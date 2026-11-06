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
 * Anthropic is unreachable through LiveKit Inference.
 *
 * Measured against the live gateway on 2026-11-05: a request for
 * `anthropic/claude-sonnet-4-6` is accepted, returns no error, and streams
 * zero chunks. The agent then connects, transcribes, and never says anything,
 * with nothing in the logs to explain it. Refusing the combination at startup
 * turns a silent mute into a one-line message.
 */
function assertRoutable(provider: LlmProvider, model: string): void {
  if (provider !== 'inference') return;
  if (!/anthropic|claude/i.test(model)) return;

  throw new Error(
    `VOICE_LLM_MODEL="${model}" cannot be served by LiveKit Inference: the gateway ` +
      'accepts anthropic/claude models and then streams zero chunks, so the agent ' +
      'would connect and never speak. Either use a served model ' +
      '(e.g. google/gemini-2.5-flash, openai/gpt-4.1-mini), or set ' +
      'VOICE_LLM_PROVIDER=anthropic with ANTHROPIC_API_KEY to call Anthropic directly.',
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

  const llmModel = env['VOICE_LLM_MODEL']?.trim() || 'google/gemini-2.5-flash';
  assertRoutable(llmProvider, llmModel);

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
      model: env['VOICE_STT_MODEL']?.trim() || 'deepgram/nova-3',
    },
    llm: {
      provider: llmProvider,
      model: llmModel,
      temperature: Number(env['VOICE_LLM_TEMPERATURE']?.trim() || '0.3'),
    },
    tts: {
      provider: ttsProvider,
      model: env['VOICE_TTS_MODEL']?.trim() || 'elevenlabs/eleven_flash_v2_5',
      voice: env['VOICE_TTS_VOICE']?.trim() || null,
    },
    vadProvider: 'silero',
    api: {
      url: required('TICKET_API_URL'),
      serviceToken: required('TICKET_API_SERVICE_TOKEN'),
    },
  };
}
