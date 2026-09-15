import type { ToolCall } from "./types";

/**
 * Fallback parser for GLM's native tool-call syntax when an endpoint leaks it into `content`
 * instead of returning `tool_calls`:
 *   <tool_call>NAME<arg_key>K</arg_key><arg_value>V</arg_value>…</tool_call>
 * Also accepts JSON inside the tag and fenced ```json {"name":…, "arguments":…} ``` blocks.
 */
export function parseToolCallsFromText(text: string, known: Set<string>): { calls: ToolCall[]; content: string } {
  const calls: ToolCall[] = [];
  let content = text.replace(/<tool_call>([\s\S]*?)<\/tool_call>/g, (whole, inner: string) => {
    const call = parseInner(inner.trim(), known);
    if (!call) return whole;
    calls.push(call);
    return "";
  });
  if (calls.length === 0) {
    content = content.replace(/```(?:json|tool_call)?\s*(\{[\s\S]*?\})\s*```/g, (whole, js: string) => {
      try {
        const o = JSON.parse(js);
        const name = o.name ?? o.tool ?? o.function?.name;
        const args = o.arguments ?? o.parameters ?? o.args ?? o.function?.arguments;
        if (typeof name === "string" && known.has(name) && args !== undefined) {
          calls.push(mk(name, typeof args === "string" ? args : JSON.stringify(args)));
          return "";
        }
      } catch {
        /* not a tool call */
      }
      return whole;
    });
  }
  return { calls, content: content.trim() };
}

function parseInner(inner: string, known: Set<string>): ToolCall | null {
  if (inner.startsWith("{")) {
    try {
      const o = JSON.parse(inner);
      const name = o.name ?? o.function?.name;
      const args = o.arguments ?? o.parameters ?? o.function?.arguments ?? {};
      if (typeof name === "string" && (known.size === 0 || known.has(name))) {
        return mk(name, typeof args === "string" ? args : JSON.stringify(args));
      }
    } catch {
      /* fall through to XML form */
    }
  }
  const head = inner.match(/^([A-Za-z0-9_.-]+)\s*/);
  if (!head) return null;
  const name = head[1];
  if (known.size > 0 && !known.has(name)) return null;
  const rest = inner.slice(head[0].length);
  const args: Record<string, unknown> = {};
  const kv = /<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/g;
  let m: RegExpExecArray | null;
  let any = false;
  while ((m = kv.exec(rest))) {
    any = true;
    args[m[1].trim()] = coerce(m[2]);
  }
  if (!any && rest.trim().startsWith("{")) {
    try {
      Object.assign(args, JSON.parse(rest.trim()));
    } catch {
      /* leave empty */
    }
  }
  return mk(name, JSON.stringify(args));
}

function coerce(v: string): unknown {
  const t = v.trim();
  if (/^-?\d+$/.test(t)) return Number(t);
  if (t === "true") return true;
  if (t === "false") return false;
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try {
      return JSON.parse(t);
    } catch {
      /* string */
    }
  }
  return v;
}

function mk(name: string, args: string): ToolCall {
  return { id: `call_${crypto.randomUUID().slice(0, 8)}`, type: "function", function: { name, arguments: args } };
}
