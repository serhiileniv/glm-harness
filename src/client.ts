import type { ChatResult, EndpointConfig, Limits, Message, Profile, ToolCall, Usage } from "./types";
import { recordUsage } from "./trajectory";
import { createStreamState, feed, finalize, normaliseUsage, type StreamHandlers } from "./stream";
import { estimateJson, estimateMessages } from "./tokens";

export interface ChatClient {
  chat(messages: Message[], tools: unknown[], opts?: ChatOptions): Promise<ChatResult>;
}

export interface ChatOptions {
  max_tokens?: number;
  thinking?: boolean;
  /** When set, the request streams and deltas are delivered here. The returned ChatResult is identical either way. */
  stream?: StreamHandlers;
  /** Caller-owned cancellation. An aborted request throws an error whose name is "AbortError" and is never retried. */
  signal?: AbortSignal;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
// Sums to ~90s: most 429s on the free route clear within a few seconds, so poll fast early and
// give up loud rather than grinding silently for minutes (measured: old curve summed to 3.6min).
const BACKOFF_429 = [2000, 3000, 5000, 8000, 13000, 21000, 34000];
const REQUEST_TIMEOUT_MS = 240_000;

export const isAbort = (e: unknown) => e instanceof Error && e.name === "AbortError";

/**
 * OpenAI-compatible chat client. Requests are serialised (the free route allows one at a time),
 * spaced by min_request_gap_ms, and retried with backoff on 429 and 5xx.
 */
export class Client implements ChatClient {
  private queue: Promise<unknown> = Promise.resolve();
  private lastEnd = 0;

  constructor(
    private readonly ep: EndpointConfig,
    private readonly profile: Profile,
    private readonly limits: Limits,
    private readonly onNote?: (text: string) => void,
  ) {}

  chat(messages: Message[], tools: unknown[], opts: ChatOptions = {}): Promise<ChatResult> {
    const run = this.queue.then(() => this.doChat(messages, tools, opts));
    this.queue = run.catch(() => undefined);
    return run;
  }

  buildBody(messages: Message[], tools: unknown[], opts: ChatOptions): Record<string, unknown> {
    const body: Record<string, any> = {
      model: this.ep.model,
      messages: messages.map((m) => wire(m, this.profile.thinking.preserved)),
      temperature: this.profile.sampling.temperature,
      top_p: this.profile.sampling.top_p,
      max_tokens: clampReply(opts.max_tokens ?? this.limits.max_tokens, this.limits.context_tokens, estimateMessages(messages) + estimateJson(tools)),
      stream: Boolean(opts.stream),
    };
    if (opts.stream) body.stream_options = { include_usage: true };
    if (tools.length) {
      body.tools = tools;
      body.tool_choice = "auto";
    }
    const extra = this.profile.request[this.ep.kind] ?? this.profile.request.openai ?? {};
    Object.assign(body, structuredClone(extra));
    const thinkingOn = this.profile.thinking.enabled && opts.thinking !== false;
    if (!thinkingOn) {
      if (body.thinking) body.thinking = { type: "disabled" };
      if (body.chat_template_kwargs) body.chat_template_kwargs.enable_thinking = false;
    }
    return body;
  }

