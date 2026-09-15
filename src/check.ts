import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Detect the project's test or check command. Explicit config wins over detection. */
export function detectCheck(cwd: string): string | undefined {
  const has = (f: string) => existsSync(join(cwd, f));
  if (has("package.json")) {
    try {
      const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
      if (pkg.scripts?.test) {
        if (has("bun.lock") || has("bun.lockb") || has("bunfig.toml")) return "bun run test";
        if (has("pnpm-lock.yaml")) return "pnpm test";
        if (has("yarn.lock")) return "yarn test";
        return "npm test";
      }
    } catch {
      /* fall through */
    }
  }
  if (has("pyproject.toml") || has("pytest.ini") || has("setup.cfg") || has("tests")) return "python3 -m pytest -q";
  if (has("go.mod")) return "go test ./...";
  if (has("Cargo.toml")) return "cargo test";
  return undefined;
}
