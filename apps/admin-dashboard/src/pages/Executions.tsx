import { useState } from "react";
import { usePolling } from "../hooks/useApi.js";
import { fetchExecutions } from "../api/client.js";
import {
  StatusBadge, TimeAgo, CopyId, EmptyState, LoadingState, Badge
} from "../components/ui/primitives.js";
import { Table, FilterBar, FilterInput, FilterSelect } from "../components/ui/Table.js";

export function Executions() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const { data, loading } = usePolling(fetchExecutions, 10_000);

  const rows = (data ?? []).filter((e) => {
    if (statusFilter !== "all" && e.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!e.runId.includes(q) && !(e.tool ?? "").includes(q)) return false;
    }
    return true;
  });

  const running = (data ?? []).filter((e) => e.status === "running").length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Executions</h1>
          <p className="page-subtitle">Governed tool execution runs — sandboxed, policy-bound</p>
        </div>
        {running > 0 && <Badge variant="cyan" dot>{running} running</Badge>}
      </div>

      <FilterBar>
        <FilterInput placeholder="Search by run ID or tool…" value={search} onChange={setSearch} />
        <FilterSelect
          label="Status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "all", label: "All statuses" },
            { value: "running", label: "Running" },
            { value: "pending", label: "Pending" },
            { value: "completed", label: "Completed" },
            { value: "failed", label: "Failed" },
            { value: "timeout", label: "Timeout" },
          ]}
        />
      </FilterBar>

      {loading && !data && <LoadingState label="Loading executions…" />}

      {!loading && rows.length === 0 && (
        <EmptyState
          icon="⚙"
          title="No executions found"
          description="Execution runs appear here when Manasvi invokes tools under sandbox controls."
        />
      )}

      {rows.length > 0 && (
        <Table
          columns={[
            {
              key: "id",
              header: "Run ID",
              width: "140px",
              render: (e) => <CopyId id={e.runId} maxLen={12} />,
            },
            {
              key: "tool",
              header: "Tool",
              render: (e) => e.tool
                ? <code style={{ fontSize: 12, color: "var(--cyan)" }}>{e.tool}</code>
                : <span style={{ color: "var(--text-muted)" }}>—</span>,
            },
            {
              key: "actionClass",
              header: "Action Class",
              width: "130px",
              render: (e) => e.actionClass
                ? <Badge variant="dim">{e.actionClass}</Badge>
                : <span style={{ color: "var(--text-muted)" }}>—</span>,
            },
            {
              key: "sandbox",
              header: "Sandbox",
              width: "110px",
              render: (e) => e.sandboxMode
                ? <Badge variant="violet">{e.sandboxMode}</Badge>
                : <span style={{ color: "var(--text-muted)" }}>—</span>,
            },
            {
              key: "node",
              header: "Node",
              width: "110px",
              render: (e) => e.nodeId
                ? <CopyId id={e.nodeId} maxLen={10} />
                : <Badge variant="dim">local</Badge>,
            },
            {
              key: "status",
              header: "Status",
              width: "110px",
              render: (e) => <StatusBadge status={e.status} />,
            },
            {
              key: "started",
              header: "Started",
              width: "100px",
              render: (e) => <TimeAgo iso={e.startedAt} />,
            },
          ]}
          rows={rows}
          rowKey={(e) => e.runId}
        />
      )}
    </div>
  );
}
