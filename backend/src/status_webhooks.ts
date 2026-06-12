// S49 — Platform status transition webhooks.
// Watches the consolidated platform state (S45) and, when it transitions
// (healthy <-> degraded <-> down), publishes a platform event (S21) so webhook
// subscribers are notified. Only fires on actual transitions (edge-triggered),
// not on every poll.

import type { PlatformState } from "./platform_status.js";
import type { EventBus, EventType } from "./events.js";

export type StatusTransitionDirection = "improved" | "degraded";

export interface StatusTransition {
  from: PlatformState;
  to: PlatformState;
  direction: StatusTransitionDirection;
}

const RANK: Record<PlatformState, number> = { healthy: 0, degraded: 1, down: 2 };

// Map a platform state to the event type published on entering it.
const STATE_EVENT: Record<PlatformState, EventType> = {
  healthy: "platform.recovered",
  degraded: "platform.degraded",
  down: "platform.down",
};

export class StatusTransitionWatcher {
  private last: PlatformState | null = null;
  private readonly bus: EventBus;
  private readonly tenantId: string;

  constructor(bus: EventBus, tenantId = "platform") {
    this.bus = bus;
    this.tenantId = tenantId;
  }

  // Observe the current state; if it changed, publish an event and return the
  // transition. Returns null when unchanged (edge-triggered).
  async observe(state: PlatformState): Promise<StatusTransition | null> {
    if (this.last === null) {
      // First observation establishes the baseline without firing.
      this.last = state;
      return null;
    }
    if (this.last === state) return null;

    const from = this.last;
    const transition: StatusTransition = {
      from,
      to: state,
      direction: RANK[state] < RANK[from] ? "improved" : "degraded",
    };
    this.last = state;

    await this.bus.publish({
      type: STATE_EVENT[state],
      tenantId: this.tenantId,
      subject: "platform",
      payload: { from, to: state, direction: transition.direction },
    });
    return transition;
  }

  current(): PlatformState | null {
    return this.last;
  }
}
