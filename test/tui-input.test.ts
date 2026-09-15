import { describe, expect, test } from "bun:test";
import { applyKey, createInput, renderInput, type InputState } from "../src/tui/input";
import type { Key } from "../src/tui/keys";

const k = (name: string, extra: Partial<Key> = {}): Key => ({ name, seq: "", ...extra });
const type = (s: InputState, text: string) => Array.from(text).reduce((st, ch) => applyKey(st, k("char", { ch })).state, s);

describe("input editor", () => {
  test("typing, cursor moves and backspace", () => {
    let s = type(createInput(), "hello");
    s = applyKey(s, k("left")).state;
    s = applyKey(s, k("left")).state;
    s = applyKey(s, k("backspace")).state;
    expect(s.text).toBe("helo");
    expect(s.cursor).toBe(2);
    s = applyKey(s, k("end")).state;
    s = type(s, "!");
    expect(s.text).toBe("helo!");
  });
  test("ctrl-w deletes a word, ctrl-u to start, ctrl-k to end", () => {
    let s = type(createInput(), "fix the auth bug");
    s = applyKey(s, k("ctrl-w")).state;
    expect(s.text).toBe("fix the auth ");
    s = applyKey(s, k("home")).state;
    s = applyKey(s, k("right")).state;
    s = applyKey(s, k("right")).state;
    s = applyKey(s, k("ctrl-k")).state;
    expect(s.text).toBe("fi");
    s = applyKey(s, k("ctrl-u")).state;
    expect(s.text).toBe("");
  });
  test("enter submits trimmed text and records history without consecutive duplicates", () => {
    let s = type(createInput(), "  task one ");
    let r = applyKey(s, k("enter"));
    expect(r.submit).toBe("task one");
    s = type(r.state, "task one");
    r = applyKey(s, k("enter"));
    expect(r.state.history).toEqual(["task one"]);
    expect(applyKey(createInput(), k("enter")).submit).toBeUndefined();
  });
  test("history navigation keeps the draft", () => {
    let s = createInput(["a", "b"]);
    s = type(s, "dra");
    s = applyKey(s, k("up")).state;
    expect(s.text).toBe("b");
    s = applyKey(s, k("up")).state;
    expect(s.text).toBe("a");
    s = applyKey(s, k("up")).state;
    expect(s.text).toBe("a");
    s = applyKey(s, k("down")).state;
    s = applyKey(s, k("down")).state;
    expect(s.text).toBe("dra");
  });
  test("paste inserts multi-line text and renders newlines as ⏎", () => {
    const s = applyKey(createInput(), k("paste", { text: "one\ntwo" })).state;
    expect(s.text).toBe("one\ntwo");
    const r = renderInput(s, 40, "› ");
    expect(r.line).toBe("› one⏎two");
    expect(r.cursorCol).toBe(2 + 7);
  });
  test("long input scrolls horizontally to keep the cursor visible", () => {
    const s = type(createInput(), "abcdefghijklmnopqrstuvwxyz");
    const r = renderInput(s, 12, "> ");
    expect(Bun.stringWidth(r.line)).toBeLessThanOrEqual(12);
    expect(r.line.endsWith("z")).toBe(true);
    expect(r.cursorCol).toBe(Bun.stringWidth(r.line));
    expect(r.cursorCol).toBeLessThan(12);
  });
  test("emoji count as one character for cursor math", () => {
    let s = type(createInput(), "a😀b");
    s = applyKey(s, k("left")).state;
    s = applyKey(s, k("backspace")).state;
    expect(s.text).toBe("ab");
  });
});
