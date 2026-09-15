import { basename } from "node:path";
import { Client } from "../client";
import { runTask } from "../loop";
import { Trajectory, usageToday } from "../trajectory";
import type { Config, Message, Profile, RunEvent, RunStats } from "../types";
import { Screen } from "./screen";
import { decodeKeys, flushEscape, type Key } from "./keys";
import { applyKey, createInput, renderInput } from "./input";
import { blocksToLines, plural, viewport, type Block, type Style } from "./buffer";
import { existsSync } from "node:fs";

export interface TuiOptions {
  config: Config;
  profile: Profile;
  cwd: string;
  yes: boolean;
  allowSecrets: boolean;
  version: string;
  initialTask?: string;
}

const esc = (code: string) => (s: string) => `\x1b[${code}m${s}\x1b[0m`;
const style: Style = { dim: esc("2"), bold: esc("1"), cyan: esc("36"), green: esc("32"), red: esc("31"), yellow: esc("33"), magenta: esc("35") };
const w = (s: string) => Bun.stringWidth(s);
const HELP = `commands
  /diff    git diff --stat and status     /reset   start a new conversation
  /yes     toggle auto-approve            /think   show or hide the model's reasoning
  /copy    copy the last answer           /usage   requests today and this session
  /clear   clear the transcript           /quit    leave (also Ctrl-D)
keys
  Enter send · Esc cancel the current run · PgUp/PgDn scroll · Up/Down history · Ctrl-L redraw
approvals
  y yes · n no · a yes and stop asking for this session`;

type Phase = "idle" | "waiting" | "thinking" | "streaming" | "tools" | "check";

