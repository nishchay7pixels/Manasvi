import { NavLink, useLocation } from "react-router-dom";
import "./sidebar.css";

interface NavItem {
  path: string;
  label: string;
  icon: string;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const NAV: NavSection[] = [
  {
    label: "Operate",
    items: [
      { path: "/", label: "Overview", icon: "◈" },
      { path: "/activity", label: "Live Activity", icon: "◎" },
      { path: "/sessions", label: "Sessions", icon: "⊡" },
      { path: "/executions", label: "Executions", icon: "⚙" },
      { path: "/approvals", label: "Approvals", icon: "⊘" },
    ],
  },
  {
    label: "Connect",
    items: [
      { path: "/channels", label: "Channels", icon: "◈" },
      { path: "/models", label: "Models", icon: "◉" },
      { path: "/tools", label: "Tools", icon: "⌖" },
    ],
  },
  {
    label: "Govern",
    items: [
      { path: "/policy", label: "Policy", icon: "⊟" },
      { path: "/memory", label: "Memory", icon: "⊞" },
      { path: "/audit", label: "Audit", icon: "≡" },
      { path: "/risk", label: "Risk", icon: "⚑" },
    ],
  },
  {
    label: "Extend",
    items: [
      { path: "/plugins", label: "Plugins", icon: "⊕" },
      { path: "/nodes", label: "Nodes", icon: "⊛" },
    ],
  },
  {
    label: "Configure",
    items: [
      { path: "/traces", label: "Trace Explorer", icon: "⊹" },
      { path: "/settings", label: "Settings", icon: "⊜" },
      { path: "/secrets", label: "Secrets", icon: "⊗" },
      { path: "/tenants", label: "Tenants", icon: "⊏" },
    ],
  },
];

export function Sidebar() {
  const location = useLocation();

  return (
    <aside className="sidebar">
      {/* Logo / Brand */}
      <div className="sidebar__brand">
        <div className="sidebar__logo">
          <span className="sidebar__logo-m">M</span>
        </div>
        <div className="sidebar__brand-text">
          <span className="sidebar__name">Manasvi</span>
          <span className="sidebar__sub">Control Room</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="sidebar__nav">
        {NAV.map((section) => (
          <div key={section.label} className="sidebar__section">
            <div className="sidebar__section-label">{section.label}</div>
            {section.items.map((item) => {
              const active =
                item.path === "/"
                  ? location.pathname === "/"
                  : location.pathname.startsWith(item.path);
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={`sidebar__item${active ? " sidebar__item--active" : ""}`}
                  end={item.path === "/"}
                >
                  <span className="sidebar__item-icon">{item.icon}</span>
                  <span className="sidebar__item-label">{item.label}</span>
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="sidebar__footer">
        <div className="sidebar__footer-env">
          <span className="sidebar__footer-dot" />
          <span>local</span>
        </div>
        <span className="sidebar__footer-ver">v0.1.0</span>
      </div>
    </aside>
  );
}
