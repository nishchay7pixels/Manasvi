import React from "react";
import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import styles from "./index.module.css";

const FEATURES = [
  {
    icon: "🛡️",
    title: "Policy-governed by design",
    desc: "Every action is evaluated against a policy engine before it can execute. There is no path from model output to side effect that bypasses authorization."
  },
  {
    icon: "🔏",
    title: "Signed intents & expiring approvals",
    desc: "Execution intents are cryptographically signed. Approvals are payload-bound and time-limited. Nothing can be replayed, mutated, or reused silently."
  },
  {
    icon: "📦",
    title: "Sandboxed execution",
    desc: "All tool execution happens inside isolated sandboxes with declared network and filesystem constraints. The runtime verifies before it executes."
  },
  {
    icon: "🧩",
    title: "Plugin isolation",
    desc: "Third-party plugins run in separate processes with narrow, approved capability grants. Plugins cannot inherit core system trust."
  },
  {
    icon: "🧠",
    title: "Trust-classified memory",
    desc: "Memory is partitioned by trust class. User-owned, system-trusted, model-generated, and external content are stored and surfaced according to their provenance."
  },
  {
    icon: "📋",
    title: "Append-only audit trail",
    desc: "Every decision, action, and outcome is recorded in an immutable audit stream with integrity hash chaining. Nothing disappears silently."
  }
];

const PILLARS = [
  {
    icon: "🔒",
    title: "Zero-trust by default",
    desc: "No component inherits trust from another. Every service boundary validates artifacts independently."
  },
  {
    icon: "📜",
    title: "Policy-first architecture",
    desc: "Authorization is not an afterthought. It is the primary decision gate for all sensitive operations."
  },
  {
    icon: "✅",
    title: "Approval as a security primitive",
    desc: "High-risk actions require signed, time-bounded human approval before execution can proceed."
  },
  {
    icon: "🔍",
    title: "Observable and auditable",
    desc: "Every decision leaves a record. Every outcome is attributable. Governance is built in."
  }
];

function HeroSection() {
  return (
    <div className="hero">
      <div className="container">
        <div className={styles.heroBadge}>
          <span className="m-badge">v0.1 · Open Preview</span>
          A secure AI agent operating fabric
        </div>
        <h1 className="hero__title">
          Agent governance,<br />
          built in from the start.
        </h1>
        <p className="hero__subtitle">
          Manasvi is a policy-driven, multi-service AI agent platform designed
          for teams who need auditable automation — not just powerful automation.
        </p>
        <div className={styles.heroButtons}>
          <Link className="button button--primary button--lg" to="/docs/getting-started/introduction">
            Get started →
          </Link>
          <Link className="button button--secondary button--lg" to="/docs/architecture/overview">
            Explore architecture
          </Link>
        </div>
      </div>
    </div>
  );
}

function FeaturesSection() {
  return (
    <section className="features-section">
      <div className="container">
        <div className={styles.sectionHeader}>
          <h2>What makes Manasvi different</h2>
          <p>
            Most agent frameworks give you power. Manasvi gives you power with governance.
            Every layer is designed around control, not convenience.
          </p>
        </div>
        <div className="row">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="col col--4" style={{ marginBottom: "1.5rem" }}>
              <div className="feature-card">
                <span className="feature-icon">{feature.icon}</span>
                <div className="feature-title">{feature.title}</div>
                <p className="feature-desc">{feature.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PillarsSection() {
  return (
    <section className="pillars-section">
      <div className="container">
        <div className="row">
          <div className="col col--5">
            <h2 className={styles.pillarsTitle}>Four pillars of safe automation</h2>
            <p style={{ color: "var(--ifm-font-color-secondary)", lineHeight: 1.7 }}>
              Manasvi treats AI agent infrastructure the same way security engineers
              treat production systems — with explicit boundaries, verifiable decisions,
              and observable outcomes at every step.
            </p>
            <Link className="button button--outline button--primary" to="/docs/why-manasvi/not-just-a-chatbot">
              Why Manasvi →
            </Link>
          </div>
          <div className="col col--6 col--offset-1">
            {PILLARS.map((p) => (
              <div key={p.title} className="pillar-item">
                <span className="pillar-icon">{p.icon}</span>
                <div>
                  <div className="pillar-title">{p.title}</div>
                  <p className="pillar-desc">{p.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function QuickLinksSection() {
  const LINKS = [
    {
      icon: "🚀",
      title: "Quick start",
      desc: "Get Manasvi running locally in minutes.",
      href: "/docs/getting-started/introduction",
      label: "Get started"
    },
    {
      icon: "📡",
      title: "Connect Telegram",
      desc: "Set up a Telegram bot as your first channel.",
      href: "/docs/setup/connect-telegram",
      label: "Setup guide"
    },
    {
      icon: "🏗️",
      title: "Architecture",
      desc: "Understand the planes and services.",
      href: "/docs/architecture/overview",
      label: "Read more"
    },
    {
      icon: "🔐",
      title: "Security model",
      desc: "Learn how Manasvi protects execution.",
      href: "/docs/security/philosophy",
      label: "Explore security"
    }
  ];
  return (
    <section style={{ padding: "4rem 0" }}>
      <div className="container">
        <h2 className={styles.sectionTitle}>Explore the docs</h2>
        <div className="row">
          {LINKS.map((l) => (
            <div key={l.title} className="col col--3" style={{ marginBottom: "1.5rem" }}>
              <div className={styles.quickCard}>
                <span style={{ fontSize: "1.75rem", display: "block", marginBottom: "0.75rem" }}>{l.icon}</span>
                <h3 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.4rem" }}>{l.title}</h3>
                <p style={{ fontSize: "0.85rem", color: "var(--ifm-font-color-secondary)", marginBottom: "1rem" }}>{l.desc}</p>
                <Link to={l.href} style={{ fontSize: "0.85rem", fontWeight: 600 }}>{l.label} →</Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTASection() {
  return (
    <section className="cta-section">
      <div className="container">
        <h2>Ready to build with governance?</h2>
        <p>
          Start with the getting started guide and have Manasvi running locally in under 15 minutes.
        </p>
        <Link className="button button--primary button--lg" to="/docs/getting-started/install">
          Install Manasvi →
        </Link>
      </div>
    </section>
  );
}

export default function Home(): React.JSX.Element {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout title={`${siteConfig.title} Docs`} description="A secure, policy-governed AI agent operating fabric with built-in governance, audit, and zero-trust execution.">
      <HeroSection />
      <FeaturesSection />
      <PillarsSection />
      <QuickLinksSection />
      <CTASection />
    </Layout>
  );
}
