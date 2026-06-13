import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewInbox } from "../src/reviews/ReviewInbox.js";
import { AuthClient, AuthApiError, type AuthSession, type ReviewItem } from "../src/auth/authClient.js";

beforeEach(() => cleanup());

function session(): AuthSession {
  return {
    token: "tok",
    expiresAt: Date.now() + 3_600_000,
    user: { id: "acme:rev@acme.com", email: "rev@acme.com", tenantId: "acme", roles: ["reviewer"] },
  };
}

function item(over: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: "rev-1",
    agentId: "support-bot",
    tenantId: "acme",
    requestedBy: "composer@acme.com",
    weightedScore: 0.86,
    status: "pending",
    assignee: null,
    resolvedBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function fakeClient(over: Partial<Record<keyof AuthClient, unknown>> = {}): AuthClient {
  const base = {
    listReviews: vi.fn(async () => [
      item(),
      item({ id: "rev-2", agentId: "sales-bot", weightedScore: 0.62 }),
      item({ id: "rev-3", agentId: "risky-bot", weightedScore: 0.31 }),
    ]),
    approveReview: vi.fn(async () => item({ status: "approved" })),
    rejectReview: vi.fn(async () => item({ status: "rejected" })),
  };
  return { ...base, ...over } as unknown as AuthClient;
}

describe("ReviewInbox load (S99)", () => {
  it("lists pending reviews with score badges", async () => {
    render(<ReviewInbox client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByText("support-bot")).toBeInTheDocument());
    expect(screen.getByText("sales-bot")).toBeInTheDocument();
    expect(screen.getByText("0.86")).toBeInTheDocument();
    expect(screen.getByText("0.31")).toBeInTheDocument();
  });

  it("shows an API error when listing fails", async () => {
    const client = fakeClient({ listReviews: vi.fn(async () => { throw new AuthApiError(403, "Requires reviewer or admin"); }) });
    render(<ReviewInbox client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("reviews-error")).toHaveTextContent("reviewer or admin"));
  });

  it("shows a generic error on a non-API failure", async () => {
    const client = fakeClient({ listReviews: vi.fn(async () => { throw new Error("socket"); }) });
    render(<ReviewInbox client={client} session={session()} />);
    await waitFor(() => expect(screen.getByTestId("reviews-error")).toHaveTextContent("Request failed"));
  });

  it("shows the caught-up empty state", async () => {
    const client = fakeClient({ listReviews: vi.fn(async () => []) });
    render(<ReviewInbox client={client} session={session()} />);
    await waitFor(() => expect(screen.getByText(/all caught up/)).toBeInTheDocument());
  });
});

describe("ReviewInbox approve (S99)", () => {
  it("opens an item and approves it", async () => {
    const u = userEvent.setup();
    const approveReview = vi.fn(async () => item({ status: "approved" }));
    render(<ReviewInbox client={fakeClient({ approveReview })} session={session()} />);
    await waitFor(() => expect(screen.getByText("support-bot")).toBeInTheDocument());
    await u.click(screen.getByTestId("open-rev-1"));
    expect(screen.getByTestId("detail-agent")).toHaveTextContent("support-bot");
    await u.click(screen.getByTestId("approve"));
    await waitFor(() => expect(screen.getByTestId("reviews-notice")).toHaveTextContent("Approved support-bot"));
    expect(approveReview).toHaveBeenCalledWith("tok", "rev-1");
  });

  it("shows an error if approve fails", async () => {
    const u = userEvent.setup();
    const approveReview = vi.fn(async () => { throw new AuthApiError(409, "Review already resolved"); });
    render(<ReviewInbox client={fakeClient({ approveReview })} session={session()} />);
    await waitFor(() => expect(screen.getByText("support-bot")).toBeInTheDocument());
    await u.click(screen.getByTestId("open-rev-1"));
    await u.click(screen.getByTestId("approve"));
    await waitFor(() => expect(screen.getByTestId("detail-error")).toHaveTextContent("already resolved"));
  });

  it("shows a network error if approve throws non-API", async () => {
    const u = userEvent.setup();
    const approveReview = vi.fn(async () => { throw new Error("offline"); });
    render(<ReviewInbox client={fakeClient({ approveReview })} session={session()} />);
    await waitFor(() => expect(screen.getByText("support-bot")).toBeInTheDocument());
    await u.click(screen.getByTestId("open-rev-1"));
    await u.click(screen.getByTestId("approve"));
    await waitFor(() => expect(screen.getByTestId("detail-error")).toHaveTextContent("Network error"));
  });
});

