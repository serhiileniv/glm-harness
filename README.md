# glm-harness

`glmh` is a terminal coding agent built for one model, GLM-4.7-Flash, so that anyone can use
an AI coding agent for free with a key they own. No account with us, no telemetry, MIT.

Status: MVP. Passes its three fixture tasks against the Z.ai free route with 5 to 9 requests each
(`eval/README.md`). Full-screen TUI with streaming. Not yet packaged.

## Why one model

Same model, different harness: 12 to 27 points of pass rate on coding benchmarks. Small
models are the most sensitive to harness quality, and on a free key every wasted turn is your
daily quota. `glmh` speaks GLM's own tool protocol, keeps its reasoning across turns, uses the
vendor's sampling, and spends as few requests per task as it can. Details in `docs/`.

## Quick start

1. Get a free key. Z.ai direct is the one to use:
   - Z.ai: register at https://z.ai/model-api, create a key at https://z.ai/manage-apikey/apikey-list. About 1,000 requests a day.
   - ZenMux (fallback only): https://zenmux.ai/platform/pay-as-you-go, allow `z-ai/glm-4.7-flash-free` on the key. Its free route walls after roughly 15 requests an hour.
2. Run from source for now (Bun 1.3+):

```sh
git clone https://github.com/serhiileniv/glm-harness && cd glm-harness && bun install
bun run src/cli.ts init            # paste the key; runs a test call and a tool-call test
cd ~/some/repo
glmh                                   # full-screen session: type tasks, Esc cancels, /help
glmh "make the failing test in auth pass"   # one task, plain output, scriptable
```

`bun run build` produces a single binary at `dist/glmh`. A Homebrew formula and `curl | sh`
installer come with the first release.

## What it does

- Full-screen session with streamed output, scrollback, y/n approvals in place, Esc to cancel a
  run, `/diff`, `/reset`, `/yes`, `/think`. Plain line mode for pipes, CI and `glmh "task"`.

- Six tools: read (100-line windows), edit (exact search and replace with a syntax check), write,
  grep (ripgrep, capped at 50 hits), search (files by name), bash (asks first unless `--yes`).
- One request at a time, 3 s apart, exponential backoff on 429. The free route is often busy;
  a cold turn can take a minute, a warm one three seconds.
- The model's full 200k window and no turn limit. Deterministic compaction only under real pressure: last 5 tool results kept in full, older ones collapsed.
- Doom-loop detection, duplicate-read short circuit, parallel tool calls in one turn.
- After changes, runs the project's tests once (auto-detected or `check = "..."` in `glmh.toml`)
  and feeds failures back for up to two repair rounds.
- Never commits or pushes. Never reads `.env` or key files unless `--allow-secrets`.
- Prints a quota line after every run: requests today, estimated cap, tasks left.

## Limits you should know

- Free tier: one concurrent request per key, community-estimated ~1,000 requests a day, not
  published by Z.ai. Roughly 30 agent tasks a day for one person.
- Your prompts and the file contents the agent reads go to the endpoint you chose. Z.ai states
  API content is not stored and is processed in Singapore. Do not paste secrets into tasks.
- GLM-4.7-Flash is a 30B model. It is good at agentic edits in small and medium repos and weaker
  at large refactors. Give it one clear task at a time.

## Development

```sh
bun test                 # 39 tests, no network
bun run typecheck
bun run eval 01-ts-slugify   # runs a fixture task against your configured endpoint
```

Design record: `docs/specs/basic-harness.md`, `docs/decisions.md`, `docs/architecture.md`,
`docs/research/`.
