import { describe, expect, test } from "bun:test";
import { createStreamState, feed, finalize } from "../src/stream";

const ev = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

describe("SSE stream parser", () => {
  test("accumulates content split across chunk boundaries", () => {
    const s = createStreamState();
    const texts: string[] = [];
    const frame = ev({ choices: [{ delta: { content: "Hello, world" } }] });
    feed(s, frame.slice(0, 20), { onText: (d) => texts.push(d) });
    feed(s, frame.slice(20), { onText: (d) => texts.push(d) });
    feed(s, ev({ choices: [{ delta: {}, finish_reason: "stop" }] }) + "data: [DONE]\n\n");
    const r = finalize(s);
    expect(r.message.content).toBe("Hello, world");
    expect(texts).toEqual(["Hello, world"]);
    expect(r.finish_reason).toBe("stop");
    expect(s.done).toBe(true);
  });

  test("accumulates two parallel tool calls by index", () => {
    const s = createStreamState();
    const announced: string[] = [];
    const h = { onToolCall: (n: string) => announced.push(n) };
    feed(s, ev({ choices: [{ delta: { tool_calls: [{ index: 0, id: "a", function: { name: "read", arguments: "" } }] } }] }), h);
    feed(s, ev({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":"a' } }] } }] }), h);
    feed(s, ev({ choices: [{ delta: { tool_calls: [{ index: 1, id: "b", function: { name: "read", arguments: '{"path":"b.ts"}' } }] } }] }), h);
    feed(s, ev({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '.ts"}' } }] }, finish_reason: "tool_calls" }] }), h);
    const r = finalize(s);
    expect(r.message.tool_calls?.map((t) => [t.id, t.function.name, JSON.parse(t.function.arguments).path])).toEqual([["a", "read", "a.ts"], ["b", "read", "b.ts"]]);
    expect(r.finish_reason).toBe("tool_calls");
    expect(announced).toEqual(["read", "read"]);
  });

  test("captures reasoning under either field name and usage from the last chunk", () => {
    const s = createStreamState();
    feed(s, ev({ choices: [{ delta: { reasoning_content: "think " } }] }));
    feed(s, ev({ choices: [{ delta: { reasoning: "more" } }] }));
    feed(s, ev({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, completion_tokens_details: { reasoning_tokens: 3 } } }));
    const r = finalize(s);
    expect(r.message.reasoning_content).toBe("think more");
    expect(r.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, reasoning_tokens: 3, cached_tokens: undefined });
  });

  test("ignores comments, CRLF and torn frames", () => {
    const s = createStreamState();
    feed(s, ": keep-alive\r\ndata: {not json\r\n" + ev({ choices: [{ delta: { content: "x" } }] }).replace(/\n/g, "\r\n"));
    expect(finalize(s).message.content).toBe("x");
  });

  test("flushes a final line without newline", () => {
    const s = createStreamState();
    feed(s, `data: ${JSON.stringify({ choices: [{ delta: { content: "tail" } }] })}`);
    expect(finalize(s).message.content).toBe("tail");
  });
});
