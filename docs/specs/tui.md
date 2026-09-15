# Spec: full-screen TUI and streaming

Status: approved and implemented 2026-09-15. Open questions resolved with the proposed defaults (see D20).

## Goal

Give `glmh` the interactive shape people expect from a coding agent: a full-screen terminal
session where the model's words and tool calls appear as they happen, the transcript scrolls,
approvals are answered in place, and a run can be cancelled with one key. Streaming ships in the
same change because a full-screen frame around a 40-second spinner is not an improvement.

## Non-goals

- Mouse support, themes, a diff pane, multiple sessions. Each is real work that moves neither
  pass rate nor requests per task; they wait for user feedback.
- Replacing plain mode. Pipes, CI and the eval runner keep the line-based output.
- A UI library. Ink needs yoga WASM and has raw-mode problems under `bun build --compile`;
  OpenTUI is a native addon. A hand-rolled renderer is about 700 lines and keeps the binary
  dependency-free.

## Current state

- `src/cli.ts` (365 lines): `cmdRepl` is a `prompt()` loop; `makeEmitter` prints `RunEvent`s as
  lines; `Spinner` overwrites one stderr line with elapsed seconds; `ask` uses `askTTY`.
- `src/client.ts`: `Client.chat()` sends `stream: false`, no caller-supplied abort signal
  (`AbortSignal.timeout(240_000)` only).
- `src/loop.ts`: `runTask()` emits `RunEvent`s and awaits `deps.ask()` for approvals; no way to
  cancel a run; a turn's assistant and tool messages are pushed as they complete.
- `src/types.ts`: `RunEvent` has no streaming variants.
- Streaming was verified on the Z.ai route on 2026-09-15: SSE chunks, reasoning deltas present,
  time to first token 11.6 s while busy.

## Proposed design

### New and changed files

```
src/stream.ts          SSE parser: bytes → deltas → accumulated ChatResult (pure, tested)
src/client.ts          chat(opts.stream, opts.signal); stream: true + stream_options.include_usage
src/loop.ts            deps.signal; reason "aborted"; partial turn discarded; stream events
src/types.ts           RunEvent += stream_text, stream_reasoning, aborted
src/tui/keys.ts        byte sequences → key events (pure, tested)
src/tui/input.ts       single-line editor state: text, cursor, history (pure, tested)
src/tui/buffer.ts      transcript blocks → wrapped lines → viewport (pure, tested)
src/tui/screen.ts      alternate screen, raw mode, cursor, resize, frame writer
src/tui/app.ts         state, event handlers, slash commands, approval prompt, render scheduling
src/tui/index.ts       runTui(deps, initialTask?)
src/cli.ts             glmh in a TTY → TUI; --plain → old loop; --tui "task"; plain mode streams text
```

### Layout

```
row 1          glmh 0.1 · glm-4.7-flash via zai · my-repo ───────────── today 143 / ~1000
rows 2..H-3    transcript viewport, wrapped to width, follows the tail unless scrolled up
row H-2        turn 3 · streaming 12s · 1,860 in · 2 tool calls · auto-approve off · Esc cancels
row H-1        › type a task, /help for commands
```

Below 60x12 the screen shows only "terminal too small". Resize re-wraps and redraws.

### Transcript blocks

| Block | Rendering |
| --- | --- |
| user | `you ›` bold, the task text |
| assistant | `glm ›`, text appended as deltas arrive |
| thinking | one dim line `thinking (532 chars)`; `/think` expands to the text |
| tool | `→ read path=src/a.ts` then, on result, `✓ 1,234 chars · 0.1s` or `✗` and the error's first line |
| note | yellow `! text` |
| check | `✓ check passed: bun test` or `✗ check failed` plus the last 20 output lines |
| done | summary, `git diff --stat`, stats line, quota line |
| aborted | `cancelled turn 3 · partial output discarded` |

### Rendering

Full frame rebuilt from state on every change, written as one string: cursor home, each row
overwritten with clear-to-end-of-line, never a full clear. Redraws are coalesced to at most one
per 33 ms. Alternate screen on, cursor hidden while drawing, autowrap off, bracketed paste on;
all restored on exit and on uncaught error.

### Keys

| Key | Idle | Run in progress | Approval prompt |
| --- | --- | --- | --- |
| Enter | submit | ignored, status says "run in progress" | no |
| Esc | clear input | cancel the run | no |
| y / n | typed | typed | yes / no |
| Ctrl-C | clear input; twice within 1 s quits | cancel the run | no |
| Ctrl-D | quit when input is empty | cancel, then quit | quit |
| Up / Down | input history | input history | ignored |
| PgUp / PgDn | scroll transcript one page | same | same |
| Home/End, Ctrl-A/E, Ctrl-U, Ctrl-W, Backspace, Left/Right | line editing | same | ignored |
| Ctrl-L | redraw | redraw | redraw |

Pasted text is inserted verbatim; newlines display as `⏎` and are sent as newlines.

### Slash commands

`/help` `/diff` (git diff --stat into the transcript) `/reset` (new conversation) `/yes` (toggle
auto-approve, shown in the status row) `/think` (toggle expanded reasoning) `/clear` (transcript
only) `/quit`.

### Approvals

