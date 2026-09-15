import { extname } from "node:path";

/** Cheap syntax-only check after write/edit. Returns "" when no checker applies. */
export function syntaxCheck(absPath: string, content: string): string {
  const ext = extname(absPath).toLowerCase();
  try {
    if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"].includes(ext)) {
      const loader = ext.includes("ts") ? (ext.endsWith("x") ? "tsx" : "ts") : ext.endsWith("x") ? "jsx" : "js";
      new Bun.Transpiler({ loader }).transformSync(content);
      return `syntax check: ok (${loader})`;
    }
    if (ext === ".json") {
      JSON.parse(content);
      return "syntax check: ok (json)";
    }
    if ([".yaml", ".yml"].includes(ext)) {
      Bun.YAML.parse(content);
      return "syntax check: ok (yaml)";
    }
    if (ext === ".toml") {
      Bun.TOML.parse(content);
      return "syntax check: ok (toml)";
    }
    if (ext === ".py") return external(["python3", "-m", "py_compile", absPath], "python");
    if (ext === ".go") return external(["gofmt", "-e", "-l", absPath], "go");
    if (ext === ".sh" || ext === ".bash") return external(["bash", "-n", absPath], "bash");
    return "";
  } catch (e) {
    return `syntax check FAILED (${ext.slice(1)}): ${String((e as Error).message).split("\n").slice(0, 4).join(" ")}`;
  }
}

function external(cmd: string[], label: string): string {
  if (!Bun.which(cmd[0])) return "";
  const r = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode === 0) return `syntax check: ok (${label})`;
  const msg = (r.stderr.toString() || r.stdout.toString()).trim().split("\n").slice(0, 6).join("\n");
  return `syntax check FAILED (${label}):\n${msg}`;
}
