#!/usr/bin/env bun
import pkg from "../package.json";
import { CONFIG_PATH, PRESETS, loadConfig, saveConfig, type Overrides } from "./config";
import { loadProfile } from "./profile";
import { Client } from "./client";
import { runTask } from "./loop";
import { Trajectory, usageToday } from "./trajectory";
import { askTTY } from "./approvals";
import { detectCheck } from "./check";
import { TOOLS } from "./tools";
import type { Config, EndpointConfig, Message, RunEvent, RunStats } from "./types";
import { runTui } from "./tui";

const VERSION = pkg.version;
const isTTY = Boolean(process.stderr.isTTY) && !process.env.NO_COLOR;
const c = {
  dim: (s: string) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s),
  cyan: (s: string) => (isTTY ? `\x1b[36m${s}\x1b[0m` : s),
  green: (s: string) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s: string) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s: string) => (isTTY ? `\x1b[33m${s}\x1b[0m` : s),
};
const err = (s: string) => process.stderr.write(s + "\n");
const out = (s: string) => process.stdout.write(s + "\n");

interface Flags extends Overrides {
  yes: boolean;
  allowSecrets: boolean;
  quiet: boolean;
  quick: boolean;
  tui: boolean;
  plain: boolean;
}

function parseArgv(argv: string[]): { cmd: string; rest: string[]; flags: Flags } {
  const flags: Flags = { yes: false, allowSecrets: false, quiet: false, quick: false, tui: false, plain: false };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "-y": case "--yes": flags.yes = true; break;
      case "--allow-secrets": flags.allowSecrets = true; break;
      case "-q": case "--quiet": flags.quiet = true; break;
      case "--quick": flags.quick = true; break;
      case "--tui": flags.tui = true; break;
      case "--plain": flags.plain = true; break;
      case "--no-check": flags.no_check = true; break;
      case "--check": flags.check = next(); break;
      case "--context": flags.context_tokens = Number(next()); break;
      case "--model": flags.model = next(); break;
      case "--base-url": flags.base_url = next(); break;
      case "--api-key": flags.api_key = next(); break;
      case "--preset": flags.preset = next() as Overrides["preset"]; break;
      case "-h": case "--help": rest.unshift("help"); break;
      case "-v": case "--version": rest.unshift("version"); break;
      default: rest.push(a);
    }
  }
  const cmd = ["init", "doctor", "help", "version", "repl"].includes(rest[0]) ? rest.shift()! : rest.length ? "run" : "repl";
  return { cmd, rest, flags };
}

const HELP = `glmh ${VERSION}: coding agent built for GLM-4.7-Flash, free with your own key.

usage:
  glmh init                 set up your endpoint and key (takes a minute)
  glmh "task"               run one task in the current directory, plain output
  glmh                      full-screen session (falls back to plain when not a terminal)
  glmh --tui "task"         full-screen session that starts with the task
  glmh --plain              line-based session
  glmh doctor               check endpoint, key, tools and today's usage

flags:
  -y, --yes                 do not ask before running commands (destructive ones still ask)
  --context N               context window to use (default: the model's 200k)
  --check "cmd"             command to verify the result; auto-detected if omitted
  --no-check                skip the final verification run
  --allow-secrets           allow reading .env and key files
  --preset zenmux|zai       override the configured endpoint preset
  --model, --base-url, --api-key   one-off endpoint overrides
  -q, --quiet               only print the final summary

config: ${CONFIG_PATH}, plus optional ./glmh.toml with check = "..." and context_tokens = N`;

class Spinner {
  private timer?: ReturnType<typeof setInterval>;
  private start = 0;
  private label = "";
  private frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private i = 0;
  constructor(private enabled: boolean) {}
  go(label: string) {
    this.stop();
    this.label = label;
    this.start = Date.now();
    if (!this.enabled) return;
    this.timer = setInterval(() => {
      const s = Math.round((Date.now() - this.start) / 1000);
      process.stderr.write(`\r\x1b[2K${c.dim(`${this.frames[this.i++ % this.frames.length]} ${this.label} ${s}s`)}`);
    }, 250);
  }
  note(text: string) {
    if (this.enabled) process.stderr.write(`\r\x1b[2K`);
    err(c.yellow(`! ${text}`));
  }
  relabel(label: string) {
    if (this.timer) this.label = label;
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.enabled) process.stderr.write(`\r\x1b[2K`);
  }
}

function fmtArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([k, v]) => {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      const one = s.replace(/\n/g, "⏎");
      return `${k}=${one.length > 70 ? one.slice(0, 70) + "…" : one}`;
    })
    .join(" ");
}

function makeEmitter(traj: Trajectory, spinner: Spinner, quiet: boolean, config: Config): (e: RunEvent) => void {
  const streamed = new Set<number>();
  return (e) => {
    traj.log(e as unknown as Record<string, unknown>);
    if (quiet && e.type !== "done") return;
    switch (e.type) {
      case "request":
        spinner.go(`turn ${e.turn}: waiting for GLM (${e.est_tokens.toLocaleString()} tokens in)`);
        break;
      case "stream_reasoning":
        spinner.relabel(`turn ${e.turn}: thinking`);
        break;
      case "stream_text":
        if (!streamed.has(e.turn)) {
          spinner.stop();
          streamed.add(e.turn);
          process.stderr.write("  ");
        }
        process.stderr.write(c.dim(e.delta.replace(/\n/g, "\n  ")));
        break;
      case "aborted":
        spinner.stop();
        err(c.yellow(`⨯ cancelled turn ${e.turn}; partial output discarded`));
        break;
      case "response": {
        spinner.stop();
        const bits = [`${(e.ms / 1000).toFixed(1)}s`, `${e.usage.prompt_tokens ?? "?"}+${e.usage.completion_tokens ?? "?"} tokens`];
        if (e.usage.reasoning_tokens) bits.push(`thought ${e.usage.reasoning_tokens}`);
        if (e.retries) bits.push(`${e.retries} retr${e.retries === 1 ? "y" : "ies"}`);
        if (e.recovered) bits.push("recovered tool call from text");
        err(c.dim(`  turn ${e.turn} · ${bits.join(" · ")}`));
        break;
      }
      case "assistant":
        if (streamed.has(e.turn)) err("");
        else err(c.dim(e.content.trim().split("\n").map((l) => `  ${l}`).join("\n")));
        break;
      case "tool_call":
        err(c.cyan(`→ ${e.name} ${fmtArgs(e.args)}`));
        break;
      case "tool_result":
        err(`  ${e.error ? c.red("✗") : c.green("✓")} ${c.dim(`${e.chars.toLocaleString()} chars · ${(e.ms / 1000).toFixed(1)}s`)}`);
        break;
      case "note":
        spinner.note(e.text);
        break;
      case "check":
        err(e.ok ? c.green(`✓ check passed: ${e.command}`) : c.red(`✗ check failed: ${e.command}`));
        if (!e.ok) err(c.dim(e.output.split("\n").slice(-20).map((l) => `  ${l}`).join("\n")));
        break;
      case "done":
        spinner.stop();
        break;
      default:
        break;
    }
  };
}

function printDone(reason: string, summary: string, stats: RunStats, config: Config, cwd: string) {
  out("");
  const tag = reason === "complete" ? c.green("done") : c.yellow(reason.replace("_", " "));
  out(`${c.bold("glmh")} ${tag}`);
  out(summary.trim());
  const git = Bun.spawnSync(["git", "diff", "--stat"], { cwd });
  if (git.exitCode === 0 && git.stdout.toString().trim()) out(`\n${c.dim(git.stdout.toString().trimEnd())}`);
  const mins = (stats.wall_ms / 60000).toFixed(1);
  out(c.dim(`\n${stats.requests} requests · ${stats.tool_calls} tool calls · ${stats.prompt_tokens.toLocaleString()} in / ${stats.completion_tokens.toLocaleString()} out · ${mins} min` +
    (stats.malformed_calls ? ` · ${stats.malformed_calls} recovered calls` : "") + (stats.edit_failures ? ` · ${stats.edit_failures} edit misses` : "")));
  const u = usageToday();
  const est = config.daily_request_estimate;
  const perTask = Math.max(8, stats.requests);
  const left = Math.max(0, Math.floor((est - u.requests) / perTask));
  const line = `requests today: ${u.requests} / ~${est} · est. tasks left: ~${left}`;
  out(u.requests >= est * 0.8 ? c.yellow(line + " · near the daily cap") : c.dim(line));
}

