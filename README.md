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

## Known environment trap: clone onto the Linux filesystem

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

Clone into the WSL filesystem (`~/src/...`) rather than a Windows path and this
disappears. It does not affect CI or a native Linux/macOS machine.

> Caveat: I could not complete the control experiment — copying `node_modules`
> to the local overlay filesystem broke pnpm's symlink layout — so the
> filesystem attribution is a strong inference from the numbers above rather
> than something directly measured.
