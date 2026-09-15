import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTool } from "../src/tools";
import type { ToolContext } from "../src/types";

let cwd: string;
let ctx: ToolContext;

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), "glmh-tools-"));
  mkdirSync(join(cwd, "src"));
  writeFileSync(join(cwd, "src", "a.ts"), Array.from({ length: 150 }, (_, i) => `const line${i + 1} = ${i + 1};`).join("\n") + "\n");
  writeFileSync(join(cwd, "src", "b.ts"), `export function add(a: number, b: number) {\n  return a + b;\n}\nexport function sub(a: number, b: number) {\n  return a + b;\n}\n`);
  writeFileSync(join(cwd, "many.txt"), Array.from({ length: 60 }, (_, i) => `needle ${i}`).join("\n"));
  writeFileSync(join(cwd, ".env"), "SECRET=1\n");
  writeFileSync(join(cwd, "README.md"), "# fixture\n");
  ctx = { cwd, yes: true, allowSecrets: false, outputChars: 8000, ask: async () => true };
});
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

describe("read", () => {
  test("returns a numbered window with a continuation hint", async () => {
    const r = await runTool("read", JSON.stringify({ path: "src/a.ts" }), ctx);
    expect(r.error).toBeFalsy();
    expect(r.content.startsWith("src/a.ts: lines 1-100 of 150")).toBe(true);
    expect(r.content).toContain("  1| const line1 = 1;");
    expect(r.content).toContain("offset=101");
  });
  test("honours offset and limit", async () => {
    const r = await runTool("read", JSON.stringify({ path: "src/a.ts", offset: 140, limit: 5 }), ctx);
    expect(r.content).toContain("lines 140-144 of 150");
  });
  test("explains a missing file", async () => {
    const r = await runTool("read", JSON.stringify({ path: "src/zzz.ts" }), ctx);
    expect(r.error).toBe(true);
    expect(r.content).toContain("No such file");
  });
  test("refuses secrets unless allowed", async () => {
    const r = await runTool("read", JSON.stringify({ path: ".env" }), ctx);
    expect(r.error).toBe(true);
    expect(r.content).toContain("secrets file");
    const ok = await runTool("read", JSON.stringify({ path: ".env" }), { ...ctx, allowSecrets: true });
    expect(ok.content).toContain("SECRET=1");
  });
  test("refuses paths outside the project", async () => {
    const r = await runTool("read", JSON.stringify({ path: "../../etc/hosts" }), ctx);
    expect(r.error).toBe(true);
  });
});

describe("edit", () => {
  test("replaces a unique match and reports a syntax check", async () => {
    const r = await runTool("edit", JSON.stringify({ path: "src/b.ts", old: "export function sub(a: number, b: number) {\n  return a + b;", new: "export function sub(a: number, b: number) {\n  return a - b;" }), ctx);
    expect(r.error).toBeFalsy();
    expect(r.content).toContain("syntax check: ok");
    expect(readFileSync(join(cwd, "src/b.ts"), "utf8")).toContain("return a - b;");
  });
  test("rejects an ambiguous match", async () => {
    const r = await runTool("edit", JSON.stringify({ path: "src/b.ts", old: "a: number, b: number", new: "x" }), ctx);
    expect(r.error).toBe(true);
    expect(r.content).toContain("matches 2 times");
  });
  test("offers closest lines when nothing matches", async () => {
    const r = await runTool("edit", JSON.stringify({ path: "src/b.ts", old: "export function add(a: number,b: number) {", new: "x" }), ctx);
    expect(r.error).toBe(true);
    expect(r.content).toContain("not found");
    expect(r.content).toContain("Closest lines");
    expect(r.content).toContain("export function add");
  });
  test("flags a syntax error it introduced", async () => {
    const r = await runTool("edit", JSON.stringify({ path: "src/b.ts", old: "return a - b;", new: "return a - ;" }), ctx);
    expect(r.error).toBe(true);
    expect(r.content).toContain("FAILED");
  });
});

describe("write", () => {
  test("creates nested directories and checks syntax", async () => {
    const r = await runTool("write", JSON.stringify({ path: "deep/nested/new.json", content: "{\"a\":1}" }), ctx);
    expect(r.error).toBeFalsy();
    expect(existsSync(join(cwd, "deep/nested/new.json"))).toBe(true);
    expect(r.content).toContain("Created");
  });
});

describe("grep and search", () => {
  test("grep finds matches", async () => {
    const r = await runTool("grep", JSON.stringify({ pattern: "function add" }), ctx);
    expect(r.content).toContain("src/b.ts:1:");
  });
  test("grep caps at 50 and asks to narrow", async () => {
    const r = await runTool("grep", JSON.stringify({ pattern: "needle" }), ctx);
    expect(r.content).toContain("Too many matches");
    expect(r.content).toContain("many.txt");
  });
  test("grep reports no match", async () => {
    const r = await runTool("grep", JSON.stringify({ pattern: "zebra_unicorn" }), ctx);
    expect(r.content).toContain("No matches");
  });
  test("search by substring and glob", async () => {
    const a = await runTool("search", JSON.stringify({ pattern: "b.ts" }), ctx);
    expect(a.content).toContain("src/b.ts");
    const g = await runTool("search", JSON.stringify({ pattern: "*.txt" }), ctx);
    expect(g.content).toContain("many.txt");
    expect(g.content).not.toContain(".env");
  });
});

describe("bash", () => {
  test("runs a command and reports exit code", async () => {
    const r = await runTool("bash", JSON.stringify({ command: "echo hi && exit 3" }), ctx);
    expect(r.content).toContain("hi");
    expect(r.content).toContain("exit code 3");
  });
  test("refuses commits and servers", async () => {
    const a = await runTool("bash", JSON.stringify({ command: "git commit -am x" }), ctx);
    expect(a.error).toBe(true);
    const b = await runTool("bash", JSON.stringify({ command: "npm run dev" }), ctx);
    expect(b.error).toBe(true);
    expect(b.content).toContain("server");
  });
  test("kills on timeout", async () => {
    const r = await runTool("bash", JSON.stringify({ command: "sleep 5", timeout_seconds: 1 }), ctx);
    expect(r.content).toContain("killed after 1s");
  });
  test("asks when not --yes and respects a no", async () => {
    const r = await runTool("bash", JSON.stringify({ command: "echo hi" }), { ...ctx, yes: false, ask: async () => false });
    expect(r.content).toContain("declined");
  });
});

describe("registry", () => {
  test("names missing parameters and unknown tools", async () => {
    const a = await runTool("read", "{}", ctx);
    expect(a.error).toBe(true);
    expect(a.content).toContain("missing required parameter path");
    const b = await runTool("nope", "{}", ctx);
    expect(b.content).toContain("Unknown tool");
  });
  test("tolerates a trailing comma", async () => {
    const r = await runTool("search", '{"pattern": "README",}', ctx);
    expect(r.content).toContain("README.md");
  });
});
