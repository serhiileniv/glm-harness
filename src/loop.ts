import { statSync } from "node:fs";
import { resolve } from "node:path";
import type { ChatClient } from "./client";
import type { Config, Message, Profile, RunEvent, RunStats, ToolContext } from "./types";
import { parseToolCallsFromText } from "./parser";
import { fitContext } from "./context";
import { estimateJson, estimateMessages } from "./tokens";
import { TOOL_NAMES, runTool, toolSchemas } from "./tools";
import { repoMap } from "./repomap";

export interface LoopDeps {
  client: ChatClient;
  profile: Profile;
  config: Config;
  cwd: string;
  yes: boolean;
  allowSecrets: boolean;
  emit: (e: RunEvent) => void;
  ask: (question: string) => Promise<boolean>;
  /** cancel the run; the partial turn is discarded and completed turns are kept */
  signal?: AbortSignal;
}

export interface RunResult {
  messages: Message[];
  stats: RunStats;
  summary: string;
  reason: "complete" | "doom_loop" | "error" | "aborted";
}

export function initialMessages(task: string, deps: LoopDeps): Message[] {
  const system = deps.profile.prompt.system.replace("{cwd}", deps.cwd);
  const map = repoMap(deps.cwd, deps.config.limits.repo_map_files);
  return [
    { role: "system", content: system, _turn: 0 },
    { role: "user", content: `${task.trim()}\n\n---\n${map}`, _turn: 0 },
  ];
}

