// Eval runner: bun run eval/run.ts [task-id ...]
// Each task dir has task.md, setup.sh <dir>, check.sh <dir>. Results go to eval/results/<ts>.jsonl.
import { mkdtempSync, readFileSync, readdirSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { loadProfile } from "../src/profile";
import { Client } from "../src/client";
import { runTask } from "../src/loop";
import { detectCheck } from "../src/check";
import { Trajectory } from "../src/trajectory";

const root = join(import.meta.dir, "tasks");
const wanted = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const tasks = readdirSync(root).filter((d) => !wanted.length || wanted.includes(d)).sort();
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const resultsPath = join(import.meta.dir, "results", `${stamp}.jsonl`);
const profile = loadProfile();
const rows: any[] = [];

for (const id of tasks) {
  const dir = join(root, id);
  const task = readFileSync(join(dir, "task.md"), "utf8");
  const work = mkdtempSync(join(tmpdir(), `glmh-eval-${id}-`));
  const setup = Bun.spawnSync(["bash", join(dir, "setup.sh"), work]);
  if (setup.exitCode !== 0) { console.error(`${id}: setup failed\n${setup.stderr}`); continue; }
  const config = loadConfig(work, {});
  config.check = detectCheck(work);
  const traj = new Trajectory(work);
  const client = new Client(config.endpoint, profile, config.limits, (t) => process.stderr.write(`  ! ${t}\n`));
  process.stderr.write(`\n▶ ${id}\n`);
  const t0 = Date.now();
  const r = await runTask(task, {
    client, profile, config, cwd: work, yes: true, allowSecrets: false, ask: async () => true,
    emit: (e) => {
      traj.log(e as any);
      if (e.type === "tool_call") process.stderr.write(`  → ${e.name} ${JSON.stringify(e.args).slice(0, 80)}\n`);
      if (e.type === "response") process.stderr.write(`  turn ${e.turn}: ${(e.ms / 1000).toFixed(1)}s${e.retries ? ` (${e.retries} retries)` : ""}\n`);
      if (e.type === "note") process.stderr.write(`  ! ${e.text}\n`);
    },
  });
  const check = Bun.spawnSync(["bash", join(dir, "check.sh"), work]);
  const pass = check.exitCode === 0;
  const row = { task: id, pass, reason: r.reason, ...r.stats, wall_s: Math.round((Date.now() - t0) / 1000), trajectory: traj.path, work };
  rows.push(row);
  appendFileSync(resultsPath, JSON.stringify(row) + "\n");
  process.stderr.write(`  ${pass ? "PASS" : "FAIL"} (${r.reason}) · ${r.stats.requests} req · ${r.stats.tool_calls} tools · ${row.wall_s}s\n`);
  if (pass && !process.argv.includes("--keep")) rmSync(work, { recursive: true, force: true });
}

const passed = rows.filter((r) => r.pass).length;
console.log(`\n${passed}/${rows.length} passed · results: ${resultsPath}`);
console.table(rows.map((r) => ({ task: r.task, pass: r.pass, reason: r.reason, req: r.requests, tools: r.tool_calls, in: r.prompt_tokens, out: r.completion_tokens, edits_missed: r.edit_failures, s: r.wall_s })));
process.exit(rows.length && passed === rows.length ? 0 : 1);
