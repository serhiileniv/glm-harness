# GLM-4.7-Flash: research for a model-specific coding harness

Date: 2026-09-15. Everything here is from the model card, config, chat template,
runtime bug trackers, and harness papers. Vendor benchmark numbers are unverified.

## 1. Model facts

| Fact | Value | Source |
| --- | --- | --- |
| Params | 31B total, 3B active (vendor), ~3.6B with shared expert | HF card, Unsloth |
| Layers | 47, first layer dense, rest MoE | config.json |
| Experts | 64 routed, 4 per token, 1 shared | config.json |
| Attention | MLA: q_lora_rank 768, kv_lora_rank 512, rope dim 64, 20 heads | config.json |
| Context | 202,752 | config.json |
| Vocab | 154,880 | config.json |
| License | MIT | HF card |

Vendor benchmarks: SWE-bench Verified 59.2, τ²-Bench 79.5, LiveCodeBench v6 64.0,
BrowseComp 42.8, AIME25 91.6, GPQA 75.2, HLE 14.4.

Vendor eval settings, the ones to copy:

| Task class | temp | top_p | max new tokens | thinking |
| --- | --- | --- | --- | --- |
| SWE-bench, Terminal-Bench | 0.7 | 1.0 | 16,384 | preserved, on |
| τ²-Bench | 0 | – | 16,384 | preserved, on |
| general | 1.0 | 0.95 | 131,072 | on |

Unsloth adds: min_p 0.01, repeat penalty off (1.0).

Training facts that shape the harness (GLM-4.5 paper, same lineage):
- RL on GitHub issues and PRs with executable tests in a sandbox. Evaluated in
  OpenHands v0.34.0 with a 100-iteration limit.
- Tool-call format is XML-like on purpose: code arguments need no JSON escaping.
- Format errors halted the episode with zero reward. The model is trained to be
  format-strict when given its own protocol.

## 2. Native protocol (chat_template.jinja)

