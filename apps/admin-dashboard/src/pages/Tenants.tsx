import { Card, CardHeader, Badge } from "../components/ui/primitives.js";

export function Tenants() {
  // In local/single-tenant deployment, show the default tenant context
  const localTenant = {
    tenantId: "tenant-local",
    workspaceId: "workspace-local",
    profile: "local",
    isolationMode: "per_user_isolated",
    policySetId: "default-policy-set",
    memoryScoping: "per_workspace",
    pluginRestrictions: "default",
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Tenants &amp; Workspaces</h1>
          <p className="page-subtitle">Tenant isolation, workspace scoping, and per-tenant policy configuration</p>
        </div>
        <Badge variant="dim">single-tenant local</Badge>
      </div>

      <div style={{
        padding: "12px 16px",
        background: "var(--cyan-glow)",
        border: "1px solid var(--cyan-muted)",
        borderRadius: "var(--radius)",
        fontSize: 13,
        color: "var(--text-secondary)",
        lineHeight: 1.5,
      }}>
        ◈ Currently running in <strong>single-tenant local mode</strong>.
        Multi-tenant support is architected and ready — tenant routing is handled by the
        orchestrator via <code style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--cyan)" }}>tenantId</code> and{" "}
        <code style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--cyan)" }}>workspaceId</code> context on every event.
      </div>

      <Card>
        <CardHeader title="Active Tenant Context" icon="⊏" actions={<Badge variant="success">Active</Badge>} />
        <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: "10px 16px", fontSize: 13 }}>
          {Object.entries(localTenant).map(([k, v]) => (
            <>
              <span key={`${k}-label`} style={{ color: "var(--text-muted)" }}>{k.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
              <code key={`${k}-val`} style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-primary)" }}>{v}</code>
            </>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Multi-Tenant Architecture" icon="⊞" />
        <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, display: "flex", flexDirection: "column", gap: 12 }}>
          <p>
            Manasvi is designed for multi-tenant deployment from the ground up.
            Every inbound event carries <code style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--violet)" }}>tenantId</code> and{" "}
            <code style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--violet)" }}>workspaceId</code> as first-class fields.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            {[
              { label: "Per-tenant policy sets", desc: "Each tenant can bind a distinct policy set controlling tool access, risk thresholds, and approval workflows." },
              { label: "Per-tenant memory scoping", desc: "Memory namespaces are isolated by workspace. Shared memory requires explicit cross-tenant grants." },
              { label: "Per-tenant plugin restrictions", desc: "Plugin capability grants can be restricted per-tenant — limiting surface area per deployment context." },
              { label: "Cross-tenant audit", desc: "Audit records carry tenantId for compliance-ready multi-tenant event streams." },
            ].map((item) => (
              <div key={item.label} style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                padding: "14px",
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>{item.label}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{item.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
