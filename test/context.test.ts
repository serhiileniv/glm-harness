import { describe, expect, test } from "bun:test";
import { fitContext } from "../src/context";
import type { Message } from "../src/types";

function conversation(groups: number, resultChars: number): Message[] {
  const msgs: Message[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "task" },
  ];
  for (let i = 0; i < groups; i++) {
    const id = `call_${i}`;
    msgs.push({ role: "assistant", content: "", tool_calls: [{ id, type: "function", function: { name: "read", arguments: JSON.stringify({ path: `f${i}.ts` }) } }] });
    msgs.push({ role: "tool", tool_call_id: id, content: "x".repeat(resultChars) });
  }
  return msgs;
}

describe("fitContext", () => {
  test("leaves small conversations alone", () => {
    const { messages, notes } = fitContext(conversation(3, 200), { budget: 100000, keepFull: 5, toolsTokens: 500 });
    expect(notes).toHaveLength(0);
    expect(messages).toHaveLength(8);
  });

  test("stage 1 collapses results older than keepFull", () => {
    const input = conversation(8, 3000); // ~ 8 * 833 tokens
    const { messages, notes } = fitContext(input, { budget: 7000, keepFull: 2, toolsTokens: 0 });
    const tools = messages.filter((m) => m.role === "tool");
    expect(notes.some((n) => n.includes("collapsed"))).toBe(true);
    expect(tools.slice(-2).every((m) => m.content.startsWith("xxx"))).toBe(true);
    expect(tools.slice(0, -2).every((m) => m.content.startsWith("[collapsed: read path=f"))).toBe(true);
  });

  test("stage 2 prunes whole turn groups and keeps pairs intact", () => {
    const input = conversation(10, 4000);
    const { messages, notes } = fitContext(input, { budget: 1500, keepFull: 1, toolsTokens: 0 });
    expect(notes.some((n) => n.includes("pruned"))).toBe(true);
    expect(messages[0].role).toBe("system");
    expect(messages[1].content).toBe("task");
    expect(messages[2].content).toContain("pruned");
    const ids = new Set(messages.flatMap((m) => m.tool_calls?.map((c) => c.id) ?? []));
    for (const m of messages) if (m.role === "tool") expect(ids.has(m.tool_call_id!)).toBe(true);
    expect(messages.length).toBeLessThan(input.length);
  });

  test("does not mutate the input", () => {
    const input = conversation(8, 3000);
    const before = JSON.stringify(input);
    fitContext(input, { budget: 3000, keepFull: 1, toolsTokens: 0 });
    expect(JSON.stringify(input)).toBe(before);
  });
});
