import { basename, resolve, sep } from "node:path";

/** Never executed, whatever the flags. The harness does not commit, push, or wipe disks. */
const HARD_DENY: RegExp[] = [
  /\bgit\s+(commit|push)\b/,
  /\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+(\/|~)(\s|$|\/\*)/,
  /\bmkfs\b/,
  /\b(shutdown|reboot|halt)\b/,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
  />\s*\/dev\/(sd|nvme|disk)/,
];

/** Asked about even with --yes. */
const ASK_ALWAYS: RegExp[] = [
  /\bsudo\b/,
  /\brm\s+-[a-zA-Z]*r/,
  /\bgit\s+(reset\s+--hard|clean\s+-[a-zA-Z]*f|checkout\s+--\s)/,
  /\bcurl\b[^|]*\|\s*(ba|z)?sh\b/,
  /\bchmod\s+-R\b/,
  /\bdocker\s+(rm|rmi|system\s+prune)\b/,
  /\bkill\s+-9\s+-1\b/,
];

/** Long-running processes that would hang the turn. */
const SERVER_LIKE: RegExp[] = [
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|watch)\b/,
  /\bvite\b(?!\s+build)/,
  /\bnext\s+(dev|start)\b/,
  /--watch(\b|=)/,
  /\btail\s+-[a-zA-Z]*f\b/,
  /\bpython3?\s+-m\s+http\.server\b/,
  /\b(uvicorn|gunicorn|flask\s+run|nodemon|webpack\s+serve|ng\s+serve|rails\s+s(erver)?)\b/,
  /\b(vim|vi|nano|less|more|top|htop|ssh)\b(?!\S)/,
];

export type CommandClass = "deny" | "server" | "ask" | "ok";

export function classifyCommand(cmd: string): CommandClass {
  if (HARD_DENY.some((r) => r.test(cmd))) return "deny";
  if (SERVER_LIKE.some((r) => r.test(cmd))) return "server";
  if (ASK_ALWAYS.some((r) => r.test(cmd))) return "ask";
  return "ok";
}

export function isSecretPath(p: string): boolean {
  const b = basename(p);
  return (
    /^\.env(\..+)?$/.test(b) ||
    /\.(pem|key|p12|pfx|jks|keystore)$/.test(b) ||
    /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/.test(b) ||
    /(secret|credential|password)/i.test(b) ||
    /\.netrc$/.test(b) ||
    /(^|\/)\.aws\/credentials$/.test(p) ||
    /(^|\/)\.ssh\//.test(p)
  );
}

export function insideRoot(root: string, p: string): boolean {
  const r = resolve(root);
  const abs = resolve(root, p);
  return abs === r || abs.startsWith(r + sep);
}

export async function askTTY(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const answer = prompt(`${question} [y/N]`);
  return /^y(es)?$/i.test((answer ?? "").trim());
}
