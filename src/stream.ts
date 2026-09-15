import type { Message, ToolCall, Usage } from "./types";

/** Callbacks fired as deltas arrive. All optional. */
export interface StreamHandlers {
  onText?(delta: string): void;
  onReasoning?(delta: string): void;
  onToolCall?(name: string, index: number): void;
}

export interface StreamState {
  buffer: string;
  content: string;
  reasoning: string;
  toolCalls: Map<number, { id?: string; name: string; args: string; announced: boolean }>;
  finish?: string;
  usage?: Usage;
  done: boolean;
  chunks: number;
}

export function createStreamState(): StreamState {
  return { buffer: "", content: "", reasoning: "", toolCalls: new Map(), done: false, chunks: 0 };
}

/** Feed raw SSE text. Handles `data:` lines split across chunks, CRLF, comments and [DONE]. */
export function feed(state: StreamState, text: string, h: StreamHandlers = {}): void {
  state.buffer += text;
  let nl: number;
  while ((nl = state.buffer.indexOf("\n")) >= 0) {
    const line = state.buffer.slice(0, nl).replace(/\r$/, "");
    state.buffer = state.buffer.slice(nl + 1);
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    if (payload === "[DONE]") {
      state.done = true;
      continue;
    }
    let json: any;
    try {
      json = JSON.parse(payload);
    } catch {
      continue; // a torn frame; the next line will carry a complete one
    }
    state.chunks++;
    if (json.usage) state.usage = normaliseUsage(json.usage);
    for (const choice of json.choices ?? []) {
      const d = choice.delta ?? choice.message ?? {};
      if (typeof d.content === "string" && d.content) {
        state.content += d.content;
        h.onText?.(d.content);
      }
      const r = d.reasoning_content ?? d.reasoning;
      if (typeof r === "string" && r) {
        state.reasoning += r;
        h.onReasoning?.(r);
      }
      for (const tc of d.tool_calls ?? []) {
        const idx = typeof tc.index === "number" ? tc.index : 0;
        let entry = state.toolCalls.get(idx);
        if (!entry) {
          entry = { name: "", args: "", announced: false };
          state.toolCalls.set(idx, entry);
        }
        if (tc.id) entry.id = tc.id;
        if (tc.function?.name) entry.name = entry.name ? entry.name + tc.function.name : tc.function.name;
        if (typeof tc.function?.arguments === "string") entry.args += tc.function.arguments;
        if (entry.name && !entry.announced) {
          entry.announced = true;
          h.onToolCall?.(entry.name, idx);
        }
      }
      if (choice.finish_reason) state.finish = choice.finish_reason;
    }
  }
}

/** Flush any trailing line without a newline, then assemble the message. */
export function finalize(state: StreamState, h: StreamHandlers = {}): { message: Message; finish_reason: string; usage: Usage } {
  if (state.buffer.trim()) feed(state, "\n", h);
  const message: Message = { role: "assistant", content: state.content };
  if (state.reasoning) message.reasoning_content = state.reasoning;
  if (state.toolCalls.size) {
    message.tool_calls = [...state.toolCalls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([i, t]): ToolCall => ({ id: t.id ?? `call_${i}`, type: "function", function: { name: t.name, arguments: t.args } }));
  }
  const finish_reason = state.finish ?? (message.tool_calls ? "tool_calls" : "stop");
  return { message, finish_reason, usage: state.usage ?? {} };
}

export function normaliseUsage(u: any): Usage {
  return {
    prompt_tokens: u.prompt_tokens,
    completion_tokens: u.completion_tokens,
    total_tokens: u.total_tokens,
    reasoning_tokens: u.completion_tokens_details?.reasoning_tokens,
    cached_tokens: u.prompt_tokens_details?.cached_tokens,
  };
}
