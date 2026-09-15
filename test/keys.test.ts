import { describe, expect, test } from "bun:test";
import { decodeKeys, flushEscape } from "../src/tui/keys";

const names = (s: string) => decodeKeys(s).keys.map((k) => k.name);

describe("key decoding", () => {
  test("printable characters, including multi-byte", () => {
    const { keys } = decodeKeys("aé😀");
    expect(keys.map((k) => k.ch)).toEqual(["a", "é", "😀"]);
  });
  test("control keys", () => {
    expect(names("\r\n\x7f\x08\t\x03\x04\x0c\x15\x17\x01\x05\x0b")).toEqual(["enter", "enter", "backspace", "backspace", "tab", "ctrl-c", "ctrl-d", "ctrl-l", "ctrl-u", "ctrl-w", "ctrl-a", "ctrl-e", "ctrl-k"]);
  });
  test("arrows, home, end, paging, delete in CSI and SS3 forms", () => {
    expect(names("\x1b[A\x1b[B\x1b[C\x1b[D\x1b[H\x1b[F\x1b[1~\x1b[4~\x1b[5~\x1b[6~\x1b[3~\x1bOA\x1bOF\x1b[1;5C")).toEqual([
      "up", "down", "right", "left", "home", "end", "home", "end", "pageup", "pagedown", "delete", "up", "end", "right",
    ]);
  });
  test("incomplete sequences are kept as rest", () => {
    expect(decodeKeys("ab\x1b[")).toEqual({ keys: [{ name: "char", ch: "a", seq: "a" }, { name: "char", ch: "b", seq: "b" }], rest: "\x1b[" });
    expect(decodeKeys("\x1b").rest).toBe("\x1b");
    expect(flushEscape("\x1b").map((k) => k.name)).toEqual(["escape"]);
    expect(flushEscape("")).toEqual([]);
  });
  test("bracketed paste becomes one key with the text, newlines kept", () => {
    const { keys } = decodeKeys("\x1b[200~line one\nline two\x1b[201~x");
    expect(keys[0]).toMatchObject({ name: "paste", text: "line one\nline two" });
    expect(keys[1].ch).toBe("x");
    expect(decodeKeys("\x1b[200~partial").rest).toBe("\x1b[200~partial");
  });
  test("ESC followed by an ordinary key reads as escape then the key", () => {
    expect(names("\x1bq")).toEqual(["escape", "char"]);
  });
});
