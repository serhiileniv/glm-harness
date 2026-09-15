/** Transcript blocks → wrapped, styled lines → viewport. Pure apart from Bun.stringWidth. */

export type Block =
  | { kind: "user"; text: string; at: number }
  | { kind: "assistant"; turn: number; text: string; streaming: boolean }
  | { kind: "thinking"; turn: number; text: string; chars: number; streaming: boolean }
  | { kind: "tool"; id: string; label: string; status: "running" | "ok" | "error"; detail: string; startedAt: number; ms?: number; tail: string[]; snippet: string[] }
  | { kind: "note"; text: string }
  | { kind: "check"; command: string; ok: boolean; output: string }
  | { kind: "done"; reason: string; summary: string; diff: string; stats: string; quota: string; quotaWarn: boolean }
  | { kind: "aborted"; turn: number }
  | { kind: "system"; text: string }
  | { kind: "banner"; lines: string[] };

export interface Style {
  dim(s: string): string;
  bold(s: string): string;
  cyan(s: string): string;
  green(s: string): string;
  red(s: string): string;
  yellow(s: string): string;
  magenta(s: string): string;
}

export const plainStyle: Style = { dim: (s) => s, bold: (s) => s, cyan: (s) => s, green: (s) => s, red: (s) => s, yellow: (s) => s, magenta: (s) => s };

export interface RenderOptions {
  showThinking: boolean;
  now: number;
  style: Style;
}

const width = (s: string) => Bun.stringWidth(s);
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const spin = (now: number) => SPIN[Math.floor(now / 100) % SPIN.length];
const ANSI = /^\x1b\[[0-9;]*m/;

/** Greedy word wrap. Keeps existing newlines and runs of spaces; hard-breaks tokens wider than `w`. ANSI-safe. */
export function wrapText(text: string, w: number): string[] {
  const out: string[] = [];
  const max = Math.max(1, w);
  for (const para of text.replace(/\r/g, "").replace(/\t/g, "    ").split("\n")) {
    if (para === "") {
      out.push("");
      continue;
    }
    let line = "";
    let started = false; // distinguishes "no token yet" from "tokens so far were empty", so leading spaces survive
    for (const tok of para.split(" ")) {
      const pieces = width(tok) > max ? hardBreak(tok, max) : [tok];
      for (const piece of pieces) {
        const candidate = started ? `${line} ${piece}` : piece;
        started = true;
        if (width(candidate) <= max) line = candidate;
        else {
          out.push(line);
          line = piece;
        }
      }
    }
    out.push(line);
  }
  return out;
}

function hardBreak(tok: string, max: number): string[] {
  const parts: string[] = [];
  let cur = "";
  let i = 0;
  while (i < tok.length) {
    const m = tok.slice(i).match(ANSI);
    if (m) {
      cur += m[0];
      i += m[0].length;
      continue;
    }
    const ch = String.fromCodePoint(tok.codePointAt(i)!);
    if (width(cur + ch) > max) {
      parts.push(cur);
      cur = ch;
    } else cur += ch;
    i += ch.length;
  }
  if (cur) parts.push(cur);
  return parts;
}

/** Inline markdown: **bold**, `code`. Applied before wrapping; escape codes are zero-width. */
export function inlineMarkdown(text: string, s: Style): string {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, (_, x) => s.bold(x))
    .replace(/`([^`\n]+)`/g, (_, x) => s.cyan(x));
}

/** Block markdown: fenced code, headings, bullets, numbered lists, paragraphs. Returns wrapped lines. */
export function renderMarkdown(text: string, w: number, s: Style): string[] {
  const out: string[] = [];
  let inCode = false;
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    if (/^\s*```/.test(raw)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      for (const l of wrapText(raw.replace(/\t/g, "    "), w - 2)) out.push(s.dim("│ ") + s.dim(l));
      continue;
    }
    const heading = raw.match(/^\s*#{1,6}\s+(.*)$/);
    if (heading) {
      out.push(...wrapText(inlineMarkdown(heading[1], s), w).map((l) => s.bold(l)));
      continue;
    }
    const bullet = raw.match(/^(\s*)[-*+]\s+(.*)$/);
    if (bullet) {
      const indent = bullet[1];
      const lines = wrapText(inlineMarkdown(bullet[2], s), w - indent.length - 2);
      out.push(...lines.map((l, i) => indent + (i === 0 ? "• " : "  ") + l));
      continue;
    }
    const numbered = raw.match(/^(\s*)(\d+[.)])\s+(.*)$/);
    if (numbered) {
      const indent = numbered[1];
      const marker = numbered[2] + " ";
      const lines = wrapText(inlineMarkdown(numbered[3], s), w - indent.length - marker.length);
      out.push(...lines.map((l, i) => indent + (i === 0 ? marker : " ".repeat(marker.length)) + l));
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(raw)) {
      out.push(s.dim("─".repeat(Math.min(w, 40))));
      continue;
    }
    out.push(...wrapText(inlineMarkdown(raw, s), w));
  }
  return out;
}

