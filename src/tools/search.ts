import type { ToolContext, ToolOutcome } from "../types";
import { ToolError } from "./paths";
import { listFiles } from "../repomap";
import { isSecretPath } from "../approvals";

export const schema = {
  type: "function",
  function: {
    name: "search",
    description:
      "Find files by name. pattern is a case-insensitive substring of the path, or a glob such as '*.test.ts' or 'src/**/*.py'. Returns up to 50 paths.",
    parameters: {
      type: "object",
      properties: { pattern: { type: "string", description: "Substring or glob to match against file paths" } },
      required: ["pattern"],
    },
  },
} as const;

const MAX = 50;

export async function run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const pattern = String(args.pattern ?? "").trim();
  if (!pattern) throw new ToolError("pattern is required");
  let files = listFiles(ctx.cwd);
  if (!ctx.allowSecrets) files = files.filter((f) => !isSecretPath(f));
  let hits: string[];
  if (/[*?[\]{}]/.test(pattern)) {
    const g = new Bun.Glob(pattern);
    const gb = new Bun.Glob(`**/${pattern}`);
    hits = files.filter((f) => g.match(f) || gb.match(f));
  } else {
    const q = pattern.toLowerCase();
    hits = files.filter((f) => f.toLowerCase().includes(q));
  }
  if (hits.length === 0) return { content: `No files match '${pattern}'. The project has ${files.length} files; try a shorter substring.` };
  const shown = hits.slice(0, MAX);
  const more = hits.length > MAX ? `\n… ${hits.length - MAX} more. Use a more specific pattern.` : "";
  return { content: `${hits.length} file${hits.length === 1 ? "" : "s"}:\n${shown.join("\n")}${more}` };
}
