import type { Message } from "./types";
import { estimateMessages } from "./tokens";

export interface FitOptions {
  budget: number;
  keepFull: number;
  toolsTokens: number;
}

/**
 * Deterministic context management. Stages engage at 70, 85 and 95 percent of budget:
 * 1. collapse tool results older than the last `keepFull` to one line
 * 2. drop the oldest turn groups after the first user message, leaving one note
 * 3. cap remaining tool results at 2k chars
 * Tool calls and their results are always kept or dropped together.
 */
export function fitContext(input: Message[], o: FitOptions): { messages: Message[]; notes: string[] } {
  const notes: string[] = [];
  let messages = input.map((m) => ({ ...m }));
  const total = () => estimateMessages(messages) + o.toolsTokens;
  if (total() <= o.budget * 0.7) return { messages, notes };

  // stage 1
  const callById = new Map<string, { name: string; args: string }>();
  for (const m of messages) for (const tc of m.tool_calls ?? []) callById.set(tc.id, { name: tc.function.name, args: tc.function.arguments });
  const toolIdx = messages.map((m, i) => (m.role === "tool" ? i : -1)).filter((i) => i >= 0);
  const collapseUpTo = toolIdx.length - o.keepFull;
  let collapsed = 0;
  for (let k = 0; k < collapseUpTo; k++) {
    const m = messages[toolIdx[k]];
    if (m.content.startsWith("[collapsed")) continue;
    const call = callById.get(m.tool_call_id ?? "");
    m.content = `[collapsed: ${call ? `${call.name} ${shortArgs(call.args)}` : "tool result"}, ${m.content.length} chars. Re-run the tool if you need it again.]`;
    collapsed++;
  }
  if (collapsed) notes.push(`collapsed ${collapsed} older tool result${collapsed === 1 ? "" : "s"}`);
  if (total() <= o.budget * 0.85) return { messages, notes };

  // stage 2
  const head = messages.slice(0, 2);
  const groups: Message[][] = [];
  for (const m of messages.slice(2)) {
    if (m.role === "assistant" || groups.length === 0) groups.push([m]);
    else groups[groups.length - 1].push(m);
  }
  let dropped = 0;
  while (groups.length > 2) {
    const candidate = [...head, note(), ...groups.slice(1).flat()];
    const before = estimateMessages(messages);
    messages = candidate;
    groups.shift();
    dropped++;
    if (total() <= o.budget * 0.85) break;
    if (estimateMessages(messages) >= before) break;
  }
  if (dropped) notes.push(`pruned ${dropped} older turn${dropped === 1 ? "" : "s"}`);
  if (total() <= o.budget * 0.95) return { messages, notes };

  // stage 3
  let capped = 0;
  for (const m of messages) {
    if (m.role === "tool" && m.content.length > 2000 && !m.content.startsWith("[collapsed")) {
      m.content = m.content.slice(0, 1000) + "\n…[middle cut to fit context]…\n" + m.content.slice(-900);
      capped++;
    }
  }
  if (capped) notes.push(`capped ${capped} tool result${capped === 1 ? "" : "s"} at 2k chars`);
  return { messages, notes };
}

function note(): Message {
  return { role: "user", content: "[earlier turns were pruned to fit the context window; the task above still applies]" };
}

function shortArgs(json: string): string {
  try {
    const o = JSON.parse(json);
    return Object.entries(o)
      .map(([k, v]) => `${k}=${String(v).replace(/\s+/g, " ").slice(0, 40)}`)
      .join(" ");
  } catch {
    return json.slice(0, 60);
  }
}
