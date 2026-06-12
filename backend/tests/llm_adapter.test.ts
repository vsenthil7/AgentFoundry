import { describe, it, expect } from "vitest";
import {
  AsyncModel,
  ResponseCache,
  ModelCallError,
  ModelTimeoutError,
  DEFAULT_RETRY,
  type AsyncModelTransport,
} from "../src/llm_adapter.js";
import type { ModelRequest } from "../src/model.js";

const noSleep = () => Promise.resolve();
const req = (input: string, ctx?: string[]): ModelRequest => ({
  systemPrompt: "sys",
  input,
  groundingContext: ctx,
});

describe("AsyncModel — success", () => {
  it("returns the transport output", async () => {
    const transport: AsyncModelTransport = {
      send: async () => "hello",
    };
    const m = new AsyncModel({ id: "test", transport, sleep: noSleep });
    const r = await m.complete(req("hi"));
    expect(r.output).toBe("hello");
    expect(r.grounded).toBe(false);
  });

  it("marks grounded when context supplied", async () => {
    const transport: AsyncModelTransport = { send: async () => "x" };
    const m = new AsyncModel({ id: "t", transport, sleep: noSleep });
    const r = await m.complete(req("hi", ["fact"]));
    expect(r.grounded).toBe(true);
  });
});

describe("AsyncModel — retry", () => {
  it("retries then succeeds", async () => {
    let calls = 0;
    const transport: AsyncModelTransport = {
      send: async () => {
        calls++;
        if (calls < 2) throw new Error("transient");
        return "ok";
      },
    };
    const m = new AsyncModel({ id: "t", transport, sleep: noSleep });
    const r = await m.complete(req("hi"));
    expect(r.output).toBe("ok");
    expect(calls).toBe(2);
  });

  it("throws ModelCallError after exhausting attempts", async () => {
    const transport: AsyncModelTransport = {
      send: async () => {
        throw new Error("always fails");
      },
    };
    const m = new AsyncModel({
      id: "t",
      transport,
      retry: { maxAttempts: 2, baseDelayMs: 0 },
      sleep: noSleep,
    });
    await expect(m.complete(req("hi"))).rejects.toThrow(ModelCallError);
  });

  it("handles a non-Error throw", async () => {
    const transport: AsyncModelTransport = {
      send: async () => {
        throw "string failure";
      },
    };
    const m = new AsyncModel({
      id: "t",
      transport,
      retry: { maxAttempts: 1, baseDelayMs: 0 },
      sleep: noSleep,
    });
    await expect(m.complete(req("hi"))).rejects.toThrow(ModelCallError);
  });
});

describe("AsyncModel — timeout", () => {
  it("times out a slow transport", async () => {
    const transport: AsyncModelTransport = {
      send: () => new Promise((resolve) => setTimeout(() => resolve("late"), 1000)),
    };
    const m = new AsyncModel({
      id: "t",
      transport,
      timeoutMs: 5,
      retry: { maxAttempts: 1, baseDelayMs: 0 },
      sleep: noSleep,
    });
    await expect(m.complete(req("hi"))).rejects.toThrow(ModelCallError);
  });

  it("sets aborted flag on timeout", async () => {
    let seenSignal: { aborted: boolean } | null = null;
    const transport: AsyncModelTransport = {
      send: (_r, signal) =>
        new Promise((resolve) => {
          seenSignal = signal;
          setTimeout(() => resolve("late"), 1000);
        }),
    };
    const m = new AsyncModel({
      id: "t",
      transport,
      timeoutMs: 5,
      retry: { maxAttempts: 1, baseDelayMs: 0 },
      sleep: noSleep,
    });
    await expect(m.complete(req("hi"))).rejects.toThrow();
    expect(seenSignal!.aborted).toBe(true);
  });

  it("uses default retry when not specified", () => {
    const m = new AsyncModel({ id: "t", transport: { send: async () => "x" } });
    expect(DEFAULT_RETRY.maxAttempts).toBe(3);
    expect(m.id).toBe("t");
  });

  it("uses the real default sleeper between retries", async () => {
    let calls = 0;
    const transport: AsyncModelTransport = {
      send: async () => {
        calls++;
        if (calls < 2) throw new Error("transient");
        return "ok";
      },
    };
    // No injected sleep -> exercises the default setTimeout-based sleeper.
    const m = new AsyncModel({
      id: "t",
      transport,
      retry: { maxAttempts: 2, baseDelayMs: 1 },
    });
    const r = await m.complete(req("hi"));
    expect(r.output).toBe("ok");
    expect(calls).toBe(2);
  });

  it("ModelTimeoutError carries the duration", () => {
    expect(new ModelTimeoutError(100).message).toContain("100ms");
  });
});

describe("ResponseCache", () => {
  it("returns a cached response", () => {
    const cache = new ResponseCache("c", {
      hi: { output: "hello", grounded: false },
    });
    expect(cache.complete(req("hi")).output).toBe("hello");
  });

  it("returns the fallback for a miss", () => {
    const cache = new ResponseCache("c", {});
    expect(cache.complete(req("unknown")).output).toBe("I don't know.");
  });

  it("uses a custom fallback", () => {
    const cache = new ResponseCache("c", {}, { output: "nope", grounded: false });
    expect(cache.complete(req("x")).output).toBe("nope");
  });

  it("warm() pre-fetches all requests into a deterministic cache", async () => {
    const transport: AsyncModelTransport = {
      send: async (r) => `echo:${r.input}`,
    };
    const model = new AsyncModel({ id: "m", transport, sleep: noSleep });
    const cache = await ResponseCache.warm(model, [req("a"), req("b")]);
    expect(cache.complete(req("a")).output).toBe("echo:a");
    expect(cache.complete(req("b")).output).toBe("echo:b");
    expect(cache.id).toBe("cache:m");
  });
});
