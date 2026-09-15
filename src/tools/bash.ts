import type { ToolContext, ToolOutcome } from "../types";
import { classifyCommand } from "../approvals";
import { ToolError } from "./paths";
import { invalidateFileList } from "../repomap";

export const schema = {
  type: "function",
  function: {
    name: "bash",
    description:
      "Run a non-interactive shell command in the project root and return its output and exit code. Output is truncated to the first and last 4000 characters. Default timeout 60 seconds, max 600. Use it for tests, builds, linters, git status and git diff. Do not start servers, watchers or interactive programs.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command" },
        timeout_seconds: { type: "integer", description: "Kill the command after this many seconds. Default 60, max 600" },
      },
      required: ["command"],
    },
  },
} as const;

const HEAD = 4000;
const TAIL = 4000;

export async function run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const command = String(args.command ?? "").trim();
  if (!command) throw new ToolError("command is required");
  const cls = classifyCommand(command);
  if (cls === "deny") throw new ToolError(`Refused: this harness never runs that command (${command.split(/\s+/).slice(0, 3).join(" ")} …). Leave commits and destructive operations to the user.`);
  if (cls === "server") throw new ToolError("Refused: that looks like a server, watcher or interactive program and would never return. Run a one-shot command instead, for example a build or a test.");
  if (cls === "ask" || !ctx.yes) {
    const ok = await ctx.ask(`Run: ${command}`);
    if (!ok) return { content: "The user declined to run this command. Choose a different approach or finish with what you know.", error: true };
  }
  const timeout = Math.min(600, Math.max(1, Math.floor(Number(args.timeout_seconds ?? 60)) || 60));
  const t0 = Date.now();
  const proc = Bun.spawn(["bash", "-c", command], {
    cwd: ctx.cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: { ...process.env, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0", TERM: "dumb", GIT_TERMINAL_PROMPT: "0" },
  });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; proc.kill("SIGKILL"); }, timeout * 1000);
  const onAbort = () => proc.kill("SIGKILL");
  ctx.signal?.addEventListener("abort", onAbort, { once: true });
  const [out, err] = await Promise.all([drain(proc.stdout, ctx.onOutput), drain(proc.stderr, ctx.onOutput)]);
  const exitCode = await proc.exited;
  clearTimeout(timer);
  ctx.signal?.removeEventListener("abort", onAbort);
  invalidateFileList();
  if (ctx.signal?.aborted) return { content: "[command cancelled by the user]", error: true };
  let combined = out;
  if (err.trim()) combined += (combined && !combined.endsWith("\n") ? "\n" : "") + `[stderr]\n${err}`;
  combined = combined.replace(/\x1b\[[0-9;]*m/g, "");
  if (combined.length > HEAD + TAIL) {
    combined = `${combined.slice(0, HEAD)}\n…[${combined.length - HEAD - TAIL} chars cut from the middle; rerun with a filter such as | tail -50 to see more]…\n${combined.slice(-TAIL)}`;
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const status = timedOut ? `killed after ${timeout}s timeout` : `exit code ${exitCode}`;
  return { content: `$ ${command}\n${combined.trimEnd()}\n[${status}, ${secs}s]`.trim(), mutated: true, error: timedOut };
}

/** Collect a stream fully while forwarding each chunk live. */
async function drain(stream: ReadableStream<Uint8Array> | null, onChunk?: (s: string) => void): Promise<string> {
  if (!stream) return "";
  const decoder = new TextDecoder();
  let all = "";
  for await (const chunk of stream) {
    const text = decoder.decode(chunk, { stream: true });
    all += text;
    onChunk?.(text);
  }
  return all;
}
