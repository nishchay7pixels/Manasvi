import React from "react";
import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import styles from "./index.module.css";

// ── Data ──────────────────────────────────────────────────────────────────────

const CONSOLE_EVENTS = [
  { id: "intent",   event: "intent.received",         label: "active",   variant: "cyan"  },
  { id: "policy",   event: "policy.evaluated",         label: "pass",     variant: "green" },
  { id: "tool",     event: "tool.access.requested",    label: "granted",  variant: "cyan"  },
  { id: "approval", event: "approval.required",        label: "pending",  variant: "amber" },
  { id: "exec",     event: "execution.completed",      label: "ok",       variant: "green" },
  { id: "audit",    event: "audit.event.stored",       label: "recorded", variant: "muted" },
];

const FLOW_STEPS = [
  { id: "intent",   icon: "◎", label: "Intent",    color: "cyan"   },
  { id: "policy",   icon: "⬡", label: "Policy",    color: "violet" },
  { id: "tools",    icon: "⚙", label: "Tools",     color: "cyan"   },
  { id: "approval", icon: "◈", label: "Approval",  color: "amber"  },
  { id: "exec",     icon: "▶", label: "Execution", color: "green"  },
  { id: "audit",    icon: "◻", label: "Audit",     color: "muted"  },
];

const START_HERE = [
  {
    icon: "⚡",
    title: "Quickstart",
    desc: "15 minutes from zero to a running, governed AI agent.",
    href: "/docs/getting-started/quickstart",
    accent: "cyan",
  },
  {
    icon: "🏗",
    title: "Architecture",
    desc: "How the services, runtime, and policy layer fit together.",
    href: "/docs/architecture/overview",
    accent: "violet",
  },
  {
    icon: "⚙",
    title: "Tool System",
    desc: "How tools are mediated, sandboxed, and governed.",
    href: "/docs/tools/overview",
    accent: "cyan",
  },
  {
    icon: "🛡",
    title: "Policy Engine",
    desc: "Rules that decide what the model is allowed to propose.",
    href: "/docs/concepts/agent-runtime",
    accent: "violet",
  },
  {
    icon: "🧠",
    title: "Memory",
    desc: "Ephemeral and persistent memory planes across sessions.",
    href: "/docs/concepts/agent-runtime",
    accent: "cyan",
  },
  {
    icon: "✅",
    title: "Approvals",
    desc: "Human-in-the-loop gates for sensitive or high-risk actions.",
    href: "/docs/concepts/agent-runtime",
    accent: "amber",
  },
];

const CAPABILITIES = [
  {
    icon: "⬡",
    title: "Policy-first execution",
    desc: "Every sensitive action is evaluated against explicit policy before execution. The model proposes; policy decides.",
  },
  {
    icon: "◈",
    title: "Approval-gated tools",
    desc: "Agents propose actions. Humans or policies approve them. Executors only run approved, cryptographically-signed intents.",
  },
  {
    icon: "📋",
    title: "Auditable by design",
    desc: "Every decision, tool call, approval, denial, and execution result is written to an append-only, integrity-checked trail.",
  },
  {
    icon: "🛡",
    title: "Sandboxed runtime",
    desc: "Tool execution is isolated with controlled filesystem, network, secret, and process access. Plugins can't escalate trust.",
  },
  {
    icon: "🧠",
    title: "Trust-aware memory",
    desc: "Memory is separated by provenance and trust level to reduce poisoning risks and prevent unsafe context reuse across sessions.",
  },
  {
    icon: "🔌",
    title: "Built for real integrations",
    desc: "Telegram, Gmail, Calendar, filesystem, and web tools can all be governed consistently through the same policy engine.",
  },
];

// ── Sections ──────────────────────────────────────────────────────────────────

