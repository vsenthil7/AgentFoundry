// S16 — Notifications & approval routing.
// A review queue holds pending approval requests; reviewers are assigned and
// notified via a pluggable dispatch channel. Reviewers act on items, which
// resolves the queue entry and emits a notification.

export type ReviewStatus = "pending" | "assigned" | "approved" | "rejected";

export interface ReviewItem {
  readonly id: string;
  readonly agentId: string;
  readonly tenantId: string;
  readonly requestedBy: string;
  readonly weightedScore: number;
  readonly status: ReviewStatus;
  readonly assignee?: string;
  readonly resolvedBy?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Notification {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly timestamp: string;
}

// Pluggable dispatch channel. Production implements email/Slack/webhook.
export interface NotificationChannel {
  send(n: Notification): void;
}

// In-memory channel for tests and offline demo.
export class InMemoryChannel implements NotificationChannel {
  readonly sent: Notification[] = [];
  send(n: Notification): void {
    this.sent.push(n);
  }
  for(recipient: string): Notification[] {
    return this.sent.filter((n) => n.to === recipient);
  }
}

export class ReviewItemNotFoundError extends Error {
  constructor(id: string) {
    super(`Review item not found: ${id}`);
    this.name = "ReviewItemNotFoundError";
  }
}

export class InvalidReviewActionError extends Error {
  constructor(action: string, status: ReviewStatus) {
    super(`Cannot ${action} a review item in status '${status}'.`);
    this.name = "InvalidReviewActionError";
  }
}

export class ReviewQueue {
  private readonly items = new Map<string, ReviewItem>();
  private readonly channel: NotificationChannel;
  private readonly now: () => string;
  private counter = 0;

  constructor(
    channel: NotificationChannel,
    now: () => string = () => new Date(0).toISOString(),
  ) {
    this.channel = channel;
    this.now = now;
  }

  // Submit an agent for review. Emits a notification to the review pool.
  submit(input: {
    agentId: string;
    tenantId: string;
    requestedBy: string;
    weightedScore: number;
    reviewPool?: string;
  }): ReviewItem {
    const ts = this.now();
    const item: ReviewItem = Object.freeze({
      id: `review-${this.counter++}`,
      agentId: input.agentId,
      tenantId: input.tenantId,
      requestedBy: input.requestedBy,
      weightedScore: input.weightedScore,
      status: "pending",
      createdAt: ts,
      updatedAt: ts,
    });
    this.items.set(item.id, item);
    this.channel.send({
      to: input.reviewPool ?? "reviewers",
      subject: `Review requested: ${input.agentId}`,
      body: `${input.requestedBy} requested promotion of ${input.agentId} (score ${input.weightedScore}).`,
      timestamp: ts,
    });
    return item;
  }

  get(id: string): ReviewItem {
    const item = this.items.get(id);
    if (!item) throw new ReviewItemNotFoundError(id);
    return item;
  }

  // Assign a pending item to a reviewer; notifies the assignee.
  assign(id: string, assignee: string): ReviewItem {
    const item = this.get(id);
    if (item.status !== "pending") {
      throw new InvalidReviewActionError("assign", item.status);
    }
    const ts = this.now();
    const updated: ReviewItem = Object.freeze({
      ...item,
      status: "assigned",
      assignee,
      updatedAt: ts,
    });
    this.items.set(id, updated);
    this.channel.send({
      to: assignee,
      subject: `Assigned for review: ${item.agentId}`,
      body: `You have been assigned to review ${item.agentId}.`,
      timestamp: ts,
    });
    return updated;
  }

  // Resolve an item (approve/reject); notifies the original requester.
  resolve(
    id: string,
    decision: "approved" | "rejected",
    resolvedBy: string,
  ): ReviewItem {
    const item = this.get(id);
    if (item.status !== "pending" && item.status !== "assigned") {
      throw new InvalidReviewActionError("resolve", item.status);
    }
    const ts = this.now();
    const updated: ReviewItem = Object.freeze({
      ...item,
      status: decision,
      resolvedBy,
      updatedAt: ts,
    });
    this.items.set(id, updated);
    this.channel.send({
      to: item.requestedBy,
      subject: `Review ${decision}: ${item.agentId}`,
      body: `${resolvedBy} ${decision} the promotion of ${item.agentId}.`,
      timestamp: ts,
    });
    return updated;
  }

  // Pending/assigned items for a reviewer pool or assignee, deterministic order.
  pending(tenantId?: string): ReviewItem[] {
    return [...this.items.values()]
      .filter(
        (i) =>
          (i.status === "pending" || i.status === "assigned") &&
          (tenantId === undefined || i.tenantId === tenantId),
      )
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  size(): number {
    return this.items.size;
  }
}
