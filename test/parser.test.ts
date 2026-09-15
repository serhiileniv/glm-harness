import { describe, expect, test } from "bun:test";
import { parseToolCallsFromText } from "../src/parser";

const known = new Set(["read", "edit", "grep", "bash"]);

describe("fallback tool-call parser", () => {
  test("parses GLM's native XML form and strips it from content", () => {
    const text = `Let me look.\n<tool_call>read<arg_key>path</arg_key><arg_value>src/a.ts</arg_value><arg_key>limit</arg_key><arg_value>40</arg_value></tool_call>`;
    const { calls, content } = parseToolCallsFromText(text, known);
    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe("read");
    expect(JSON.parse(calls[0].function.arguments)).toEqual({ path: "src/a.ts", limit: 40 });
    expect(content).toBe("Let me look.");
  });

  test("keeps quotes and newlines inside code arguments", () => {
    const old = `if (x) {\n  return "a";\n}`;
    const text = `<tool_call>edit<arg_key>path</arg_key><arg_value>a.ts</arg_value><arg_key>old</arg_key><arg_value>${old}</arg_value><arg_key>new</arg_key><arg_value>return 'b';</arg_value></tool_call>`;
    const { calls } = parseToolCallsFromText(text, known);
    const args = JSON.parse(calls[0].function.arguments);
    expect(args.old).toBe(old);
    expect(args.new).toBe("return 'b';");
  });

  test("parses JSON inside the tag", () => {
    const { calls } = parseToolCallsFromText(`<tool_call>{"name":"grep","arguments":{"pattern":"foo"}}</tool_call>`, known);
    expect(calls[0].function.name).toBe("grep");
    expect(JSON.parse(calls[0].function.arguments)).toEqual({ pattern: "foo" });
  });

  test("parses a fenced json block as a last resort", () => {
    const { calls, content } = parseToolCallsFromText("Running:\n```json\n{\"name\": \"bash\", \"arguments\": {\"command\": \"ls\"}}\n```", known);
    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe("bash");
    expect(content).toBe("Running:");
  });

  test("ignores unknown tool names and plain prose", () => {
    const { calls, content } = parseToolCallsFromText("<tool_call>launch_missiles<arg_key>x</arg_key><arg_value>1</arg_value></tool_call> hi", known);
    expect(calls).toHaveLength(0);
    expect(content).toContain("launch_missiles");
    expect(parseToolCallsFromText("Nothing here", known).calls).toHaveLength(0);
  });

  test("parses several calls in one message", () => {
    const text = `<tool_call>read<arg_key>path</arg_key><arg_value>a</arg_value></tool_call><tool_call>read<arg_key>path</arg_key><arg_value>b</arg_value></tool_call>`;
    const { calls } = parseToolCallsFromText(text, known);
    expect(calls.map((c) => JSON.parse(c.function.arguments).path)).toEqual(["a", "b"]);
    expect(new Set(calls.map((c) => c.id)).size).toBe(2);
  });
});
