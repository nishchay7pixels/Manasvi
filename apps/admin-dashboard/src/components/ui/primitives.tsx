import React, { useState } from "react";
import "./primitives.css";

// ── Badge ─────────────────────────────────────────────────────────────────

export type BadgeVariant =
  | "default" | "success" | "warning" | "error" | "info"
  | "violet" | "pending" | "dim" | "amber" | "cyan";

export function Badge({
  children,
  variant = "default",
  dot,
}: {
  children: React.ReactNode;
  variant?: BadgeVariant;
  dot?: boolean;
}) {
  return (
    <span className={`badge badge--${variant}`}>
      {dot && <span className="badge__dot" />}
      {children}
    </span>
  );
}

// ── StatusDot ─────────────────────────────────────────────────────────────

export type StatusVariant = "online" | "offline" | "warning" | "error" | "pending" | "dim";

export function StatusDot({ status, size = 8 }: { status: StatusVariant; size?: number }) {
  return (
    <span
      className={`status-dot status-dot--${status}`}
      style={{ width: size, height: size }}
    />
  );
}

// ── Card ──────────────────────────────────────────────────────────────────

export function Card({
  children,
  className,
  onClick,
  accent,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  accent?: "amber" | "cyan" | "violet";
}) {
  return (
    <div
      className={`card${accent ? ` card--${accent}` : ""}${onClick ? " card--clickable" : ""}${className ? ` ${className}` : ""}`}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  actions,
  icon,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="card-header">
      <div className="card-header__left">
        {icon && <span className="card-header__icon">{icon}</span>}
        <div>
          <div className="card-header__title">{title}</div>
          {subtitle && <div className="card-header__subtitle">{subtitle}</div>}
        </div>
      </div>
      {actions && <div className="card-header__actions">{actions}</div>}
    </div>
  );
}

// ── MetricCard ────────────────────────────────────────────────────────────

export function MetricCard({
  label,
  value,
  sub,
  accent,
  icon,
  onClick,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: "amber" | "cyan" | "violet";
  icon?: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <Card accent={accent} onClick={onClick} className="metric-card">
      <div className="metric-card__icon">{icon}</div>
      <div className="metric-card__value">{value}</div>
      <div className="metric-card__label">{label}</div>
      {sub && <div className="metric-card__sub">{sub}</div>}
    </Card>
  );
}

// ── CopyId ────────────────────────────────────────────────────────────────

export function CopyId({ id, maxLen = 12 }: { id: string; maxLen?: number }) {
  const [copied, setCopied] = useState(false);
  const display = id.length > maxLen ? `${id.slice(0, maxLen)}…` : id;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <button className="copy-id" onClick={handleCopy} title={id}>
      <span className="copy-id__text mono">{display}</span>
      <span className="copy-id__icon">{copied ? "✓" : "⎘"}</span>
    </button>
  );
}

// ── TimeAgo ───────────────────────────────────────────────────────────────

export function TimeAgo({ iso }: { iso?: string | null }) {
  if (!iso) return <span className="text-muted">—</span>;
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  let label: string;
  if (diff < 60_000) label = `${Math.floor(diff / 1000)}s ago`;
  else if (diff < 3_600_000) label = `${Math.floor(diff / 60_000)}m ago`;
  else if (diff < 86_400_000) label = `${Math.floor(diff / 3_600_000)}h ago`;
  else label = d.toLocaleDateString();
  return <span title={d.toLocaleString()} className="time-ago">{label}</span>;
}

// ── Spinner ───────────────────────────────────────────────────────────────

export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg
      className="spinner"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
    >
      <circle
        cx="12" cy="12" r="10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="32"
        strokeDashoffset="12"
        opacity="0.3"
      />
      <circle
        cx="12" cy="12" r="10"
        stroke="var(--violet)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="16"
        strokeDashoffset="0"
      />
    </svg>
  );
}

// ── EmptyState ────────────────────────────────────────────────────────────

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state__icon">{icon}</div>}
      <div className="empty-state__title">{title}</div>
      {description && <div className="empty-state__desc">{description}</div>}
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}

// ── LoadingState ──────────────────────────────────────────────────────────

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="loading-state">
      <Spinner size={24} />
      <span>{label}</span>
    </div>
  );
}

// ── ErrorState ────────────────────────────────────────────────────────────

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="error-state">
      <span className="error-state__icon">⚠</span>
      <span>{message}</span>
      {onRetry && (
        <button className="btn btn--ghost btn--sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

// ── Button ────────────────────────────────────────────────────────────────

export function Button({
  children,
  onClick,
  variant = "primary",
  size = "md",
  disabled,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success";
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      className={`btn btn--${variant} btn--${size}${className ? ` ${className}` : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

// ── Divider ───────────────────────────────────────────────────────────────

export function Divider() {
  return <div className="divider" />;
}

// ── SectionLabel ──────────────────────────────────────────────────────────

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="section-label">{children}</div>;
}

// ── StatusBadge for service states ────────────────────────────────────────

const statusVariantMap: Record<string, BadgeVariant> = {
  // service states
  online: "success", offline: "dim",
  // generic states
  active: "success", running: "cyan", healthy: "success",
  completed: "success", succeeded: "success",
  failed: "error", error: "error", critical: "error",
  pending: "warning", waiting: "warning",
  warning: "warning", degraded: "warning",
  disabled: "dim", stopped: "dim", none: "dim",
  denied: "error", deny: "error",
  allowed: "success", allow: "success", approved: "success",
  approval_required: "amber", quarantined: "warning", revoked: "error",
  trusted: "success", semi_trusted: "warning", untrusted: "error",
  external_untrusted: "error", candidate: "amber",
  polling: "cyan", webhook: "violet",
  low: "success", medium: "warning", high: "error",
  enabled: "success",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const variant = statusVariantMap[status.toLowerCase()] ?? "dim";
  return <Badge variant={variant}>{label ?? status}</Badge>;
}

// ── JsonViewer ────────────────────────────────────────────────────────────

export function JsonViewer({ data, maxHeight = 300 }: { data: unknown; maxHeight?: number }) {
  return (
    <pre
      className="json-viewer"
      style={{ maxHeight }}
    >
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
