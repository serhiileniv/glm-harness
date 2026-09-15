import type { ToolContext, ToolOutcome } from "../types";
import { checkPath, ToolError } from "./paths";

export const schema = {
  type: "function",
  function: {
    name: "grep",
    description:
      "Search file contents with a regular expression (ripgrep syntax, smart case). Returns up to 50 matching lines as path:line: text. If more than 50 lines match you get only per-file counts; narrow the pattern, set path to a subdirectory, or add a glob.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regular expression to search for" },
        path: { type: "string", description: "File or directory to search, relative to the project root. Default: whole project" },
        glob: { type: "string", description: "Only search files matching this glob, e.g. '*.ts' or 'src/**/*.py'" },
      },
      required: ["pattern"],
    },
  },
} as const;

const MAX = 50;
const SECRET_EXCLUDES = ["!.env", "!.env.*", "!*.pem", "!*.key", "!*.p12", "!id_rsa*", "!id_ed25519*", "!*secret*", "!*credential*"];

export async function run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const pattern = String(args.pattern ?? "");
  if (!pattern) throw new ToolError("pattern is required");
  const rel = typeof args.path === "string" && args.path.trim() ? args.path : ".";
  const abs = await checkPath(ctx, rel, "read");
  const rg = Bun.which("rg");
  const cmd = rg
    ? ["rg", "-n", "--no-heading", "--color", "never", "-S", "--max-columns", "300", "--max-columns-preview",
       ...(ctx.allowSecrets ? [] : SECRET_EXCLUDES.flatMap((g) => ["-g", g])),
       ...(typeof args.glob === "string" && args.glob ? ["-g", args.glob] : []),
       "-e", pattern, abs]
    : ["grep", "-rnE", "--exclude-dir=node_modules", "--exclude-dir=.git", "--exclude-dir=dist", "-e", pattern, abs];
  const r = Bun.spawnSync(cmd, { cwd: ctx.cwd, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode === 2) throw new ToolError(`grep error: ${r.stderr.toString().trim().split("\n")[0]}`);
  const lines = r.stdout.toString().split("\n").filter(Boolean).map((l) => l.startsWith(ctx.cwd + "/") ? l.slice(ctx.cwd.length + 1) : l);
  if (lines.length === 0) return { content: `No matches for /${pattern}/${rel !== "." ? ` in ${rel}` : ""}. Try a shorter pattern or a different spelling.` };
  if (lines.length > MAX) {
    const perFile = new Map<string, number>();
    for (const l of lines) { const f = l.split(":")[0]; perFile.set(f, (perFile.get(f) ?? 0) + 1); }
    const top = [...perFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([f, n]) => `${n.toString().padStart(5)}  ${f}`).join("\n");
    return { content: `Too many matches: ${lines.length} lines in ${perFile.size} files. Narrow the pattern, set path to a subdirectory, or add a glob.\nFiles with most matches:\n${top}` };
  }
  return { content: `${lines.length} match${lines.length === 1 ? "" : "es"}:\n${lines.join("\n")}` };
}