async function ask(question: string): Promise<boolean> {
  return askTTY(question);
}

async function cmdRun(task: string, flags: Flags, cwd: string): Promise<number> {
  const config = loadConfig(cwd, flags);
  if (!config.endpoint.api_key) {
    err(c.red("No API key configured. Run: glmh init"));
    return 2;
  }
  if (!config.check && !flags.no_check) config.check = detectCheck(cwd);
  const profile = loadProfile();
  const spinner = new Spinner(isTTY && !flags.quiet);
  const client = new Client(config.endpoint, profile, config.limits, (t) => spinner.note(t));
  const traj = new Trajectory(cwd);
  const emit = makeEmitter(traj, spinner, flags.quiet, config);
  if (!flags.quiet) err(c.dim(`glmh ${VERSION} · ${config.endpoint.model} via ${config.endpoint.kind} · context ${config.limits.context_tokens} · ${config.check ? `check: ${config.check}` : "no check"} · log ${traj.path}`));
  const result = await runTask(task, { client, profile, config, cwd, yes: flags.yes, allowSecrets: flags.allowSecrets, emit, ask });
  printDone(result.reason, result.summary, result.stats, config, cwd);
  return result.reason === "complete" ? 0 : 1;
}

async function cmdRepl(flags: Flags, cwd: string): Promise<number> {
  const config = loadConfig(cwd, flags);
  if (!config.endpoint.api_key) {
    err(c.red("No API key configured. Run: glmh init"));
    return 2;
  }
  if (!process.stdin.isTTY) {
    err("No task given and no terminal attached. Usage: glmh \"task\"");
    return 2;
  }
  if (!config.check && !flags.no_check) config.check = detectCheck(cwd);
  const profile = loadProfile();
  const spinner = new Spinner(isTTY);
  const client = new Client(config.endpoint, profile, config.limits, (t) => spinner.note(t));
  const traj = new Trajectory(cwd);
  const emit = makeEmitter(traj, spinner, false, config);
  err(c.dim(`glmh ${VERSION} · ${config.endpoint.model} via ${config.endpoint.kind} · type a task, /reset, /diff or /quit`));
  let history: Message[] | undefined;
  while (true) {
    const line = prompt(c.bold("glmh>"));
    if (line === null || /^\/(q|quit|exit)$/.test(line.trim())) return 0;
    const t = line.trim();
    if (!t) continue;
    if (t === "/reset") { history = undefined; err(c.dim("conversation cleared")); continue; }
    if (t === "/diff") { const g = Bun.spawnSync(["git", "diff", "--stat"], { cwd }); out(g.stdout.toString() || "no changes"); continue; }
    if (t === "/help") { out(HELP); continue; }
    const result = await runTask(t, { client, profile, config, cwd, yes: flags.yes, allowSecrets: flags.allowSecrets, emit, ask }, history);
    history = result.messages;
    printDone(result.reason, result.summary, result.stats, config, cwd);
  }
}

async function cmdTui(flags: Flags, cwd: string, initialTask?: string): Promise<number> {
  const config = loadConfig(cwd, flags);
  if (!config.endpoint.api_key) {
    err(c.red("No API key configured. Run: glmh init"));
    return 2;
  }
  if (!config.check && !flags.no_check) config.check = detectCheck(cwd);
  return runTui({ config, profile: loadProfile(), cwd, yes: flags.yes, allowSecrets: flags.allowSecrets, version: VERSION, initialTask });
}

