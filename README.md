```
 ██████╗ ██╗     ███╗   ███╗██╗  ██╗
██╔════╝ ██║     ████╗ ████║██║  ██║
██║  ███╗██║     ██╔████╔██║███████║
██║   ██║██║     ██║╚██╔╝██║██╔══██║
╚██████╔╝███████╗██║ ╚═╝ ██║██║  ██║
 ╚═════╝ ╚══════╝╚═╝     ╚═╝╚═╝  ╚═╝
```

**A free coding agent for your terminal.** Open source, MIT, no subscription, no credit card,
no account with me, no telemetry. It runs on a free API key that you get yourself in two
minutes.

I built it for people who cannot pay for Claude Code, Cursor or Copilot: students, people
between jobs, anyone learning to code. glmh is built around the free GLM model that Z.ai
publishes with open weights and a permanent free API, GLM-4.7-Flash today. When they ship the
next free model, glmh moves to it. The model lives in one profile file; nothing else knows its
name.

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

## Get started

**1. Get a free key** from any provider in the table below. Z.ai is the source and the best
one to start with: register with an email, create a key, done.

**2. Install.** You need [Bun](https://bun.sh) 1.3 or newer. A Homebrew formula and a
one-line installer come with the first release.

```sh
git clone https://github.com/serhiileniv/glm-harness
cd glm-harness && bun install && bun run build
ln -s "$PWD/dist/glmh" ~/.local/bin/glmh     # or anywhere on your PATH
glmh init                                    # paste the key; it runs a test call
```

**3. Use it inside any repository.**

```sh
cd ~/code/my-project
glmh                                    # full-screen session: type a task, press Enter
glmh "explain what this project does"   # one task, plain output, scriptable
```

Inside the session: **Enter** sends, **Esc** cancels the current run, **PgUp/PgDn** scroll,
**Up/Down** recall earlier tasks. Commands: `/diff`, `/reset`, `/yes`, `/think`, `/copy`,
`/usage`, `/help`, `/quit`.

## Where to get a free key

| Provider | Sign up | Model id | Base URL |
| --- | --- | --- | --- |
| **Z.ai** (the model's authors) | https://z.ai/model-api, key at https://z.ai/manage-apikey/apikey-list | `glm-4.7-flash` | `https://api.z.ai/api/paas/v4` |
| ZenMux | https://zenmux.ai/platform/pay-as-you-go, then allow `z-ai/glm-4.7-flash-free` on the key | `z-ai/glm-4.7-flash-free` | `https://zenmux.ai/api/v1` |
| Cloudflare Workers AI | https://dash.cloudflare.com, Workers AI, free daily allocation | `@cf/zai-org/glm-4.7-flash` | Workers AI OpenAI-compatible endpoint |
| BigModel (China) | https://open.bigmodel.cn | `glm-4.7-flash` | `https://open.bigmodel.cn/api/paas/v4` |

`glmh init` has presets for Z.ai and ZenMux and accepts any OpenAI-compatible URL, so a local
llama.cpp or Ollama server serving the same open weights works too. glmh shows your usage for
the day after every task.

## What it does

- Reads, searches, edits and writes files, and runs shell commands, in the repository you
  start it in. Every edit is checked for syntax errors before the model sees the result.
- Asks before running any command. Answer `y`, `n`, or `a` to stop asking for the session.
  It never commits, never pushes, never runs destructive commands.
- After it changes something, it runs your project's tests once and fixes what failed, up to
  two rounds. The test command is auto-detected or set with `check = "..."` in `glmh.toml`.
- Streams the model's words as it writes them, shows live output of running commands, and
  prints the edited lines under each change.
- Gives the model its full context window and never cuts a task short on a turn count. A run
  ends when the model is done, when you press Esc, or when it repeats itself.

## Built to be rebuilt

glmh is a free module, not a product. Fork it, strip it, port it, ship it under another name.
The point is to make a small free model as effective as a paid agent, and every part of that
is in the open:

- `profiles/glm-4.7-flash.toml` holds everything model-specific: the system prompt, sampling,
  thinking mode, request fields. A new model is a new profile.
- `src/tools/` are six small tools with measured design choices: 100-line read windows, exact
  search-and-replace edits with a syntax check, grep capped at 50 hits.
- `src/loop.ts` is the whole agent loop in one file: tool calls, cancellation, doom-loop
  detection, check-and-repair.
- `eval/` runs real tasks against your key and reports requests per task, the number that
  matters on a free tier. Today's fixtures solve in 5 to 9 requests each.
- `docs/` is the design record: research on the model, the spec, the architecture, and every
  decision with its reason.

If you make it more efficient, send the eval numbers with the change.

## Privacy

Your prompts and the file contents the agent reads are sent to the endpoint you configured.
Z.ai states that API content is not stored and is processed in Singapore. glmh never reads
`.env`, key or credential files unless you pass `--allow-secrets`, keeps your API key in
`~/.config/glmh/config.toml` with owner-only permissions, and sends nothing anywhere else.
Do not paste secrets into a task.

## Development

```sh
bun test                    # 76 tests, no network needed
bun run typecheck
bun run eval                # runs the fixture tasks against your configured endpoint
```

## License

MIT. The model weights are MIT too, released by Z.ai.
