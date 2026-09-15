import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import type { ToolContext, ToolOutcome } from "../types";
import { checkPath, ToolError } from "./paths";

export const schema = {
  type: "function",
  function: {
    name: "read",
    description:
      "Read a window of a file with line numbers. Default 100 lines from offset. Read the exact lines before you edit them. For large files, read the region grep pointed to instead of the whole file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to the project root" },
        offset: { type: "integer", description: "First line to read, 1-based. Default 1" },
        limit: { type: "integer", description: "Number of lines. Default 100, max 400" },
      },
      required: ["path"],
    },
  },
} as const;

export async function run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const abs = await checkPath(ctx, args.path, "read");
  const rel = String(args.path);
  if (!existsSync(abs)) throw new ToolError(`No such file: ${rel}. Use search to find the right path.`);
  const st = statSync(abs);
  if (st.isDirectory()) {
    const entries = readdirSync(abs).slice(0, 200);
    return { content: `${rel} is a directory with ${entries.length} entries:\n${entries.join("\n")}` };
  }
  if (st.size > 5_000_000) throw new ToolError(`${rel} is ${Math.round(st.size / 1e6)} MB; too large to read. Use grep to find the region you need.`);
  const buf = readFileSync(abs);
  if (buf.subarray(0, 8000).includes(0)) throw new ToolError(`${rel} is binary.`);
  const lines = buf.toString("utf8").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop(); // trailing newline is not a line
  const total = lines.length;
  const offset = Math.max(1, Math.floor(Number(args.offset ?? 1)) || 1);
  const limit = Math.min(400, Math.max(1, Math.floor(Number(args.limit ?? 100)) || 100));
  if (offset > total) throw new ToolError(`offset ${offset} is past the end of ${rel} (${total} lines).`);
  const end = Math.min(total, offset + limit - 1);
  const width = String(end).length;
  const body = lines
    .slice(offset - 1, end)
    .map((l, i) => `${String(offset + i).padStart(width)}| ${l.length > 500 ? l.slice(0, 500) + " …[line truncated]" : l}`)
    .join("\n");
  const more = end < total ? `\n… ${total - end} more lines. Call read with offset=${end + 1} to continue.` : "";
  return { content: `${rel}: lines ${offset}-${end} of ${total}\n${body}${more}`, path: rel };
}