async function testEndpoint(endpoint: EndpointConfig, quick: boolean): Promise<{ ok: boolean; notes: string[] }> {
  const profile = loadProfile();
  const notes: string[] = [];
  const spinner = new Spinner(isTTY);
  const client = new Client(endpoint, profile, { ...profile.limits, min_request_gap_ms: 0 }, (t) => spinner.note(t));
  try {
    spinner.go("listing models");
    const ids = await client.listModels();
    spinner.stop();
    // Z.ai's /models omits the free Flash models, so absence from the list is a warning; the chat test decides.
    notes.push(ids.includes(endpoint.model) ? `model ${endpoint.model}: listed` : `model ${endpoint.model}: not in the ${ids.length} listed models (Z.ai omits free Flash models; testing it directly)`);
  } catch (e) {
    spinner.stop();
    notes.push(`could not list models: ${(e as Error).message}`);
  }
  try {
    spinner.go("test call (the free route can take up to a minute when busy)");
    const r = await client.chat([{ role: "user", content: "Reply with exactly: ok" }], [], { max_tokens: 20, thinking: false });
    spinner.stop();
    notes.push(`chat: ok in ${(r.ms / 1000).toFixed(1)}s${r.retries ? ` after ${r.retries} retries` : ""}`);
  } catch (e) {
    spinner.stop();
    notes.push(`chat failed: ${(e as Error).message}`);
    return { ok: false, notes };
  }
  if (quick) return { ok: true, notes };
  try {
    spinner.go("tool-call test");
    const r = await client.chat(
      [{ role: "system", content: "You are a coding agent. Use tools." }, { role: "user", content: "Read the first 20 lines of README.md." }],
      [TOOLS.read.schema],
      { max_tokens: 1500 },
    );
    spinner.stop();
    const tc = r.message.tool_calls?.[0];
    notes.push(tc ? `tool calling: ok (${tc.function.name} ${tc.function.arguments.slice(0, 60)})` : "tool calling: model answered in text instead of a tool call; the harness will fall back to parsing");
    notes.push(r.message.reasoning_content ? `thinking: returned (${r.message.reasoning_content.length} chars)` : `thinking: ${r.usage.reasoning_tokens ? `${r.usage.reasoning_tokens} tokens used, content not returned` : "none"}`);
  } catch (e) {
    spinner.stop();
    notes.push(`tool-call test failed: ${(e as Error).message}`);
  }
  return { ok: true, notes };
}

async function cmdInit(flags: Flags): Promise<number> {
  out(c.bold(`glmh ${VERSION} setup`));
  out("glmh talks to GLM-4.7-Flash through a free API key that you own. Two free providers:");
  out("  1) Z.ai     https://z.ai/model-api                     model glm-4.7-flash (recommended, ~1,000 requests a day)");
  out("  2) ZenMux   https://zenmux.ai/platform/pay-as-you-go   model z-ai/glm-4.7-flash-free (small hourly quota)");
  out("  3) custom OpenAI-compatible URL (for example a local llama.cpp or Ollama server)");
  let preset = flags.preset;
  let base_url = flags.base_url;
  let model = flags.model;
  if (!preset && !base_url) {
    const a = process.stdin.isTTY ? (prompt("Choose [1/2/3]", "1") ?? "1").trim() : "1";
    if (a === "2") preset = "zenmux";
    else if (a === "3") {
      base_url = (prompt("Base URL (ending in /v1 or /v4)") ?? "").trim();
      model = (prompt("Model id", "glm-4.7-flash") ?? "glm-4.7-flash").trim();
    } else preset = "zai";
  }
  const p = preset ? PRESETS[preset] : undefined;
  const endpoint: EndpointConfig = {
    kind: preset ?? "openai",
    base_url: String(base_url ?? p?.base_url ?? "").replace(/\/+$/, ""),
    model: String(model ?? p?.model ?? "glm-4.7-flash"),
    api_key: flags.api_key ?? process.env.GLMH_API_KEY ?? "",
  };
  if (!endpoint.base_url) { err(c.red("A base URL is required.")); return 2; }
  if (!endpoint.api_key) {
    if (!process.stdin.isTTY) { err(c.red("Pass --api-key or set GLMH_API_KEY when not in a terminal.")); return 2; }
    out(c.dim("Paste your API key. It is stored only in your config file with mode 600 and sent only to the endpoint above."));
    endpoint.api_key = (prompt("API key") ?? "").trim();
    if (!endpoint.api_key) { err(c.red("No key entered.")); return 2; }
  }
  const t = await testEndpoint(endpoint, flags.quick);
  for (const n of t.notes) out(`  ${n.includes("fail") ? c.red("✗") : n.includes("not in") ? c.yellow("·") : c.green("✓")} ${n}`);
  if (!t.ok) {
    err(c.red("Setup did not complete. Fix the key or model access and run glmh init again."));
    if (endpoint.kind === "zenmux") err(c.dim("ZenMux keys have an allowed-model list; make sure z-ai/glm-4.7-flash-free is on it."));
    return 1;
  }
  const path = saveConfig(endpoint);
  out(`\n${c.green("saved")} ${path}`);
  out(c.dim("Privacy: your prompts and the file contents the agent reads are sent to the endpoint above. Z.ai states API content is not stored. Never paste secrets into a task; .env and key files are not read unless you pass --allow-secrets."));
  out(`\nTry it in any repository:  ${c.bold('glmh "explain what this project does"')}`);
  return 0;
}

