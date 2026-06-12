# Notifications & Approval Routing (S16)

A review queue routes promotion requests to reviewers and notifies all parties.

## Flow
1. **submit** — a composer's promotion request creates a pending `ReviewItem` and
   notifies the review pool (default `reviewers`, or a named pool e.g. `security-team`).
2. **assign** — a pending item is assigned to a reviewer, who is notified.
3. **resolve** — the reviewer approves/rejects; the original requester is notified.

Each transition is guarded: you cannot assign or resolve an already-resolved item
(`InvalidReviewActionError`), and unknown items throw `ReviewItemNotFoundError`.
Pending lists are tenant-scoped and deterministically ordered.

## Channels
`NotificationChannel.send(n)` is pluggable. `InMemoryChannel` is used for tests and
the offline demo; production implements email / Slack / webhook behind the same
interface with no other code changes.
