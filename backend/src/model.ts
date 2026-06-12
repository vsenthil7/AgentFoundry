// Model adapter boundary. The engine NEVER scores using the model itself;
// the model only produces outputs and (separately) proposes eval cases.
// A deterministic stub lets the tamper test assert computed (not theatrical) scores.

export interface ModelRequest {
  systemPrompt: string;
  input: string;
  // When grounding is wired, retrieved context is injected here.
  groundingContext?: string[];
}

export interface ModelResponse {
  output: string;
  // True when the response was produced using grounding context.
  grounded: boolean;
}

export interface ModelAdapter {
  readonly id: string;
  complete(req: ModelRequest): ModelResponse;
}

// Deterministic stub: maps known inputs to known outputs. Used by the tamper
// test (known outputs -> mathematically known score) and by demo-offline.
export class StubModel implements ModelAdapter {
  readonly id: string;
  private readonly table: Map<string, string>;
  private readonly fallback: string;

  constructor(
    table: Record<string, string> = {},
    opts: { id?: string; fallback?: string } = {},
  ) {
    this.id = opts.id ?? "stub-model";
    this.table = new Map(Object.entries(table));
    this.fallback = opts.fallback ?? "I don't know.";
  }

  complete(req: ModelRequest): ModelResponse {
    const grounded = !!req.groundingContext && req.groundingContext.length > 0;
    // If grounded, prefer an answer found in the grounding context.
    if (grounded) {
      for (const ctx of req.groundingContext!) {
        const hit = this.table.get(`ctx:${ctx}:${req.input}`);
        if (hit !== undefined) return { output: hit, grounded: true };
      }
    }
    const direct = this.table.get(req.input);
    if (direct !== undefined) return { output: direct, grounded };
    return { output: this.fallback, grounded };
  }
}
