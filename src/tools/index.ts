import type { ToolContext, ToolOutcome } from "../types";
import * as read from "./read";
import * as edit from "./edit";
import * as write from "./write";
import * as grep from "./grep";
import * as search from "./search";
import * as bash from "./bash";
import { ToolError, truncateMiddle } from "./paths";

type Tool = { schema: { type: "function"; function: { name: string; description: string; parameters: any } }; run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutcome> };

export const TOOLS: Record<string, Tool> = {
  read: read as Tool,
  edit: edit as Tool,
  write: write as Tool,
  grep: grep as Tool,
  search: search as Tool,
  bash: bash as Tool,
};

export const TOOL_NAMES = new Set(Object.keys(TOOLS));

export function toolSchemas(): unknown[] {
  return Object.values(TOOLS).map((t) => t.schema);
}

export function parseArgs(raw: string): Record<string, unknown> {
  const s = (raw ?? "").trim();
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    try {
      // common small-model slips: trailing commas, single quotes around the whole thing
      return JSON.parse(s.replace(/,\s*([}\]])/g, "$1"));
    } catch {
      throw new ToolError(`arguments were not valid JSON: ${s.slice(0, 120)}. Send a JSON object with the documented parameters.`);
    }
  }
}

export async function runTool(name: string, rawArgs: string, ctx: ToolContext): Promise<ToolOutcome> {
  const tool = TOOLS[name];
  if (!tool) return { content: `Unknown tool '${name}'. Available tools: ${[...TOOL_NAMES].join(", ")}.`, error: true };
  let args: Record<string, unknown>;
  try {
    args = parseArgs(rawArgs);
  } catch (e) {
    return { content: (e as Error).message, error: true };
  }
  const required: string[] = tool.schema.function.parameters.required ?? [];
  const missing = required.filter((k) => args[k] === undefined || args[k] === null || args[k] === "");
  if (missing.length) return { content: `${name}: missing required parameter${missing.length > 1 ? "s" : ""} ${missing.join(", ")}.`, error: true };
  try {
    const out = await tool.run(args, ctx);
    out.content = truncateMiddle(out.content, ctx.outputChars);
    return out;
  } catch (e) {
    if (e instanceof ToolError) return { content: e.message, error: true };
    return { content: `${name} failed: ${(e as Error).message}`, error: true };
  }
}