- Prefix `[gMASK]<sop>`; roles `<|system|>`, `<|user|>`, `<|assistant|>`, `<|observation|>`.
- Tools go into the system prompt inside `<tools>…</tools>`, one JSON object per tool.
- Model emits: `<tool_call>NAME<arg_key>K</arg_key><arg_value>V</arg_value>…</tool_call>`.
- Result goes back as `<|observation|><tool_response>…</tool_response>`.
- Thinking is `<think>…</think>`. Template vars: `enable_thinking`, `clear_thinking`
  (false = keep previous turns' reasoning = "preserved thinking").
- Over the OpenAI-style API: return `reasoning_content` unmodified on assistant
  messages that carry `tool_calls`; `thinking: {type: enabled|disabled}`;
  `clear_thinking: false` for preserved mode.

## 3. Strengths to exploit

1. **Tool use is its best skill.** τ²-Bench 79.5 is far above its class. Use native
   tool calls, never text-parsing hacks.
2. **Preserved and interleaved thinking.** Vendor says turn it on for multi-turn
   agentic work. The harness must carry reasoning across tool turns.
3. **XML arguments carry raw code.** Search-and-replace edits with unescaped code
   are the format it was trained on.
4. **MLA makes long context cheap** when the runtime implements it: 54 KB per token.
5. **Fast.** 3B active. Community reports 13 to 32 tok/s on mixed hardware under
   llama.cpp; MLX is typically 2 to 3x faster on MoE models on Apple silicon.
6. **Format-strict by training.** Give it exactly its own protocol and it complies.

## 4. Weaknesses to design around

| Symptom | Where seen | Harness answer |
| --- | --- | --- |
| Stops after emitting a tool call | Ollama issue 13840 | Harness owns the turn loop; never rely on runtime "continue" |
| Tool-call parse failures, XML errors | Claude Code reports, vLLM issue 36833 | Runtime-native parser plus a fallback parser for leaked `<tool_call>` text |
| Looping, repetition | HN, Unsloth (gating bug fixed Jan 21 in GGUFs) | Fixed GGUFs; repeat penalty off; doom-loop detector |
| Garbled identifiers in output | HN | Syntax check after every edit; tests before done |
| Weaker instruction following than Claude | HN | Prompt under 500 tokens; rules live in tool descriptions |
| Weaker repo-scale reasoning | benchmarks | Repo map, capped search, harness-side decomposition |
| Long thinking | vendor cap 16k | Per-turn max_tokens; truncation recovery message |

## 5. Runtime constraints, reference machine

Reference: MacBook Pro M5 Pro, 24 GB unified, Metal wired limit 20,480 MB (measured).

KV cache per token: 54 KB with MLA, 0.91 MB without (HF discussion 3).

| Context | KV with MLA | KV without MLA |
| --- | --- | --- |
| 16k | 0.9 GB | 14.5 GB |
| 32k | 1.7 GB | 29 GB |

Runtime MLA status:

| Runtime | MLA cache | Notes |
| --- | --- | --- |
| llama.cpp | yes, PR 18953 merged 2026-01-22 | CUDA: FA + quantized KV crashes (issue 19307, closed not planned). Use f16 KV. Metal: verify locally |
| ik_llama.cpp | yes | community-confirmed |
| vLLM | missed at launch, fix pending at time of thread | server only |
| MLX | unverified | mlx-community 4-bit exists, 16.9 GB, mlx-lm 0.30.5 |
| Ollama | uses llama.cpp | native `RENDERER glm-4.7` / `PARSER glm-4.7` since 0.14.3; Unsloth still says "not recommended"; verify on 0.33.2 |

Memory budget on the reference machine:

| Build | Weights | + 32k KV | Fits 20 GB wired limit |
| --- | --- | --- | --- |
| Ollama q4_K_M | 19 GB | 20.7 GB | no |
| Unsloth UD-Q4_K_XL | ~18 GB | 19.7 GB | borderline |
| MLX 4-bit | 16.9 GB | 18.6 GB | yes |

Conclusion: 32 GB machines are comfortable. 24 GB machines need MLX or a smaller
GGUF quant, and 16k is the safe default. 16 GB machines cannot run it locally and
should use the free API.

llama.cpp flags to start from:

```
llama-server -m <gguf> --jinja --reasoning-format auto -fa on -ctk f16 -ctv f16 \
  --ctx-size 16384 --temp 0.7 --top-p 1.0 --min-p 0.01 --repeat-penalty 1.0 \
  --chat-template-kwargs '{"clear_thinking":false}'
```

Add `--override-kv deepseek2.expert_gating_func=int:2` only for GGUFs built
before 2026-01-21.

Ollama library tags: latest = q4_K_M 19 GB, q8_0 32 GB, bf16 60 GB, 198k context.

## 6. Free hosted access

| Channel | Limit | Preserved thinking |
| --- | --- | --- |
| Z.ai `https://api.z.ai/api/paas/v4/`, model `glm-4.7-flash` | free, 1 concurrent request, no published daily cap | `reasoning_content` round-trip + `clear_thinking:false`; Flash not explicitly listed in thinking docs, verify with a key |
| Cloudflare Workers AI `@cf/zai-org/glm-4.7-flash` | 10,000 neurons/day free ≈ 250k output or 1.8M input tokens | unknown |
| OpenRouter | paid, ~$0.06 in / $0.40 out per M | n/a |

Z.ai privacy policy: API content not stored, processed in Singapore.

## 7. What moves the number: harness research

- **Claw-SWE-Bench (2606.12344).** Same model, five harnesses: 60.9 to 73.4 pass@1
  on GLM-5.1; 27.4-point spread on Qwen 3.6-flash. Smaller models are more
  harness-sensitive. A bare adapter scored 19.1 with 69% of patches failing to
  apply; a real edit tool plus git-state patch extraction scored 73.4.
- **SWE-agent ACI (2405.15793).** File viewer of 100 lines (30 lines: −3.7,
  whole file: −5.3). Search capped at 50 hits, otherwise "narrow the query"
  (iterative search: −6.0). Edit with lint guardrail (+3.0). Keep last 5
  observations in full, collapse older ones to one line (+3.0). Principles:
  simple actions, consolidated operations, informative feedback, guardrails.
- **mini-swe-agent.** Bash only, linear history, >74% SWE-bench Verified with
  frontier models. Simplicity is enough when the model is strong; the ACI gains
  above are what a 30B model needs on top.
- **Anthropic, writing tools for agents.** Few consolidated tools. Unambiguous
  parameter names. Concise responses (72 vs 206 tokens for the same fact).
  Errors that say what to do next. Description quality moved evals to SOTA.
- **Terminal agents paper (2603.05344).** Provider-conditional prompt sections.
  Staged compaction, not cliff truncation. Per-tool-type truncation with hints.
  Offload big outputs to disk. Doom-loop detection separate from turn caps.
  Detect server-like commands and background them.
- **Local-model harness lessons (orion-core).** Match the template exactly.
  Liberal parser. Prune whole turns, never single messages. Cache the prefix.
  Eight-iteration default cap.
- **Aider edit formats.** Search-and-replace "diff" is the default for most
  models; whole-file only for the weakest; unified diff is for large models.

## 8. Settle by measurement, not opinion

1. Native `<tool_call>` XML through runtime parsers vs harness-side rendering and parsing: malformed-call rate.
2. Thinking on vs off per turn; preserved vs cleared: pass rate and tokens.
3. Ollama vs llama.cpp vs MLX on the reference Mac: tok/s, memory, tool-call correctness.
4. Edit tool: exact search-and-replace vs line-range replace: apply-failure rate.
5. 16k vs 32k context: pass rate on the eval set.

## Sources

- https://huggingface.co/zai-org/GLM-4.7-Flash
- https://huggingface.co/zai-org/GLM-4.7-Flash/raw/main/config.json
- https://huggingface.co/zai-org/GLM-4.7-Flash/raw/main/chat_template.jinja
- https://huggingface.co/zai-org/GLM-4.7-Flash/discussions/3
- https://github.com/ggml-org/llama.cpp/pull/18953
- https://github.com/ggml-org/llama.cpp/issues/19307
- https://github.com/ollama/ollama/issues/13840
- https://github.com/vllm-project/vllm/issues/36833
- https://huggingface.co/unsloth/GLM-4.7-Flash-GGUF/discussions/23
- https://unsloth.ai/docs/models/tutorials/glm-4.7-flash
- https://ollama.com/library/glm-4.7-flash/tags
- https://huggingface.co/mlx-community/GLM-4.7-Flash-4bit
- https://docs.z.ai/guides/capabilities/thinking-mode
- https://docs.z.ai/guides/overview/pricing
- https://docs.z.ai/legal-agreement/privacy-policy.md
- https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://arxiv.org/html/2606.12344v1
- https://arxiv.org/html/2405.15793
- https://arxiv.org/html/2508.06471
- https://arxiv.org/html/2603.05344v1
- https://github.com/SWE-agent/mini-swe-agent
- https://www.anthropic.com/engineering/writing-tools-for-agents
- https://aider.chat/docs/more/edit-formats.html
- https://blog.anirudha.dev/orion-core/
- https://news.ycombinator.com/item?id=46679872

## 9. Verified against the free endpoint, 2026-09-15

Route: ZenMux `z-ai/glm-4.7-flash-free` (proxies Z.ai), OpenAI-compatible, key prefix `sk-ai-v1-`.
Keys carry a per-key allowed-model list; the free route must be on it or every call is 403.

| Probe | Result |
| --- | --- |
| Plain completion | 200; 2.7 s warm, 20 to 42 s cold or queued |
| Native tool call | `tool_calls` array returned, `finish_reason: tool_calls` |
| Reasoning | happens (56 to 77 reasoning tokens) and comes back in a field named `reasoning`, not `reasoning_content` |
| Round trip after tool result | works; 3.3 s |
| Parallel tool calls | yes: two `read` calls in one response when asked |
| Streaming | works; time to first token 11.6 s while busy; reasoning deltas present |
| Concurrency and pacing | second concurrent request 429; sequential calls 3 s apart still 429 after two successes; 429 clears on a 3 to 5 s wait |
| 429 body | "该模型当前访问量过大，请您稍后再试": upstream busy, not a per-key quota message |

Design consequences applied: requests serialised with a 3 s minimum gap and exponential backoff;
client reads `reasoning` or `reasoning_content`; assistant messages are sent back with
`reasoning_content` when present; the spinner shows elapsed time because a cold turn can take a minute.

ZenMux free-route quota, measured the same day: after about 15 requests within 20 minutes the
429 body changed from the upstream "model busy" text to "You have reached the usage limit for the
current free model", with no reset header. A third-party operator saw the same wall and benches
the route for an hour. Conclusion: ZenMux is a fallback; Z.ai direct is the primary preset.

Z.ai direct, measured 2026-09-15 with a fresh key: `GET /models` lists ten models (glm-4.5 through
glm-5.3-flash) and omits `glm-4.7-flash` and `glm-4.5-flash`, yet both answer `POST /chat/completions`
with 200. Flash 4.7 replied in 1.4 s warm. Do not gate on the model list; gate on a real call.