  private async doChat(messages: Message[], tools: unknown[], opts: ChatOptions): Promise<ChatResult> {
    if (opts.signal?.aborted) throw abortError();
    const gap = this.limits.min_request_gap_ms - (Date.now() - this.lastEnd);
    if (gap > 0) await sleepAbortable(gap, opts.signal);
    const body = JSON.stringify(this.buildBody(messages, tools, opts));
    let retries = 0;
    for (let attempt = 0; ; attempt++) {
      const t0 = performance.now();
      let res: Response;
      try {
        res = await fetch(`${this.ep.base_url}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${this.ep.api_key}`, accept: opts.stream ? "text/event-stream" : "application/json" },
          body,
          signal: combine(opts.signal, REQUEST_TIMEOUT_MS),
        });
      } catch (e) {
        if (isAbort(e) && opts.signal?.aborted) throw abortError();
        if (attempt < 3) {
          retries++;
          this.onNote?.(`network error (${(e as Error).name}); retry ${attempt + 1}`);
          await sleepAbortable(2000 * (attempt + 1), opts.signal);
          continue;
        }
        throw new Error(`network error talking to ${this.ep.base_url}: ${(e as Error).message}`);
      }
      if (res.status === 429 || res.status >= 500) {
        const text = await res.text().catch(() => "");
        this.lastEnd = Date.now();
        if (attempt < BACKOFF_429.length) {
          retries++;
          const wait = res.status === 429 ? BACKOFF_429[attempt] : 2000 * (attempt + 1);
          this.onNote?.(`${res.status} from endpoint${res.status === 429 ? " (busy or rate limited)" : ""}; waiting ${Math.round(wait / 1000)}s`);
          await sleepAbortable(wait + Math.random() * 1000, opts.signal);
          continue;
        }
        throw new Error(`${extractErrorMessage(text) ?? `endpoint returned ${res.status}`} (after ${retries} retries, ~${Math.round(BACKOFF_429.reduce((a, b) => a + b, 0) / 1000)}s)`);
      }
      const streaming = opts.stream && (res.headers.get("content-type") ?? "").includes("text/event-stream");
      let parsed: { message: Message; finish_reason: string; usage: Usage };
      if (streaming) {
        parsed = await this.readStream(res, opts);
      } else {
        const text = await res.text();
        this.lastEnd = Date.now();
        parsed = parseJsonCompletion(res.status, res.ok, text);
      }
      const ms = Math.round(performance.now() - t0);
      this.lastEnd = Date.now();
      recordUsage(this.ep.kind, this.ep.model, parsed.usage, ms);
      return { ...parsed, ms, retries, recovered: false };
    }
  }

  private async readStream(res: Response, opts: ChatOptions): Promise<{ message: Message; finish_reason: string; usage: Usage }> {
    const state = createStreamState();
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const onAbort = () => reader.cancel().catch(() => undefined);
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        feed(state, decoder.decode(value, { stream: true }), opts.stream);
        if (opts.signal?.aborted) throw abortError();
      }
    } catch (e) {
      if (opts.signal?.aborted || isAbort(e)) throw abortError();
      throw e;
    } finally {
      opts.signal?.removeEventListener("abort", onAbort);
    }
    if (opts.signal?.aborted) throw abortError();
    if (state.chunks === 0 && !state.content && !state.toolCalls.size) throw new Error("stream ended without any data");
    return finalize(state, opts.stream);
  }

  /** GET /models; returns the ids or throws. Used by doctor and init. */
  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.ep.base_url}/models`, {
      headers: { authorization: `Bearer ${this.ep.api_key}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`GET /models returned ${res.status}`);
    const json: any = await res.json();
    return (json.data ?? []).map((m: any) => String(m.id));
  }
}

/** Pull the human message out of a JSON error body ({error:{message}} or {message}); undefined if it isn't JSON. */
function extractErrorMessage(text: string): string | undefined {
  try {
    const json = JSON.parse(text);
    const msg = json.error?.message ?? json.message;
    return typeof msg === "string" ? msg : undefined;
  } catch {
    return undefined;
  }
}

function parseJsonCompletion(status: number, ok: boolean, text: string): { message: Message; finish_reason: string; usage: Usage } {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`non-JSON response (${status}): ${text.slice(0, 200)}`);
  }
  if (!ok || json.error) throw new Error(`endpoint error ${status}: ${JSON.stringify(json.error ?? json).slice(0, 300)}`);
  const choice = json.choices?.[0];
  if (!choice) throw new Error("response had no choices");
  const raw = choice.message ?? {};
  const message: Message = { role: "assistant", content: typeof raw.content === "string" ? raw.content : "" };
  const reasoning = raw.reasoning_content ?? raw.reasoning;
  if (typeof reasoning === "string" && reasoning) message.reasoning_content = reasoning;
  if (Array.isArray(raw.tool_calls) && raw.tool_calls.length) {
    message.tool_calls = raw.tool_calls.map((t: any, i: number): ToolCall => ({
      id: t.id ?? `call_${i}`,
      type: "function",
      function: {
        name: t.function?.name ?? "",
        arguments: typeof t.function?.arguments === "string" ? t.function.arguments : JSON.stringify(t.function?.arguments ?? {}),
      },
    }));
  }
  return { message, finish_reason: choice.finish_reason ?? "stop", usage: normaliseUsage(json.usage ?? {}) };
}

/** Shape a message for the wire: drop harness fields; keep reasoning only when preserved thinking is on. */
function wire(m: Message, preserved: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = { role: m.role, content: m.content ?? "" };
  if (m.role === "assistant") {
    if (preserved && m.reasoning_content) out.reasoning_content = m.reasoning_content;
    if (m.tool_calls?.length) out.tool_calls = m.tool_calls;
  }
  if (m.role === "tool") out.tool_call_id = m.tool_call_id;
  return out;
}

/** The reply may use whatever the window has left after the prompt, never more than the profile ceiling. */
function clampReply(wanted: number, context: number, promptEstimate: number): number {
  const left = context - Math.ceil(promptEstimate * 1.1) - 256; // the estimate is rough; leave 10 percent slack
  return Math.max(1024, Math.min(wanted, left));
}

function abortError(): Error {
  const e = new Error("cancelled");
  e.name = "AbortError";
  return e;
}

function combine(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  const anyFn = (AbortSignal as any).any as ((s: AbortSignal[]) => AbortSignal) | undefined;
  if (anyFn) return anyFn([signal, timeout]);
  const c = new AbortController();
  signal.addEventListener("abort", () => c.abort(), { once: true });
  timeout.addEventListener("abort", () => c.abort(), { once: true });
  return c.signal;
}

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return sleep(ms);
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
