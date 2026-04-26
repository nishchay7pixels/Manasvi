import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar.js";
import { GlobalStatusBar } from "./TopBar.js";
import { usePolling } from "../../hooks/useApi.js";
import { fetchSystemOverview } from "../../api/client.js";
import "./applayout.css";

export function AppLayout() {
  const { data: overview } = usePolling(fetchSystemOverview, 15_000);

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="app-layout__main">
        <GlobalStatusBar
          services={overview?.services}
          pendingApprovals={overview?.pendingApprovals}
        />
        <div className="app-layout__content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
