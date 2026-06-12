// S21 — Events & webhooks.
// A typed event bus that platform modules publish to, plus webhook subscriptions
// with HMAC-signed, retried delivery. Delivery transport is pluggable so it runs
// deterministically offline and in CI.

import { createHmac } from "node:crypto";

export type EventType =
  | "agent.registered"
  | "agent.promoted"
  | "agent.deployed"
  | "agent.retired"
  | "promotion.requested"
  | "promotion.approved"
  | "promotion.rejected"
  | "incident.captured"
  | "regression.detected"
  | "pack.published"
  | "secret.rotated"
  | "platform.degraded"
  | "platform.down"
  | "platform.recovered"
  | "profile.updated"
  | "profile.applied"
  | "profile.rolledback";

export interface PlatformEvent {
  readonly id: string;
  readonly type: EventType;
  readonly tenantId: string;
  readonly subject: string;
  readonly payload: Record<string, unknown>;
  readonly timestamp: string;
}

export interface WebhookSubscription {
  readonly id: string;
  readonly tenantId: string;
  readonly url: string;
  readonly secret: string;
  readonly events: readonly EventType[];
  readonly active: boolean;
}

export interface DeliveryAttempt {
  subscriptionId: string;
  eventId: string;
  url: string;
  signature: string;
  status: "delivered" | "failed";
  attempts: number;
}

// Pluggable transport. Returns true on a successful (2xx) delivery.
export interface WebhookTransport {
  post(url: string, body: string, signature: string): Promise<boolean>;
}

export class SubscriptionNotFoundError extends Error {
  constructor(id: string) {
    super(`Webhook subscription not found: ${id}`);
    this.name = "SubscriptionNotFoundError";
  }
}

// Sign a payload with HMAC-SHA256 (the standard webhook signature scheme).
export function signPayload(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

export function verifySignature(
  secret: string,
  body: string,
  signature: string,
): boolean {
  return signPayload(secret, body) === signature;
}

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
}

export const DEFAULT_WEBHOOK_RETRY: RetryConfig = { maxAttempts: 3, baseDelayMs: 0 };

export class EventBus {
  private readonly subscriptions = new Map<string, WebhookSubscription>();
  private readonly log: PlatformEvent[] = [];
  private readonly transport: WebhookTransport;
  private readonly retry: RetryConfig;
  private readonly now: () => string;
  private readonly sleep: (ms: number) => Promise<void>;
  private counter = 0;

  constructor(opts: {
    transport: WebhookTransport;
    retry?: RetryConfig;
    now?: () => string;
    sleep?: (ms: number) => Promise<void>;
  }) {
    this.transport = opts.transport;
    this.retry = opts.retry ?? DEFAULT_WEBHOOK_RETRY;
    this.now = opts.now ?? (() => new Date(0).toISOString());
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  subscribe(sub: WebhookSubscription): WebhookSubscription {
    const frozen = Object.freeze({ ...sub, events: Object.freeze([...sub.events]) });
    this.subscriptions.set(sub.id, frozen);
    return frozen;
  }

  unsubscribe(id: string): boolean {
    return this.subscriptions.delete(id);
  }

  getSubscription(id: string): WebhookSubscription {
    const s = this.subscriptions.get(id);
    if (!s) throw new SubscriptionNotFoundError(id);
    return s;
  }

  eventLog(): readonly PlatformEvent[] {
    return this.log;
  }

  // Publish an event: appends to the log and delivers to matching subscriptions.
  async publish(input: {
    type: EventType;
    tenantId: string;
    subject: string;
    payload?: Record<string, unknown>;
  }): Promise<DeliveryAttempt[]> {
    const event: PlatformEvent = Object.freeze({
      id: `evt-${this.counter++}`,
      type: input.type,
      tenantId: input.tenantId,
      subject: input.subject,
      payload: input.payload ?? {},
      timestamp: this.now(),
    });
    this.log.push(event);

    const matches = [...this.subscriptions.values()]
      .filter(
        (s) =>
          s.active &&
          s.tenantId === event.tenantId &&
          s.events.includes(event.type),
      )
      .sort((a, b) => a.id.localeCompare(b.id));

    const attempts: DeliveryAttempt[] = [];
    for (const sub of matches) {
      attempts.push(await this.deliver(sub, event));
    }
    return attempts;
  }

  private async deliver(
    sub: WebhookSubscription,
    event: PlatformEvent,
  ): Promise<DeliveryAttempt> {
    const body = JSON.stringify(event);
    const signature = signPayload(sub.secret, body);
    let attempts = 0;
    for (let i = 1; i <= this.retry.maxAttempts; i++) {
      attempts = i;
      const ok = await this.transport.post(sub.url, body, signature);
      if (ok) {
        return { subscriptionId: sub.id, eventId: event.id, url: sub.url, signature, status: "delivered", attempts };
      }
      if (i < this.retry.maxAttempts) await this.sleep(this.retry.baseDelayMs * i);
    }
    return { subscriptionId: sub.id, eventId: event.id, url: sub.url, signature, status: "failed", attempts };
  }
}
