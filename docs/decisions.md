# Decision log

One entry per decision: what, why, what was rejected. Dates absolute. Newest last.

## D1 · 2026-09-15 · Build a model-specific harness, not a generic one
Why: same model, different harness moves pass@1 by 12 to 27 points; small models are the most
harness-sensitive; generic harnesses resend long prompts and many schemas every turn, which on a
free key is the user's daily quota.
Rejected: fork OpenCode or Qwen Code (generic prompt and tool set, token-hungry); use Qwen Code as is.

## D2 · 2026-09-15 · Model: GLM-4.7-Flash
Why: MIT weights, irrevocable. 30B total, 3B active. Best agentic scores in its class among models
with a free API. The only free API with no token cap. Tool format is XML built for raw code.
Preserved thinking across tool turns. API content not stored, processed in Singapore.
Rejected: Qwen3.5/3.8 (free OAuth closed 2026-04-15; Qwen Code exists). Devstral (Mistral free tier
became $10/month credits on 2026-09-03). gpt-oss-20b (weaker agentic; Groq free unusable for agents).
Gemma 4 (weakest coder of the set; kept as fallback). North Mini Code and Nemotron 3.5 Lightning
(good models, no better free API; candidates for a later eval). GLM-5.3-Flash (320B, paid API).

## D3 · 2026-09-15 · Access: each user's own Z.ai free key. Local is an optional endpoint
Why: audience is students and people without money or hardware. One key gives about 30 agent
tasks a day, 1 concurrent request, email signup, no card. Local runs are not orchestrated by the
harness; any OpenAI-compatible URL can be configured.
Rejected: local-first (24 GB Macs: 19 GB weights against a 20 GB Metal limit). Stacking OpenRouter
and Groq free keys (adds about 2 tasks a day; Groq's 8k tokens per minute rejects agent-sized
requests; different models break the tuning).

## D4 · 2026-09-15 · The bet is on released weights and today's free API, not on Z.ai's future
Why: GLM-5.3-Flash is paid and 320B. The 5.3 flagship shipped under a non-MIT license. Zhipu is a
public company since January 2026. A future model earns the slot by beating 4.7-Flash on the eval.

## D5 · 2026-09-15 · Six tools: read, edit, write, grep, search, bash
Why: a real edit tool is the difference between 19 and 73 percent pass@1. A 100-line read window
beats 30 lines by 3.7 points and whole files by 5.3. Grep capped at 50 hits beats iterative search
by 6 points. Fewer, consolidated tools help small models most.
Rejected: bash only (works for frontier models, not a 30B). Batched multi-edit (v2 if the eval
shows edits dominate turn count).

## D6 · 2026-09-15 · One OpenAI-compatible code path plus a fallback tool-call parser
Why: Z.ai, llama.cpp and Ollama all expose the same surface. The fallback parser for
`<tool_call>` text leaking into content is cheap insurance against endpoint parser gaps.

## D7 · 2026-09-15 · Preserved thinking on, vendor sampling, reply ceiling
Why: vendor uses preserved thinking for SWE-bench and Terminal-Bench. temperature 0.7, top_p 1.0,
repeat penalty off are their settings; the penalty causes its looping. The reply ceiling was
raised to the model's maximum in D22; truncation recovery stays for the rare clamp.

## D8 · 2026-09-15 · Deterministic context management, no LLM summaries in v1
Why: keep last 5 tool results in full, collapse older ones to one line (+3 points), prune whole
turns, cap tool output at 8k chars, staged compaction. Predictable and debuggable.

## D9 · 2026-09-15 · Quota is a first-class UI element; diet defaults; privacy guardrails
Why: students feel the daily cap directly. Show requests used today and tasks left. Defaults:
100-file repo map, 3 s request gap. Context and turn limits were removed the same day (D22). Init screen states where code goes; `.env` and key
files are never read unless named explicitly.

## D10 · 2026-09-15 · Eval before features; every run logged as JSONL
Why: every lever is a hypothesis until it moves pass@1 or requests per task on the same tasks.
Baselines: OpenCode, Qwen Code, mini-swe-agent on the same endpoint.

## D11 · 2026-09-15 · TypeScript on Bun, single binary, Homebrew tap and curl | sh
Why: no runtime for users to install; the maintainer's stack and existing tap.

## D12 · 2026-09-15 · Name: repo `glm-harness`, binary `glmh`
Why: honest and searchable. Caveats: borrows Z.ai's brand; ties identity to one vendor. Placeholder
until 1.0; renaming is cheap.

