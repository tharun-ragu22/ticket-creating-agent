# Voice ticketing agent

A mobile app where a signed-in user taps one button, describes an IT problem
out loud, and a voice agent files a structured ticket for them.

Built test-first. See `/home/node/.claude/plans/i-need-you-to-elegant-nautilus.md`
for the full plan, including the eval catalogue and the honest account of the
one layer TDD does not reach.

## Layout

```
packages/contracts/         @tca/contracts — the zod ticket model, imported by
                            the agent, API, board and mobile app so it exists once
packages/ticket-providers/  the demo provider, the HTTP client, the Interact stub,
                            and the shared provider contract suite
packages/test-helpers/      PGlite bootstrap and caller fixtures
apps/api/                   Fastify: tickets, transcripts, LiveKit tokens, /board
apps/agent/                 the voice agent and its tools
evals/                      the behavioural specification (53 cases) + scorer
```

## Running it

```bash
pnpm install
cp .env.example .env          # then fill in the keys
pnpm --filter @tca/api start  # :8080, board at /board
```

The `start`, `dev` and `console` scripts load the repo-root `.env` themselves
via `node --env-file-if-exists=../../.env`, so no shell export or `direnv` is
needed. Nothing reads a per-package `.env`.

Two profiles are seeded on every boot — `priya` (a laptop and a phone on
record, plus an open ticket) and `dave` — and the schema migrates itself, so
there is no separate migrate step.

`DATABASE_URL` defaults to `pglite://./data/tca` — real Postgres compiled to
WASM, no Docker and no server, persisting to disk. Use `postgres://…` for
anything beyond one machine; PGlite is single-process.

## Verification

```bash
pnpm test        # tiers 1-5, deterministic
pnpm typecheck
pnpm eval --list # the behavioural spec: 53 cases
pnpm eval        # tier 6, real model (not wired until phase 6)
```

## The voice stack

Every stage defaults to **LiveKit Inference**, which authenticates with the
LiveKit credentials the project already has — so the whole thing runs with no
vendor keys:

```ini
VOICE_STT_PROVIDER=inference
VOICE_LLM_PROVIDER=inference
VOICE_TTS_PROVIDER=inference
```

A direct plugin is selected per stage and must bring its own key, checked at
startup rather than on the first word of the first call.

### Inference serves a fixed vendor list, and rejects the rest uselessly

Every model type in `@livekit/agents` ends in `AnyString`, so **any**
`vendor/model` string typechecks and reaches the gateway. An unsupported vendor
comes back with an error carrying no message:

```
ERROR  AgentSession is closing due to an unrecoverable error
       type: "tts_error"  label: "inference.TTS"
       error: "LiveKit TTS returned error: undefined"  body: null
```

The vendors it does serve, from the unions in `src/inference/{llm,stt,tts}.ts`:

| Stage | Served |
|---|---|
| STT | `assemblyai` `cartesia` `deepgram` `google` `inworld` `speechmatics` `xai` |
| LLM | `deepseek-ai` `google` `moonshotai` `openai` `xai` `zai` — **no `anthropic`** |
| TTS | `assemblyai` `cartesia` `deepgram` `fishaudio` `inworld` `rime` `xai` — **no `elevenlabs`** |

`loadVoiceConfig` checks the vendor prefix of each stage at startup, so an
unserved vendor is a one-line message instead of a call that dies mid-session.
Two live calls were lost to this before the check existed — `anthropic` on the
LLM side, `elevenlabs` on the TTS side, the latter being the repo's own former
default. Re-read those unions when bumping `@livekit/agents`.

Measured through the gateway on 2026-11-06, one sample each, synthesising the
same sentence — time to first audio frame, which is the slice of the ~900 ms
mouth-to-ear budget that TTS owns:

