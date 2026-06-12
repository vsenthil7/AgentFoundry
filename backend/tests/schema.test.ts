import { describe, it, expect } from "vitest";
import { validateSchema, type JsonSchema } from "../src/schema.js";

describe("type validation", () => {
  it("accepts a matching type", () => {
    expect(validateSchema({ type: "string" }, "hi").valid).toBe(true);
  });
  it("rejects a mismatched type", () => {
    const r = validateSchema({ type: "string" }, 42);
    expect(r.valid).toBe(false);
    expect(r.errors[0].message).toContain("expected string");
  });
  it("distinguishes array from object", () => {
    expect(validateSchema({ type: "array" }, []).valid).toBe(true);
    expect(validateSchema({ type: "object" }, []).valid).toBe(false);
  });
  it("treats null distinctly", () => {
    expect(validateSchema({ type: "null" }, null).valid).toBe(true);
    expect(validateSchema({ type: "object" }, null).valid).toBe(false);
  });
  it("recognizes booleans and numbers", () => {
    expect(validateSchema({ type: "boolean" }, true).valid).toBe(true);
    expect(validateSchema({ type: "number" }, 3.14).valid).toBe(true);
  });
  it("treats undefined as the null type for matching purposes", () => {
    // undefined isn't a JSON type; typeOf falls back to "null".
    expect(validateSchema({ type: "null" }, undefined).valid).toBe(true);
    expect(validateSchema({ type: "string" }, undefined).valid).toBe(false);
  });
});

describe("enum", () => {
  it("accepts an allowed value", () => {
    expect(validateSchema({ enum: ["a", "b"] }, "a").valid).toBe(true);
  });
  it("rejects a disallowed value", () => {
    expect(validateSchema({ enum: ["a", "b"] }, "c").valid).toBe(false);
  });
});

describe("number ranges", () => {
  it("enforces minimum", () => {
    expect(validateSchema({ type: "number", minimum: 0 }, -1).valid).toBe(false);
    expect(validateSchema({ type: "number", minimum: 0 }, 0).valid).toBe(true);
  });
  it("enforces maximum", () => {
    expect(validateSchema({ type: "number", maximum: 1 }, 2).valid).toBe(false);
    expect(validateSchema({ type: "number", maximum: 1 }, 1).valid).toBe(true);
  });
});

describe("string lengths", () => {
  it("enforces minLength", () => {
    expect(validateSchema({ type: "string", minLength: 2 }, "a").valid).toBe(false);
  });
  it("enforces maxLength", () => {
    expect(validateSchema({ type: "string", maxLength: 2 }, "abc").valid).toBe(false);
  });
});

describe("objects", () => {
  const schema: JsonSchema = {
    type: "object",
    required: ["id", "name"],
    properties: {
      id: { type: "string" },
      name: { type: "string", minLength: 1 },
      tier: { enum: ["low", "high"] },
    },
  };

  it("accepts a valid object", () => {
    expect(validateSchema(schema, { id: "a", name: "Acme", tier: "high" }).valid).toBe(true);
  });

  it("reports a missing required property with path", () => {
    const r = validateSchema(schema, { id: "a" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path === "$.name")).toBe(true);
  });

  it("validates nested property constraints", () => {
    const r = validateSchema(schema, { id: "a", name: "", tier: "high" });
    expect(r.errors.some((e) => e.path === "$.name")).toBe(true);
  });

  it("validates an enum property", () => {
    const r = validateSchema(schema, { id: "a", name: "x", tier: "medium" });
    expect(r.errors.some((e) => e.path === "$.tier")).toBe(true);
  });

  it("rejects additional properties when disallowed", () => {
    const strict: JsonSchema = { type: "object", properties: { a: { type: "string" } }, additionalProperties: false };
    const r = validateSchema(strict, { a: "x", b: "y" });
    expect(r.errors.some((e) => e.path === "$.b")).toBe(true);
  });

  it("allows additional properties by default", () => {
    const loose: JsonSchema = { type: "object", properties: { a: { type: "string" } } };
    expect(validateSchema(loose, { a: "x", b: "y" }).valid).toBe(true);
  });
});

describe("nested objects + arrays", () => {
  it("validates a nested object", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { sdlc: { type: "object", required: ["version"], properties: { version: { type: "string" } } } },
    };
    expect(validateSchema(schema, { sdlc: { version: "1.0.0" } }).valid).toBe(true);
    expect(validateSchema(schema, { sdlc: {} }).valid).toBe(false);
  });

  it("validates array items with index paths", () => {
    const schema: JsonSchema = { type: "array", items: { type: "number" } };
    const r = validateSchema(schema, [1, "two", 3]);
    expect(r.valid).toBe(false);
    expect(r.errors[0].path).toBe("$[1]");
  });

  it("accepts a valid array", () => {
    expect(validateSchema({ type: "array", items: { type: "string" } }, ["a", "b"]).valid).toBe(true);
  });
});
