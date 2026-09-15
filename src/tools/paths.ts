import { resolve } from "node:path";
import { insideRoot, isSecretPath } from "../approvals";
import type { ToolContext } from "../types";

export class ToolError extends Error {}

/** Resolve a model-supplied path against the project root and enforce the two boundaries. */
export async function checkPath(ctx: ToolContext, p: unknown, mode: "read" | "write"): Promise<string> {
  if (typeof p !== "string" || !p.trim()) throw new ToolError("path is required and must be a string");
  const abs = resolve(ctx.cwd, p);
  if (!insideRoot(ctx.cwd, abs)) {
    if (mode === "write") throw new ToolError(`Refused: ${p} is outside the project root. Only files under ${ctx.cwd} can be changed.`);
    const ok = ctx.yes ? false : await ctx.ask(`Allow reading outside the project: ${abs}?`);
    if (!ok) throw new ToolError(`Refused: ${p} is outside the project root.`);
  }
  if (!ctx.allowSecrets && isSecretPath(abs)) {
    throw new ToolError(`Refused: ${p} looks like a secrets file. The user can rerun with --allow-secrets if this is intended.`);
  }
  return abs;
}

export function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  const cut = text.length - max;
  return `${text.slice(0, half)}\n…[${cut} chars cut from the middle; narrow the request to see them]…\n${text.slice(-half)}`;
}
