import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTask, type LoopDeps } from "../src/loop";
import type { ChatClient } from "../src/client";
import type { ChatResult, Config, Message, RunEvent, ToolCall } from "../src/types";
import { loadProfile } from "../src/profile";

class FakeClient implements ChatClient {
  sent: Message[][] = [];
  constructor(private script: Array<Partial<ChatResult> & { message: Message }>) {}
  async chat(messages: Message[]): Promise<ChatResult> {
    this.sent.push(messages);
    const next = this.script.shift();
    if (!next) throw new Error("script exhausted");
    return { finish_reason: "stop", usage: { prompt_tokens: 10, completion_tokens: 5 }, ms: 1, retries: 0, recovered: false, ...next };
  }
}

const call = (name: string, args: Record<string, unknown>, id = `c_${Math.random().toString(36).slice(2, 8)}`): ToolCall => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const toolTurn = (...calls: ToolCall[]) => ({ message: { role: "assistant" as const, content: "", tool_calls: calls }, finish_reason: "tool_calls" });
const final = (content: string) => ({ message: { role: "assistant" as const, content } });

let cwd: string;
let events: RunEvent[];
process.env.GLMH_DATA_DIR = mkdtempSync(join(tmpdir(), "glmh-data-"));

function deps(client: ChatClient, check?: string): LoopDeps {
  const profile = loadProfile();
  const config: Config = { endpoint: { kind: "zenmux", base_url: "http://x", api_key: "k", model: "m" }, limits: { ...profile.limits }, check, daily_request_estimate: 1000 };
  return { client, profile, config, cwd, yes: true, allowSecrets: false, emit: (e) => events.push(e), ask: async () => true };
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "glmh-loop-"));
  writeFileSync(join(cwd, "README.md"), "# demo\nhello\n");
  writeFileSync(join(cwd, "a.txt"), "alpha\n");
  events = [];
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

