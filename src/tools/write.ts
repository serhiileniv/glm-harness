import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ToolContext, ToolOutcome } from "../types";
import { checkPath, ToolError } from "./paths";
import { syntaxCheck } from "./syntax";
import { invalidateFileList } from "../repomap";

export const schema = {
  type: "function",
  function: {
    name: "write",
    description:
      "Create a new file, or overwrite an existing one with complete content. Use only for new files or full rewrites of small files. Prefer edit for changes to existing files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to the project root" },
        content: { type: "string", description: "The complete file content" },
      },
      required: ["path", "content"],
    },
  },
} as const;

export async function run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const abs = await checkPath(ctx, args.path, "write");
  if (typeof args.content !== "string") throw new ToolError("content is required and must be a string");
  const rel = String(args.path);
  const existed = existsSync(abs);
  const before = existed ? readFileSync(abs, "utf8").split("\n").length : 0;
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, args.content);
  invalidateFileList();
  const after = args.content.split("\n").length;
  const check = syntaxCheck(abs, args.content);
  const head = existed ? `Overwrote ${rel} (${before} → ${after} lines).` : `Created ${rel} (${after} lines).`;
  return { content: check ? `${head} ${check}` : head, mutated: true, path: rel, error: check.includes("FAILED") };
}
