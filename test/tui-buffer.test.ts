import { describe, expect, test } from "bun:test";
import { blocksToLines, clip, lastLine, plainStyle, renderBlock, renderMarkdown, viewport, wrapText, type Block } from "../src/tui/buffer";

const o = { showThinking: false, now: 1000, style: plainStyle };

describe("wrapText", () => {
  test("wraps at spaces and keeps newlines", () => {
    expect(wrapText("the quick brown fox jumps", 10)).toEqual(["the quick", "brown fox", "jumps"]);
    expect(wrapText("a\n\nb", 10)).toEqual(["a", "", "b"]);
  });
  test("hard-breaks tokens wider than the width", () => {
    expect(wrapText("abcdefghijkl", 5)).toEqual(["abcde", "fghij", "kl"]);
  });
  test("keeps runs of spaces inside code", () => {
    expect(wrapText("if (x) {\n    return 1;\n}", 40)).toEqual(["if (x) {", "    return 1;", "}"]);
  });
  test("counts wide characters as two columns", () => {
    expect(wrapText("该模型当前访问量过大", 8)).toEqual(["该模型当", "前访问量", "过大"]);
  });
});

describe("renderBlock", () => {
  test("user and assistant prefixes with continuation indent", () => {
    const u = renderBlock({ kind: "user", text: "one two three four", at: 0 }, 16, o);
    expect(u[0]).toMatch(/^── \d\d:\d\d ─+$/);
    expect(u.slice(1)).toEqual(["you › one two", "      three four"]);
    expect(renderBlock({ kind: "assistant", turn: 1, text: "", streaming: true }, 20, o)[0]).toMatch(/^glm › .$/);
    expect(renderBlock({ kind: "assistant", turn: 1, text: "", streaming: false }, 20, o)).toEqual([]);
  });
  test("thinking collapses to one line unless expanded", () => {
    const b: Block = { kind: "thinking", turn: 1, text: "deep thoughts here", chars: 18, streaming: false };
    expect(renderBlock(b, 40, o)).toEqual(["      thinking (18 chars) · /think"]);
    expect(renderBlock(b, 40, { ...o, showThinking: true })[0]).toContain("┆ deep thoughts here");
  });
  test("tool block shows running, ok and error states", () => {
    const base = { kind: "tool" as const, id: "1", label: "read a.ts", detail: "", startedAt: 0, tail: [] as string[], snippet: [] as string[] };
    expect(renderBlock({ ...base, status: "running" }, 40, o)[1]).toMatch(/^    . 1s$/);
    expect(renderBlock({ ...base, status: "ok", detail: "120 chars · 0.1s", ms: 100 }, 40, o)[1]).toBe("    ✓ 120 chars · 0.1s");
    expect(renderBlock({ ...base, status: "error", detail: "No such file" }, 40, o)[1]).toBe("    ✗ No such file");
    const running = renderBlock({ ...base, label: "$ bun test", status: "running", tail: ["a", "b", "c", "d", "e", "f", "g"] }, 40, o);
    expect(running.slice(1, 7)).toEqual(["    │ b", "    │ c", "    │ d", "    │ e", "    │ f", "    │ g"]);
    const edited = renderBlock({ ...base, label: "edit a.ts", status: "ok", detail: "Edited a.ts", snippet: ["12| x", "13| y"] }, 40, o);
    expect(edited.slice(1)).toEqual(["    ✓ Edited a.ts", "      12| x", "      13| y"]);
  });
  test("check failure shows the output tail", () => {
    const lines = renderBlock({ kind: "check", command: "bun test", ok: false, output: "a\nb\nc" }, 40, o);
    expect(lines[0]).toBe("  ✗ check failed: bun test");
    expect(lines.slice(1)).toEqual(["    a", "    b", "    c"]);
  });
  test("blocks are separated by a blank line, activity blocks stack tightly", () => {
    const lines = blocksToLines([{ kind: "note", text: "x" }, { kind: "note", text: "y" }], 40, o);
    expect(lines).toEqual(["  ! x", "", "  ! y"]);
    const tool = (id: string): Block => ({ kind: "tool", id, label: `read ${id}`, status: "ok", detail: "ok", startedAt: 0, tail: [], snippet: [] });
    const stacked = blocksToLines([tool("a"), { kind: "thinking", turn: 1, text: "", chars: 5, streaming: false }, tool("b"), { kind: "assistant", turn: 1, text: "done", streaming: false }], 60, o);
    expect(stacked).toEqual(["  → read a", "    ✓ ok", "      thinking (5 chars) · /think", "  → read b", "    ✓ ok", "", "glm › done"]);
  });
  test("bash keeps its last lines after success", () => {
    const b: Block = { kind: "tool", id: "1", label: "$ bun test", status: "ok", detail: "exit code 0", startedAt: 0, tail: ["1 pass", "0 fail", "Ran 1 test"], snippet: [] };
    expect(renderBlock(b, 60, o)).toEqual(["  → $ bun test", "    │ 1 pass", "    │ 0 fail", "    │ Ran 1 test", "    ✓ exit code 0"]);
  });
});

