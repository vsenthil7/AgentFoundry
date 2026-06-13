import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Button,
  Card,
  Badge,
  Table,
  Tabs,
  Field,
  Input,
  Banner,
  Modal,
  Avatar,
  initialsOf,
  type Column,
} from "../src/ui/components.js";

beforeEach(() => cleanup());

describe("Button (S94)", () => {
  it("defaults to a secondary button of type button", () => {
    render(<Button>Go</Button>);
    const btn = screen.getByRole("button", { name: "Go" });
    expect(btn).toHaveClass("af-btn", "af-btn--secondary");
    expect(btn).toHaveAttribute("type", "button");
  });

  it("applies variant, block, custom className and explicit type", () => {
    render(<Button variant="primary" block type="submit" className="x">Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn).toHaveClass("af-btn--primary", "af-btn--block", "x");
    expect(btn).toHaveAttribute("type", "submit");
  });

  it("renders danger + ghost variants and fires onClick", async () => {
    const onClick = vi.fn();
    render(<><Button variant="danger" onClick={onClick}>Del</Button><Button variant="ghost">G</Button></>);
    expect(screen.getByRole("button", { name: "Del" })).toHaveClass("af-btn--danger");
    expect(screen.getByRole("button", { name: "G" })).toHaveClass("af-btn--ghost");
    await userEvent.click(screen.getByRole("button", { name: "Del" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("Card (S94)", () => {
  it("renders a bare card body with no header when no title/actions", () => {
    render(<Card>content</Card>);
    expect(screen.getByText("content")).toBeInTheDocument();
    expect(document.querySelector(".af-card__head")).toBeNull();
  });

  it("renders title and actions when provided", () => {
    render(<Card title="Agents" actions={<button>New</button>} className="c">body</Card>);
    expect(screen.getByText("Agents")).toHaveClass("af-card__title");
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
    expect(document.querySelector(".af-card")).toHaveClass("c");
  });

  it("renders a header when only actions are given (no title)", () => {
    render(<Card actions={<span>act</span>}>b</Card>);
    expect(document.querySelector(".af-card__head")).not.toBeNull();
    expect(document.querySelector(".af-card__title")).toBeNull();
  });
});

describe("Badge (S94)", () => {
  it("defaults to neutral tone", () => {
    render(<Badge>n</Badge>);
    expect(screen.getByText("n")).toHaveClass("af-badge", "af-badge--neutral");
  });
  it("honours an explicit tone + className", () => {
    render(<Badge tone="success" className="z">ok</Badge>);
    expect(screen.getByText("ok")).toHaveClass("af-badge--success", "z");
  });
});

interface Row { id: string; name: string; score: number }
const cols: ReadonlyArray<Column<Row>> = [
  { key: "name", header: "Name", render: (r) => r.name },
  { key: "score", header: "Score", align: "right", render: (r) => r.score },
];

describe("Table (S94)", () => {
  it("renders the default empty state when there are no rows", () => {
    render(<Table<Row> columns={cols} rows={[]} rowKey={(r) => r.id} />);
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });

  it("renders a custom empty node", () => {
    render(<Table<Row> columns={cols} rows={[]} rowKey={(r) => r.id} empty={<span>no agents</span>} />);
    expect(screen.getByText("no agents")).toBeInTheDocument();
  });

  it("renders headers + rows with alignment", () => {
    const rows: Row[] = [{ id: "a", name: "Bot A", score: 9 }, { id: "b", name: "Bot B", score: 7 }];
    render(<Table<Row> columns={cols} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Bot A")).toBeInTheDocument();
    expect(screen.getByText("Bot B")).toBeInTheDocument();
    const scoreHeader = screen.getByText("Score");
    expect(scoreHeader).toHaveStyle({ textAlign: "right" });
  });
});

describe("Tabs (S94)", () => {
  const items = [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }];
  it("marks the active tab and reports changes", async () => {
    const onChange = vi.fn();
    render(<Tabs items={items} active="a" onChange={onChange} />);
    const alpha = screen.getByRole("tab", { name: "Alpha" });
    const beta = screen.getByRole("tab", { name: "Beta" });
    expect(alpha).toHaveAttribute("aria-selected", "true");
    expect(alpha).toHaveClass("af-tab--active");
    expect(beta).toHaveAttribute("aria-selected", "false");
    await userEvent.click(beta);
    expect(onChange).toHaveBeenCalledWith("b");
  });
});

describe("Field + Input (S94)", () => {
  it("shows a hint when there is no error", () => {
    render(<Field label="Email" htmlFor="e" hint="we never share it"><Input id="e" /></Field>);
    expect(screen.getByText("we never share it")).toHaveClass("af-field__hint");
    expect(document.querySelector(".af-field--error")).toBeNull();
  });

  it("shows an error (taking priority over hint) and flags the wrapper", () => {
    render(<Field label="Email" hint="ignored" error="required"><Input /></Field>);
    expect(screen.getByText("required")).toHaveClass("af-field__error");
    expect(screen.queryByText("ignored")).toBeNull();
    expect(document.querySelector(".af-field--error")).not.toBeNull();
  });

  it("renders neither hint nor error when both absent", () => {
    render(<Field label="Name"><Input /></Field>);
    expect(document.querySelector(".af-field__hint")).toBeNull();
    expect(document.querySelector(".af-field__error")).toBeNull();
  });

  it("Input forwards props + className", () => {
    render(<Input placeholder="type" className="i" />);
    const input = screen.getByPlaceholderText("type");
    expect(input).toHaveClass("af-input", "i");
  });
});

describe("Banner (S94)", () => {
  it("defaults to info tone and shows no close button without onDismiss", () => {
    render(<Banner>hello</Banner>);
    expect(document.querySelector(".af-banner")).toHaveClass("af-banner--info");
    expect(screen.queryByLabelText("Dismiss")).toBeNull();
  });

  it("renders a tone + dismiss button that fires the callback", async () => {
    const onDismiss = vi.fn();
    render(<Banner tone="danger" onDismiss={onDismiss}>bad</Banner>);
    expect(document.querySelector(".af-banner")).toHaveClass("af-banner--danger");
    await userEvent.click(screen.getByLabelText("Dismiss"));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe("Modal (S94)", () => {
  it("renders nothing when closed", () => {
    render(<Modal open={false} onClose={() => {}}>x</Modal>);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders title, body, footer when open", () => {
    render(<Modal open title="Confirm" footer={<button>OK</button>} onClose={() => {}}>are you sure?</Modal>);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Confirm")).toBeInTheDocument();
    expect(screen.getByText("are you sure?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "OK" })).toBeInTheDocument();
  });

  it("renders without a title/footer", () => {
    render(<Modal open onClose={() => {}}>plain</Modal>);
    expect(document.querySelector(".af-modal__title")).toBeNull();
    expect(document.querySelector(".af-modal__foot")).toBeNull();
  });

  it("closes via the X and the overlay, but not when clicking the panel", async () => {
    const onClose = vi.fn();
    render(<Modal open title="T" onClose={onClose}>body</Modal>);
    await userEvent.click(screen.getByText("body")); // panel click — stopPropagation
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByLabelText("Close")); // X
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(document.querySelector(".af-modal__overlay")!); // overlay
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("Avatar + initialsOf (S94)", () => {
  it("derives initials from emails, multi-part and single names, and blanks", () => {
    expect(initialsOf("jane.doe@acme.com")).toBe("JD"); // local 'jane.doe' splits on '.' -> J + D
    expect(initialsOf("owner@acme.com")).toBe("OW");
    expect(initialsOf("Grace Hopper")).toBe("GH");
    expect(initialsOf("madonna")).toBe("MA");
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("   ")).toBe("?");
  });

  it("renders an avatar with size + title", () => {
    render(<Avatar name="Grace Hopper" size={48} />);
    const av = screen.getByTitle("Grace Hopper");
    expect(av).toHaveClass("af-avatar");
    expect(av).toHaveTextContent("GH");
    expect(av).toHaveStyle({ width: "48px", height: "48px" });
  });

  it("uses the default size when none is given", () => {
    render(<Avatar name="solo" />);
    expect(screen.getByTitle("solo")).toHaveStyle({ width: "32px" });
  });
});