/** The agent loop. `history` continues a previous conversation (REPL); otherwise a fresh one starts. */
export async function runTask(task: string, deps: LoopDeps, history?: Message[]): Promise<RunResult> {
  const { profile, config, emit } = deps;
  const limits = config.limits;
  const messages: Message[] = history ? [...history, { role: "user", content: task.trim() }] : initialMessages(task, deps);
  const tools = toolSchemas();
  const toolsTokens = estimateJson(tools);
  const budget = limits.context_tokens - limits.reply_reserve - 1000;
  const t0 = Date.now();
  const stats: RunStats = { turns: 0, requests: 0, prompt_tokens: 0, completion_tokens: 0, reasoning_tokens: 0, tool_calls: 0, malformed_calls: 0, edit_failures: 0, doom_loops: 0, retries: 0, wall_ms: 0 };
  const ctx: ToolContext = { cwd: deps.cwd, yes: deps.yes, allowSecrets: deps.allowSecrets, outputChars: limits.tool_output_chars, ask: deps.ask, signal: deps.signal };
  const readCache = new Map<string, { turn: number; seq: number; mtime: number; size: number }>();
  let resultSeq = 0;
  let lastKey = "";
  let sameCount = 0;
  let repairs = 0;
  let dirty = false;
  const finish = (reason: RunResult["reason"], summary: string): RunResult => {
    stats.wall_ms = Date.now() - t0;
    emit({ type: "done", turn: stats.turns, reason, summary, stats });
    return { messages, stats, summary, reason };
  };
  // Drop everything pushed during `turn` so no tool result survives without its call, then stop.
  const abortTurn = (turn: number): RunResult => {
    while (messages.length > 2 && messages[messages.length - 1]._turn === turn) messages.pop();
    emit({ type: "aborted", turn });
    return finish("aborted", `Cancelled during turn ${turn}. Completed turns are kept.`);
  };

  for (let turn = 1; ; turn++) {
    stats.turns = turn;
    emit({ type: "turn", turn });
    if (deps.signal?.aborted) return abortTurn(turn);
    const fitted = fitContext(messages, { budget, keepFull: limits.keep_full_results, toolsTokens });
    for (const n of fitted.notes) emit({ type: "note", turn, text: n });
    emit({ type: "request", turn, messages: fitted.messages.length, est_tokens: estimateMessages(fitted.messages) + toolsTokens });

    let result;
    try {
      result = await deps.client.chat(fitted.messages, tools, {
        signal: deps.signal,
        stream: {
          onText: (delta) => emit({ type: "stream_text", turn, delta }),
          onReasoning: (delta) => emit({ type: "stream_reasoning", turn, delta }),
        },
      });
    } catch (e) {
      if (deps.signal?.aborted || (e as Error).name === "AbortError") return abortTurn(turn);
      emit({ type: "note", turn, text: `request failed: ${(e as Error).message}` });
      return finish("error", (e as Error).message);
    }
    stats.requests++;
    stats.retries += result.retries;
    stats.prompt_tokens += result.usage.prompt_tokens ?? 0;
    stats.completion_tokens += result.usage.completion_tokens ?? 0;
    stats.reasoning_tokens += result.usage.reasoning_tokens ?? 0;

    const msg: Message = { ...result.message, _turn: turn };
    let recovered = false;
    if (!msg.tool_calls?.length && /<tool_call>|```(json|tool_call)/.test(msg.content)) {
      const parsed = parseToolCallsFromText(msg.content, TOOL_NAMES);
      if (parsed.calls.length) {
        msg.tool_calls = parsed.calls;
        msg.content = parsed.content;
        recovered = true;
        stats.malformed_calls++;
      }
    }
    emit({ type: "response", turn, ms: result.ms, usage: result.usage, finish: result.finish_reason, tool_calls: msg.tool_calls?.length ?? 0, recovered, retries: result.retries });
    if (msg.reasoning_content) emit({ type: "thinking", turn, chars: msg.reasoning_content.length });
    if (msg.content) emit({ type: "assistant", turn, content: msg.content });

    if (!msg.tool_calls?.length && result.finish_reason === "length") {
      messages.push(msg, { role: "user", content: profile.prompt.truncated, _turn: turn });
      emit({ type: "note", turn, text: "reply was cut off at max_tokens; asked the model to continue" });
      continue;
    }

    messages.push(msg);

    if (msg.tool_calls?.length) {
      const key = JSON.stringify(msg.tool_calls.map((c) => [c.function.name, c.function.arguments]));
      sameCount = key === lastKey ? sameCount + 1 : 0;
      lastKey = key;
      if (sameCount >= 2) {
        stats.doom_loops++;
        emit({ type: "note", turn, text: "same tool call three turns in a row; stopping" });
        return finish("doom_loop", msg.content || "Stopped: the model repeated the same action three times.");
      }
      for (const [i, call] of msg.tool_calls.entries()) {
        if (deps.signal?.aborted) return abortTurn(turn);
        const name = call.function.name;
        let argsObj: Record<string, unknown> = {};
        try { argsObj = JSON.parse(call.function.arguments || "{}"); } catch { /* reported by runTool */ }
        emit({ type: "tool_call", turn, id: call.id, name, args: argsObj });
        const tc0 = Date.now();
        let outcome;
        const dup = name === "read" ? duplicateRead(argsObj, deps.cwd, readCache, resultSeq, limits.keep_full_results) : undefined;
        if (dup) {
          outcome = { content: dup };
        } else {
          outcome = await runTool(name, call.function.arguments, { ...ctx, onOutput: (chunk) => emit({ type: "tool_output", turn, id: call.id, chunk }) });
          stats.tool_calls++;
          if (name === "edit" && outcome.error) stats.edit_failures++;
          if (outcome.mutated) dirty = true;
          if (name === "read" && !outcome.error) rememberRead(argsObj, deps.cwd, readCache, turn, resultSeq);
        }
        resultSeq++;
        if (deps.signal?.aborted) return abortTurn(turn);
        let content = outcome.content;
        if (i === 0 && sameCount === 1) content = `[note: you repeated exactly the same call as last turn. Do something different.]\n${content}`;
        messages.push({ role: "tool", tool_call_id: call.id, content, _turn: turn });
        emit({ type: "tool_result", turn, id: call.id, name, chars: content.length, ms: Date.now() - tc0, error: Boolean(outcome.error), preview: previewOf(name, content), snippet: snippetOf(name, content) });
      }
      continue;
    }

    // final answer
    if (dirty && config.check && repairs < 2) {
      const check = await runCheck(config.check, deps.cwd, deps.signal);
      if (deps.signal?.aborted) return abortTurn(turn);
      emit({ type: "check", turn, command: config.check, ok: check.ok, output: check.output });
      if (!check.ok) {
        repairs++;
        messages.push({ role: "user", content: `The project check failed.\nCommand: ${config.check}\nOutput:\n${check.output}\n\nFix the failures, then give your final summary.`, _turn: turn });
        continue;
      }
      return finish("complete", `${msg.content}\n\nCheck passed: ${config.check}`);
    }
    return finish("complete", msg.content);
  }
}

async function runCheck(command: string, cwd: string, signal?: AbortSignal): Promise<{ ok: boolean; output: string }> {
  const proc = Bun.spawn(["bash", "-c", command], { cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore", env: { ...process.env, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" } });
  const timer = setTimeout(() => proc.kill("SIGKILL"), 600_000);
  const onAbort = () => proc.kill("SIGKILL");
  signal?.addEventListener("abort", onAbort, { once: true });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  clearTimeout(timer);
  signal?.removeEventListener("abort", onAbort);
  let output = (out + (err ? `\n${err}` : "")).replace(/\x1b\[[0-9;]*m/g, "").trim();
  if (output.length > 6000) output = output.slice(0, 2000) + "\n…\n" + output.slice(-4000);
  return { ok: code === 0, output: `${output}\n[exit code ${code}]` };
}

/** One line that summarises a tool result for the UI: the status line for bash, the first line otherwise. */
function previewOf(name: string, content: string): string {
  const lines = content.split("\n").filter((l) => l.trim());
  if (!lines.length) return "";
  const pick = name === "bash" ? lines[lines.length - 1] : lines[0];
  return pick.replace(/^\[|\]$/g, "").slice(0, 120);
}

/** For edits and writes, the changed region the tool echoed back (up to 8 lines) so the UI can show evidence. */
function snippetOf(name: string, content: string): string[] {
  if (name !== "edit" && name !== "write") return [];
  return content.split("\n").slice(1).filter((l) => l.trim()).slice(0, 8);
}

function readKey(args: Record<string, unknown>): string {
  return `${args.path}:${args.offset ?? 1}:${args.limit ?? 100}`;
}

function fileSig(cwd: string, p: unknown): { mtime: number; size: number } | undefined {
  try {
    const st = statSync(resolve(cwd, String(p)));
    return { mtime: st.mtimeMs, size: st.size };
  } catch {
    return undefined;
  }
}

function rememberRead(args: Record<string, unknown>, cwd: string, cache: Map<string, any>, turn: number, seq: number): void {
  const sig = fileSig(cwd, args.path);
  if (sig) cache.set(readKey(args), { turn, seq, ...sig });
}

/** If the same window of an unchanged file was read recently enough to still be in full context, say so instead of resending it. */
function duplicateRead(args: Record<string, unknown>, cwd: string, cache: Map<string, any>, seq: number, keepFull: number): string | undefined {
  const prev = cache.get(readKey(args));
  if (!prev) return undefined;
  const sig = fileSig(cwd, args.path);
  if (!sig || sig.mtime !== prev.mtime || sig.size !== prev.size) return undefined;
  if (seq - prev.seq >= keepFull) return undefined;
  return `[unchanged since turn ${prev.turn}: see the earlier read of ${args.path} above. Read a different range or proceed.]`;
}
