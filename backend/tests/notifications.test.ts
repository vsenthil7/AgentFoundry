import { describe, it, expect, beforeEach } from "vitest";
import {
  ReviewQueue,
  InMemoryChannel,
  ReviewItemNotFoundError,
  InvalidReviewActionError,
} from "../src/notifications.js";

let channel: InMemoryChannel;
let queue: ReviewQueue;
beforeEach(() => {
  channel = new InMemoryChannel();
  queue = new ReviewQueue(channel);
});

function submit() {
  return queue.submit({
    agentId: "acme-support-bot",
    tenantId: "t1",
    requestedBy: "composer@acme.test",
    weightedScore: 0.92,
  });
}

describe("submit", () => {
  it("creates a pending item and notifies the review pool", () => {
    const item = submit();
    expect(item.status).toBe("pending");
    expect(queue.size()).toBe(1);
    expect(channel.for("reviewers")).toHaveLength(1);
    expect(channel.for("reviewers")[0].subject).toContain("acme-support-bot");
  });

  it("notifies a custom review pool", () => {
    queue.submit({
      agentId: "x",
      tenantId: "t1",
      requestedBy: "c",
      weightedScore: 0.9,
      reviewPool: "security-team",
    });
    expect(channel.for("security-team")).toHaveLength(1);
  });
});

describe("assign", () => {
  it("assigns a pending item and notifies the assignee", () => {
    const item = submit();
    const assigned = queue.assign(item.id, "reviewer@acme.test");
    expect(assigned.status).toBe("assigned");
    expect(assigned.assignee).toBe("reviewer@acme.test");
    expect(channel.for("reviewer@acme.test")).toHaveLength(1);
  });

  it("rejects assigning an unknown item", () => {
    expect(() => queue.assign("ghost", "r")).toThrow(ReviewItemNotFoundError);
  });

  it("rejects assigning an already-resolved item", () => {
    const item = submit();
    queue.resolve(item.id, "approved", "reviewer@acme.test");
    expect(() => queue.assign(item.id, "r")).toThrow(InvalidReviewActionError);
  });
});

describe("resolve", () => {
  it("approves a pending item and notifies the requester", () => {
    const item = submit();
    const resolved = queue.resolve(item.id, "approved", "reviewer@acme.test");
    expect(resolved.status).toBe("approved");
    expect(resolved.resolvedBy).toBe("reviewer@acme.test");
    expect(channel.for("composer@acme.test")).toHaveLength(1);
    expect(channel.for("composer@acme.test")[0].subject).toContain("approved");
  });

  it("approves an assigned item", () => {
    const item = submit();
    queue.assign(item.id, "reviewer@acme.test");
    const resolved = queue.resolve(item.id, "approved", "reviewer@acme.test");
    expect(resolved.status).toBe("approved");
  });

  it("rejects a pending item", () => {
    const item = submit();
    const resolved = queue.resolve(item.id, "rejected", "reviewer@acme.test");
    expect(resolved.status).toBe("rejected");
    expect(channel.for("composer@acme.test")[0].subject).toContain("rejected");
  });

  it("rejects resolving an unknown item", () => {
    expect(() => queue.resolve("ghost", "approved", "r")).toThrow(
      ReviewItemNotFoundError,
    );
  });

  it("rejects resolving an already-resolved item", () => {
    const item = submit();
    queue.resolve(item.id, "approved", "r");
    expect(() => queue.resolve(item.id, "rejected", "r2")).toThrow(
      InvalidReviewActionError,
    );
  });
});

describe("pending listing", () => {
  it("lists pending and assigned items, deterministic order", () => {
    const a = submit();
    submit();
    queue.assign(a.id, "r");
    const pending = queue.pending();
    expect(pending).toHaveLength(2);
    expect(pending.map((i) => i.id)).toEqual([...pending.map((i) => i.id)].sort());
  });

  it("excludes resolved items", () => {
    const a = submit();
    queue.resolve(a.id, "approved", "r");
    expect(queue.pending()).toHaveLength(0);
  });

  it("filters by tenant", () => {
    submit(); // t1
    queue.submit({ agentId: "y", tenantId: "t2", requestedBy: "c", weightedScore: 0.9 });
    expect(queue.pending("t1")).toHaveLength(1);
    expect(queue.pending("t2")).toHaveLength(1);
    expect(queue.pending()).toHaveLength(2);
  });
});

describe("get", () => {
  it("throws for an unknown item", () => {
    expect(() => queue.get("ghost")).toThrow(ReviewItemNotFoundError);
  });
});

describe("freezing + custom now", () => {
  it("items are frozen", () => {
    expect(Object.isFrozen(submit())).toBe(true);
  });
  it("uses an injected clock", () => {
    const q = new ReviewQueue(channel, () => "2026-06-08T11:30:00.000Z");
    expect(
      q.submit({ agentId: "x", tenantId: "t", requestedBy: "c", weightedScore: 1 })
        .createdAt,
    ).toBe("2026-06-08T11:30:00.000Z");
  });
});