describe("runTask", () => {
  test("executes a tool call, feeds the result back, and completes", async () => {
    const client = new FakeClient([toolTurn(call("read", { path: "README.md" })), final("Done: it is a demo.")]);
    const r = await runTask("What is this project?", deps(client));
    expect(r.reason).toBe("complete");
    expect(r.summary).toContain("Done");
    expect(r.stats.tool_calls).toBe(1);
    expect(r.stats.requests).toBe(2);
    const toolMsg = client.sent[1].find((m) => m.role === "tool");
    expect(toolMsg?.content).toContain("README.md: lines 1-2 of 2");
    expect(client.sent[0][0].role).toBe("system");
    expect(client.sent[0][1].content).toContain("Repository files");
  });

  test("runs parallel tool calls in one turn", async () => {
    const client = new FakeClient([toolTurn(call("read", { path: "README.md" }), call("read", { path: "a.txt" })), final("ok")]);
    const r = await runTask("read both", deps(client));
    expect(r.stats.tool_calls).toBe(2);
    expect(client.sent[1].filter((m) => m.role === "tool")).toHaveLength(2);
  });

  test("stops a doom loop after three identical turns", async () => {
    const same = () => toolTurn(call("grep", { pattern: "alpha" }, "fixed"));
    const client = new FakeClient([same(), same(), same(), final("never")]);
    const r = await runTask("loop", deps(client));
    expect(r.reason).toBe("doom_loop");
    expect(r.stats.turns).toBe(3);
    expect(r.stats.doom_loops).toBe(1);
    const warned = client.sent[2].find((m) => m.role === "tool" && m.content.includes("repeated exactly the same call"));
    expect(warned).toBeDefined();
  });

  test("recovers a tool call leaked into text", async () => {
    const client = new FakeClient([
      { message: { role: "assistant", content: "<tool_call>read<arg_key>path</arg_key><arg_value>a.txt</arg_value></tool_call>" } },
      final("alpha it is"),
    ]);
    const r = await runTask("read a", deps(client));
    expect(r.reason).toBe("complete");
    expect(r.stats.malformed_calls).toBe(1);
    expect(client.sent[1].some((m) => m.role === "tool" && m.content.includes("alpha"))).toBe(true);
  });

  test("asks the model to continue after a truncated reply", async () => {
    const client = new FakeClient([{ message: { role: "assistant", content: "I was going to" }, finish_reason: "length" }, final("finished")]);
    const r = await runTask("x", deps(client));
    expect(r.reason).toBe("complete");
    expect(client.sent[1].at(-1)?.content).toContain("cut off");
  });

  test("short-circuits a duplicate read of an unchanged file", async () => {
    const client = new FakeClient([toolTurn(call("read", { path: "a.txt" })), toolTurn(call("read", { path: "a.txt" }, "other")), final("ok")]);
    const r = await runTask("x", deps(client));
    expect(r.stats.tool_calls).toBe(1);
    expect(client.sent[2].some((m) => m.role === "tool" && m.content.includes("unchanged since turn 1"))).toBe(true);
  });

  test("runs the check after changes and feeds failures back once", async () => {
    const check = "test -f .ok || (touch .ok && exit 1)";
    const client = new FakeClient([toolTurn(call("write", { path: "new.txt", content: "x" })), final("done v1"), final("done v2")]);
    const r = await runTask("make a file", deps(client, check));
    expect(r.reason).toBe("complete");
    expect(r.summary).toContain("Check passed");
    expect(client.sent[2].at(-1)?.content).toContain("The project check failed");
    expect(existsSync(join(cwd, ".ok"))).toBe(true);
    expect(events.filter((e) => e.type === "check")).toHaveLength(2);
  });

  test("skips the check when nothing changed", async () => {
    const client = new FakeClient([final("nothing to do")]);
    const r = await runTask("x", deps(client, "exit 1"));
    expect(r.reason).toBe("complete");
    expect(events.some((e) => e.type === "check")).toBe(false);
  });

  test("runs as many turns as the task needs", async () => {
    const client = new FakeClient([...Array.from({ length: 8 }, (_, i) => toolTurn(call("read", { path: "a.txt", offset: i + 1, limit: 1 }))), final("finally")]);
    const r = await runTask("x", deps(client));
    expect(r.reason).toBe("complete");
    expect(r.stats.turns).toBe(9);
  });

  test("streams bash output while it runs", async () => {
    const client = new FakeClient([toolTurn(call("bash", { command: "echo one; sleep 0.2; echo two" })), final("ok")]);
    const r = await runTask("x", deps(client));
    const chunks = events.filter((e) => e.type === "tool_output").map((e: any) => e.chunk).join("");
    expect(r.reason).toBe("complete");
    expect(chunks).toContain("one");
    expect(chunks).toContain("two");
  });

});

describe("cancellation", () => {
  class HangingClient implements ChatClient {
    sent: Message[][] = [];
    async chat(messages: Message[], _tools: unknown[], opts?: { signal?: AbortSignal }): Promise<ChatResult> {
      this.sent.push(messages);
      return new Promise((_, reject) => {
        opts?.signal?.addEventListener("abort", () => {
          const e = new Error("cancelled");
          e.name = "AbortError";
          reject(e);
        });
      });
    }
  }

  test("abort during the request keeps history intact", async () => {
    const client = new HangingClient();
    const controller = new AbortController();
    const d = { ...deps(client), signal: controller.signal };
    const p = runTask("hang", d);
    setTimeout(() => controller.abort(), 50);
    const r = await p;
    expect(r.reason).toBe("aborted");
    expect(r.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(events.some((e) => e.type === "aborted")).toBe(true);
  });

  test("abort during a tool batch kills the tool and drops the partial turn", async () => {
    const client = new FakeClient([toolTurn(call("bash", { command: "sleep 5", timeout_seconds: 30 }), call("read", { path: "a.txt" })), final("never")]);
    const controller = new AbortController();
    const d = { ...deps(client), signal: controller.signal };
    const started = Date.now();
    const p = runTask("slow", d);
    setTimeout(() => controller.abort(), 300);
    const r = await p;
    expect(r.reason).toBe("aborted");
    expect(Date.now() - started).toBeLessThan(3000);
    expect(r.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(r.stats.tool_calls).toBe(1);
  });
});