describe("ReviewInbox reject (S99)", () => {
  it("requires a reason before the reject can be confirmed", async () => {
    const u = userEvent.setup();
    render(<ReviewInbox client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByText("support-bot")).toBeInTheDocument());
    await u.click(screen.getByTestId("open-rev-1"));
    await u.click(screen.getByTestId("reject-start"));
    expect(screen.getByTestId("reject-confirm")).toBeDisabled();
    await u.type(screen.getByTestId("reject-reason"), "insufficient red-team coverage");
    expect(screen.getByTestId("reject-confirm")).toBeEnabled();
  });

  it("rejects with a reason and reports the decision", async () => {
    const u = userEvent.setup();
    const rejectReview = vi.fn(async () => item({ status: "rejected" }));
    render(<ReviewInbox client={fakeClient({ rejectReview })} session={session()} />);
    await waitFor(() => expect(screen.getByText("support-bot")).toBeInTheDocument());
    await u.click(screen.getByTestId("open-rev-1"));
    await u.click(screen.getByTestId("reject-start"));
    await u.type(screen.getByTestId("reject-reason"), "insufficient red-team coverage");
    await u.click(screen.getByTestId("reject-confirm"));
    await waitFor(() => expect(screen.getByTestId("reviews-notice")).toHaveTextContent("Rejected support-bot"));
    expect(rejectReview).toHaveBeenCalledWith("tok", "rev-1", "insufficient red-team coverage");
  });

  it("can go back from the reject form to the approve/reject choice", async () => {
    const u = userEvent.setup();
    render(<ReviewInbox client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByText("support-bot")).toBeInTheDocument());
    await u.click(screen.getByTestId("open-rev-1"));
    await u.click(screen.getByTestId("reject-start"));
    expect(screen.getByTestId("reject-reason")).toBeInTheDocument();
    await u.click(screen.getByTestId("reject-back"));
    expect(screen.queryByTestId("reject-reason")).toBeNull();
    expect(screen.getByTestId("approve")).toBeInTheDocument();
  });

  it("shows an error if reject fails", async () => {
    const u = userEvent.setup();
    const rejectReview = vi.fn(async () => { throw new AuthApiError(409, "Review already resolved"); });
    render(<ReviewInbox client={fakeClient({ rejectReview })} session={session()} />);
    await waitFor(() => expect(screen.getByText("support-bot")).toBeInTheDocument());
    await u.click(screen.getByTestId("open-rev-1"));
    await u.click(screen.getByTestId("reject-start"));
    await u.type(screen.getByTestId("reject-reason"), "too risky");
    await u.click(screen.getByTestId("reject-confirm"));
    await waitFor(() => expect(screen.getByTestId("detail-error")).toHaveTextContent("already resolved"));
  });

  it("shows a network error if reject throws non-API", async () => {
    const u = userEvent.setup();
    const rejectReview = vi.fn(async () => { throw new Error("offline"); });
    render(<ReviewInbox client={fakeClient({ rejectReview })} session={session()} />);
    await waitFor(() => expect(screen.getByText("support-bot")).toBeInTheDocument());
    await u.click(screen.getByTestId("open-rev-1"));
    await u.click(screen.getByTestId("reject-start"));
    await u.type(screen.getByTestId("reject-reason"), "too risky");
    await u.click(screen.getByTestId("reject-confirm"));
    await waitFor(() => expect(screen.getByTestId("detail-error")).toHaveTextContent("Network error"));
  });
});

describe("ReviewInbox modal + notice (S99)", () => {
  it("closes the detail modal via the X", async () => {
    const u = userEvent.setup();
    render(<ReviewInbox client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByText("support-bot")).toBeInTheDocument());
    await u.click(screen.getByTestId("open-rev-1"));
    expect(screen.getByTestId("detail-agent")).toBeInTheDocument();
    await u.click(screen.getByLabelText("Close"));
    await waitFor(() => expect(screen.queryByTestId("detail-agent")).toBeNull());
  });

  it("dismisses the notice banner", async () => {
    const u = userEvent.setup();
    render(<ReviewInbox client={fakeClient()} session={session()} />);
    await waitFor(() => expect(screen.getByText("support-bot")).toBeInTheDocument());
    await u.click(screen.getByTestId("open-rev-1"));
    await u.click(screen.getByTestId("approve"));
    await waitFor(() => expect(screen.getByTestId("reviews-notice")).toBeInTheDocument());
    await u.click(screen.getByLabelText("Dismiss"));
    await waitFor(() => expect(screen.queryByTestId("reviews-notice")).toBeNull());
  });
});
