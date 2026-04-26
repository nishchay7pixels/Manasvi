import { useState } from "react";
import { useApi, usePolling } from "../hooks/useApi.js";
import { fetchPolicyDecisions, fetchPolicyMetadata } from "../api/client.js";
import {
  Card, CardHeader, StatusBadge, TimeAgo, CopyId,
  EmptyState, LoadingState
} from "../components/ui/primitives.js";
import { Table, FilterBar, FilterInput, FilterSelect } from "../components/ui/Table.js";

export function Policy() {
  const [search, setSearch] = useState("");
  const [resultFilter, setResultFilter] = useState("all");

  const { data: meta } = useApi(fetchPolicyMetadata);
  const { data: decisions, loading } = usePolling(fetchPolicyDecisions, 15_000);

  const rows = (decisions ?? []).filter((d) => {
    if (resultFilter !== "all" && d.result !== resultFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!(d.action ?? "").includes(q) && !(d.actorPrincipalId ?? "").includes(q)) return false;
    }
    return true;
  });

  const allowCount = (decisions ?? []).filter((d) => d.result === "allow").length;
  const denyCount = (decisions ?? []).filter((d) => d.result === "deny").length;
  const approvalCount = (decisions ?? []).filter((d) => d.result === "approval_required").length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Policy</h1>
          <p className="page-subtitle">Policy decisions, rule matches, risk scoring, and governance actions</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid-3">
        <Card accent="cyan">
          <div style={{ fontSize: 28, fontWeight: 700, color: "var(--success)" }}>{allowCount}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Allowed</div>
        </Card>
        <Card accent="amber">
          <div style={{ fontSize: 28, fontWeight: 700, color: "var(--amber)" }}>{approvalCount}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Approval required</div>
        </Card>
        <Card>
          <div style={{ fontSize: 28, fontWeight: 700, color: "var(--error)" }}>{denyCount}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Denied</div>
        </Card>
      </div>

      {/* Policy set metadata */}
      {meta && (
        <Card>
          <CardHeader title="Active Policy Set" icon="⊟" />
          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "8px 16px", fontSize: 13 }}>
            {meta.policySetId && <><span style={{ color: "var(--text-muted)" }}>Policy set</span><code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{meta.policySetId}</code></>}
            {meta.ruleCount != null && <><span style={{ color: "var(--text-muted)" }}>Rules</span><span>{meta.ruleCount}</span></>}
            {meta.description && <><span style={{ color: "var(--text-muted)" }}>Description</span><span>{meta.description}</span></>}
            {meta.loadedAt && <><span style={{ color: "var(--text-muted)" }}>Loaded</span><TimeAgo iso={meta.loadedAt} /></>}
          </div>
        </Card>
      )}

      {/* Decisions table */}
      <FilterBar>
        <FilterInput placeholder="Search by action or principal…" value={search} onChange={setSearch} />
        <FilterSelect
          label="Result"
          value={resultFilter}
          onChange={setResultFilter}
          options={[
            { value: "all", label: "All results" },
            { value: "allow", label: "Allow" },
            { value: "deny", label: "Deny" },
            { value: "approval_required", label: "Approval required" },
            { value: "conditional_allow", label: "Conditional allow" },
          ]}
        />
      </FilterBar>

      {loading && !decisions && <LoadingState label="Loading policy decisions…" />}

      {!loading && rows.length === 0 && (
        <EmptyState
          icon="⊟"
          title="No policy decisions"
          description="Policy decisions from the policy service appear here as Manasvi evaluates actions."
        />
      )}

      {rows.length > 0 && (
        <Table
          columns={[
            {
              key: "action",
              header: "Action",
              render: (d) => d.action
                ? <code style={{ fontSize: 12, color: "var(--violet)" }}>{d.action}</code>
                : <span style={{ color: "var(--text-muted)" }}>—</span>,
            },
            {
              key: "resource",
              header: "Resource",
              render: (d) => d.resource
                ? <span style={{ fontSize: 12 }}>{d.resource}</span>
                : <span style={{ color: "var(--text-muted)" }}>—</span>,
            },
            {
              key: "result",
              header: "Result",
              width: "140px",
              render: (d) => <StatusBadge status={d.result} label={d.result.replace("_", " ")} />,
            },
            {
              key: "risk",
              header: "Risk",
              width: "70px",
              render: (d) => d.riskScore != null
                ? <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{d.riskScore}</span>
                : <span style={{ color: "var(--text-muted)" }}>—</span>,
            },
            {
              key: "rule",
              header: "Matched Rule",
              width: "120px",
              render: (d) => d.matchedRuleId
                ? <CopyId id={d.matchedRuleId} maxLen={10} />
                : <span style={{ color: "var(--text-muted)" }}>—</span>,
            },
            {
              key: "created",
              header: "Time",
              width: "100px",
              render: (d) => <TimeAgo iso={d.createdAt} />,
            },
          ]}
          rows={rows}
          rowKey={(d) => d.decisionId}
        />
      )}
    </div>
  );
}
