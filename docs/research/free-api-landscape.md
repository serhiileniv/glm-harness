# Free API landscape for agentic coding, 2026-09-15

Question: is there any free endpoint a coding agent can call without meaningful limits?
Answer: no. The year closed several: Qwen free OAuth (2026-04-15), GitHub Models (2026-07-30),
Cerebras permanent free tier (now a 30-day $5 trial), Mistral 1B tokens/month (now $10/month
credits since 2026-09-03).

Unit of measure: one agent task ≈ 30 requests and 400k to 600k input tokens, because context
is resent every turn.

| Endpoint | Model(s) | Per-key limit | Agent tasks/day | Notes |
| --- | --- | --- | --- | --- |
| Z.ai free | GLM-4.7-Flash | ~1,000 req/day (community), 1 concurrent, no token cap | ~30 | email signup, no card, content not stored, Singapore |
| Google AI Studio | Gemini 3 Flash, 3.1 Flash-Lite, Gemma 4 | ~250 to 1,500 req/day, 250k TPM, 10 to 15 RPM | ~5 to 15 | prompts used to improve products; has excluded parts of Europe before |
| OpenRouter free | rotating: Gemma 4, North Mini Code, Nemotron 3.x | 20 RPM, 50 req/day; 1,000/day after $10 once | 1 to 2 (30 after $10) | GLM Flash is paid there; providers may log |
| Groq free | gpt-oss-120b/20b, Qwen3.8-27B | 30 RPM, 1,000 RPD, 8k TPM, 200k TPD | 0 | 8k TPM rejects agent-sized requests |
| Mistral | all models | $10/month credits | ~4 on Devstral Small 2 | changed 2026-09-03 |
| NVIDIA NIM | Nemotron, Qwen, others | 40 RPM, credit pool, unpublished | unknown | no increases granted |
| Cohere trial | North Mini Code | 20 RPM, 1,000 calls/month | ~1 | trial terms |
| Cloudflare Workers AI | GLM-4.7-Flash, gpt-oss | 10,000 neurons/day ≈ 250k output tokens | <1 | needs CF account |
| Cerebras | gpt-oss-120b, Qwen3.8-27B | $5 trial, 30 days | n/a | no longer permanent |

Stacking keys: Z.ai + OpenRouter free + Groq free ≈ 32 tasks/day instead of 30, three signups,
two different models. Not worth it. A second endpoint is a fallback for "keep working after the
cap", not capacity.

Only local inference is unlimited. On a 24 GB Mac GLM-4.7-Flash fits at 16k context with MLX
4-bit (16.9 GB) or a small GGUF quant; the Ollama q4_K_M build (19 GB) does not leave room under
the 20 GB Metal limit.

## Models seen during the search that are open, laptop-size and on a free API

| Model | Size | License | Free API | Note |
| --- | --- | --- | --- | --- |
| GLM-4.7-Flash | 30B-A3B | MIT | Z.ai | chosen |
| Gemma 4 26B-A4B | 26B-A4B | Apache 2.0 | AI Studio, OpenRouter | weakest coder; fallback profile |
| North Mini Code 1.0 | 30B-A3B | Apache 2.0 | OpenRouter, Cohere trial | built for agentic coding, coding index 33.4 vs GLM Flash 25.9 |
| Nemotron 3.5 Lightning | 30B-A3B | OpenMDW 1.1 | OpenRouter, NVIDIA NIM | SWE-bench Verified 51.6, Terminal-Bench 24.6 |

## Sources
- https://docs.z.ai/guides/overview/pricing
- https://openrouter.ai/docs/api-reference/limits
- https://openrouter.ai/collections/free-models
- https://inference-docs.cerebras.ai/support/rate-limits
- https://console.groq.com/docs/rate-limits
- https://ai.google.dev/gemini-api/docs/pricing
- https://tinkerllm.com/blog/gemini-api-free-tier-limits-rate-quotas/
- https://agentdeals.dev/vendor/mistral-ai
- https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models
- https://github.com/QwenLM/qwen-code/issues/3203
- https://forums.developer.nvidia.com/t/clarity-on-nim-api-free-tier-rate-limit-increases/369624
- https://docs.cohere.com/docs/rate-limits
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://huggingface.co/blog/CohereLabs/introducing-north-mini-code
- https://artificialanalysis.ai/articles/north-mini-code-cohere-s-small-coding-focused-moe-model
- https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16
