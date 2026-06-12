// S26 — Scheduled jobs.
// A deterministic scheduler for recurring platform tasks (continuous runtime
// red-teaming, drift scans, quota resets). Jobs run on fixed intervals; the
// scheduler is driven by an explicit clock + tick() so it is fully testable and
// offline-safe (no real timers).

export type JobStatus = "scheduled" | "running" | "succeeded" | "failed";

export interface JobRun {
  jobId: string;
  startedAt: number;
  finishedAt: number;
  status: "succeeded" | "failed";
  detail: string;
}

export interface JobDefinition {
  id: string;
  intervalMs: number;
  // The task; receives the current time, returns a detail string. May throw.
  task: (nowMs: number) => string | Promise<string>;
}

interface JobState {
  def: JobDefinition;
  nextRunMs: number;
  lastStatus: JobStatus;
  runs: number;
}

export class JobNotFoundError extends Error {
  constructor(id: string) {
    super(`Job not found: ${id}`);
    this.name = "JobNotFoundError";
  }
}

export class DuplicateJobError extends Error {
  constructor(id: string) {
    super(`Job already scheduled: ${id}`);
    this.name = "DuplicateJobError";
  }
}

export class Scheduler {
  private readonly jobs = new Map<string, JobState>();
  private readonly history: JobRun[] = [];
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  schedule(def: JobDefinition): void {
    if (this.jobs.has(def.id)) throw new DuplicateJobError(def.id);
    if (def.intervalMs <= 0) {
      throw new Error(`Job interval must be positive: ${def.id}`);
    }
    this.jobs.set(def.id, {
      def,
      nextRunMs: this.now() + def.intervalMs,
      lastStatus: "scheduled",
      runs: 0,
    });
  }

  unschedule(id: string): boolean {
    return this.jobs.delete(id);
  }

  status(id: string): { status: JobStatus; nextRunMs: number; runs: number } {
    const j = this.jobs.get(id);
    if (!j) throw new JobNotFoundError(id);
    return { status: j.lastStatus, nextRunMs: j.nextRunMs, runs: j.runs };
  }

  history_(): readonly JobRun[] {
    return this.history;
  }

  // Advance to the current time, running every job whose nextRun has passed.
  // Jobs run in deterministic id order; each due job runs once per tick.
  async tick(): Promise<JobRun[]> {
    const nowMs = this.now();
    const ran: JobRun[] = [];
    const due = [...this.jobs.values()]
      .filter((j) => j.nextRunMs <= nowMs)
      .sort((a, b) => a.def.id.localeCompare(b.def.id));

    for (const job of due) {
      job.lastStatus = "running";
      const startedAt = nowMs;
      let run: JobRun;
      try {
        const detail = await job.def.task(nowMs);
        run = { jobId: job.def.id, startedAt, finishedAt: this.now(), status: "succeeded", detail };
        job.lastStatus = "succeeded";
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        run = { jobId: job.def.id, startedAt, finishedAt: this.now(), status: "failed", detail };
        job.lastStatus = "failed";
      }
      job.runs++;
      job.nextRunMs = nowMs + job.def.intervalMs;
      this.history.push(run);
      ran.push(run);
    }
    return ran;
  }

  size(): number {
    return this.jobs.size;
  }
}