export function runTui(o: TuiOptions): Promise<number> {
  return new Promise<number>((resolve) => {
    const screen = new Screen();
    const traj = new Trajectory(o.cwd);
    const st = {
      blocks: [] as Block[],
      scroll: 0,
      input: createInput(),
      running: false,
      controller: undefined as AbortController | undefined,
      pending: undefined as { question: string; resolve: (v: boolean) => void } | undefined,
      showThinking: false,
      autoYes: o.yes,
      history: undefined as Message[] | undefined,
      turn: 0,
      phase: "idle" as Phase,
      turnStart: 0,
      tokensIn: 0,
      toolCalls: 0,
      retries: 0,
      hint: "",
      hintUntil: 0,
      ctrlCAt: 0,
      usage: usageToday(),
      sessionTurns: 0,
      sessionRequests: 0,
      quitting: false,
      git: gitInfo(o.cwd),
      toolText: new Map<string, string>(),
      queue: [] as string[],
      prevLines: 0,
    };
    let pendingEsc = "";
    let escTimer: ReturnType<typeof setTimeout> | undefined;
    let renderTimer: ReturnType<typeof setTimeout> | undefined;
    let ticker: ReturnType<typeof setInterval> | undefined;
    let finished = false;

    const schedule = () => {
      if (renderTimer || finished) return;
      renderTimer = setTimeout(() => {
        renderTimer = undefined;
        render();
      }, 33);
    };
    const push = (b: Block) => {
      st.blocks.push(b);
      schedule();
    };
    const note = (text: string) => push({ kind: "note", text });
    const system = (text: string) => push({ kind: "system", text });
    const hint = (text: string, ms = 3000) => {
      st.hint = text;
      st.hintUntil = Date.now() + ms;
      schedule();
    };
    const client = new Client(o.config.endpoint, o.profile, o.config.limits, (t) => {
      const m = t.match(/waiting (\d+)s/);
      if (m) hint(`endpoint busy, retrying in ${m[1]}s`, Number(m[1]) * 1000 + 500);
      else note(t);
      st.retries++;
    });

    const findLast = <K extends Block["kind"]>(kind: K, pred: (b: Extract<Block, { kind: K }>) => boolean): Extract<Block, { kind: K }> | undefined => {
      for (let i = st.blocks.length - 1; i >= 0; i--) {
        const b = st.blocks[i];
        if (b.kind === kind && pred(b as Extract<Block, { kind: K }>)) return b as Extract<Block, { kind: K }>;
      }
      return undefined;
    };

    const emit = (e: RunEvent) => {
      traj.log(e as unknown as Record<string, unknown>);
      switch (e.type) {
        case "turn":
          st.turn = e.turn;
          st.turnStart = Date.now();
          st.phase = "waiting";
          break;
        case "request":
          st.tokensIn = e.est_tokens;
          st.phase = "waiting";
          break;
        case "stream_reasoning": {
          st.phase = "thinking";
          let b = findLast("thinking", (x) => x.turn === e.turn);
          if (!b) {
            b = { kind: "thinking", turn: e.turn, text: "", chars: 0, streaming: true };
            st.blocks.push(b);
          }
          b.text += e.delta;
          b.chars = b.text.length;
          break;
        }
        case "stream_text": {
          st.phase = "streaming";
          const th = findLast("thinking", (x) => x.turn === e.turn);
          if (th) th.streaming = false;
          let b = findLast("assistant", (x) => x.turn === e.turn);
          if (!b) {
            b = { kind: "assistant", turn: e.turn, text: "", streaming: true };
            st.blocks.push(b);
          }
          b.text += e.delta;
          break;
        }
        case "thinking": {
          const b = findLast("thinking", (x) => x.turn === e.turn);
          if (b) {
            b.streaming = false;
            b.chars = e.chars;
          } else st.blocks.push({ kind: "thinking", turn: e.turn, text: "", chars: e.chars, streaming: false });
          break;
        }
        case "assistant": {
          const b = findLast("assistant", (x) => x.turn === e.turn);
          if (b) {
            b.text = e.content;
            b.streaming = false;
          } else st.blocks.push({ kind: "assistant", turn: e.turn, text: e.content, streaming: false });
          break;
        }
        case "response": {
          const th = findLast("thinking", (x) => x.turn === e.turn);
          if (th) th.streaming = false;
          const a = findLast("assistant", (x) => x.turn === e.turn);
          if (a) a.streaming = false;
          st.sessionRequests++;
          break;
        }
        case "tool_call":
          st.phase = "tools";
          st.toolCalls++;
          st.blocks.push({ kind: "tool", id: e.id, label: describeCall(e.name, e.args), status: "running", detail: "", startedAt: Date.now(), tail: [], snippet: [] });
          break;
        case "tool_output": {
          const b = findLast("tool", (x) => x.id === e.id);
          if (!b) break;
          const text = (st.toolText.get(e.id) ?? "") + e.chunk;
          st.toolText.set(e.id, text.slice(-4000));
          b.tail = text.replace(/\x1b\[[0-9;]*m/g, "").split("\n").filter((l) => l.trim()).slice(-6);
          break;
        }
        case "tool_result": {
          const b = findLast("tool", (x) => x.id === e.id);
          if (b) {
            b.status = e.error ? "error" : "ok";
            b.ms = e.ms;
            const secs = e.ms >= 100 ? ` · ${(e.ms / 1000).toFixed(1)}s` : "";
            b.detail = `${e.preview || (e.error ? "error" : `${e.chars.toLocaleString()} chars`)}${secs}`;
            b.snippet = e.snippet;
            st.toolText.delete(e.id);
            if (e.error && !b.tail.length && e.preview) b.tail = [];
          }
          break;
        }
        case "note":
          note(e.text);
          break;
        case "check":
          st.phase = "check";
          st.blocks.push({ kind: "check", command: e.command, ok: e.ok, output: e.output });
          break;
        case "aborted":
          st.blocks.push({ kind: "aborted", turn: e.turn });
          break;
        case "done": {
          if (e.reason !== "aborted") st.blocks.push(doneBlock(e.reason, e.summary, e.stats));
          break;
        }
        default:
          break;
      }
      schedule();
    };

    const doneBlock = (reason: string, summary: string, s: RunStats): Block => {
      const git = Bun.spawnSync(["git", "diff", "--stat"], { cwd: o.cwd });
      const diff = git.exitCode === 0 ? git.stdout.toString().trimEnd() : "";
      st.usage = usageToday();
      const est = o.config.daily_request_estimate;
      const perTask = Math.max(8, s.requests);
      const left = Math.max(0, Math.floor((est - st.usage.requests) / perTask));
      const mins = s.wall_ms < 60000 ? `${Math.round(s.wall_ms / 1000)}s` : `${(s.wall_ms / 60000).toFixed(1)} min`;
      const stats = `${mins} · ${plural(s.requests, "request")} · ${plural(s.tool_calls, "tool call")} · ${s.prompt_tokens.toLocaleString()} in / ${s.completion_tokens.toLocaleString()} out` +
        (s.malformed_calls ? ` · ${plural(s.malformed_calls, "recovered call")}` : "") + (s.edit_failures ? ` · ${plural(s.edit_failures, "edit miss", "edit misses")}` : "");
      const quota = `today ${st.usage.requests} / ~${est} requests · about ${left} more tasks like this one`;
      return { kind: "done", reason, summary, diff, stats, quota, quotaWarn: st.usage.requests >= est * 0.8 };
    };

    const ask = (question: string): Promise<boolean> =>
      new Promise((res) => {
        st.pending = { question, resolve: res };
        schedule();
      });
    const answer = (v: boolean) => {
      const p = st.pending;
      st.pending = undefined;
      p?.resolve(v);
      schedule();
    };

    const startRun = (task: string) => {
      st.running = true;
      st.controller = new AbortController();
      st.turn = 0;
      st.phase = "waiting";
      st.turnStart = Date.now();
      st.tokensIn = 0;
      st.toolCalls = 0;
      st.retries = 0;
      st.scroll = 0;
      push({ kind: "user", text: task, at: Date.now() });
      if (!ticker) ticker = setInterval(schedule, 250);
      runTask(task, { client, profile: o.profile, config: o.config, cwd: o.cwd, yes: st.autoYes, allowSecrets: o.allowSecrets, emit, ask, signal: st.controller.signal }, st.history)
        .then((r) => {
          st.history = r.messages;
          st.sessionTurns += r.stats.turns;
        })
        .catch((e) => note(`run failed: ${(e as Error).message}`))
        .finally(() => {
          st.running = false;
          st.controller = undefined;
          st.phase = "idle";
          if (ticker) {
            clearInterval(ticker);
            ticker = undefined;
          }
          st.usage = usageToday();
          st.git = gitInfo(o.cwd);
          schedule();
          if (st.quitting) return finish(0);
          const next = st.queue.shift();
          if (next) startRun(next);
        });
    };

    const cancel = () => {
      if (!st.running || !st.controller) return;
      st.controller.abort();
      hint("cancelling…");
    };

    const slash = (cmd: string) => {
      const [name, ...rest] = cmd.slice(1).split(/\s+/);
      switch (name) {
        case "help":
          system(HELP);
          break;
        case "diff": {
          const g = Bun.spawnSync(["git", "diff", "--stat"], { cwd: o.cwd });
          const s = Bun.spawnSync(["git", "status", "--short"], { cwd: o.cwd });
          system((g.stdout.toString().trim() || "no unstaged changes") + (s.stdout.toString().trim() ? `\n\n${s.stdout.toString().trimEnd()}` : ""));
          break;
        }
        case "reset":
          st.history = undefined;
          system("new conversation; the next task starts fresh");
          break;
        case "yes":
          st.autoYes = !st.autoYes;
          system(`auto-approve ${st.autoYes ? "on: commands run without asking (destructive ones still ask)" : "off"}`);
          break;
        case "think":
          st.showThinking = !st.showThinking;
          schedule();
          break;
        case "clear":
          st.blocks = [];
          schedule();
          break;
        case "copy": {
          const last = findLast("assistant", () => true);
          if (!last?.text) return note("nothing to copy yet");
          const tool = ["pbcopy", "wl-copy", "xclip"].find((t) => Bun.which(t));
          if (!tool) return note("no clipboard tool found (pbcopy, wl-copy or xclip)");
          const proc = Bun.spawn(tool === "xclip" ? ["xclip", "-selection", "clipboard"] : [tool], { stdin: "pipe" });
          proc.stdin.write(last.text);
          proc.stdin.end();
          system(`copied ${plural(last.text.length, "char")} to the clipboard`);
          break;
        }
        case "usage": {
          const u = usageToday();
          system(`today: ${u.requests} requests, ${u.tokens.toLocaleString()} tokens · estimate cap ~${o.config.daily_request_estimate}\nthis session: ${plural(st.sessionRequests, "request")}, ${plural(st.sessionTurns, "turn")}`);
          break;
        }
        case "quit":
        case "exit":
        case "q":
          quit();
          break;
        default:
          note(`unknown command /${name}${rest.length ? " " + rest.join(" ") : ""}; try /help`);
      }
    };

    const submit = (text: string) => {
      if (text.startsWith("/")) return slash(text);
      if (st.running) {
        st.queue.push(text);
        system(`queued (${st.queue.length}): ${text}`);
        return hint("queued; it starts when the current run finishes");
      }
      startRun(text);
    };

    const quit = () => {
      if (st.running) {
        st.quitting = true;
        cancel();
        return;
      }
      finish(0);
    };

    const finish = (code: number) => {
      if (finished) return;
      finished = true;
      if (ticker) clearInterval(ticker);
      if (renderTimer) clearTimeout(renderTimer);
      if (escTimer) clearTimeout(escTimer);
      screen.leave();
      process.stdout.write(`glmh session ended · ${plural(st.sessionRequests, "request")} · ${st.usage.requests} today · log ${traj.path}\n`);
      resolve(code);
    };

    const handleKey = (k: Key) => {
      if (st.pending) {
        if (k.name === "char" && /^y$/i.test(k.ch ?? "")) answer(true);
        else if (k.name === "char" && /^a$/i.test(k.ch ?? "")) {
          st.autoYes = true;
          system("auto-approve on for this session; destructive commands still ask");
          answer(true);
        } else if ((k.name === "char" && /^n$/i.test(k.ch ?? "")) || k.name === "escape" || k.name === "enter") answer(false);
        else if (k.name === "ctrl-c" || k.name === "ctrl-d") {
          answer(false);
          quit();
        }
        return;
      }
      switch (k.name) {
        case "ctrl-c":
          if (st.running) cancel();
          else if (st.input.text) st.input = createInput(st.input.history);
          else if (Date.now() - st.ctrlCAt < 1000) quit();
          else {
            st.ctrlCAt = Date.now();
            hint("press Ctrl-C again to quit, or type /quit");
          }
          break;
        case "ctrl-d":
          if (st.running) quit();
          else if (!st.input.text) quit();
          else st.input = applyKey(st.input, { name: "delete", seq: "" }).state;
          break;
        case "escape":
          if (st.running) cancel();
          else st.input = applyKey(st.input, k).state;
          break;
        case "ctrl-l":
          screen.clear();
          break;
        case "pageup":
          st.scroll += Math.max(1, screen.rows - 4);
          break;
        case "pagedown":
          st.scroll = Math.max(0, st.scroll - Math.max(1, screen.rows - 4));
          break;
        case "enter": {
          const r = applyKey(st.input, k);
          st.input = r.state;
          if (r.submit) submit(r.submit);
          break;
        }
        default:
          st.input = applyKey(st.input, k).state;
      }
      schedule();
    };

    const onData = (data: string) => {
      if (escTimer) {
        clearTimeout(escTimer);
        escTimer = undefined;
      }
      const { keys, rest } = decodeKeys(pendingEsc + data);
      pendingEsc = rest;
      for (const k of keys) handleKey(k);
      if (pendingEsc === "\x1b") {
        escTimer = setTimeout(() => {
          const flushed = flushEscape(pendingEsc);
          pendingEsc = "";
          for (const k of flushed) handleKey(k);
        }, 40);
      }
    };

    const header = (): string => {
      const left = ` ${style.cyan(style.bold("glmh"))} ${style.dim(`${o.version} · ${o.profile.model.name} · ${o.config.endpoint.kind} · ${basename(o.cwd)}${st.git ? " " + st.git : ""}`)}`;
      const right = style.dim(`today ${st.usage.requests} / ~${o.config.daily_request_estimate} `);
      const pad = Math.max(1, screen.cols - w(left) - w(right));
      return left + " ".repeat(pad) + right;
    };

    const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    const statusRow = (now: number): string => {
      let text: string;
      if (st.pending) text = style.yellow(`? ${st.pending.question}`);
      else if (now < st.hintUntil && st.hint) text = style.yellow(`! ${st.hint}`);
      else if (st.running) {
        const secs = Math.round((now - st.turnStart) / 1000);
        const phase = { waiting: "waiting for GLM", thinking: "thinking", streaming: "writing", tools: "running tools", check: "running check", idle: "" }[st.phase];
        text = style.cyan(SPIN[Math.floor(now / 100) % SPIN.length]) + style.dim(` turn ${st.turn} · ${phase} ${secs}s · ${st.tokensIn.toLocaleString()} in · ${plural(st.toolCalls, "tool call")}${st.retries ? ` · ${plural(st.retries, "retry", "retries")}` : ""}${st.queue.length ? ` · ${st.queue.length} queued` : ""} · Esc cancels`);
      } else text = style.dim(`ready · ${plural(st.sessionTurns, "turn")} this session${st.autoYes ? " · auto-approve on" : ""}${st.showThinking ? " · thinking shown" : ""} · /help`);
      const scrolled = st.scroll ? style.yellow(`  ↑ ${st.scroll} lines · PgDn to follow`) : "";
      return " " + text + scrolled;
    };

    const render = () => {
      if (finished) return;
      const { cols, rows } = screen;
      if (cols < 60 || rows < 12) {
        screen.draw([style.yellow(" terminal too small: glmh needs at least 60x12")], null);
        return;
      }
      const now = Date.now();
      const lines = blocksToLines(st.blocks, Math.min(cols - 2, 110), { showThinking: st.showThinking, now, style }).map((l) => " " + l);
      if (st.scroll > 0 && lines.length > st.prevLines) st.scroll += lines.length - st.prevLines; // stay put while reading
      st.prevLines = lines.length;
      const vp = viewport(lines, rows - 4, st.scroll);
      st.scroll = vp.scroll;
      let inputLine: string;
      let cursorCol: number;
      if (st.pending) {
        inputLine = ` ${style.bold("y")}${style.dim(" yes   ")}${style.bold("n")}${style.dim(" no   ")}${style.bold("a")}${style.dim(" yes, and stop asking this session   ")}${style.dim("Esc no")}`;
        cursorCol = 1;
      } else {
        const prompt = st.running ? style.dim(" › ") : style.cyan(style.bold(" › "));
        const r = renderInput(st.input, cols - 1, " › ");
        inputLine = prompt + r.line.slice(3);
        cursorCol = r.cursorCol;
        if (!st.input.text && !st.running) inputLine += style.dim("type a task, /help for commands");
      }
      screen.draw([header(), "", ...vp.rows, statusRow(now), inputLine], { row: rows - 1, col: cursorCol });
    };

    // boot
    try {
      screen.enter();
    } catch (e) {
      resolve(2);
      return;
    }
    process.stdout.write(`\x1b]0;glmh · ${basename(o.cwd)}\x07`);
    screen.onKeys(onData);
    screen.onResizeEvent(schedule);
    const onExit = () => finish(130);
    process.once("SIGINT", onExit);
    process.once("SIGTERM", onExit);
    process.once("uncaughtException", (err) => {
      screen.leave();
      process.stderr.write(`glmh crashed: ${err?.stack ?? err}\n`);
      resolve(1);
    });
    push({ kind: "banner", lines: welcomeCard(o, st.usage.requests) });
    render();
    if (o.initialTask) submit(o.initialTask);
  });
}

const BANNER = [
  " ██████╗ ██╗     ███╗   ███╗██╗  ██╗",
  "██╔════╝ ██║     ████╗ ████║██║  ██║",
  "██║  ███╗██║     ██╔████╔██║███████║",
  "██║   ██║██║     ██║╚██╔╝██║██╔══██║",
  "╚██████╔╝███████╗██║ ╚═╝ ██║██║  ██║",
  " ╚═════╝ ╚══════╝╚═╝     ╚═╝╚═╝  ╚═╝",
];

/** Banner plus four facts beside it; shown once, scrolls away with use. */
function welcomeCard(o: TuiOptions, today: number): string[] {
  const facts = [
    "",
    `${o.version} · ${o.profile.model.name} via ${o.config.endpoint.kind}`,
    o.cwd,
    `${o.config.check ? `check: ${o.config.check}` : "no check command detected"} · context ${Math.round(o.config.limits.context_tokens / 1000)}k · today ${today} / ~${o.config.daily_request_estimate}`,
    "Enter sends · Esc cancels a run · PgUp/PgDn scroll · /help",
    "",
  ];
  return BANNER.map((l, i) => ({ art: l, fact: facts[i] ?? "" })).map(({ art, fact }) => JSON.stringify([art, fact]));
}

/** "main ✚3": current branch and number of changed files, or "" outside git. */
function gitInfo(cwd: string): string {
  if (!existsSync(cwd)) return "";
  const br = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  if (br.exitCode !== 0) return "";
  const branch = br.stdout.toString().trim();
  const stt = Bun.spawnSync(["git", "status", "--porcelain"], { cwd });
  const dirty = stt.exitCode === 0 ? stt.stdout.toString().split("\n").filter(Boolean).length : 0;
  return `${branch}${dirty ? ` ✚${dirty}` : ""}`;
}

/** Human label for a tool call: what a colleague would say, not the JSON. */
function describeCall(name: string, a: Record<string, unknown>): string {
  const str = (v: unknown, max = 80) => {
    const s = (typeof v === "string" ? v : v === undefined ? "" : JSON.stringify(v)).replace(/\s+/g, " ").trim();
    return s.length > max ? s.slice(0, max) + "…" : s;
  };
  switch (name) {
    case "read": {
      const range = a.offset && Number(a.offset) > 1 ? ` from line ${a.offset}` : "";
      const lim = a.limit && Number(a.limit) !== 100 ? ` (${a.limit} lines)` : "";
      return `read ${str(a.path)}${range}${lim}`;
    }
    case "edit": {
      const oldLines = String(a.old ?? "").split("\n").length;
      const newLines = String(a.new ?? "").split("\n").length;
      return `edit ${str(a.path)} · ${plural(oldLines, "line")} → ${newLines}`;
    }
    case "write":
      return `write ${str(a.path)} · ${plural(String(a.content ?? "").split("\n").length, "line")}`;
    case "grep":
      return `grep /${str(a.pattern, 60)}/${a.path && a.path !== "." ? ` in ${str(a.path)}` : ""}${a.glob ? ` (${str(a.glob)})` : ""}`;
    case "search":
      return `search files matching ${str(a.pattern)}`;
    case "bash":
      return `$ ${str(a.command, 100)}`;
    default:
      return `${name} ${str(a, 80)}`;
  }
}

