import { inference, type llm, type stt, type tts } from '@livekit/agents';
import type { VoiceConfig } from './config.js';

/**
 * Builds the STT, LLM and TTS instances from config.
 *
 * Every LiveKit plugin subclasses llm.LLM / stt.STT / tts.TTS and AgentSession
 * accepts any instance, so swapping a vendor needs only this factory — no
 * abstraction of our own, which is why requirement #4 costs almost nothing.
 *
 * `inference` is the default for all three because it authenticates with the
 * LiveKit credentials the project already has, so the whole stack runs with no
 * vendor keys. The direct plugins are imported lazily so that selecting one
 * does not make every other vendor's SDK a startup cost.
 */
export async function buildVoiceStack(config: VoiceConfig): Promise<{
  stt: stt.STT;
  llm: llm.LLM;
  tts: tts.TTS;
}> {
  return {
    stt: await buildStt(config),
    llm: await buildLlm(config),
    tts: await buildTts(config),
  };
}

async function buildStt(config: VoiceConfig): Promise<stt.STT> {
  const { provider, model } = config.stt;

  if (provider === 'inference') {
    return new inference.STT({ model: model as never, language: config.language });
  }

  if (provider === 'deepgram') {
    const { STT } = await import('@livekit/agents-plugin-deepgram');
    return new STT({ model: bare(model), language: config.language });
  }

  if (provider === 'cartesia') {
    const { STT } = await import('@livekit/agents-plugin-cartesia');
    return new STT({ model: bare(model) as never, language: config.language });
  }

  throw new Error(`STT provider "${provider}" has no plugin wired up yet.`);
}

async function buildLlm(config: VoiceConfig): Promise<llm.LLM> {
  const { provider, model, temperature } = config.llm;

  if (provider === 'inference') {
    return new inference.LLM({ model, modelOptions: { temperature } });
  }

  if (provider === 'anthropic') {
    const { LLM } = await import('@livekit/agents-plugin-anthropic');
    return new LLM({ model: bare(model) as never, temperature });
  }

  throw new Error(`LLM provider "${provider}" has no plugin wired up yet.`);
}

async function buildTts(config: VoiceConfig): Promise<tts.TTS> {
  const { provider, model, voice } = config.tts;

  if (provider === 'inference') {
    // The gateway spells a voice as part of the model string.
    const spec = voice ? `${model}:${voice}` : model;
    return new inference.TTS({ model: spec as never });
  }

  if (provider === 'elevenlabs') {
    const { TTS } = await import('@livekit/agents-plugin-elevenlabs');
    return new TTS({ modelID: bare(model) as never, ...(voice ? { voice: { id: voice } as never } : {}) });
  }

  if (provider === 'cartesia') {
    const { TTS } = await import('@livekit/agents-plugin-cartesia');
    return new TTS({ model: bare(model) as never, ...(voice ? { voice } : {}) });
  }

  throw new Error(`TTS provider "${provider}" has no plugin wired up yet.`);
}

/**
 * Strips a `provider/` prefix.
 *
 * The inference gateway names models `deepgram/nova-3`; the direct plugins
 * want `nova-3`. Keeping one env format for both means a provider swap really
 * is only the provider line.
 */
const bare = (model: string): string => model.split('/').pop() ?? model;
