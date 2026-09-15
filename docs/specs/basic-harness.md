# Spec: basic harness for GLM-4.7-Flash

Status: approved 2026-09-15; MVP implemented the same day. Deviations from this spec are recorded in `docs/decisions.md`. Research: `docs/research/glm-4.7-flash-harness.md`.

## Goal

A terminal coding agent built for exactly one model, GLM-4.7-Flash, that anyone can
install and use for free in under five minutes. Primary path: the Z.ai free API.
Local weights are an optional endpoint, not a requirement. No account with us, no
telemetry, MIT license. It must beat generic harnesses running the same model on
the same tasks.

## Non-goals (v1)

- Multi-model support. One model profile. Swapping models is an eval decision later.
- Local runtime orchestration (starting llama.cpp, pulling Ollama models), MLX.
- IDE plugin, GUI, MCP, sub-agents, web search, fine-tuning.
- LLM-based context summarisation. v1 compacts deterministically.
- Windows. macOS and Linux first.

## Current state

- No harness exists for this model. Generic harnesses show tool-call breakage,
  loops and parse failures with it (research §4).
- Same model, different harness: 12 to 27 point pass@1 spread (research §7).
- Z.ai serves GLM-4.7-Flash at $0 with 1 concurrent request per key. Verified 2026-09-15:
  native tool calls, parallel tool calls, reasoning content returned, 1.4 s warm latency,
  intermittent 429 "busy" cleared by backoff. ZenMux's free route to the same model walls after
  roughly 15 requests an hour and is a fallback only.

## Design

### Model profile (one file, versioned with the model)