| TTS model | First audio | Frames |
|---|---|---|
| `inworld/inworld-tts-1.5` | 215 ms | 39 |
| `deepgram/aura-2` | 230 ms | 38 |
| `rime/mistv2` | 396 ms | 35 |
| `cartesia/sonic-3` | 786 ms | 27 |
| `elevenlabs/eleven_flash_v2_5` | **zero frames in 4.5 s** | 0 |

`deepgram/aura-2` is the default: fast, and Deepgram is already the STT vendor.
The ElevenLabs row is the signature to recognise — the server event is
literally `{"type":"error"}` with no message field, which is why the SDK logs
`LiveKit TTS returned error: undefined`.

### Anthropic is the confusing one: accepted, then silent

Measured against the live gateway on 2026-11-05: a request for
`anthropic/claude-sonnet-4-6` — or bare `claude-sonnet-4-6` — is **accepted**,
returns **no error**, and streams **zero chunks**. The agent connects,
transcribes, and never speaks, with nothing in the logs to explain it.

`loadVoiceConfig` refuses the combination at startup for that reason. Confirmed
working through the gateway, all handling tool calls with the nested ticket
schema:

| Model | First token |
|---|---|
| `google/gemini-2.5-flash` | ~190 ms |
| `google/gemini-3-flash` | ~1.6 s (with tools) |
| `google/gemma-4-31b-it` | ~140 ms |
| `openai/gpt-4.1-mini` | ~460 ms |

To use Claude, call it directly instead: `VOICE_LLM_PROVIDER=anthropic` with
`ANTHROPIC_API_KEY`.

### "runner initialization timed out" and no agent joins

The job subprocess has `initializeProcessTimeout` to signal ready, and
`prewarm` loads Silero's ONNX model inside that window. The SDK allows 10s,
which is not enough on a machine under load or on a first run that still has to
fetch the model, so the worker logs:

```
ERROR  error launching job   requestId: "AJ_..."
       err: "runner initialization timed out"  (ipc/supervised_proc.ts)
```

From the caller's side this is indistinguishable from a dispatch problem, but
it is the opposite: a `requestId` means LiveKit offered the job and the worker
accepted it, so registration and the `agentName` match are both fine.

The worker now allows 60s, overridable with `AGENT_INIT_TIMEOUT_MS`. Cache the
model ahead of the first call rather than fetching it during one:

```bash
pnpm --filter @tca/agent download-files
```

## Known environment trap: Linux reading Windows files

Under WSL2, a repo on a Windows drive (`/mnt/c`, or anything reported as a `9p`
mount by `df -T .`) makes module loading pathologically slow. Measured here:

| | |
|---|---|
| `import '@livekit/agents'` in bare Node | **~46 s**, stable across runs |
| `cat` of all 407 files in its `dist/` | 4.9 s at 11% CPU |
| The agent test suite | 49 s, of which 44 s is collect and 61 ms is tests |

The low CPU share and the absence of any page-cache benefit on repeat runs both
point at per-syscall latency on the 9p mount, and ESM resolution makes far more
syscalls per module than a plain read. It is not the package and not vitest.

This is not a Windows problem, it is a *Linux-reading-Windows-files* problem.
Either of these is fine; only the third is slow:

| Files live on | Run by | Speed |
|---|---|---|
| Windows `C:\` | Node for Windows (PowerShell) | fast, native NTFS |
| WSL home `~/src/...` | Node inside WSL | fast, ext4 in the VM |
| Windows `C:\` | Node inside WSL, via `/mnt/c/...` | the numbers above |

Running natively on Windows is the better choice for the phase 7 walking
skeleton anyway, because console mode then gets a real microphone instead of
fighting WSLg audio. It does not affect CI or a native Linux/macOS machine.

The same cost is why the agent **worker** cannot be smoke-tested on this mount:
importing `@livekit/agents-plugin-silero` alone takes minutes, so the process
never reaches its first log line.

> Caveat: I could not complete the control experiment — copying `node_modules`
> to the local overlay filesystem broke pnpm's symlink layout — so the
> filesystem attribution is a strong inference from the numbers above rather
> than something directly measured.