`deps.ask(question)` in TUI mode stores the pending question and its resolver. The input row
shows `Run: bun test?  y / n`. The tool that asked stays awaiting the promise, so the run pauses.

### Cancel

Esc calls `controller.abort()`. The client passes the signal to `fetch`; the loop catches the
abort, drops any assistant or tool messages pushed during that turn so call/result pairs stay
intact, emits `aborted`, and returns reason `aborted`. History keeps every completed turn.

### Streaming protocol

Request adds `stream: true` and `stream_options: {include_usage: true}`. The parser handles
`data:` lines split across chunks, `[DONE]`, and per-choice deltas: `content`,
`reasoning_content` or `reasoning`, `tool_calls[]` accumulated by `index` with concatenated
`function.arguments`, `finish_reason` from the last delta, `usage` from the final chunk when
present. If the endpoint answers without `text/event-stream`, the client falls back to one
non-streaming request. The returned `ChatResult` is identical in shape to today's, so `loop.ts`
logic and the fallback tool-call parser are unchanged.

Plain mode benefits too: one-shot and `--plain` print assistant text as it streams; the spinner
shows only until the first token.

### Mode selection

| Invocation | Mode |
| --- | --- |
| `glmh` in a TTY | TUI |
| `glmh --plain` | line REPL, unchanged |
| `glmh "task"` | plain one-shot, streams text, exit code as today |
| `glmh --tui "task"` | TUI with the task submitted on open |
| no TTY | plain, always |

### Tests

`test/stream.test.ts`: chunk boundaries inside a `data:` line, two parallel tool calls
accumulated by index, usage captured, `[DONE]`, reasoning under both field names.
`test/keys.test.ts`: every key in the table, Esc alone versus Esc-prefixed sequences, bracketed
paste. `test/tui-input.test.ts`: editing ops and history. `test/tui-buffer.test.ts`: wrapping at
width, viewport follow and scroll, resize re-wrap.

What the tests cannot do: prove the frame looks right in Terminal.app, iTerm2 and tmux. That is
checked by hand before merge and recorded in the PR.

### Size

About 150 lines for streaming, 700 for the TUI, 100 of changes to existing files, 250 of tests.

## Acceptance criteria

- [x] `glmh` in a TTY opens the TUI and restores the terminal on `/quit`, Ctrl-D and on a crash. (pseudo-terminal check: alt screen and bracketed paste restored)
- [ ] Assistant text appears within one redraw of arrival; no visible flicker during a 500-token stream.
- [ ] Esc during a request stops the run within 1 s; the transcript shows the cancelled block; the next task continues from the last completed turn.
- [x] Esc during a tool batch stops before the next tool; no tool message without its call remains in history. (unit-tested)
- [ ] An approval question is answerable with `y` or `n` in the input row while the run waits.
- [ ] Two parallel tool calls streamed from Z.ai are executed exactly as in non-streaming mode.
- [ ] Resize to 80x24 and back re-wraps without leftover characters.
- [x] `bun test` passes with no terminal attached; eval runner and `glmh "task"` output unchanged apart from streamed text.
- [ ] Works in Terminal.app, iTerm2 and inside tmux, checked by hand.
- [x] Binary still builds with `bun build --compile` and gains no dependency.

## Open questions

1. Should `glmh "task"` in a TTY open the TUI and stay open after the task, or remain a plain one-shot that exits? Proposed: remain plain, `--tui "task"` for the other behaviour.
2. Reasoning collapsed by default with `/think` to expand, or expanded by default? Proposed: collapsed.
3. Should Ctrl-C twice quit, or only `/quit` and Ctrl-D? Proposed: twice within a second quits.

## Visual design v2 (amendment, 2026-09-15)

Principles: three levels of attention (task and answer primary; tool activity secondary,
indented and dim, stacked without blank lines; metadata tertiary), one accent colour (cyan is
the agent; green and red are outcomes; yellow means look here), minimal chrome (no filled
bars), comfort over cleverness.

```
 glmh 0.1.0 · GLM-4.7-Flash · zai · repo main ✚3                        today 27 / ~1000

 ── 12:04 ──────────────────────────────────────────────────────────────────────────
 you › task text

       thinking (312 chars) · /think
   → grep /pattern/ in test
     ✓ 3 matches
   → $ bun test
     │ 14 pass
     │ 0 fail
     ✓ exit code 0, 1.9s

 glm › answer, markdown rendered

   ✓ done · 48s · 5 requests · 4 tool calls · 11,208 in / 1,412 out
     src/auth.ts | 5 ++-
     today 28 / ~1000 · about 120 more tasks like this one

 ⠹ turn 3 · writing 12s · 1,860 in · 2 tool calls · Esc cancels
 › type a task…
```

Rules added:
- Consecutive tool and thinking blocks stack with no blank line; everything else gets one.
- Bash keeps its last three output lines after success, so test results stay visible.
- Header is one dim line; one blank line of air below it; status line has no fill and carries
  the spinner while running; the approval prompt moves to the status line with the key legend
  in the input row.
- Typing Enter during a run queues the task; it starts when the run ends. The status line shows
  the queue depth.
- Scrolling up stays anchored when new lines arrive; PgDn returns to following.
- A welcome card with the GLMH banner and four facts is shown once and scrolls away. Below 84
  columns only the facts are shown.
- Transcript width is capped at 110 columns and offset by one column from the left edge.
