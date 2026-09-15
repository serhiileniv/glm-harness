import type { Message } from "./types";

/** Rough estimate. GLM's tokenizer averages about 3.6 chars per token on code and English. */
export function estimateTokens(text: string): number {
  return Math.ceil((text ?? "").length / 3.6);
}

export function estimateMessages(messages: Message[]): number {
  let n = 0;
  for (const m of messages) {
    n += 4 + estimateTokens(m.content);
    if (m.reasoning_content) n += estimateTokens(m.reasoning_content);
    if (m.tool_calls) n += estimateTokens(JSON.stringify(m.tool_calls));
  }
  return n;
}

export function estimateJson(value: unknown): number {
  return estimateTokens(JSON.stringify(value));
}
