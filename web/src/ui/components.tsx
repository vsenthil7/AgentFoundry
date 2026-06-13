// S94 — AgentFoundry design-system UI primitives.
// Small, typed, accessible building blocks shared by every screen. No external
// UI library: plain React + the design tokens in tokens.css / components.css.
// Every primitive forwards className + remaining props so screens can extend.

import React from "react";

type Div = React.HTMLAttributes<HTMLDivElement>;

function cx(...parts: Array<string | false | undefined | null>): string {
  return parts.filter(Boolean).join(" ");
}

// ---- Button -------------------------------------------------------------
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  block?: boolean;
}
export function Button({ variant = "secondary", block, className, type, ...rest }: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={cx("af-btn", `af-btn--${variant}`, block && "af-btn--block", "af-focusable", className)}
      {...rest}
    />
  );
}

// ---- Card ---------------------------------------------------------------
export interface CardProps extends Omit<Div, "title"> {
  title?: React.ReactNode;
  actions?: React.ReactNode;
}
export function Card({ title, actions, className, children, ...rest }: CardProps) {
  return (
    <section className={cx("af-card", className)} {...rest}>
      {(title !== undefined || actions !== undefined) && (
        <header className="af-card__head">
          {title !== undefined && <h2 className="af-card__title">{title}</h2>}
          {actions !== undefined && <div className="af-card__actions">{actions}</div>}
        </header>
      )}
      <div className="af-card__body">{children}</div>
    </section>
  );
}

// ---- Badge --------------------------------------------------------------
export type BadgeTone = "neutral" | "brand" | "success" | "warn" | "danger" | "info";
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}
export function Badge({ tone = "neutral", className, ...rest }: BadgeProps) {
  return <span className={cx("af-badge", `af-badge--${tone}`, className)} {...rest} />;
}

// ---- Table --------------------------------------------------------------
export interface Column<Row> {
  key: string;
  header: React.ReactNode;
  render: (row: Row) => React.ReactNode;
  align?: "left" | "right" | "center";
}
export interface TableProps<Row> {
  columns: ReadonlyArray<Column<Row>>;
  rows: ReadonlyArray<Row>;
  rowKey: (row: Row) => string;
  empty?: React.ReactNode;
}
export function Table<Row>({ columns, rows, rowKey, empty }: TableProps<Row>) {
  if (rows.length === 0) {
    return <div className="af-table__empty">{empty ?? "Nothing here yet."}</div>;
  }
  return (
    <table className="af-table">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} style={{ textAlign: c.align ?? "left" }}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)}>
            {columns.map((c) => (
              <td key={c.key} style={{ textAlign: c.align ?? "left" }}>
                {c.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---- Tabs ---------------------------------------------------------------
export interface TabItem {
  id: string;
  label: React.ReactNode;
}
export interface TabsProps {
  items: ReadonlyArray<TabItem>;
  active: string;
  onChange: (id: string) => void;
}
export function Tabs({ items, active, onChange }: TabsProps) {
  return (
    <div className="af-tabs" role="tablist">
      {items.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === active}
          className={cx("af-tab", "af-focusable", t.id === active && "af-tab--active")}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---- Field (label + control wrapper) ------------------------------------
export interface FieldProps {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
}
export function Field({ label, htmlFor, hint, error, children }: FieldProps) {
  return (
    <div className={cx("af-field", Boolean(error) && "af-field--error")}>
      <label className="af-field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="af-field__error">{error}</p>
      ) : hint ? (
        <p className="af-field__hint">{hint}</p>
      ) : null}
    </div>
  );
}

// ---- Input (styled text control) ----------------------------------------
export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;
export function Input({ className, ...rest }: InputProps) {
  return <input className={cx("af-input", "af-focusable", className)} {...rest} />;
}

// ---- Banner -------------------------------------------------------------
export type BannerTone = "info" | "success" | "warn" | "danger";
export interface BannerProps extends Div {
  tone?: BannerTone;
  onDismiss?: () => void;
}
export function Banner({ tone = "info", onDismiss, className, children, ...rest }: BannerProps) {
  return (
    <div role="status" className={cx("af-banner", `af-banner--${tone}`, className)} {...rest}>
      <div className="af-banner__body">{children}</div>
      {onDismiss && (
        <button type="button" className="af-banner__close af-focusable" aria-label="Dismiss" onClick={onDismiss}>
          ×
        </button>
      )}
    </div>
  );
}

// ---- Modal --------------------------------------------------------------
export interface ModalProps {
  open: boolean;
  title?: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}
export function Modal({ open, title, onClose, footer, children }: ModalProps) {
  if (!open) return null;
  return (
    <div className="af-modal__overlay" onClick={onClose}>
      <div
        className="af-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="af-modal__head">
          {title !== undefined && <h2 className="af-modal__title">{title}</h2>}
          <button type="button" className="af-modal__close af-focusable" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="af-modal__body">{children}</div>
        {footer !== undefined && <footer className="af-modal__foot">{footer}</footer>}
      </div>
    </div>
  );
}

// ---- Avatar -------------------------------------------------------------
export interface AvatarProps {
  name: string;
  size?: number;
}
// Derive up to two uppercase initials from an email or display name.
export function initialsOf(name: string): string {
  const local = name.includes("@") ? name.slice(0, name.indexOf("@")) : name;
  const parts = local.split(/[.\s_-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
export function Avatar({ name, size = 32 }: AvatarProps) {
  return (
    <span
      className="af-avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden="true"
      title={name}
    >
      {initialsOf(name)}
    </span>
  );
}
