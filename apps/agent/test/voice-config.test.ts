import { describe, it, expect } from 'vitest';
import { loadVoiceConfig } from '../src/voice/config.js';

const BASE = {
  LIVEKIT_URL: 'wss://p.livekit.cloud',
  LIVEKIT_API_KEY: 'devkey',
  LIVEKIT_API_SECRET: 'secret-0123456789abcdef',
  TICKET_API_URL: 'http://127.0.0.1:8080',
  TICKET_API_SERVICE_TOKEN: 'dev-service-token-0000',
};

describe('loadVoiceConfig', () => {
  it('defaults every stage to inference, which needs only LiveKit credentials', () => {
    const config = loadVoiceConfig(BASE);

    expect(config.stt.provider).toBe('inference');
    expect(config.llm.provider).toBe('inference');
    expect(config.tts.provider).toBe('inference');
  });

  it('reads the provider and model for each stage', () => {
    const config = loadVoiceConfig({
      ...BASE,
      VOICE_LLM_PROVIDER: 'inference',
      VOICE_LLM_MODEL: 'google/gemini-2.5-flash',
      VOICE_LLM_TEMPERATURE: '0.3',
    });

    expect(config.llm).toMatchObject({
      provider: 'inference',
      model: 'google/gemini-2.5-flash',
      temperature: 0.3,
    });
  });

  it('rejects an unknown provider by name rather than falling back', () => {
    expect(() => loadVoiceConfig({ ...BASE, VOICE_LLM_PROVIDER: 'skynet' })).toThrow(/skynet/);
  });

  /**
   * The silent failure that cost a debugging session: the gateway accepts
   * anthropic/* and then streams zero chunks, so the agent connects, listens
   * and never speaks. Verified against the live gateway on 2026-11-05.
   */
  it('refuses an anthropic model routed through inference, which fails silently', () => {
    expect(() =>
      loadVoiceConfig({
        ...BASE,
        VOICE_LLM_PROVIDER: 'inference',
        VOICE_LLM_MODEL: 'anthropic/claude-sonnet-4-6',
      }),
    ).toThrow(/anthropic/i);
  });

  it('refuses a bare claude model name through inference too', () => {
    expect(() =>
      loadVoiceConfig({
        ...BASE,
        VOICE_LLM_PROVIDER: 'inference',
        VOICE_LLM_MODEL: 'claude-sonnet-4-6',
      }),
    ).toThrow(/claude|anthropic/i);
  });

  it('allows an anthropic model when the direct plugin is used with its own key', () => {
    const config = loadVoiceConfig({
      ...BASE,
      VOICE_LLM_PROVIDER: 'anthropic',
      VOICE_LLM_MODEL: 'claude-sonnet-4-6',
      ANTHROPIC_API_KEY: 'sk-ant-test',
    });

    expect(config.llm.provider).toBe('anthropic');
  });

  /** A direct plugin with no key fails at startup, not on the first call. */
  it('requires the vendor key when a direct plugin is selected', () => {
    expect(() =>
      loadVoiceConfig({ ...BASE, VOICE_LLM_PROVIDER: 'anthropic', VOICE_LLM_MODEL: 'claude-sonnet-4-6' }),
    ).toThrow(/ANTHROPIC_API_KEY/);

    expect(() =>
      loadVoiceConfig({ ...BASE, VOICE_STT_PROVIDER: 'deepgram' }),
    ).toThrow(/DEEPGRAM_API_KEY/);
  });

  it('does not require a vendor key for a stage that uses inference', () => {
    expect(() =>
      loadVoiceConfig({ ...BASE, VOICE_STT_PROVIDER: 'inference', VOICE_TTS_PROVIDER: 'inference' }),
    ).not.toThrow();
  });

  it('requires the ticket API service token, since the agent cannot file without it', () => {
    const { TICKET_API_SERVICE_TOKEN: _omitted, ...withoutToken } = BASE;
    expect(() => loadVoiceConfig(withoutToken)).toThrow(/TICKET_API_SERVICE_TOKEN/);
  });

  it('carries the agent name, because naming it disables automatic dispatch', () => {
    expect(loadVoiceConfig({ ...BASE, LIVEKIT_AGENT_NAME: 'ticket-agent' }).agentName)
      .toBe('ticket-agent');
  });
});
