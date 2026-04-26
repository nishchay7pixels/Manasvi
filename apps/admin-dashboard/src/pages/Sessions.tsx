import { useState } from "react";
import { usePolling } from "../hooks/useApi.js";
import { fetchSessions } from "../api/client.js";
import {
  StatusBadge, TimeAgo, CopyId, EmptyState, LoadingState, Badge
} from "../components/ui/primitives.js";
import { Table, FilterBar, FilterInput, FilterSelect } from "../components/ui/Table.js";

export function Sessions() {
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState("all");
  const { data, loading } = usePolling(fetchSessions, 12_000);

  const rows = (data ?? []).filter((s) => {
    if (channelFilter !== "all" && s.channelType !== channelFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!s.sessionId.includes(q) && !(s.principalId ?? "").includes(q)) return false;
    }
    return true;
  });

  const channels = [...new Set((data ?? []).map((s) => s.channelType).filter(Boolean))];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Sessions</h1>
          <p className="page-subtitle">Active and recent conversation sessions across all channels</p>
        </div>
        <Badge variant="cyan">{(data ?? []).length} total</Badge>
      </div>

      <FilterBar>
        <FilterInput placeholder="Search by session or principal ID…" value={search} onChange={setSearch} />
        <FilterSelect
          label="Channel"
          value={channelFilter}
          onChange={setChannelFilter}
          options={[
            { value: "all", label: "All channels" },
            ...channels.map((c) => ({ value: c!, label: c! })),
          ]}
        />
      </FilterBar>

      {loading && !data && <LoadingState label="Loading sessions…" />}

      {!loading && rows.length === 0 && (
        <EmptyState
          icon="⊡"
          title="No sessions found"
          description="Sessions appear here when users interact with Manasvi through any channel."
        />
      )}

      {rows.length > 0 && (
        <Table
          columns={[
            {
              key: "id",
              header: "Session ID",
              width: "160px",
              render: (s) => <CopyId id={s.sessionId} maxLen={14} />,
            },
            {
              key: "principal",
              header: "Principal",
              render: (s) => s.principalId
                ? <CopyId id={s.principalId} maxLen={16} />
                : <span style={{ color: "var(--text-muted)" }}>anonymous</span>,
            },
            {
              key: "channel",
              header: "Channel",
              width: "110px",
              render: (s) => s.channelType
                ? <StatusBadge status="cyan" label={s.channelType} />
                : <span style={{ color: "var(--text-muted)" }}>—</span>,
            },
            {
              key: "isolation",
              header: "Isolation",
              width: "120px",
              render: (s) => s.isolationMode
                ? <Badge variant="dim">{s.isolationMode}</Badge>
                : <span style={{ color: "var(--text-muted)" }}>—</span>,
            },
            {
              key: "risk",
              header: "Risk",
              width: "80px",
              render: (s) => s.riskProfile
                ? <StatusBadge status={s.riskProfile} />
                : <span style={{ color: "var(--text-muted)" }}>—</span>,
            },
            {
              key: "msgs",
              header: "Messages",
              width: "90px",
              render: (s) => (
                <span style={{ color: "var(--text-secondary)" }}>
                  {s.messageCount ?? "—"}
                </span>
              ),
            },
            {
              key: "last",
              header: "Last Active",
              width: "110px",
              render: (s) => <TimeAgo iso={s.lastActivityAt ?? s.createdAt} />,
            },
          ]}
          rows={rows}
          rowKey={(s) => s.sessionId}
        />
      )}
    </div>
  );
}
