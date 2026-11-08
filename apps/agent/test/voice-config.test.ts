import { describe, it, expect } from 'vitest';
import {
  INFERENCE_VENDORS,
  resolveIdleProcesses,
  resolveInitializeProcessTimeout,
  loadVoiceConfig,
} from '../src/voice/config.js';

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
   * The same trap as anthropic, found the same way: a live call that joined the
   * room and then died with `LiveKit TTS returned error: undefined`.
   *
   * Inference's model types all end in `AnyString`, so any "vendor/model"
   * string typechecks, and the gateway answers an unsupported vendor with an
   * error carrying no message at all. The vendor lists come from the unions in
   * @livekit/agents 1.9.5 src/inference/{llm,stt,tts}.ts.
   */
  describe('vendors the inference gateway does not serve', () => {
    it('refuses elevenlabs TTS, which the gateway rejects with an empty error', () => {
      expect(() =>
        loadVoiceConfig({
          ...BASE,
          VOICE_TTS_PROVIDER: 'inference',
          VOICE_TTS_MODEL: 'elevenlabs/eleven_flash_v2_5',
        }),
      ).toThrow(/elevenlabs/i);
    });

    it('names the served vendors, so the fix is in the message', () => {
      expect(() =>
        loadVoiceConfig({
          ...BASE,
          VOICE_TTS_PROVIDER: 'inference',
          VOICE_TTS_MODEL: 'elevenlabs/eleven_flash_v2_5',
        }),
      ).toThrow(/cartesia/);
    });

    /**
     * The default shipped as elevenlabs/eleven_flash_v2_5, which the gateway
     * cannot serve, so the out-of-the-box config could never speak. Asserting
     * against the served list rather than a literal keeps this true if the
     * model is retuned for latency later.
     */
    it('defaults every stage to a vendor the gateway actually serves', () => {
      const config = loadVoiceConfig(BASE);

      for (const [stage, model] of [
        ['stt', config.stt.model],
        ['llm', config.llm.model],
        ['tts', config.tts.model],
      ] as const) {
        const vendor = model.slice(0, model.indexOf('/'));
        expect(INFERENCE_VENDORS[stage]).toContain(vendor);
      }
    });

    it('refuses an unserved STT vendor too', () => {
      expect(() =>
        loadVoiceConfig({ ...BASE, VOICE_STT_MODEL: 'whisper.cpp/tiny' }),
      ).toThrow(/whisper\.cpp/i);
    });

    it('allows every served vendor through unchanged', () => {
      const served = loadVoiceConfig({
        ...BASE,
        VOICE_STT_MODEL: 'deepgram/nova-3',
        VOICE_LLM_MODEL: 'google/gemini-2.5-flash',
        VOICE_TTS_MODEL: 'rime/mistv2',
      });

      expect(served.tts.model).toBe('rime/mistv2');
      expect(served.stt.model).toBe('deepgram/nova-3');
    });

    /**
     * A bare model with no vendor prefix cannot be attributed, and the gateway
     * accepts some (STT takes 'auto'). Guessing would block valid config, so
     * only a recognisable vendor is checked.
     */
    it('does not block a model string carrying no vendor prefix', () => {
      expect(() => loadVoiceConfig({ ...BASE, VOICE_STT_MODEL: 'auto' })).not.toThrow();
    });

    it('does not apply to a direct plugin, which talks to the vendor itself', () => {
      const config = loadVoiceConfig({
        ...BASE,
        VOICE_TTS_PROVIDER: 'elevenlabs',
        VOICE_TTS_MODEL: 'eleven_flash_v2_5',
        ELEVENLABS_API_KEY: 'el-key',
      });

      expect(config.tts.provider).toBe('elevenlabs');
    });
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

/**
 * The job subprocess must signal ready within this window or the worker logs
 * "runner initialization timed out" and no agent ever joins the room. Our
 * prewarm loads Silero's ONNX model in that window, and the SDK's 10s default
 * is not enough on a loaded laptop or on a first run that still has to fetch
 * the model file — observed on Windows while the watchdog was reporting
 * 100-300ms host stalls.
 */
describe('resolveInitializeProcessTimeout', () => {
  it('allows far more than the SDK default of 10s, which prewarm overruns', () => {
    expect(resolveInitializeProcessTimeout({})).toBeGreaterThanOrEqual(60_000);
  });

  it('is overridable for a slower machine', () => {
    expect(resolveInitializeProcessTimeout({ AGENT_INIT_TIMEOUT_MS: '120000' })).toBe(120_000);
  });

  it('ignores a value that is not a positive number rather than disabling the timeout', () => {
    expect(resolveInitializeProcessTimeout({ AGENT_INIT_TIMEOUT_MS: 'soon' })).toBeGreaterThanOrEqual(60_000);
    expect(resolveInitializeProcessTimeout({ AGENT_INIT_TIMEOUT_MS: '0' })).toBeGreaterThanOrEqual(60_000);
    expect(resolveInitializeProcessTimeout({ AGENT_INIT_TIMEOUT_MS: '-5' })).toBeGreaterThanOrEqual(60_000);
  });
});

describe('resolveIdleProcesses', () => {
  /**
   * The SDK keeps none warm in dev mode, which puts the whole cold start —
   * tsx, every plugin import, the Silero load — between the caller tapping
   * Call and the greeting. Measured at 8.5s on a demo call.
   */
  it('keeps at least one process warm, unlike the SDK default in dev mode', () => {
    expect(resolveIdleProcesses({})).toBeGreaterThanOrEqual(1);
  });

  it('is overridable for a machine with memory to spare', () => {
    expect(resolveIdleProcesses({ AGENT_IDLE_PROCESSES: '3' })).toBe(3);
  });

  it('falls back rather than accepting a value the SDK would silently replace', () => {
    // The SDK stores `numIdleProcesses || default`, so 0 would revert to its
    // own — 0 under dev but min(cores, 4) under start. Same behaviour in both
    // modes is worth more than honouring a value that cannot be expressed.
    expect(resolveIdleProcesses({ AGENT_IDLE_PROCESSES: '0' })).toBeGreaterThanOrEqual(1);
    expect(resolveIdleProcesses({ AGENT_IDLE_PROCESSES: '-1' })).toBeGreaterThanOrEqual(1);
    expect(resolveIdleProcesses({ AGENT_IDLE_PROCESSES: '1.5' })).toBeGreaterThanOrEqual(1);
    expect(resolveIdleProcesses({ AGENT_IDLE_PROCESSES: 'lots' })).toBeGreaterThanOrEqual(1);
  });
});