function RuntimeConsole() {
  return (
    <div className={styles.console}>
      <div className={styles.consoleHeader}>
        <div className={styles.consoleDots}>
          <span className={styles.consoleDot} style={{ background: "#FF5F57" }} />
          <span className={styles.consoleDot} style={{ background: "#FEBC2E" }} />
          <span className={styles.consoleDot} style={{ background: "#28C840" }} />
        </div>
        <span className={styles.consoleName}>agent-runtime</span>
        <span className={styles.consoleLive}>
          <span className={styles.liveIndicator} />
          LIVE
        </span>
      </div>
      <div className={styles.consoleBody}>
        {CONSOLE_EVENTS.map((ev) => (
          <div key={ev.id} className={styles.consoleRow}>
            <span className={styles.consoleTimestamp}>{`0${CONSOLE_EVENTS.indexOf(ev) + 1}:0${CONSOLE_EVENTS.indexOf(ev) + 1}`}</span>
            <span className={styles.consoleEvent}>{ev.event}</span>
            <span className={`${styles.consolePill} ${styles[`pill${capitalize(ev.variant)}`]}`}>
              {ev.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HeroSection() {
  return (
    <div className="hero">
      <div className="container">
        <div className={styles.heroInner}>
          <div className={styles.heroLeft}>
            <div className={styles.heroBadge}>
              <span className="m-badge">Security-first AI agent runtime</span>
            </div>
            <h1 className="hero__title">
              Build AI agents that can be <em>trusted</em> to act.
            </h1>
            <p className={`hero__subtitle ${styles.heroSubtitle}`}>
              Manasvi is a policy-governed runtime for building agents with approval-gated
              actions, auditable execution, tool mediation, sandboxing, and memory provenance.
            </p>
            <div className={styles.heroButtons}>
              <Link className="button button--primary button--lg" to="/docs/getting-started/quickstart">
                Get Started →
              </Link>
              <Link className="button button--secondary button--lg" to="/docs/architecture/overview">
                View Architecture
              </Link>
            </div>
          </div>
          <div className={styles.heroRight}>
            <RuntimeConsole />
          </div>
        </div>
      </div>
    </div>
  );
}

function FlowSection() {
  return (
    <section className={styles.flowSection}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <div className={styles.sectionLabel}>A control plane for AI agents</div>
          <h2 className={styles.sectionTitle}>One message. Six governed steps.</h2>
          <p className={styles.sectionDesc}>
            Manasvi separates conversation, policy, approval, memory, tools, and execution
            so agents can be useful without becoming blindly autonomous.
          </p>
        </div>
        <div className={styles.flowSteps}>
          {FLOW_STEPS.map((step, i) => (
            <React.Fragment key={step.id}>
              <div className={styles.flowStep}>
                <div className={`${styles.flowIcon} ${styles[`flowIcon${capitalize(step.color)}`]}`}>
                  {step.icon}
                </div>
                <span className={styles.flowLabel}>{step.label}</span>
              </div>
              {i < FLOW_STEPS.length - 1 && (
                <div className={styles.flowArrow}>→</div>
              )}
            </React.Fragment>
          ))}
        </div>
        <div className={styles.flowDesc}>
          <div className={styles.flowDescItem}>
            <strong>Intent</strong> — user message received and parsed into an execution intent
          </div>
          <div className={styles.flowDescItem}>
            <strong>Policy</strong> — every proposed action evaluated against operator-defined rules
          </div>
          <div className={styles.flowDescItem}>
            <strong>Approval</strong> — sensitive or high-risk actions paused for human sign-off
          </div>
          <div className={styles.flowDescItem}>
            <strong>Audit</strong> — every outcome written to an append-only, integrity-checked trail
          </div>
        </div>
      </div>
    </section>
  );
}

function StartHereSection() {
  return (
    <section className={styles.startSection}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <div className={styles.sectionLabel}>Start here</div>
          <h2 className={styles.sectionTitle}>Where do you want to go?</h2>
        </div>
        <div className="row">
          {START_HERE.map((card) => (
            <div key={card.title} className="col col--4" style={{ marginBottom: "1.25rem" }}>
              <Link to={card.href} className={styles.startCard}>
                <span className={styles.startIcon}>{card.icon}</span>
                <h3 className={styles.startTitle}>{card.title}</h3>
                <p className={styles.startDesc}>{card.desc}</p>
                <span className={styles.startArrow}>Read docs →</span>
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CapabilitiesSection() {
  return (
    <section className="features-section">
      <div className="container">
        <div className={styles.sectionHeader}>
          <div className={styles.sectionLabel}>Security-first by design</div>
          <h2 className={styles.sectionTitle}>Governance built into every layer</h2>
          <p className={styles.sectionDesc}>
            Agents that propose, policies that decide, humans that approve.
            Every capability is mediated — not bolted on after the fact.
          </p>
        </div>
        <div className="row">
          {CAPABILITIES.map((cap) => (
            <div key={cap.title} className="col col--4" style={{ marginBottom: "1.25rem" }}>
              <div className="feature-card">
                <span className="feature-icon">{cap.icon}</span>
                <div className="feature-title">{cap.title}</div>
                <p className="feature-desc">{cap.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SafetySection() {
  return (
    <section className={styles.safetySection}>
      <div className="container">
        <div className="row" style={{ alignItems: "center" }}>
          <div className="col col--6">
            <div className={styles.sectionLabel}>Design principle</div>
            <h2 className={styles.safetyTitle}>
              The model doesn't call tools directly.
            </h2>
            <p className={styles.safetyBody}>
              In most agent frameworks, the model outputs a tool call and the system runs it.
              Manasvi puts a governance layer in between. The model proposes. Policy decides.
              A signed intent is created. Execution is sandboxed. Everything is recorded.
            </p>
            <p className={styles.safetyBody}>
              This means you get real control — not just logging after the fact, but actual
              gates that can stop, redirect, or require approval for any action.
            </p>
            <div className={styles.safetyPills}>
              {["Policy-first", "Signed intents", "Approval flows", "Sandboxed execution", "Append-only audit"].map((p) => (
                <span key={p} className={styles.pill}>{p}</span>
              ))}
            </div>
            <Link className="button button--outline button--primary" to="/docs/why-manasvi/not-just-a-chatbot">
              Why this design matters →
            </Link>
          </div>
          <div className="col col--5 col--offset-1">
            <div className={styles.pipelineDiagram}>
              {[
                { label: "Model output",          variant: "default" },
                { label: "Policy evaluation",     variant: "accent"  },
                { label: "Approval gate",         variant: "warn"    },
                { label: "Signed intent",         variant: "default" },
                { label: "Sandboxed execution",   variant: "success" },
                { label: "Audit record",          variant: "default" },
              ].map((row, i, arr) => (
                <React.Fragment key={row.label}>
                  <div className={`${styles.pipelineBox} ${styles[`pipelineBox${capitalize(row.variant)}`]}`}>
                    {row.label}
                  </div>
                  {i < arr.length - 1 && <div className={styles.pipelineArrow}>↓</div>}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CTASection() {
  return (
    <section className="cta-section">
      <div className="container" style={{ position: "relative", zIndex: 1 }}>
        <h2>A governed runtime for trustworthy AI agents.</h2>
        <p>
          Free, open source, and runs entirely on your machine.
          Policy-first execution from the ground up.
        </p>
        <div style={{ display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" }}>
          <Link className="button button--primary button--lg" to="/docs/getting-started/quickstart">
            Start the quickstart →
          </Link>
          <Link className="button button--secondary button--lg" to="/docs/getting-started/introduction">
            Learn more
          </Link>
        </div>
      </div>
    </section>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Home(): React.JSX.Element {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title} — Governed AI Agent Runtime`}
      description="Build governed AI agents you can actually run. Policy controls, approval flows, sandboxed execution, and a full audit trail built in."
    >
      <HeroSection />
      <FlowSection />
      <StartHereSection />
      <CapabilitiesSection />
      <SafetySection />
      <CTASection />
    </Layout>
  );
}