describe("renderMarkdown", () => {
  test("bullets, bold, inline code and headings", () => {
    const lines = renderMarkdown("# Title\n- **bold** item with `code`\n  - nested\n1. first\nplain", 40, plainStyle);
    expect(lines).toEqual(["Title", "• bold item with code", "  • nested", "1. first", "plain"]);
  });
  test("fenced code keeps indentation and is not wrapped at spaces oddly", () => {
    const lines = renderMarkdown("```ts\nif (x) {\n    return 1;\n}\n```\nafter", 40, plainStyle);
    expect(lines).toEqual(["│ if (x) {", "│     return 1;", "│ }", "after"]);
  });
  test("wraps long bullet continuation under the text", () => {
    const lines = renderMarkdown("- alpha beta gamma delta", 14, plainStyle);
    expect(lines).toEqual(["• alpha beta", "  gamma delta"]);
  });
});

describe("thinking glimpse", () => {
  test("shows the last line of reasoning while streaming, cut from the left", () => {
    const b: Block = { kind: "thinking", turn: 1, text: "first line\nthe test expects trailing dashes to be removed", chars: 60, streaming: true };
    const line = renderBlock(b, 70, o)[0];
    expect(line).toContain("thinking (60 chars) · ");
    expect(line.endsWith("removed")).toBe(true);
    expect(lastLine("abcdefghij", 6)).toBe("…fghij");
  });
});

describe("banner", () => {
  const rows = [["ART1", ""], ["ART2", "fact one"], ["ART3", "fact two"]].map((r) => JSON.stringify(r));
  test("wide terminals get art beside facts, narrow ones only facts", () => {
    expect(renderBlock({ kind: "banner", lines: rows }, 100, o)).toEqual([" ART1   ", " ART2   fact one", " ART3   fact two"]);
    expect(renderBlock({ kind: "banner", lines: rows }, 80, o)).toEqual(["  fact one", "  fact two"]);
  });
});

describe("viewport", () => {
  const lines = Array.from({ length: 10 }, (_, i) => `l${i}`);
  test("follows the tail when scroll is 0 and pads short content", () => {
    expect(viewport(lines, 4, 0).rows).toEqual(["l6", "l7", "l8", "l9"]);
    expect(viewport(["a"], 3, 0).rows).toEqual(["a", "", ""]);
  });
  test("scrolls up and clamps", () => {
    expect(viewport(lines, 4, 3).rows).toEqual(["l3", "l4", "l5", "l6"]);
    const v = viewport(lines, 4, 99);
    expect(v.rows).toEqual(["l0", "l1", "l2", "l3"]);
    expect(v.scroll).toBe(6);
    expect(v.atBottom).toBe(false);
  });
});

describe("clip", () => {
  test("cuts by visible width without breaking escape codes", () => {
    const styled = "\x1b[36mabcdef\x1b[0m";
    const c = clip(styled, 3);
    expect(Bun.stringWidth(c)).toBe(3);
    expect(c.startsWith("\x1b[36mabc")).toBe(true);
    expect(clip("short", 10)).toBe("short");
  });
});