function indented(lines: string[], first: string, rest: string): string[] {
  return lines.map((l, i) => (i === 0 ? first : rest) + l);
}

export function renderBlock(b: Block, w: number, o: RenderOptions): string[] {
  const s = o.style;
  switch (b.kind) {
    case "user": {
      const t = new Date(b.at);
      const stamp = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
      return [s.dim(`── ${stamp} ` + "─".repeat(Math.max(0, w - stamp.length - 4))), ...indented(wrapText(b.text, w - 6), s.bold("you ") + s.dim("› "), "      ")];
    }
    case "assistant": {
      const prefix = s.cyan(s.bold("glm ")) + s.dim("› ");
      if (!b.text) return b.streaming ? [prefix + s.dim(spin(o.now))] : [];
      const lines = renderMarkdown(b.text, w - 6, s);
      return indented(lines, prefix, "      ");
    }
    case "thinking": {
      const n = b.chars || width(b.text);
      if (!o.showThinking) {
        if (!b.streaming) return [s.dim(`      thinking (${n.toLocaleString()} chars) · /think`)];
        const glimpse = lastLine(b.text, Math.max(20, w - 30));
        return [s.dim(`      ${spin(o.now)} thinking (${n.toLocaleString()} chars)${glimpse ? " · " + glimpse : ""}`)];
      }
      return indented(wrapText(b.text || "…", w - 8), s.dim("      ┆ "), s.dim("      ┆ ")).map((l) => s.dim(l));
    }
    case "tool": {
      const head = indented(wrapText(b.label, w - 4), s.dim("  → "), "    ");
      const tail = (lines: string[], n: number) => lines.slice(-n).flatMap((l) => wrapText(l, w - 6)).map((l) => s.dim("    │ " + l));
      if (b.status === "running") return [...head, ...tail(b.tail, 6), ...wrapText(s.dim(`    ${spin(o.now)} ${Math.round((o.now - b.startedAt) / 1000)}s`), w)];
      if (b.status === "ok") {
        const snippet = b.snippet.flatMap((l) => wrapText(l, w - 6)).map((l) => s.dim("      " + l));
        const kept = b.label.startsWith("$ ") ? tail(b.tail, 3) : [];
        return [...head, ...kept, ...wrapText(`    ${s.green("✓")} ${s.dim(b.detail)}`, w), ...snippet];
      }
      return [...head, ...tail(b.tail, 6), ...wrapText(`    ${s.red("✗")} ${s.dim(b.detail)}`, w)];
    }
    case "note":
      return indented(wrapText(b.text, w - 4), s.yellow("  ! "), "    ");
    case "check": {
      const head = b.ok ? s.green(`  ✓ check passed: ${b.command}`) : s.red(`  ✗ check failed: ${b.command}`);
      if (b.ok) return [head];
      const tail = b.output.split("\n").slice(-20).flatMap((l) => wrapText(l, w - 4)).map((l) => s.dim("    " + l));
      return [head, ...tail];
    }
    case "done": {
      const lines: string[] = [];
      if (b.reason === "complete") lines.push(`  ${s.green("✓")} ${s.bold("done")} ${s.dim("· " + b.stats)}`);
      else {
        lines.push(`  ${s.yellow("⚠")} ${s.bold("stopped: " + b.reason.replace("_", " "))} ${s.dim("· " + b.stats)}`);
        if (b.summary.trim()) lines.push(...indented(wrapText(b.summary.trim(), w - 4), "    ", "    "));
      }
      if (b.diff) lines.push(...b.diff.split("\n").map((l) => "    " + s.dim(l.replace(/(\++)(-*)\s*$/, (_, p, m) => `${s.green(p)}${m ? s.red(m) : ""}`))));
      lines.push(b.quotaWarn ? s.yellow("    " + b.quota) : s.dim("    " + b.quota));
      return lines;
    }
    case "aborted":
      return [s.yellow(`  ⨯ cancelled turn ${b.turn} · partial output discarded`)];
    case "system":
      return wrapText(b.text, w - 2).map((l) => s.dim("  " + l));
    case "banner": {
      const rows = b.lines.map((l) => JSON.parse(l) as [string, string]);
      if (w < 84) return rows.filter(([, f]) => f).flatMap(([, f]) => wrapText(f, w - 2)).map((l) => s.dim("  " + l));
      return rows.map(([art, fact]) => s.cyan(" " + art) + "   " + s.dim(fact));
    }
  }
}

