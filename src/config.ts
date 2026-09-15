import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import type { Config, EndpointConfig, EndpointKind, Limits } from "./types";
import { loadProfile } from "./profile";

export const PRESETS: Record<"zai" | "zenmux", Omit<EndpointConfig, "api_key">> = {
  // Z.ai direct is primary: about 1,000 requests a day per key. ZenMux's free route hits an
  // undocumented per-key wall after roughly 15 requests an hour, so it is a fallback.
  zai: { kind: "zai", base_url: "https://api.z.ai/api/paas/v4", model: "glm-4.7-flash" },
  zenmux: { kind: "zenmux", base_url: "https://zenmux.ai/api/v1", model: "z-ai/glm-4.7-flash-free" },
};

export const CONFIG_DIR = process.env.GLMH_CONFIG_DIR ?? join(homedir(), ".config", "glmh");
export const CONFIG_PATH = join(CONFIG_DIR, "config.toml");
export const DATA_DIR = process.env.GLMH_DATA_DIR ?? join(homedir(), ".local", "share", "glmh");

export interface Overrides {
  preset?: "zai" | "zenmux";
  base_url?: string;
  api_key?: string;
  model?: string;
  context_tokens?: number;
  check?: string;
  no_check?: boolean;
}

export function readToml(path: string): Record<string, any> {
  if (!existsSync(path)) return {};
  try {
    return Bun.TOML.parse(readFileSync(path, "utf8")) as Record<string, any>;
  } catch (e) {
    throw new Error(`cannot parse ${path}: ${(e as Error).message}`);
  }
}

export function loadConfig(cwd: string, o: Overrides = {}): Config {
  const profile = loadProfile();
  const global = readToml(CONFIG_PATH);
  const project = readToml(join(cwd, "glmh.toml"));
  const preset = o.preset ? PRESETS[o.preset] : undefined;
  const ep = { ...(global.endpoint ?? {}), ...(project.endpoint ?? {}), ...(preset ?? {}) };
  const kind = (o.preset ?? process.env.GLMH_KIND ?? ep.kind ?? "zai") as EndpointKind;
  const endpoint: EndpointConfig = {
    kind,
    base_url: String(o.base_url ?? process.env.GLMH_BASE_URL ?? ep.base_url ?? PRESETS[kind === "zenmux" ? "zenmux" : "zai"].base_url).replace(/\/+$/, ""),
    api_key: String(o.api_key ?? process.env.GLMH_API_KEY ?? ep.api_key ?? ""),
    model: String(o.model ?? process.env.GLMH_MODEL ?? ep.model ?? PRESETS[kind === "zenmux" ? "zenmux" : "zai"].model),
  };
  const limits: Limits = { ...profile.limits, ...(global.limits ?? {}), ...(project.limits ?? {}) };
  if (project.context_tokens) limits.context_tokens = Number(project.context_tokens);
  if (o.context_tokens) limits.context_tokens = o.context_tokens;
  const check = o.no_check ? undefined : (o.check ?? project.check ?? global.check);
  return {
    endpoint,
    limits,
    check,
    daily_request_estimate: Number(project.daily_request_estimate ?? global.daily_request_estimate ?? 1000),
  };
}

/** Rough per-key daily request capacity per preset. Z.ai is community-reported; ZenMux walls after roughly 15 requests an hour, so the figure is a guess flagged in the file. */
export const DAILY_ESTIMATE: Record<EndpointKind, number> = { zai: 1000, zenmux: 150, openai: 100000 };

export function saveConfig(endpoint: EndpointConfig, dailyEstimate = DAILY_ESTIMATE[endpoint.kind] ?? 1000): string {
  if (!endpoint.api_key || endpoint.api_key === "undefined") throw new Error("refusing to save a config without an API key");
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const q = (s: string) => JSON.stringify(s);
  const toml =
    `# glmh configuration. Keep this file private: it contains your API key.\n` +
    `[endpoint]\nkind = ${q(endpoint.kind)}\nbase_url = ${q(endpoint.base_url)}\n` +
    `api_key = ${q(endpoint.api_key)}\nmodel = ${q(endpoint.model)}\n\n` +
    `# Estimated daily request capacity for this key, used only for the quota line. Z.ai: community-reported ~1000. ZenMux free route: small hourly wall, figure is a guess. Adjust if you learn better.\n` +
    `daily_request_estimate = ${dailyEstimate}\n`;
  writeFileSync(CONFIG_PATH, toml, { mode: 0o600 });
  chmodSync(CONFIG_PATH, 0o600);
  return CONFIG_PATH;
}
