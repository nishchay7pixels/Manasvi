import { useState } from "react";
import { useApi } from "../hooks/useApi.js";
import { fetchMemoryRecords } from "../api/client.js";
import {
  Badge, StatusBadge, TimeAgo, CopyId, EmptyState, LoadingState
} from "../components/ui/primitives.js";
import { Table, FilterBar, FilterSelect } from "../components/ui/Table.js";
import type { MemoryClass } from "../api/types.js";

const CLASS_LABELS: Record<MemoryClass, string> = {
  ephemeral_session: "Ephemeral",
  user_persistent: "User Persistent",
  shared_workspace: "Shared Workspace",
  external_untrusted: "External (Untrusted)",
  audit_linked: "Audit Linked",
};

const CLASS_BADGE: Record<MemoryClass, "cyan" | "violet" | "amber" | "error" | "dim"> = {
  ephemeral_session: "dim",
  user_persistent: "cyan",
  shared_workspace: "violet",
  external_untrusted: "error",
  audit_linked: "amber",
};

export function Memory() {
  const [classFilter, setClassFilter] = useState("all");
  const [trustFilter, setTrustFilter] = useState("all");

  const { data, loading } = useApi(() =>
    fetchMemoryRecords({
      memoryClass: classFilter !== "all" ? classFilter : undefined,
      trustClass: trustFilter !== "all" ? trustFilter : undefined,
      limit: 200,
    })
  );

  const rows = data ?? [];
  const untrustedCount = rows.filter((r) => r.trustClass.includes("untrusted")).length;
  const candidateCount = rows.filter((r) => r.promotionState === "candidate").length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Memory</h1>
          <p className="page-subtitle">Trust-aware memory records — provenance, classification, promotion pipeline</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {untrustedCount > 0 && <Badge variant="error" dot>{untrustedCount} untrusted</Badge>}
          {candidateCount > 0 && <Badge variant="amber" dot>{candidateCount} promotion candidates</Badge>}
        </div>
      </div>

      <FilterBar>
        <FilterSelect
          label="Class"
          value={classFilter}
          onChange={(v) => { setClassFilter(v); }}
          options={[
            { value: "all", label: "All classes" },
            { value: "ephemeral_session", label: "Ephemeral" },
            { value: "user_persistent", label: "User persistent" },
            { value: "shared_workspace", label: "Shared workspace" },
            { value: "external_untrusted", label: "External / untrusted" },
            { value: "audit_linked", label: "Audit linked" },
          ]}
        />
        <FilterSelect
          label="Trust"
          value={trustFilter}
          onChange={(v) => { setTrustFilter(v); }}
          options={[
            { value: "all", label: "All trust levels" },
            { value: "trusted", label: "Trusted" },
            { value: "semi_trusted", label: "Semi-trusted" },
            { value: "untrusted", label: "Untrusted" },
            { value: "external_untrusted", label: "External untrusted" },
          ]}
        />
      </FilterBar>

      {loading && <LoadingState label="Loading memory records…" />}

      {!loading && rows.length === 0 && (
        <EmptyState
          icon="⊞"
          title="No memory records"
          description="Memory records appear here as Manasvi processes conversations and stores context across sessions."
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
              key: "class",
              header: "Memory Class",
              render: (r) => (
                <Badge variant={CLASS_BADGE[r.memoryClass] ?? "dim"}>
                  {CLASS_LABELS[r.memoryClass] ?? r.memoryClass}
                </Badge>
              ),
            },
            {
              key: "namespace",
              header: "Namespace",
              width: "120px",
              render: (r) => r.namespace
                ? <code style={{ fontSize: 11 }}>{r.namespace}</code>
                : <span style={{ color: "var(--text-muted)" }}>—</span>,
            },
            {
              key: "trust",
              header: "Trust",
              width: "130px",
              render: (r) => <StatusBadge status={r.trustClass} label={r.trustClass.replace("_", " ")} />,
            },
            {
              key: "promotion",
              header: "Promotion",
              width: "110px",
              render: (r) => <StatusBadge status={r.promotionState} />,
            },
            {
              key: "tokens",
              header: "Tokens",
              width: "80px",
              render: (r) => r.contentTokenCount != null
                ? <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{r.contentTokenCount}</span>
                : <span style={{ color: "var(--text-muted)" }}>—</span>,
            },
            {
              key: "created",
              header: "Created",
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
