// S33 — JSON-schema validation.
// A small, dependency-free validator for request/response bodies. Supports the
// subset of JSON Schema the API needs: types, required, properties, enum, min/max,
// minLength/maxLength, items (arrays), and nested objects. Errors are explainable
// with the failing path.

export type JsonType = "object" | "array" | "string" | "number" | "boolean" | "null";

export interface JsonSchema {
  type?: JsonType;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  // When false, properties not in `properties` are rejected.
  additionalProperties?: boolean;
}

export interface ValidationError {
  path: string;
  message: string;
}

export interface SchemaResult {
  valid: boolean;
  errors: ValidationError[];
}

function typeOf(value: unknown): JsonType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "null";
}

export function validateSchema(
  schema: JsonSchema,
  value: unknown,
  path = "$",
): SchemaResult {
  const errors: ValidationError[] = [];
  validateInto(schema, value, path, errors);
  return { valid: errors.length === 0, errors };
}

function validateInto(
  schema: JsonSchema,
  value: unknown,
  path: string,
  errors: ValidationError[],
): void {
  // Type.
  if (schema.type) {
    const actual = typeOf(value);
    if (actual !== schema.type) {
      errors.push({ path, message: `expected ${schema.type}, got ${actual}` });
      return; // further checks assume the right type
    }
  }

  // Enum.
  if (schema.enum && !schema.enum.some((e) => e === value)) {
    errors.push({ path, message: `value not in enum [${schema.enum.join(", ")}]` });
  }

  // Numbers.
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({ path, message: `must be >= ${schema.minimum}` });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({ path, message: `must be <= ${schema.maximum}` });
    }
  }

  // Strings.
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({ path, message: `length must be >= ${schema.minLength}` });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push({ path, message: `length must be <= ${schema.maxLength}` });
    }
  }

  // Objects.
  if (typeOf(value) === "object" && schema.type === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) {
        errors.push({ path: `${path}.${key}`, message: "required property missing" });
      }
    }
    if (schema.properties) {
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (key in obj) {
          validateInto(sub, obj[key], `${path}.${key}`, errors);
        }
      }
    }
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(obj)) {
        if (!(key in schema.properties)) {
          errors.push({ path: `${path}.${key}`, message: "additional property not allowed" });
        }
      }
    }
  }

  // Arrays.
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => {
      validateInto(schema.items!, item, `${path}[${i}]`, errors);
    });
  }
}