const TIGHT = new Set<Block["kind"]>(["tool", "thinking"]);

/** Blocks are separated by a blank line, except consecutive activity blocks (tool calls, thinking), which stack. */
export function blocksToLines(blocks: Block[], w: number, o: RenderOptions): string[] {
  const out: string[] = [];
  let prev: Block | undefined;
  for (const b of blocks) {
    const lines = renderBlock(b, w, o);
    if (!lines.length) continue;
    if (out.length && !(prev && TIGHT.has(prev.kind) && TIGHT.has(b.kind))) out.push("");
    out.push(...lines);
    prev = b;
  }
  return out;
}

/** `scroll` = lines above the bottom (0 follows the tail). Returns exactly `height` rows. */
export function viewport(lines: string[], height: number, scroll: number): { rows: string[]; scroll: number; atBottom: boolean } {
  const h = Math.max(0, height);
  const maxScroll = Math.max(0, lines.length - h);
  const sc = Math.max(0, Math.min(maxScroll, scroll));
  const start = Math.max(0, lines.length - h - sc);
  const rows = lines.slice(start, start + h);
  while (rows.length < h) rows.push("");
  return { rows, scroll: sc, atBottom: sc === 0 };
}

/** Clip a styled line to the terminal width without splitting escape codes. */
export function clip(line: string, w: number): string {
  if (width(line) <= w) return line;
  let out = "";
  let visible = 0;
  let i = 0;
  while (i < line.length) {
    if (line[i] === "\x1b") {
      const m = line.slice(i).match(ANSI);
      if (m) {
        out += m[0];
        i += m[0].length;
        continue;
      }
    }
    const cp = String.fromCodePoint(line.codePointAt(i)!);
    const cw = width(cp);
    if (visible + cw > w) break;
    out += cp;
    visible += cw;
    i += cp.length;
  }
  return out + "\x1b[0m";
}

/** Last non-empty line of a text, whitespace collapsed, cut from the left to fit. */
export function lastLine(text: string, max: number): string {
  const lines = text.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const l = lines[lines.length - 1] ?? "";
  if (width(l) <= max) return l;
  const chars = Array.from(l);
  let out = "";
  for (let i = chars.length - 1; i >= 0 && width(out) < max - 1; i--) out = chars[i] + out;
  return "…" + out;
}

export const plural = (n: number, word: string, pl = word + "s") => `${n.toLocaleString()} ${n === 1 ? word : pl}`;
