import type { Key } from "./keys";

/** Single-line editor with history. Text may contain newlines (from paste); cursor is a code-point index. Pure. */
export interface InputState {
  text: string;
  cursor: number;
  history: string[];
  histIdx: number; // === history.length when not browsing
  draft: string;
}

export function createInput(history: string[] = []): InputState {
  return { text: "", cursor: 0, history, histIdx: history.length, draft: "" };
}

const cps = (s: string) => Array.from(s);

export function applyKey(s: InputState, k: Key): { state: InputState; submit?: string } {
  const chars = cps(s.text);
  const set = (text: string, cursor: number): InputState => ({ ...s, text, cursor: Math.max(0, Math.min(cps(text).length, cursor)) });
  switch (k.name) {
    case "char":
    case "paste": {
      const ins = cps(k.name === "char" ? k.ch ?? "" : k.text ?? "");
      chars.splice(s.cursor, 0, ...ins);
      return { state: set(chars.join(""), s.cursor + ins.length) };
    }
    case "backspace":
      if (s.cursor === 0) return { state: s };
      chars.splice(s.cursor - 1, 1);
      return { state: set(chars.join(""), s.cursor - 1) };
    case "delete":
      if (s.cursor >= chars.length) return { state: s };
      chars.splice(s.cursor, 1);
      return { state: set(chars.join(""), s.cursor) };
    case "left":
      return { state: set(s.text, s.cursor - 1) };
    case "right":
      return { state: set(s.text, s.cursor + 1) };
    case "home":
    case "ctrl-a":
      return { state: set(s.text, 0) };
    case "end":
    case "ctrl-e":
      return { state: set(s.text, chars.length) };
    case "ctrl-u":
      return { state: set(chars.slice(s.cursor).join(""), 0) };
    case "ctrl-k":
      return { state: set(chars.slice(0, s.cursor).join(""), s.cursor) };
    case "ctrl-w": {
      let i = s.cursor;
      while (i > 0 && /\s/.test(chars[i - 1])) i--;
      while (i > 0 && !/\s/.test(chars[i - 1])) i--;
      chars.splice(i, s.cursor - i);
      return { state: set(chars.join(""), i) };
    }
    case "up": {
      if (s.history.length === 0 || s.histIdx === 0) return { state: s };
      const draft = s.histIdx === s.history.length ? s.text : s.draft;
      const histIdx = s.histIdx - 1;
      const text = s.history[histIdx];
      return { state: { ...s, text, cursor: cps(text).length, histIdx, draft } };
    }
    case "down": {
      if (s.histIdx >= s.history.length) return { state: s };
      const histIdx = s.histIdx + 1;
      const text = histIdx === s.history.length ? s.draft : s.history[histIdx];
      return { state: { ...s, text, cursor: cps(text).length, histIdx } };
    }
    case "enter": {
      const submit = s.text.trim();
      if (!submit) return { state: s };
      const history = s.history[s.history.length - 1] === submit ? s.history : [...s.history, submit].slice(-200);
      return { state: { text: "", cursor: 0, history, histIdx: history.length, draft: "" }, submit };
    }
    case "escape":
      return { state: { ...s, text: "", cursor: 0, histIdx: s.history.length, draft: "" } };
    default:
      return { state: s };
  }
}

/** Render the input line with horizontal scrolling so the cursor stays visible. Newlines show as ⏎. */
export function renderInput(s: InputState, width: number, prompt: string): { line: string; cursorCol: number } {
  const shown = cps(s.text.replace(/\n/g, "⏎"));
  const avail = Math.max(1, width - Bun.stringWidth(prompt));
  let start = 0;
  if (s.cursor >= avail) start = s.cursor - avail + 1;
  const visible = shown.slice(start, start + avail).join("");
  return { line: prompt + visible, cursorCol: Bun.stringWidth(prompt) + Bun.stringWidth(shown.slice(start, s.cursor).join("")) };
}
