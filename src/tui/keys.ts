/** Terminal input decoding: raw bytes (already UTF-8 decoded) → key events. Pure. */
export interface Key {
  name: string; // char | paste | enter | backspace | delete | tab | escape | up | down | left | right | home | end | pageup | pagedown | ctrl-<letter> | unknown
  ch?: string; // for char
  text?: string; // for paste
  seq: string;
}

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

/**
 * Decode as many complete keys as possible. `rest` holds an incomplete escape sequence
 * (or a lone ESC) to be prepended to the next chunk. A lone ESC that stays alone is an
 * Escape key; the caller decides that with a short timer via `flushEscape`.
 */
export function decodeKeys(input: string): { keys: Key[]; rest: string } {
  const keys: Key[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === "\x1b") {
      if (input.startsWith(PASTE_START, i)) {
        const end = input.indexOf(PASTE_END, i + PASTE_START.length);
        if (end < 0) return { keys, rest: input.slice(i) };
        keys.push({ name: "paste", text: input.slice(i + PASTE_START.length, end), seq: input.slice(i, end + PASTE_END.length) });
        i = end + PASTE_END.length;
        continue;
      }
      if (i + 1 >= input.length) return { keys, rest: input.slice(i) };
      const n = input[i + 1];
      if (n === "[") {
        let j = i + 2;
        while (j < input.length && !(input.charCodeAt(j) >= 0x40 && input.charCodeAt(j) <= 0x7e)) j++;
        if (j >= input.length) return { keys, rest: input.slice(i) };
        keys.push(csi(input.slice(i + 2, j), input[j], input.slice(i, j + 1)));
        i = j + 1;
        continue;
      }
      if (n === "O") {
        if (i + 2 >= input.length) return { keys, rest: input.slice(i) };
        keys.push(csi("", input[i + 2], input.slice(i, i + 3)));
        i += 3;
        continue;
      }
      keys.push({ name: "escape", seq: "\x1b" }); // ESC followed by an ordinary key (alt combos): treat as Escape
      i += 1;
      continue;
    }
    const code = c.charCodeAt(0);
    if (c === "\r" || c === "\n") keys.push({ name: "enter", seq: c });
    else if (code === 0x7f || code === 0x08) keys.push({ name: "backspace", seq: c });
    else if (code === 0x09) keys.push({ name: "tab", seq: c });
    else if (code < 0x20) keys.push({ name: `ctrl-${String.fromCharCode(code + 96)}`, seq: c });
    else {
      const cp = input.codePointAt(i)!;
      const ch = String.fromCodePoint(cp);
      keys.push({ name: "char", ch, seq: ch });
      i += ch.length;
      continue;
    }
    i += 1;
  }
  return { keys, rest: "" };
}

/** A lone ESC that received no continuation is the Escape key. */
export function flushEscape(rest: string): Key[] {
  return rest === "\x1b" ? [{ name: "escape", seq: "\x1b" }] : [];
}

function csi(params: string, fin: string, seq: string): Key {
  const k = (name: string): Key => ({ name, seq });
  switch (fin) {
    case "A": return k("up");
    case "B": return k("down");
    case "C": return k("right");
    case "D": return k("left");
    case "H": return k("home");
    case "F": return k("end");
    case "~": {
      const code = params.split(";")[0];
      if (code === "1" || code === "7") return k("home");
      if (code === "4" || code === "8") return k("end");
      if (code === "5") return k("pageup");
      if (code === "6") return k("pagedown");
      if (code === "3") return k("delete");
      return k("unknown");
    }
    default: return k("unknown");
  }
}
