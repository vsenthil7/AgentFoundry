// S15 — Real LLM adapter contract.
// The engine's ModelAdapter is synchronous and deterministic (for reproducible
// scoring). Real LLMs are async + networked, so they live behind an AsyncModel
// adapter with retry/timeout, and are materialized into a deterministic
// ResponseCache that the sync engine can consume. This keeps scoring
// reproducible while allowing real model calls during the (separate) generation
// and live-eval phases.

import type { ModelRequest, ModelResponse, ModelAdapter } from "./model.js";

export interface AsyncModelTransport {
  // Sends a prompt to a real backend and returns the completion text.
  send(req: ModelRequest, signal: { aborted: boolean }): Promise<string>;
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 3, baseDelayMs: 0 };

export class ModelTimeoutError extends Error {
  constructor(ms: number) {
    super(`Model call timed out after ${ms}ms`);
    this.name = "ModelTimeoutError";
  }
}

export class ModelCallError extends Error {
  constructor(attempts: number, cause: string) {
    super(`Model call failed after ${attempts} attempt(s): ${cause}`);
    this.name = "ModelCallError";
  }
}

export interface AsyncModelConfig {
  id: string;
  transport: AsyncModelTransport;
  retry?: RetryPolicy;
  timeoutMs?: number;
  // Injectable sleeper for deterministic tests.
  sleep?: (ms: number) => Promise<void>;
}

export class AsyncModel {
  readonly id: string;
  private readonly transport: AsyncModelTransport;
  private readonly retry: RetryPolicy;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(cfg: AsyncModelConfig) {
    this.id = cfg.id;
    this.transport = cfg.transport;
    this.retry = cfg.retry ?? DEFAULT_RETRY;
    this.timeoutMs = cfg.timeoutMs ?? 30_000;
    this.sleep = cfg.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async complete(req: ModelRequest): Promise<ModelResponse> {
    let lastErr = "unknown";
    for (let attempt = 1; attempt <= this.retry.maxAttempts; attempt++) {
      try {
        const text = await this.withTimeout(req);
        const grounded =
          !!req.groundingContext && req.groundingContext.length > 0;
        return { output: text, grounded };
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
        if (attempt < this.retry.maxAttempts) {
          await this.sleep(this.retry.baseDelayMs * attempt);
        }
      }
    }
    throw new ModelCallError(this.retry.maxAttempts, lastErr);
  }

  private async withTimeout(req: ModelRequest): Promise<string> {
    const signal = { aborted: false };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        signal.aborted = true;
        reject(new ModelTimeoutError(this.timeoutMs));
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([this.transport.send(req, signal), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

// Materialize async model outputs into a deterministic sync adapter the engine
// can score against. Pre-fetch all inputs, then expose a frozen lookup.
export class ResponseCache implements ModelAdapter {
  readonly id: string;
  private readonly table: Map<string, ModelResponse>;
  private readonly fallback: ModelResponse;

  constructor(
    id: string,
    entries: Record<string, ModelResponse>,
    fallback: ModelResponse = { output: "I don't know.", grounded: false },
  ) {
    this.id = id;
    this.table = new Map(Object.entries(entries));
    this.fallback = fallback;
  }

  static async warm(
    model: AsyncModel,
    requests: ModelRequest[],
  ): Promise<ResponseCache> {
    const entries: Record<string, ModelResponse> = {};
    for (const req of requests) {
      entries[req.input] = await model.complete(req);
    }
    return new ResponseCache(`cache:${model.id}`, entries);
  }

  complete(req: ModelRequest): ModelResponse {
    return this.table.get(req.input) ?? this.fallback;
  }
}
