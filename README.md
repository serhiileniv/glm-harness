# glmh

A coding agent for your terminal that costs nothing to run. It works with one model,
GLM-4.7-Flash, through a free API key that you get yourself in two minutes. No subscription,
no credit card, no account with me, no telemetry.

I built it for people who cannot pay for Claude Code, Cursor or Copilot: students, people
between jobs, anyone learning to code on a laptop that cannot run a model locally. A capable
agent should not be a paywall.

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

**1. Get a free key.** Register at https://z.ai/model-api with an email, then create a key at
https://z.ai/manage-apikey/apikey-list. GLM-4.7-Flash is on Z.ai's permanent free tier.

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
glmh                        # full-screen session: type a task, press Enter
glmh "explain what this project does"   # one task, plain output, scriptable
```

Inside the session: **Enter** sends, **Esc** cancels the current run, **PgUp/PgDn** scroll,
**Up/Down** recall earlier tasks. Commands: `/diff`, `/reset`, `/yes`, `/think`, `/copy`,
`/usage`, `/help`, `/quit`.

## What it does

- Reads, searches, edits and writes files, and runs shell commands, in the repository you
  start it in. Every edit is checked for syntax errors before the model sees the result.
- Asks before running any command. Answer `y`, `n`, or `a` to stop asking for the session.
  It never commits, never pushes, never runs destructive commands.
- After it changes something, it runs your project's tests once and fixes what failed, up to
  two rounds. The test command is auto-detected or set with `check = "..."` in `glmh.toml`.
- Shows the model's words as it writes them, live output of running commands, and the edited
  lines under each change.
- Prints a quota line after every task, so you always know how much of the day's free
  allowance is left.

## Why one model

Most agents are built for the biggest paid models and treat a 30B open model as a downgrade.
glmh does the opposite. It speaks GLM's own tool-call protocol, keeps the model's reasoning
across turns the way its authors do in their own benchmarks, uses their sampling settings, and
spends as few requests per task as it can, because on a free key the request count is the
only thing that runs out. On its three fixture tasks it solves each in 5 to 9 requests
(`eval/README.md`). The design record is in `docs/`.

## What to expect, honestly

- **About 30 tasks a day per key.** The free tier allows one request at a time and a daily
  request cap that Z.ai does not publish; the community estimate is around 1,000. glmh shows
  your count.
- **Busy hours are slow.** A turn takes 3 seconds when the route is quiet and up to a minute
  when it is not. glmh waits and retries on its own; the status row tells you why.
- **It is a 30B model.** Excellent at focused tasks in small and medium repositories: fix a
  failing test, add a function, explain a module, write tests. Weaker at large refactors
  across many files. Give it one clear task at a time and it does well.

## Privacy

Your prompts and the file contents the agent reads are sent to the endpoint you configured.
Z.ai states that API content is not stored and is processed in Singapore. glmh never reads
`.env`, key or credential files unless you pass `--allow-secrets`, keeps your API key in
`~/.config/glmh/config.toml` with owner-only permissions, and sends nothing anywhere else.
Do not paste secrets into a task.

## Second free route

If you cannot register at Z.ai, ZenMux resells the same model for free: get a key at
https://zenmux.ai/platform/pay-as-you-go, allow `z-ai/glm-4.7-flash-free` on it, and choose
ZenMux in `glmh init`. Its free route walls after roughly 15 requests an hour, so it is a
fallback, not a daily driver.

## Development

```sh
bun test                    # 76 tests, no network needed
bun run typecheck
bun run eval                # runs the fixture tasks against your configured endpoint
```

Contributions that help most: eval tasks from real student projects (`eval/README.md`
shows the format), and reports of what the agent gets wrong, with the trajectory file
that `glmh` prints at the end of a session.

## License

MIT. The model weights are MIT too, released by Z.ai.
