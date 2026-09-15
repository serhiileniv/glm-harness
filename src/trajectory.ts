import { join } from "node:path";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { DATA_DIR } from "./config";
import type { Usage } from "./types";

/** JSONL run log under ~/.local/share/glmh/runs/<project-hash>/. Never contains the API key. */
export class Trajectory {
  readonly path: string;
  constructor(cwd: string) {
    const dir = join(DATA_DIR, "runs", Bun.hash(cwd).toString(16));
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  }
  log(event: Record<string, unknown>): void {
    appendFileSync(this.path, JSON.stringify({ ts: Date.now(), ...event }) + "\n");
  }
}

const USAGE_PATH = () => join(DATA_DIR, "usage.jsonl");

export function recordUsage(kind: string, model: string, usage: Usage, ms: number): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    appendFileSync(USAGE_PATH(), JSON.stringify({ ts: Date.now(), kind, model, ...usage, ms }) + "\n");
  } catch {
    /* usage accounting must never break a run */
  }
}

export function usageToday(): { requests: number; tokens: number } {
  const p = USAGE_PATH();
  if (!existsSync(p)) return { requests: 0, tokens: 0 };
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  let requests = 0;
  let tokens = 0;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line) continue;
    try {
      const e = JSON.parse(line);
      if (e.ts >= start.getTime()) {
        requests++;
        tokens += e.total_tokens ?? 0;
      }
    } catch {
      /* skip corrupt line */
    }
  }
  return { requests, tokens };
}
