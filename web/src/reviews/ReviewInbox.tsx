// S99 — Human-in-the-loop reviewer inbox (reviewer or admin).
// Lists pending reviews, opens an item to see the agent + weighted score +
// context, and approves or rejects with a required reason. Wired to the S93
// backend via authClient. Built on the design-system primitives.

import { useEffect, useState, useCallback } from "react";
import { AuthClient, AuthApiError, type AuthSession, type ReviewItem } from "../auth/authClient.js";
import { Card, Table, Badge, Button, Banner, Modal, Field, Input, type Column } from "../ui/components.js";

export interface ReviewInboxProps {
  client: AuthClient;
  session: AuthSession;
}

function scoreTone(score: number): "success" | "warn" | "danger" {
  if (score >= 0.8) return "success";
  if (score >= 0.5) return "warn";
  return "danger";
}

export function ReviewInbox({ client, session }: ReviewInboxProps) {
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Detail modal + reject reason.
  const [openItem, setOpenItem] = useState<ReviewItem | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await client.listReviews(session.token);
      setItems(r);
    } catch (err) {
      setError(err instanceof AuthApiError ? err.message : "Request failed — try again.");
      setItems([]);
    }
  }, [client, session.token]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = (item: ReviewItem) => {
    setOpenItem(item);
    setRejecting(false);
    setReason("");
    setDetailError(null);
  };

  const close = () => {
    setOpenItem(null);
    setRejecting(false);
    setReason("");
  };

  const approve = async (item: ReviewItem) => {
    setDetailError(null);
    setBusy(true);
    try {
      await client.approveReview(session.token, item.id);
      close();
      setNotice(`Approved ${item.agentId}.`);
      await load();
    } catch (err) {
      setDetailError(err instanceof AuthApiError ? err.message : "Network error — try again.");
    } finally {
      setBusy(false);
    }
  };

  const submitReject = async (item: ReviewItem) => {
    setDetailError(null);
    setBusy(true);
    try {
      await client.rejectReview(session.token, item.id, reason.trim());
      close();
      setNotice(`Rejected ${item.agentId}.`);
      await load();
    } catch (err) {
      setDetailError(err instanceof AuthApiError ? err.message : "Network error — try again.");
    } finally {
      setBusy(false);
    }
  };

  const columns: ReadonlyArray<Column<ReviewItem>> = [
    { key: "agent", header: "Agent", render: (i) => i.agentId },
    { key: "by", header: "Requested by", render: (i) => i.requestedBy },
    {
      key: "score",
      header: "Score",
      align: "right",
      render: (i) => <Badge tone={scoreTone(i.weightedScore)}>{i.weightedScore.toFixed(2)}</Badge>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (i) => (
        <Button variant="ghost" data-testid={`open-${i.id}`} onClick={() => open(i)}>Review</Button>
      ),
    },
  ];

  const canReject = reason.trim().length > 0 && !busy;

  return (
    <div className="af-reviews" data-testid="reviews-screen">
      <Card title="Pending reviews">
        {error && <Banner tone="danger" data-testid="reviews-error" className="af-reviews__banner">{error}</Banner>}
        {notice && <Banner tone="success" data-testid="reviews-notice" className="af-reviews__banner" onDismiss={() => setNotice(null)}>{notice}</Banner>}
        {items === null ? (
          <p data-testid="reviews-loading" className="af-reviews__loading">Loading reviews…</p>
        ) : (
          <Table<ReviewItem> columns={columns} rows={items} rowKey={(i) => i.id} empty="No pending reviews — you're all caught up." />
        )}
      </Card>

      <Modal
        open={openItem !== null}
        title={openItem ? `Review: ${openItem.agentId}` : ""}
        onClose={close}
        footer={
          openItem ? (
            rejecting ? (
              <>
                <Button variant="ghost" data-testid="reject-back" onClick={() => setRejecting(false)}>Back</Button>
                <Button variant="danger" data-testid="reject-confirm" disabled={!canReject} onClick={() => submitReject(openItem)}>Confirm rejection</Button>
              </>
            ) : (
              <>
                <Button variant="danger" data-testid="reject-start" onClick={() => setRejecting(true)}>Reject…</Button>
                <Button variant="primary" data-testid="approve" disabled={busy} onClick={() => approve(openItem)}>Approve</Button>
              </>
            )
          ) : null
        }
      >
        {openItem && (
          <div className="af-reviews__detail">
            <dl className="af-reviews__facts">
              <div><dt>Agent</dt><dd data-testid="detail-agent">{openItem.agentId}</dd></div>
              <div><dt>Requested by</dt><dd>{openItem.requestedBy}</dd></div>
              <div><dt>Weighted score</dt><dd><Badge tone={scoreTone(openItem.weightedScore)}>{openItem.weightedScore.toFixed(2)}</Badge></dd></div>
              <div><dt>Tenant</dt><dd>{openItem.tenantId}</dd></div>
            </dl>
            {rejecting && (
              <Field label="Rejection reason" htmlFor="reject-reason" hint="Required — recorded with the decision and emitted as an event.">
                <Input id="reject-reason" data-testid="reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. insufficient red-team coverage" />
              </Field>
            )}
            {detailError && <Banner tone="danger" data-testid="detail-error">{detailError}</Banner>}
          </div>
        )}
      </Modal>
    </div>
  );
}
