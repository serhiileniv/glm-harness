<div align="center">

<pre>
 ██████╗ ██╗     ███╗   ███╗██╗  ██╗
██╔════╝ ██║     ████╗ ████║██║  ██║
██║  ███╗██║     ██╔████╔██║███████║
██║   ██║██║     ██║╚██╔╝██║██╔══██║
╚██████╔╝███████╗██║ ╚═╝ ██║██║  ██║
 ╚═════╝ ╚══════╝╚═╝     ╚═╝╚═╝  ╚═╝
</pre>

<h3>The coding agent that costs nothing.</h3>

<p>Open source. Runs on a free API key you own. No subscription, no card, no account, no telemetry.</p>

<p>
<a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-2ea44f"></a>
<img alt="Price: $0" src="https://img.shields.io/badge/price-%240-2ea44f">
<img alt="Runtime: Bun 1.3+" src="https://img.shields.io/badge/runtime-Bun%201.3%2B-000000">
<img alt="Model: free GLM tier" src="https://img.shields.io/badge/model-free%20GLM%20tier-1f6feb">
<img alt="Tests: 76 passing" src="https://img.shields.io/badge/tests-76%20passing-2ea44f">
</p>

</div>

Paid coding agents cost 20 to 200 dollars a month. glmh gives students, people between jobs,
and anyone learning to code the same kind of tool for free: a full-screen terminal agent that
reads your repository, edits files, runs your tests and fixes what it broke. It is built around
the free GLM model that Z.ai publishes with open weights and a permanent free API, GLM-4.7-Flash
today, and it moves to the next free model when they ship one.

```
you › make the failing test in auth pass
      thinking (312 chars) · /think
  → grep /describe\("auth/ in test
    ✓ 3 matches
  → read test/auth.test.ts from line 40
    ✓ test/auth.test.ts: lines 40-139 of 210
  → edit src/auth.ts · 3 lines → 5
    ✓ Edited src/auth.ts: replaced 3 lines at line 88 with 5. syntax check: ok (ts)
  → $ bun test test/auth.test.ts
    ✓ exit code 0, 1.9s
glm › The token check compared expiry in seconds against a millisecond timestamp. Fixed the
      unit and added the missing null guard. All 14 auth tests pass.
  ✓ done · 48s · 5 requests · 4 tool calls · 11,208 in / 1,412 out
    today 23 / ~1000 requests · about 120 more tasks like this one
```

## Two minutes to your first task

**1. Get a free key.** Register at [z.ai/model-api](https://z.ai/model-api) with an email and
create a key at [z.ai/manage-apikey/apikey-list](https://z.ai/manage-apikey/apikey-list).
Other free sources are listed below.

**2. Install.** Requires [Bun](https://bun.sh) 1.3 or newer. Homebrew formula and one-line
installer arrive with the first release.

```sh
git clone https://github.com/serhiileniv/glm-harness
cd glm-harness && bun install && bun run build
ln -s "$PWD/dist/glmh" ~/.local/bin/glmh     # or anywhere on your PATH
glmh init                                    # paste the key; it runs a test call
```

**3. Run it in any repository.**

```sh
cd ~/code/my-project
glmh                                    # full-screen session
glmh "explain what this project does"   # one task, plain output, scriptable
```

## What you get

| | |
| --- | --- |
| **A real agent** | Reads, searches, edits and writes files, runs commands, in the repo you start it in. |
| **Self-checking edits** | Every edit is syntax-checked before the model sees the result. After changes it runs your tests and fixes what failed. |
| **A proper terminal UI** | Streamed output, live command logs, the edited lines under each change, scrollback, history, Esc to cancel. |
| **You stay in control** | It asks before every command. `y`, `n`, or `a` to stop asking for the session. It never commits, pushes, or runs destructive commands. |
| **No artificial limits** | The model gets its full context window. A task runs until it is done, not until a turn counter says stop. |
| **Quota you can see** | Usage for the day is printed after every task. |

Session keys: **Enter** sends, **Esc** cancels, **PgUp/PgDn** scroll, **Up/Down** history.
Commands: `/diff` `/reset` `/yes` `/think` `/copy` `/usage` `/help` `/quit`.

## Where to get a free key

| Provider | Sign up | Model id | Base URL |
| --- | --- | --- | --- |
| **Z.ai**, the model's authors | [z.ai/model-api](https://z.ai/model-api) | `glm-4.7-flash` | `https://api.z.ai/api/paas/v4` |
| ZenMux | [zenmux.ai/platform/pay-as-you-go](https://zenmux.ai/platform/pay-as-you-go), allow `z-ai/glm-4.7-flash-free` on the key | `z-ai/glm-4.7-flash-free` | `https://zenmux.ai/api/v1` |
| Cloudflare Workers AI | [dash.cloudflare.com](https://dash.cloudflare.com), Workers AI, free daily allocation | `@cf/zai-org/glm-4.7-flash` | Workers AI OpenAI-compatible endpoint |
| BigModel, China | [open.bigmodel.cn](https://open.bigmodel.cn) | `glm-4.7-flash` | `https://open.bigmodel.cn/api/paas/v4` |

`glmh init` has presets for Z.ai and ZenMux and accepts any OpenAI-compatible URL, including a
local llama.cpp or Ollama server running the same open weights.

## Why a small free model does well here

Most agents are built for the largest paid models. glmh is built for one open model and speaks
its language: its native tool-call protocol, its reasoning carried across turns the way its
authors run their own benchmarks, its sampling settings. Every design choice inside the tools
comes from published agent research, and the loop spends as few requests per task as it can,
because on a free tier the request count is what runs out. The fixture tasks in `eval/` solve
in 5 to 9 requests each.

## Built to be rebuilt

glmh is a free module, not a product. Fork it, strip it, port it, ship it under another name.

- `profiles/glm-4.7-flash.toml`: everything model-specific in one file. A new model is a new profile.
- `src/tools/`: six small tools with measured design choices.
- `src/loop.ts`: the whole agent loop in one file.
- `eval/`: real tasks against your key, reporting requests per task.
- `docs/`: research, spec, architecture, and every decision with its reason.

If you make it more efficient, send the eval numbers with the change.

## Privacy

Your prompts and the file contents the agent reads go to the endpoint you configured and
nowhere else. Z.ai states that API content is not stored and is processed in Singapore. glmh
never reads `.env`, key or credential files unless you pass `--allow-secrets`, and keeps your
API key in `~/.config/glmh/config.toml` with owner-only permissions. Do not paste secrets into a
task.

## FAQ

**Is it really free?** Yes. The model's free tier is permanent, the code is MIT, and glmh has
no account, plan or upsell. Your only cost is a free API key in your name.

**Do I need a GPU?** No. The model runs on the provider's side. Any laptop works.

**Can I use my own local model server?** Yes. Point `glmh init` at any OpenAI-compatible URL.

**What if Z.ai releases a new free model?** glmh gets a new profile and moves to it. Nothing in
the code is tied to the version number.

## Development

```sh
bun test           # 76 tests, no network needed
bun run typecheck
bun run eval       # fixture tasks against your configured endpoint
```

## License

MIT. The model weights are MIT too, released by Z.ai.
