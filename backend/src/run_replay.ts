// S86 — Agent run-replay.
// Records each production agent invocation (input, model output, and the
// deterministic guardrail verdict that decided safe/unsafe at the time) so an
// operator can review exactly what happened on call #N — and *replay* it: re-run
// the same pure guardrail logic over the stored output and confirm the verdict is
// reproduced. A mismatch means the decision logic changed between record and
// replay (a real governance signal), not that the model is nondeterministic.
//
// This sits on top of the existing Guardrail (S15), whose inspect() is a pure
// function of the output. Replay is therefore deterministic and offline-safe.

import { Guardrail, type GuardrailVerdict } from "./guardrail.js";

export interface RunRecord {
  readonly seq: number;
  readonly agentId: string;
  readonly version: string;
  readonly timestamp: string;
  readonly input: string;
  readonly output: string;
  // The guardrail verdict recorded at invocation time.
  readonly verdict: GuardrailVerdict;
}

export interface ReplayResult {
  seq: number;
  agentId: string;
  // The verdict recomputed now by re-running the guardrail over the stored output.
  recomputed: GuardrailVerdict;
  // True when the recomputed verdict matches the recorded one (decision reproduced).
  reproduced: boolean;
  // Human-readable explanation when not reproduced.
  divergence: string | null;
}

function sameVerdict(a: GuardrailVerdict, b: GuardrailVerdict): boolean {
  if (a.safe !== b.safe) return false;
  const ca = [...a.categories].sort().join(",");
  const cb = [...b.categories].sort().join(",");
  return ca === cb;
}

export class RunReplayStore {
  private readonly records: RunRecord[] = [];
  private seq = 0;

  constructor(
    private readonly guardrail: Guardrail = new Guardrail(),
    private readonly now: () => number = () => Date.now(),
  ) {}

  // Record an invocation. The guardrail verdict is computed from the output at
  // record time (the decision that was actually made).
  record(input: {
    agentId: string;
    version: string;
    input: string;
    output: string;
  }): RunRecord {
    this.seq += 1;
    const verdict = this.guardrail.inspect(input.output);
    const rec: RunRecord = {
      seq: this.seq,
      agentId: input.agentId,
      version: input.version,
      timestamp: new Date(this.now()).toISOString(),
      input: input.input,
      output: input.output,
      verdict,
    };
    this.records.push(rec);
    return rec;
  }

  // All records (defensive copy), newest last.
  all(): RunRecord[] {
    return [...this.records];
  }

  forAgent(agentId: string): RunRecord[] {
    return this.records.filter((r) => r.agentId === agentId);
  }

  get(seq: number): RunRecord | null {
    return this.records.find((r) => r.seq === seq) ?? null;
  }

  size(): number {
    return this.records.length;
  }

  // Replay a single recorded invocation: re-run the guardrail over the stored
  // output and compare to the recorded verdict.
  replay(seq: number): ReplayResult | null {
    const rec = this.get(seq);
    if (!rec) return null;
    return this.replayRecord(rec);
  }

  private replayRecord(rec: RunRecord): ReplayResult {
    const recomputed = this.guardrail.inspect(rec.output);
    const reproduced = sameVerdict(rec.verdict, recomputed);
    let divergence: string | null = null;
    if (!reproduced) {
      divergence =
        `recorded safe=${rec.verdict.safe} [${rec.verdict.categories.join(",")}] ` +
        `but replay safe=${recomputed.safe} [${recomputed.categories.join(",")}]`;
    }
    return { seq: rec.seq, agentId: rec.agentId, recomputed, reproduced, divergence };
  }

  // Replay every record; returns the list plus a count of any that diverged.
  replayAll(): { results: ReplayResult[]; diverged: number } {
    const results = this.records.map((r) => this.replayRecord(r));
    const diverged = results.filter((r) => !r.reproduced).length;
    return { results, diverged };
  }
}
