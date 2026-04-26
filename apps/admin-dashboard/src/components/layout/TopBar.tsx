import { useNavigate } from "react-router-dom";
import "./topbar.css";

interface TopBarProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function TopBar({ title, subtitle, actions }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar__title-block">
        <h1 className="topbar__title">{title}</h1>
        {subtitle && <span className="topbar__subtitle">{subtitle}</span>}
      </div>
      {actions && <div className="topbar__actions">{actions}</div>}
    </header>
  );
}

// ── GlobalStatusBar — pinned at the very top of the content area ──────────

export function GlobalStatusBar({
  services,
  pendingApprovals,
}: {
  services?: { online: boolean }[];
  pendingApprovals?: number;
}) {
  const navigate = useNavigate();
  const onlineCount = services?.filter((s) => s.online).length ?? 0;
  const totalCount = services?.length ?? 0;
  const allHealthy = onlineCount === totalCount && totalCount > 0;

  return (
    <div className="global-status-bar">
      <div className="global-status-bar__left">
        <span
          className={`global-status-bar__health ${allHealthy ? "global-status-bar__health--ok" : totalCount === 0 ? "global-status-bar__health--unknown" : "global-status-bar__health--warn"}`}
        >
          <span className="global-status-bar__dot" />
          {totalCount === 0
            ? "Checking services…"
            : allHealthy
            ? `${onlineCount} services healthy`
            : `${onlineCount}/${totalCount} services online`}
        </span>
      </div>
      <div className="global-status-bar__right">
        {(pendingApprovals ?? 0) > 0 && (
          <button
            className="global-status-bar__alert"
            onClick={() => navigate("/approvals")}
          >
            <span>⊘</span>
            {pendingApprovals} pending approval{(pendingApprovals ?? 0) !== 1 ? "s" : ""}
          </button>
        )}
        <span className="global-status-bar__env">local</span>
      </div>
    </div>
  );
}
