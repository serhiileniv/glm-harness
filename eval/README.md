# Eval

`bun run eval [task-id ...]` runs each task in `eval/tasks/` in a fresh temp dir against the
configured endpoint, then runs the task's `check.sh`. Results land in `eval/results/<ts>.jsonl`
(gitignored). Metrics per task: pass, reason, requests, tool calls, tokens in and out, edit
misses, wall seconds.

## Adding a task

```
eval/tasks/<id>/
  task.md       the prompt, exactly what a user would type
  fixture/      the repository state before the task
  setup.sh DIR  copies the fixture into DIR and makes an initial git commit
  check.sh DIR  exits 0 when the task is solved
```

## Results

2026-09-15, GLM-4.7-Flash via Z.ai free, profile defaults at the time (16k context, 20 turns; since replaced by the full 200k window and no cap):

| task | pass | requests | tool calls | tokens in / out | edit misses |
| --- | --- | --- | --- | --- | --- |
| 01-ts-slugify | yes | 9 | 9 | 32,048 / 4,073 | 0 |
| 02-ts-duration | yes | 8 | 8 | 29,749 / 2,984 | 0 |
| 03-py-chunks | yes | 5 | 6 | 10,312 / 725 | 0 |

Wall times were 172 to 695 s, dominated by 429 backoff while another session shared the key.
No baseline harness has been run on these tasks yet; that is the next measurement.
