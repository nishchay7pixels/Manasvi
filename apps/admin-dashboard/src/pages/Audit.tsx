import { useState } from "react";
import { usePolling } from "../hooks/useApi.js";
import { fetchApprovalAuditRecords } from "../api/client.js";
import {
  Badge, StatusBadge, TimeAgo, CopyId, EmptyState, LoadingState
} from "../components/ui/primitives.js";
import { Table, FilterBar, FilterInput, FilterSelect } from "../components/ui/Table.js";

export function Audit() {
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("all");

  // Approval audit is the primary audit source; real deployments would query the audit service
  const { data, loading } = usePolling(fetchApprovalAuditRecords, 15_000);

  const rows = (data ?? []).filter((r) => {
    if (stateFilter !== "all" && r.state !== stateFilter) return false;
    if (search && !r.recordId.includes(search) && !r.requestId.includes(search)) return false;
    return true;
  });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit Log</h1>
          <p className="page-subtitle">Append-only audit record of governance events — approvals, policy, execution</p>
        </div>
        <Badge variant="violet">{(data ?? []).length} records</Badge>
      </div>

      <div style={{
        fontSize: 12,
        color: "var(--text-muted)",
        padding: "10px 14px",
        background: "var(--violet-glow)",
        border: "1px solid var(--violet-muted)",
        borderRadius: "var(--radius)",
      }}>
        ⊟ Audit records are append-only and integrity-verified. Currently showing approval audit records.
        Full event audit from all services requires the audit service to be running.
      </div>

      <FilterBar>
        <FilterInput placeholder="Search by record ID or request ID…" value={search} onChange={setSearch} />
        <FilterSelect
          label="State"
          value={stateFilter}
          onChange={setStateFilter}
          options={[
            { value: "all", label: "All states" },
            { value: "pending", label: "Pending" },
            { value: "approved", label: "Approved" },
            { value: "denied", label: "Denied" },
            { value: "expired", label: "Expired" },
            { value: "revoked", label: "Revoked" },
          ]}
        />
      </FilterBar>

      {loading && !data && <LoadingState label="Loading audit records…" />}

      {!loading && rows.length === 0 && (
        <EmptyState
          icon="≡"
          title="No audit records"
          description="Audit events appear here as Manasvi processes approvals and governance actions."
        />
      )}

      {rows.length > 0 && (
        <Table
          columns={[
            {
              key: "id",
              header: "Record ID",
              width: "140px",
              render: (r) => <CopyId id={r.recordId} maxLen={12} />,
            },
            {
              key: "requestId",
              header: "Request ID",
              width: "140px",
              render: (r) => <CopyId id={r.requestId} maxLen={12} />,
            },
            {
              key: "state",
              header: "State",
              width: "110px",
              render: (r) => <StatusBadge status={r.state} />,
            },
            {
              key: "actor",
              header: "Actor",
              width: "120px",
              render: (r) => r.actorId
                ? <CopyId id={r.actorId} maxLen={10} />
                : <span style={{ color: "var(--text-muted)" }}>system</span>,
            },
            {
              key: "reason",
              header: "Reason",
              render: (r) => r.reason
                ? <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{r.reason}</span>
                : <span style={{ color: "var(--text-muted)" }}>—</span>,
            },
            {
              key: "created",
              header: "Time",
              width: "100px",
              render: (r) => <TimeAgo iso={r.createdAt} />,
            },
          ]}
          rows={rows}
          rowKey={(r) => r.recordId}
        />
      )}
    </div>
  );
}
