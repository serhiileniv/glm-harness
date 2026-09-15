# Architecture

Thin single-binary client. One protocol, one model profile, six tools, a deterministic loop.
Nothing in the codebase outside `profiles/` and `parser.ts` knows which model it talks to.

## Modules

```
src/
  cli.ts          init | doctor | run "task" | repl        argument parsing, output
  config.ts       ~/.config/glmh/config.toml + ./glmh.toml  endpoint, key, limits, check command
  profile.ts      profiles/glm-4.7-flash.toml (bundled)     sampling, thinking, prompt, caps
  client.ts       OpenAI-compatible chat, serialised, 429 backoff, reasoning_content passthrough
  parser.ts       fallback <tool_call> XML parser for text leaks
  loop.ts         turn loop, doom-loop detector, truncation recovery, termination, check + repair
  context.ts      token budget, collapse old results, prune whole turns, staged compaction
  tools/          read, edit, write, grep, search, bash, syntax check, registry + schemas
  repomap.ts      git ls-files tree ≤ 100 files + README head
  approvals.ts    y/n prompts, deny-list, project-root boundary, secret-file filter
  trajectory.ts   JSONL run log + usage counter
  check.ts        detect project check command
  tokens.ts       chars/4 estimate
eval/
  run.ts          task runner, metrics, baselines
  tasks/<id>/     task.md, setup.sh, check.sh
profiles/
  glm-4.7-flash.toml
```

## One turn

```
messages ──► context.fit(budget) ──► client.chat(profile, tools)
                                          │
              ┌──── tool_calls present? ───┴──── no ────► final answer ──► check.run()
              │                                                          │ pass → done
              ▼                                                          │ fail (≤2) → inject failure, loop
   approvals.gate(call) ─► tools.exec(call) ─► truncate(8k) ─► observation
              │
   doom-loop? duplicate read? ─► inject note
              ▼
   append assistant{content, reasoning_content, tool_calls} + tool results ─► trajectory.log ─► loop
```

Parallel tool calls in one response are executed in order and returned as one batch of tool
messages, one request saved per extra call.

## Request shape (Z.ai)

```json
{
  "model": "glm-4.7-flash",
  "messages": [...],
  "tools": [...],
  "tool_choice": "auto",
  "temperature": 0.7,
  "top_p": 1.0,
  "max_tokens": 6000,
  "thinking": {"type": "enabled"},
  "clear_thinking": false
}
```

Assistant messages are appended exactly as returned, including `reasoning_content`, so the
model keeps its reasoning across tool turns. For a local endpoint the profile swaps the last two
fields for `chat_template_kwargs: {enable_thinking: true, clear_thinking: false}`.

## Error handling

| Event | Action |
| --- | --- |
| 429 | wait 2, 4, 8, 16, 32 s; then stop with quota message |
| 5xx, network | retry 3 times, 2 s apart |
| finish_reason = length | append partial content, inject "Your reply was cut off. Call a tool now." |
| tool_calls missing but `<tool_call>` in content | fallback parser; count as malformed in metrics |
| malformed arguments | tool returns an error that names the missing or wrong field |
| identical call twice in a row | inject warning; three times stop the run |
| same read on an unchanged file | respond "unchanged since turn N" |

## Context budget

```
budget   = context_tokens − reply_reserve − 1000     # reply max_tokens is clamped per request to the window left
always   = system prompt, first user message, last 5 tool results
stage 1  at 70%  collapse tool results older than last 5 to one line
stage 2  at 85%  drop oldest assistant+tool turn groups after the first user message,
                 insert one "[earlier turns pruned]" note
stage 3  at 95%  cap remaining tool results at 2k chars
```

Never drop a tool call without its result, or a result without its call.

## Files

`~/.config/glmh/config.toml` (mode 600)
```toml
[endpoint]
kind = "zai"                      # zai | openai
base_url = "https://api.z.ai/api/paas/v4"
api_key = "..."
model = "glm-4.7-flash"
[limits]
context_tokens = 202752
```

`./glmh.toml` (optional, per project)
```toml
check = "bun test"
context_tokens = 32000
```

`~/.local/share/glmh/runs/<project-hash>/<timestamp>.jsonl`: one line per event
(`request`, `response`, `tool_call`, `tool_result`, `note`, `done`) with token counts and timing.

`~/.local/share/glmh/usage.jsonl`: one line per request, used by `doctor` and the post-run
quota line.

## Quota UI

After every run: `requests today: 143 / ~1000 · this run: 18 · est. tasks left: ~45`.
Warn at 80 percent. The daily estimate is configurable because Z.ai does not publish it.

## Security

- Key stored 600, never logged, never in trajectories.
- No network except the configured endpoint.
- `bash` and writes outside the project root prompt unless `--yes`. Deny-list always prompts.
- Never read `.env*`, `*.pem`, `*.key`, `id_*`, `*secret*` unless named explicitly in the task.
- Init screen states where code goes and that it is not stored per provider policy.

## Build and release

`bun build --compile` per target: darwin-arm64, linux-x64. Homebrew formula in the existing
tap; `curl | sh` for Linux. Version and profile hash printed by `glmh doctor`.