`profiles/glm-4.7-flash.toml`:
- sampling: temperature 0.7, top_p 1.0 (min_p 0.01 and repeat_penalty 1.0 only where the endpoint accepts them)
- thinking: enabled, preserved (`clear_thinking=false`, `reasoning_content` round-tripped)
- reply ceiling 128,000 (the model's maximum), clamped per request to what the window has left; on truncation inject "Your reply was cut off. Call a tool now."
- context 202,752, the model's full window; the free tier caps requests, not tokens. No turn limit; the doom-loop detector and Esc are the guards
- system prompt ≤ 500 tokens, stored in the profile, never inline in code

Why one file: every model-specific fact lives in one place so a future model is a
new profile plus an eval run, not a rewrite.

### Backends

One code path: OpenAI-compatible `/v1/chat/completions` with `tools`, streaming.

| Backend | Endpoint | Status in v1 |
| --- | --- | --- |
| Z.ai free | `https://api.z.ai/api/paas/v4`, model `glm-4.7-flash` | primary, tested |
| ZenMux free | `https://zenmux.ai/api/v1`, model `z-ai/glm-4.7-flash-free` | fallback preset, tested, small hourly quota |
| Any OpenAI-compatible URL | e.g. Ollama `/v1`, `llama-server` | config option, best effort |

Z.ai specifics: requests are serialised (1 concurrency); 429 gets exponential
backoff; a per-day request counter is shown because the daily cap is unpublished.

Fallback parser: if `<tool_call>…</tool_call>` appears in `content` instead of
`tool_calls`, parse it. Cheap insurance against endpoint parser gaps.

### Tools

Six. The user's list plus `edit`. Why `edit`: without a search-and-replace tool the
model must rewrite whole files; that is the bare-adapter case that scored 19 vs 73
(research §7). Whole-file `write` stays for new files.

| Tool | Signature | Behaviour |
| --- | --- | --- |
| `read` | `(path, offset?, limit=100)` | line-numbered window, 100 lines default (SWE-agent), header "lines 1-100 of 540" |
| `write` | `(path, content)` | create or overwrite, mkdir -p, then syntax check |
| `edit` | `(path, old, new)` | exact, must match once; on miss return the 3 closest lines with numbers; then syntax check |
| `grep` | `(pattern, path?, glob?)` | ripgrep; ≤ 50 hits; over 50 returns count and "narrow the query" |
| `search` | `(name_or_glob)` | file finder over `git ls-files`; ≤ 50 hits |
| `bash` | `(cmd, timeout=60)` | non-interactive, cwd = project, output head 4k + tail 4k with truncation hint, exit code; server-like commands refused with hint |

Rules live in tool descriptions, not the system prompt. Parameter names are
unambiguous. Errors say what to do next.

Syntax check after `write`/`edit`: language-specific parse only (`node --check`,
`python -m py_compile`, `gofmt -e`, `rustc --emit=metadata`), result appended to
the tool response. Full tests are the model's job via `bash` and the harness's job
at the end (below).

### Loop

1. First user message = task + repo map (`git ls-files` tree ≤ 200 entries) + first 40 lines of README.
2. Turn: model → tool call(s) → execute → observation → repeat.
3. No turn limit exists. Doom-loop detector: identical tool+args twice in a row injects a
   warning; three times stops the run. Esc stops a run interactively.
4. On model "done": run the project `check` command once (from `glmh.toml`, else
   auto-detect `bun test`/`npm test`/`pytest -q`/`go test ./...`/`cargo test`).
   Failures go back to the model. Max 2 repair rounds.
5. Output: summary plus `git diff --stat`. The harness never commits.

### Context management (deterministic)

- Budget = context − (16k reply reserve + 1k). The reply's max_tokens is clamped per request to the window left after the prompt.
- Always kept in full: system prompt, task message, last 5 tool results.
- Older tool results collapse to one line: `read src/a.ts lines 1-100` (SWE-agent, +3.0).
- Prune whole turns, never a call without its result.
- Tool output hard cap 8k chars before it enters context.
- Compaction is staged at 70%, 85%, 95% of budget, not a cliff.

### Safety

- `bash` and `write`/`edit` outside the project root ask y/n. `--yes` skips.
- Deny-list patterns (`rm -rf /`, `git push --force`, `sudo`) always ask.
- No network calls except the configured model endpoint. Key stored in
  `~/.config/glmh/config.toml`, mode 600.

### CLI

- `glmh init`: asks for a Z.ai key (prints the signup link), makes one test call
  that exercises a tool call and reasoning_content, writes the config. Under a minute.
- `glmh "task"` one-shot; `glmh` REPL.
- `glmh doctor`: endpoint reachable, model id matches, tool call round-trips,
  ripgrep present, today's request count.
- Shows each tool call and a one-line result as it happens.

### Language and distribution

TypeScript on Bun, compiled to a single binary per platform. Install via the
maintainer's existing Homebrew tap on macOS and `curl | sh` on Linux.
Why: no runtime for users to install, and the maintainer's stack.

### Eval (built before features)

- `eval/tasks/<id>/`: `task.md`, `setup.sh` (clone at commit or local fixture), `check.sh` (exit 0 = pass).
- MVP: 10 tasks. Full: 30 tasks, 10 bug fixes, 10 small features, 5 refactors, 5 write-tests. TS, Python, Go, Rust.
- Runner records: pass@1, turns, tokens in/out, wall time, malformed tool calls, edit apply failures, doom loops.
- Baselines on the same endpoint and tasks: OpenCode, Qwen Code, mini-swe-agent.

## GLM-specific layers, used in full

| Layer | Where | Effect |
| --- | --- | --- |
| Native `tool_calls` and the fallback `<tool_call>` XML parser | client, parser | zero malformed-call loss |
| Preserved thinking: `reasoning` or `reasoning_content` returned and sent back on assistant turns | client | reasoning carried across tool turns |
| Parallel tool calls executed in one turn, results returned as one batch | loop | fewer requests per task |
| Vendor sampling 0.7 / 1.0, repeat penalty off, per-turn cap 6k with truncation recovery | profile | fewer loops, bounded thinking |
| Static system prompt and tool schemas, append-only history | loop | prefix caching on local runtimes |
| Duplicate-read short circuit while the earlier result is still in full context | loop | saved requests and tokens |
| Doom-loop detector on identical consecutive tool calls | loop | no burned quota on repetition |

## Student defaults

- Quota line after every run: requests today, estimate cap, tasks left. Warning at 80 percent.
- Diet only where it saves requests: 200-file repo map, 3 s request gap, duplicate-read short circuit. Context and turns are not limited (D22).
- Privacy: init screen states where code goes; `.env` and key files refused unless `--allow-secrets`; key stored mode 600; no telemetry.
- Two free presets in `init`: ZenMux and Z.ai, same model, same profile.

## Access tiers

| User | Path |
| --- | --- |
| anyone | Z.ai free key, zero hardware requirement |
| 32 GB+ machine, wants offline | same binary, endpoint set to a local server (best effort in v1) |

## MVP scope for first distribution to colleagues

In: Z.ai backend, six tools, profile, fallback parser, turn cap, doom-loop
detector, output caps and last-5 compaction, y/n approvals, `init`, `doctor`,
one-shot and REPL, macOS arm64 and Linux x64 binaries, Homebrew formula, README,
MIT license, 10-task smoke eval with one baseline.

Out: local runtime setup, MLX, staged compaction, more than one repair round,
30-task eval, Windows.

## Milestones

- **M0 verify.** With a Z.ai key: tool calls, reasoning_content round-trip, 429
  behaviour, observed daily cap. 100-line loop plus one baseline on 10 tasks.
  Failure taxonomy. No features.
- **M1 loop.** Six tools, profile, fallback parser, turn cap, doom-loop detector.
- **M2 context and verify.** Compaction, syntax checks, end-of-run check + repair.
- **M3 ship.** Eval runner, `init`, `doctor`, binaries, Homebrew tap, README.

## Acceptance criteria

1. Pass@1 on the eval set beats the best baseline running GLM-4.7-Flash on the same endpoint.
2. Malformed tool calls < 2% of turns. Edit apply failures < 5% of edits.
3. Zero runs that repeat the same action three times without the doom-loop detector firing.
4. Fresh Mac: `brew install` to first completed task under 5 minutes, including key signup.
5. Works on Z.ai free with the profile. Same binary pointed at a local OpenAI-compatible endpoint completes the smoke eval (best effort).
6. Free-tier limits are handled: no crash on 429, request counter visible.

## Decisions taken for the MVP (override if you disagree)

1. `edit` is in. Reason above.
2. `search` = find files by name. Symbol search is v2.
3. MLX and local orchestration are out of v1.
4. `bash` asks every time unless `--yes`.
5. Repo `glm-harness`, binary `glmh`. Rename before 1.0 is cheap if needed.
