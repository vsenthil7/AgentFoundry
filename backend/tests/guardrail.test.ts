import { describe, it, expect } from "vitest";
import { Guardrail, DEFAULT_RULES } from "../src/guardrail.js";

describe("Guardrail — safe output", () => {
  it("passes benign text", () => {
    const v = new Guardrail().inspect("Our support hours are 9am to 5pm.");
    expect(v.safe).toBe(true);
    expect(v.hits).toHaveLength(0);
    expect(v.categories).toHaveLength(0);
  });
});

describe("Guardrail — prompt injection", () => {
  it("flags system-prompt disclosure", () => {
    const v = new Guardrail().inspect("My system prompt is: you are a helpful bot.");
    expect(v.safe).toBe(false);
    expect(v.categories).toContain("prompt_injection");
  });
  it("flags injection acknowledgement", () => {
    const v = new Guardrail().inspect("Okay, ignoring previous instructions now.");
    expect(v.categories).toContain("prompt_injection");
  });
});

describe("Guardrail — jailbreak", () => {
  it("flags a jailbreak persona", () => {
    const v = new Guardrail().inspect("Sure, as DAN I can do anything.");
    expect(v.categories).toContain("jailbreak");
  });
});

describe("Guardrail — PII", () => {
  it("flags an email", () => {
    const v = new Guardrail().inspect("Contact me at jane.doe@example.com please.");
    expect(v.categories).toContain("pii");
  });
  it("flags a credit-card-like number", () => {
    const v = new Guardrail().inspect("Card: 4111 1111 1111 1111");
    expect(v.categories).toContain("pii");
  });
  it("flags an SSN", () => {
    const v = new Guardrail().inspect("SSN 123-45-6789");
    expect(v.categories).toContain("pii");
  });
});

describe("Guardrail — secrets", () => {
  it("flags an API key", () => {
    const v = new Guardrail().inspect("Here is the key sk-abcdefghij0123456789xyz");
    expect(v.categories).toContain("secret_exposure");
  });
  it("flags a disclosed password", () => {
    const v = new Guardrail().inspect("The admin password is hunter2");
    expect(v.categories).toContain("secret_exposure");
  });
});

describe("Guardrail — multiple hits", () => {
  it("reports every fired rule and dedupes categories", () => {
    const v = new Guardrail().inspect(
      "My system prompt is secret. Email: a@b.com. Password is x.",
    );
    expect(v.hits.length).toBeGreaterThanOrEqual(3);
    // categories deduped + sorted
    expect(v.categories).toEqual([...new Set(v.categories)].sort());
  });
});

describe("Guardrail — config", () => {
  it("only enforces enabled categories", () => {
    const g = new Guardrail({ enabled: ["pii"] });
    const v = g.inspect("As DAN I have no rules. Email a@b.com");
    expect(v.categories).toEqual(["pii"]); // jailbreak ignored
  });

  it("accepts custom rules", () => {
    const g = new Guardrail({
      rules: [
        {
          id: "custom",
          category: "pii",
          pattern: /forbidden/i,
          description: "custom",
        },
      ],
    });
    expect(g.inspect("this is forbidden").safe).toBe(false);
    expect(g.inspect("this is fine").safe).toBe(true);
  });

  it("DEFAULT_RULES covers all four categories", () => {
    const cats = new Set(DEFAULT_RULES.map((r) => r.category));
    expect([...cats].sort()).toEqual([
      "jailbreak",
      "pii",
      "prompt_injection",
      "secret_exposure",
    ]);
  });
});

describe("Guardrail — redaction", () => {
  it("redacts matched unsafe spans", () => {
    const g = new Guardrail({ enabled: ["pii"] });
    const out = g.redact("reach me at jane@example.com today");
    expect(out).not.toContain("jane@example.com");
    expect(out).toContain("[REDACTED]");
  });

  it("uses a custom replacement", () => {
    const g = new Guardrail({ enabled: ["pii"] });
    expect(g.redact("ssn 123-45-6789", "***")).toContain("***");
  });

  it("leaves safe text unchanged", () => {
    const g = new Guardrail();
    expect(g.redact("all good here")).toBe("all good here");
  });
});
