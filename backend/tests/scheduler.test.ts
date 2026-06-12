import { describe, it, expect } from "vitest";
import {
  Scheduler,
  JobNotFoundError,
  DuplicateJobError,
} from "../src/scheduler.js";

describe("Scheduler", () => {
  it("schedules a job and reports status", () => {
    let t = 0;
    const s = new Scheduler(() => t);
    s.schedule({ id: "scan", intervalMs: 1000, task: () => "ok" });
    expect(s.status("scan").status).toBe("scheduled");
    expect(s.status("scan").nextRunMs).toBe(1000);
    expect(s.size()).toBe(1);
  });

  it("rejects a duplicate job", () => {
    const s = new Scheduler(() => 0);
    s.schedule({ id: "j", intervalMs: 1000, task: () => "" });
    expect(() => s.schedule({ id: "j", intervalMs: 1000, task: () => "" })).toThrow(DuplicateJobError);
  });

  it("rejects a non-positive interval", () => {
    const s = new Scheduler(() => 0);
    expect(() => s.schedule({ id: "j", intervalMs: 0, task: () => "" })).toThrow();
  });

  it("unschedules a job", () => {
    const s = new Scheduler(() => 0);
    s.schedule({ id: "j", intervalMs: 1000, task: () => "" });
    expect(s.unschedule("j")).toBe(true);
    expect(s.unschedule("j")).toBe(false);
  });

  it("throws status for an unknown job", () => {
    const s = new Scheduler(() => 0);
    expect(() => s.status("ghost")).toThrow(JobNotFoundError);
  });

  it("does not run a job before its interval elapses", async () => {
    let t = 0;
    const s = new Scheduler(() => t);
    s.schedule({ id: "j", intervalMs: 1000, task: () => "ran" });
    t = 500;
    const ran = await s.tick();
    expect(ran).toHaveLength(0);
  });

  it("runs a job when due and reschedules it", async () => {
    let t = 0;
    const s = new Scheduler(() => t);
    s.schedule({ id: "j", intervalMs: 1000, task: () => "ran" });
    t = 1000;
    const ran = await s.tick();
    expect(ran).toHaveLength(1);
    expect(ran[0].status).toBe("succeeded");
    expect(ran[0].detail).toBe("ran");
    expect(s.status("j").runs).toBe(1);
    expect(s.status("j").nextRunMs).toBe(2000);
  });

  it("captures a failing job without throwing", async () => {
    let t = 0;
    const s = new Scheduler(() => t);
    s.schedule({
      id: "bad",
      intervalMs: 1000,
      task: () => {
        throw new Error("boom");
      },
    });
    t = 1000;
    const ran = await s.tick();
    expect(ran[0].status).toBe("failed");
    expect(ran[0].detail).toBe("boom");
    expect(s.status("bad").status).toBe("failed");
  });

  it("handles a non-Error throw", async () => {
    let t = 0;
    const s = new Scheduler(() => t);
    s.schedule({
      id: "bad",
      intervalMs: 1000,
      task: () => {
        throw "string fail";
      },
    });
    t = 1000;
    const ran = await s.tick();
    expect(ran[0].detail).toBe("string fail");
  });

  it("runs multiple due jobs in deterministic id order", async () => {
    let t = 0;
    const s = new Scheduler(() => t);
    s.schedule({ id: "b", intervalMs: 100, task: () => "b" });
    s.schedule({ id: "a", intervalMs: 100, task: () => "a" });
    t = 100;
    const ran = await s.tick();
    expect(ran.map((r) => r.jobId)).toEqual(["a", "b"]);
  });

  it("supports async tasks", async () => {
    let t = 0;
    const s = new Scheduler(() => t);
    s.schedule({ id: "j", intervalMs: 100, task: async () => "async-ok" });
    t = 100;
    const ran = await s.tick();
    expect(ran[0].detail).toBe("async-ok");
  });

  it("accumulates run history", async () => {
    let t = 0;
    const s = new Scheduler(() => t);
    s.schedule({ id: "j", intervalMs: 100, task: () => "x" });
    t = 100;
    await s.tick();
    t = 200;
    await s.tick();
    expect(s.history_()).toHaveLength(2);
  });

  it("uses the default clock when none injected", () => {
    const s = new Scheduler();
    s.schedule({ id: "j", intervalMs: 1000, task: () => "" });
    expect(s.status("j").nextRunMs).toBeGreaterThan(0);
  });
});