## D13 · 2026-09-15 · Second free endpoint is a v2 "keep working" fallback, not a multiplier
Why: OpenRouter free rotates models monthly and carries no GLM Flash. A generic profile there
keeps a student working after the Z.ai daily cap; it does not add meaningful capacity.

## D14 · 2026-09-15 · Termination is "no tool call", then one check run and at most two repairs
Why: no extra `done` tool for the model to misuse. The harness owns verification.

## D15 · 2026-09-15 · Efficiency metric: requests per solved task first, tokens second
Why: Z.ai caps requests, not tokens. Halving turns per task doubles tasks per day per key.

## D16 · 2026-09-15 · Z.ai direct is the default preset; ZenMux is the fallback
Why: both reach the same model with the same profile. Measured on 2026-09-15: the ZenMux free
route returned "You have reached the usage limit for the current free model" after roughly 15
requests inside 20 minutes, with no reset header; a third party observed the same wall and
assumes a one-hour cooldown. That is a few agent turns an hour. Z.ai direct is community-reported
at about 1,000 requests a day. ZenMux stays as preset 2 for users who cannot register at Z.ai.
Caveat: ZenMux keys carry a per-key allowed-model list that must include the free route.

## D17 · 2026-09-15 · Non-streaming requests in the MVP
Why: tool calls and reasoning deltas in a stream are extra parsing surface for no quota gain.
Streaming's only benefit is perceived latency; a spinner with elapsed seconds covers that.
Streaming is verified to work on the route (TTFT 11.6 s when busy) and is a v2 item.

## D18 · 2026-09-15 · Endpoint health is decided by a real chat call, never by the model list
Why: Z.ai's `GET /models` omits the free Flash models while `POST /chat/completions` serves them.
`init` and `doctor` report the list as information and pass or fail on the chat and tool-call tests.

## D19 · 2026-09-15 · Hand-rolled TUI and streaming, no UI library
Why: Ink needs yoga WASM and misbehaves in raw mode under the Bun compiler; OpenTUI is a native
addon. About 900 lines of our own code keep the single-file, zero-dependency binary. Streaming
shipped with it because a full-screen frame around a 40-second spinner is not an improvement.
Rendering is a full-frame overwrite with clear-to-EOL per row, coalesced to 30 fps, never a clear.

## D20 · 2026-09-15 · TUI defaults
`glmh "task"` in a terminal stays a plain one-shot; `--tui "task"` opens the session with the task.
Reasoning is collapsed to one line, `/think` expands it. Ctrl-C twice within a second quits, as do
`/quit` and Ctrl-D. Esc cancels the current run and the partial turn is discarded.

## D21 · 2026-09-15 · TUI polish rules
Markdown in model output is rendered (headings, bullets, numbered lists, fenced code with a
gutter, bold, inline code); everything else is shown verbatim. Tool calls read as a colleague
would say them (`read math.ts from line 40`, `$ bun test`, `edit a.ts · 3 lines → 4`) and their
result line is the tool's own first line, or the exit status for bash. The done footer never
repeats the answer that is already on screen. Transcript text wraps at 110 columns even on wide
terminals, because long prose lines are hard to read. A dim rule separates tasks.

## D22 · 2026-09-15 · Full context window, no turn cap, reply ceiling at the model's maximum
Decision by the maintainer, reaffirmed after the trade-offs were stated. Why the trade-offs do
not bite: the free API caps requests per day, not tokens, so window size is free on the quota and
costs only prefill time, which Z.ai's prefix cache reduces; the doom-loop detector and Esc are the
guards against a stuck model, and a turn cap that stops at 20 wastes the 20 requests already
spent. Implementation: context 200,000 of the model's 202,752; max_tokens 128,000 clamped per
request to the window left after the prompt; compaction budget keeps a 16k reply reserve; Recorded risk:
history compaction, measured at +3 points on SWE-agent, now almost never triggers; revisit if the
eval regresses on long tasks.

## D23 · 2026-09-15 · Second TUI polish round
Live tail of a running command under its tool line, a glimpse of the last reasoning line while
the model thinks, the edited region under edit and write results, a timestamped rule between
tasks, git branch and dirty count in the header, `a` = approve and stop asking for the session,
`/copy` and `/usage`.

## D24 · 2026-09-15 · No turn limit exists, anywhere
Maintainer's decision, stated three times. `max_turns` is removed from the profile, config, CLI,
loop, TUI and eval runner. A run ends when the model gives a final answer, when the doom-loop
detector sees the same action three times, on an endpoint error, or when the user presses Esc.
Context is the model's full 202,752-token window. The only size number left is the API's own
max output field, set to the model's maximum and clamped per request so the call stays valid.
