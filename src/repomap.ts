import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const IGNORE = /(^|\/)(node_modules|dist|build|out|\.git|\.next|\.turbo|target|__pycache__|\.venv|venv|\.cache|coverage)(\/|$)/;

let cache: { cwd: string; files: string[] } | undefined;

/** Project file list: git-tracked plus untracked-but-not-ignored, else a bounded walk. Cached per process. */
export function listFiles(cwd: string): string[] {
  if (cache && cache.cwd === cwd) return cache.files;
  let files: string[] = [];
  const git = Bun.spawnSync(["git", "ls-files", "--cached", "--others", "--exclude-standard"], { cwd });
  if (git.exitCode === 0) {
    files = git.stdout.toString().split("\n").filter(Boolean);
  } else {
    files = walk(cwd, cwd, 5000);
  }
  files = files.filter((f) => !IGNORE.test(f));
  cache = { cwd, files };
  return files;
}

export function invalidateFileList(): void {
  cache = undefined;
}

function walk(root: string, dir: string, max: number, acc: string[] = []): string[] {
  if (acc.length >= max) return acc;
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    if (acc.length >= max) break;
    const full = join(dir, name);
    const rel = relative(root, full);
    if (IGNORE.test(rel + "/")) continue;
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(root, full, max, acc);
    else acc.push(rel);
  }
  return acc;
}

const depth = (p: string) => p.split("/").length;

export function repoMap(cwd: string, maxFiles: number): string {
  const files = [...listFiles(cwd)].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
  const shown = files.slice(0, maxFiles);
  let out = `Repository files (${shown.length} of ${files.length}):\n${shown.join("\n")}`;
  if (files.length > shown.length) out += `\n... ${files.length - shown.length} more. Use search to find files by name.`;
  const readme = files.find((f) => /^readme(\.md|\.txt|\.rst)?$/i.test(f));
  if (readme && existsSync(join(cwd, readme))) {
    const head = readFileSync(join(cwd, readme), "utf8").split("\n").slice(0, 40).join("\n");
    out += `\n\n${readme} (first 40 lines):\n${head}`;
  }
  return out;
}