async function cmdDoctor(flags: Flags, cwd: string): Promise<number> {
  const config = loadConfig(cwd, flags);
  const profile = loadProfile();
  out(c.bold(`glmh ${VERSION} doctor`));
  out(`  config: ${CONFIG_PATH}`);
  out(`  endpoint: ${config.endpoint.kind} ${config.endpoint.base_url} model ${config.endpoint.model}`);
  out(`  key: ${config.endpoint.api_key ? c.green("present") : c.red("missing (run glmh init)")}`);
  out(`  ripgrep: ${Bun.which("rg") ? c.green("found") : c.yellow("not found; grep falls back to GNU grep, slower and no glob filter")}`);
  out(`  profile: ${profile.model.name} · temp ${profile.sampling.temperature} · thinking ${profile.thinking.enabled ? "on" : "off"}${profile.thinking.preserved ? ", preserved" : ""} · context ${config.limits.context_tokens.toLocaleString()}`);
  const check = config.check ?? detectCheck(cwd);
  out(`  project check here: ${check ?? c.dim("none detected; set check = \"...\" in glmh.toml")}`);
  const u = usageToday();
  out(`  usage today: ${u.requests} requests, ${u.tokens.toLocaleString()} tokens, estimate cap ~${config.daily_request_estimate}`);
  if (!config.endpoint.api_key) return 1;
  const t = await testEndpoint(config.endpoint, flags.quick);
  for (const n of t.notes) out(`  ${n.includes("fail") ? c.red("✗") : n.includes("not in") ? c.yellow("·") : c.green("✓")} ${n}`);
  return t.ok ? 0 : 1;
}

async function main(): Promise<number> {
  const { cmd, rest, flags } = parseArgv(process.argv.slice(2));
  const cwd = process.cwd();
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !flags.plain;
  if (!(interactive && (cmd === "repl" || (cmd === "run" && flags.tui)))) {
    process.on("SIGINT", () => { process.stderr.write("\r\x1b[2K"); err(c.yellow("interrupted")); process.exit(130); });
  }
  switch (cmd) {
    case "help": out(HELP); return 0;
    case "version": out(VERSION); return 0;
    case "init": return cmdInit(flags);
    case "doctor": return cmdDoctor(flags, cwd);
    case "repl": return interactive ? cmdTui(flags, cwd) : cmdRepl(flags, cwd);
    case "run": return interactive && flags.tui ? cmdTui(flags, cwd, rest.join(" ")) : cmdRun(rest.join(" "), flags, cwd);
    default: out(HELP); return 2;
  }
}

process.exit(await main());
