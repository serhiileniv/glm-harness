import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ToolContext, ToolOutcome } from "../types";
import { checkPath, ToolError } from "./paths";
import { syntaxCheck } from "./syntax";

export const schema = {
  type: "function",
  function: {
    name: "edit",
    description:
      "Replace exactly one occurrence of old with new in a file. old must match the file text exactly, including whitespace and indentation, and must occur exactly once; include enough surrounding lines to make it unique. Read the lines first. Use write for new files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to the project root" },
        old: { type: "string", description: "Exact text to replace, copied from read output without the line-number prefix" },
        new: { type: "string", description: "Replacement text" },
      },
      required: ["path", "old", "new"],
    },
  },
} as const;

export async function run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const abs = await checkPath(ctx, args.path, "write");
  const rel = String(args.path);
  const oldText = String(args.old ?? "");
  const newText = String(args.new ?? "");
  if (!oldText) throw new ToolError("old must not be empty. Use write to create a file.");
  if (!existsSync(abs)) throw new ToolError(`No such file: ${rel}. Use write to create it or search to find the right path.`);
  const text = readFileSync(abs, "utf8");
  const count = text.split(oldText).length - 1;
  if (count === 0) throw new ToolError(notFound(rel, text, oldText));
  if (count > 1) throw new ToolError(`old matches ${count} times in ${rel}. Include more surrounding lines so it matches exactly once.`);
  const idx = text.indexOf(oldText);
  const updated = text.slice(0, idx) + newText + text.slice(idx + oldText.length);
  writeFileSync(abs, updated);
  const startLine = text.slice(0, idx).split("\n").length;
  const oldLines = oldText.split("\n").length;
  const newLines = newText.split("\n").length;
  const check = syntaxCheck(abs, updated);
  const preview = updated
    .split("\n")
    .slice(Math.max(0, startLine - 3), startLine - 1 + newLines + 2)
    .map((l, i) => `${String(Math.max(1, startLine - 2) + i).padStart(4)}| ${l}`)
    .join("\n");
  return {
    content: `Edited ${rel}: replaced ${oldLines} line${oldLines === 1 ? "" : "s"} at line ${startLine} with ${newLines}. ${check}\n${preview}`.trim(),
    mutated: true,
    path: rel,
    error: check.includes("FAILED"),
  };
}

function notFound(rel: string, text: string, oldText: string): string {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const lines = text.split("\n");
  const first = oldText.split("\n").find((l) => l.trim().length > 0) ?? oldText;
  const target = norm(first);
  const scored = lines
    .map((l, i) => ({ i, l, score: similarity(norm(l), target) }))
    .filter((x) => x.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const wsMatch = norm(text).includes(norm(oldText));
  let msg = `old was not found in ${rel}.`;
  if (wsMatch) msg += " It matches when whitespace is normalised, so the indentation or line breaks differ. Copy the exact text from read output.";
  if (scored.length) msg += `\nClosest lines:\n${scored.map((x) => `${String(x.i + 1).padStart(4)}| ${x.l}`).join("\n")}`;
  msg += "\nRe-read the region and copy the text exactly, without the line-number prefix.";
  return msg;
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let inter = 0;
  for (const [g, n] of ga) inter += Math.min(n, gb.get(g) ?? 0);
  return (2 * inter) / (a.length - 1 + b.length - 1);
}
