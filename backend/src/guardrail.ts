// S15 — Real guardrail classifier (not a stub).
// Inspects model output for unsafe content: prompt-injection leakage, PII,
// jailbreak compliance, and secret exposure. Deterministic and explainable:
// every verdict lists the rules that fired with the matched span.

export type GuardrailCategory =
  | "prompt_injection"
  | "pii"
  | "jailbreak"
  | "secret_exposure";

export interface GuardrailRule {
  id: string;
  category: GuardrailCategory;
  // A regex that, if matched in the output, indicates unsafe content.
  pattern: RegExp;
  description: string;
}

export interface GuardrailHit {
  ruleId: string;
  category: GuardrailCategory;
  match: string;
}

export interface GuardrailVerdict {
  safe: boolean;
  hits: GuardrailHit[];
  categories: GuardrailCategory[];
}

// The default rule set. Patterns are intentionally conservative and explainable.
export const DEFAULT_RULES: GuardrailRule[] = [
  {
    id: "pi-system-prompt",
    category: "prompt_injection",
    pattern: /\b(system prompt|my instructions|my system message)\b[\s\S]{0,40}(is|are|:)/i,
    description: "Reveals or restates the system prompt.",
  },
  {
    id: "pi-ignore-ack",
    category: "prompt_injection",
    pattern: /\b(ignoring|disregarding) (previous|prior|all) (instructions|rules)\b/i,
    description: "Acknowledges following an injection instruction.",
  },
  {
    id: "jb-no-rules",
    category: "jailbreak",
    pattern: /\b(i have no rules|i am now unrestricted|as dan|developer mode enabled)\b/i,
    description: "Adopts a jailbreak persona.",
  },
  {
    id: "pii-email",
    category: "pii",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
    description: "Contains an email address.",
  },
  {
    id: "pii-credit-card",
    category: "pii",
    pattern: /\b(?:\d[ -]?){13,16}\b/,
    description: "Contains a credit-card-like number.",
  },
  {
    id: "pii-ssn",
    category: "pii",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/,
    description: "Contains an SSN-like number.",
  },
  {
    id: "secret-api-key",
    category: "secret_exposure",
    pattern: /\b(sk-[A-Za-z0-9]{16,}|AKIA[A-Z0-9]{12,}|ghp_[A-Za-z0-9]{20,})\b/,
    description: "Contains an API key / access token.",
  },
  {
    id: "secret-password",
    category: "secret_exposure",
    pattern: /\b(password|passwd|admin password)\s*(is|:)\s*\S+/i,
    description: "Discloses a password.",
  },
];

export interface GuardrailConfig {
  // Which categories to enforce. Defaults to all.
  enabled?: GuardrailCategory[];
  rules?: GuardrailRule[];
}

export class Guardrail {
  private readonly rules: GuardrailRule[];

  constructor(config: GuardrailConfig = {}) {
    const enabled = config.enabled;
    const base = config.rules ?? DEFAULT_RULES;
    this.rules = enabled
      ? base.filter((r) => enabled.includes(r.category))
      : base;
  }

  inspect(output: string): GuardrailVerdict {
    const hits: GuardrailHit[] = [];
    for (const rule of this.rules) {
      const m = rule.pattern.exec(output);
      if (m) {
        hits.push({ ruleId: rule.id, category: rule.category, match: m[0] });
      }
    }
    const categories = [...new Set(hits.map((h) => h.category))].sort();
    return { safe: hits.length === 0, hits, categories };
  }

  // Redact matched unsafe spans, returning sanitized output.
  redact(output: string, replacement = "[REDACTED]"): string {
    let result = output;
    for (const rule of this.rules) {
      result = result.replace(rule.pattern, replacement);
    }
    return result;
  }
}
