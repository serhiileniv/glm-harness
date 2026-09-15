export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface Message {
  role: Role;
  content: string;
  reasoning_content?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  /** harness-only: which turn produced this message; never sent */
  _turn?: number;
}

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  reasoning_tokens?: number;
  cached_tokens?: number;
}

export interface ChatResult {
  message: Message;
  finish_reason: string;
  usage: Usage;
  ms: number;
  retries: number;
  /** tool calls recovered from text by the fallback parser */
  recovered: boolean;
}

export type EndpointKind = "zai" | "zenmux" | "openai";

export interface EndpointConfig {
  kind: EndpointKind;
  base_url: string;
  api_key: string;
  model: string;
}

export interface Limits {
  max_tokens: number;
  context_tokens: number;
  reply_reserve: number;
  keep_full_results: number;
  tool_output_chars: number;
  repo_map_files: number;
  min_request_gap_ms: number;
}

export interface Profile {
  model: { name: string };
  sampling: { temperature: number; top_p: number };
  thinking: { enabled: boolean; preserved: boolean };
  limits: Limits;
  request: Record<string, Record<string, unknown>>;
  prompt: { system: string; truncated: string };
}

export interface Config {
  endpoint: EndpointConfig;
  limits: Limits;
  check?: string;
  daily_request_estimate: number;
}

export interface ToolContext {
  cwd: string;
  yes: boolean;
  allowSecrets: boolean;
  outputChars: number;
  ask: (question: string) => Promise<boolean>;
  /** run cancellation; long-running tools stop when it fires */
  signal?: AbortSignal;
  /** live output from long-running tools (bash), chunk by chunk */
  onOutput?: (chunk: string) => void;
}

export interface ToolOutcome {
  content: string;
  /** true if the tool changed files */
  mutated?: boolean;
  /** file path touched, for syntax checks and diff */
  path?: string;
  error?: boolean;
}

export type RunEvent =
  | { type: "turn"; turn: number }
  | { type: "request"; turn: number; messages: number; est_tokens: number }
  | { type: "response"; turn: number; ms: number; usage: Usage; finish: string; tool_calls: number; recovered: boolean; retries: number }
  | { type: "thinking"; turn: number; chars: number }
  | { type: "assistant"; turn: number; content: string }
  | { type: "tool_call"; turn: number; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_output"; turn: number; id: string; chunk: string }
  | { type: "tool_result"; turn: number; id: string; name: string; chars: number; ms: number; error: boolean; preview: string; snippet: string[] }
  | { type: "stream_text"; turn: number; delta: string }
  | { type: "stream_reasoning"; turn: number; delta: string }
  | { type: "aborted"; turn: number }
  | { type: "note"; turn: number; text: string }
  | { type: "check"; turn: number; command: string; ok: boolean; output: string }
  | { type: "done"; turn: number; reason: string; summary: string; stats: RunStats };

export interface RunStats {
  turns: number;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
  tool_calls: number;
  malformed_calls: number;
  edit_failures: number;
  doom_loops: number;
  retries: number;
  wall_ms: number;
}
