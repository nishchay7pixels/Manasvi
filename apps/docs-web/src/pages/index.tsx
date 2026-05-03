import React from "react";
import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import styles from "./index.module.css";

// ── Data ──────────────────────────────────────────────────────────────────────

const CAPABILITIES = [
  {
    icon: "💬",
    title: "Chat via Telegram or Slack",
    desc: "Connect a Telegram bot or Slack workspace. Your agent receives messages, processes them, and replies — with every action governed."
  },
  {
    icon: "🖥️",
    title: "Run models locally with Ollama",
    desc: "Use Llama 3, Mistral, Qwen, or any Ollama-supported model. No API key, no cloud costs. The model runs on your machine."
  },
  {
    icon: "🔧",
    title: "Use tools with controlled access",
    desc: "Web search, file access, HTTP calls, shell execution — all mediated through a policy engine. The model can't call tools directly."
  },
  {
    icon: "✅",
    title: "Approve sensitive actions",
    desc: "High-risk actions require your sign-off before they run. Approvals are cryptographically bound and time-limited."
  },
  {
    icon: "📋",
    title: "See everything that happened",
    desc: "Every decision, tool call, and outcome is recorded in an append-only audit trail with integrity checking."
  },
  {
    icon: "🧩",
    title: "Extend with plugins safely",
    desc: "Third-party plugins run in isolated processes with narrow capability grants. They can't inherit core system trust."
  }
];

const HOW_IT_WORKS = [
  {
    step: "1",
    title: "Connect",
    desc: "Choose a model — DeepSeek (default), Ollama for local inference, or OpenAI/Claude for cloud. Add a channel: Telegram, Slack, or the built-in terminal. Takes about 5 minutes."
  },
  {
    step: "2",
    title: "Act",
    desc: "Send a message. The agent proposes a plan, and the policy engine decides what's allowed. Tools execute in sandboxed environments with declared constraints."
  },
  {
    step: "3",
    title: "Control",
    desc: "Every action is policy-evaluated. Sensitive ones trigger an approval flow. Every outcome is recorded. You always know what your agent did and why."
  }
];

const QUICK_LINKS = [
  {
    icon: "⚡",
    title: "15-minute quickstart",
    desc: "Install, onboard, and send your first message.",
    href: "/docs/getting-started/quickstart",
    label: "Start here"
  },
  {
    icon: "🖥️",
    title: "Connect Ollama",
    desc: "Run a local model with zero API costs.",
    href: "/docs/setup/connect-ollama",
    label: "Setup guide"
  },
  {
    icon: "📡",
    title: "Connect Telegram",
    desc: "Chat with your agent from your phone.",
    href: "/docs/setup/connect-telegram",
    label: "Setup guide"
  },
  {
    icon: "🏗️",
    title: "Why Manasvi is different",
    desc: "The model doesn't call tools directly. Here's why that matters.",
    href: "/docs/why-manasvi/not-just-a-chatbot",
    label: "Read more"
  }
];

// ── Sections ──────────────────────────────────────────────────────────────────

function HeroSection() {
  return (
    <div className="hero">
      <div className="container">
        <div className={styles.heroBadge}>
          <span className="m-badge">v0.1 · Open Preview</span>
          Free and open source
        </div>
        <h1 className="hero__title">
          An AI agent<br />
          you can actually run.
        </h1>
        <p className="hero__subtitle">
          Connect Telegram. Use local models with Ollama. Let your agent use tools
          safely — with policy controls, approval flows, and a full audit trail built in.
        </p>
        <div className={styles.heroButtons}>
          <Link className="button button--primary button--lg" to="/docs/getting-started/quickstart">
            Get started in 15 min →
          </Link>
          <Link className="button button--secondary button--lg" to="/docs/getting-started/introduction">
            What is Manasvi?
          </Link>
        </div>
        <div className={styles.heroTerminal}>
          <div className={styles.terminalBar}>
            <span className={styles.terminalDot} style={{ background: "#FF5F57" }} />
            <span className={styles.terminalDot} style={{ background: "#FEBC2E" }} />
            <span className={styles.terminalDot} style={{ background: "#28C840" }} />
            <span className={styles.terminalTitle}>terminal</span>
          </div>
          <div className={styles.terminalBody}>
            <div className={styles.terminalLine}>
              <span className={styles.terminalPrompt}>$</span>
              <span className={styles.terminalCmd}>pnpm manasvi init</span>
              <span className={styles.terminalComment}># set up secrets and config</span>
            </div>
            <div className={styles.terminalLine}>
              <span className={styles.terminalPrompt}>$</span>
              <span className={styles.terminalCmd}>pnpm manasvi onboard</span>
              <span className={styles.terminalComment}># choose model and channel</span>
            </div>
            <div className={styles.terminalLine}>
              <span className={styles.terminalPrompt}>$</span>
              <span className={styles.terminalCmd}>pnpm manasvi start</span>
              <span className={styles.terminalComment}># start all services</span>
            </div>
            <div className={`${styles.terminalLine} ${styles.terminalOutput}`}>
              <span className={styles.terminalCheck}>✓</span>
              All 9 services healthy · Chat: pnpm cli
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HowItWorksSection() {
  return (
    <section className={styles.howSection}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <h2>How Manasvi works</h2>
          <p>
            Three steps from nothing to a running, governed AI agent.
          </p>
        </div>
        <div className="row">
          {HOW_IT_WORKS.map((item) => (
            <div key={item.step} className="col col--4">
              <div className={styles.howCard}>
                <div className={styles.howStep}>{item.step}</div>
                <h3 className={styles.howTitle}>{item.title}</h3>
                <p className={styles.howDesc}>{item.desc}</p>
              </div>
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
          <h2>What you can do with Manasvi</h2>
          <p>
            A real agent you can run locally, connect to channels, and extend with tools —
            with governance built in from the start.
          </p>
        </div>
        <div className="row">
          {CAPABILITIES.map((cap) => (
            <div key={cap.title} className="col col--4" style={{ marginBottom: "1.5rem" }}>
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
        <div className="row">
          <div className="col col--6">
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
              <span className={styles.pill}>Policy-first</span>
              <span className={styles.pill}>Signed intents</span>
              <span className={styles.pill}>Approval flows</span>
              <span className={styles.pill}>Sandboxed execution</span>
              <span className={styles.pill}>Append-only audit</span>
            </div>
            <Link className="button button--outline button--primary" to="/docs/why-manasvi/not-just-a-chatbot">
              Why this design matters →
            </Link>
          </div>
          <div className="col col--5 col--offset-1">
            <div className={styles.flowDiagram}>
              <div className={styles.flowRow}>
                <div className={styles.flowBox}>Model output</div>
              </div>
              <div className={styles.flowArrow}>↓</div>
              <div className={styles.flowRow}>
                <div className={`${styles.flowBox} ${styles.flowBoxAccent}`}>Policy evaluation</div>
              </div>
              <div className={styles.flowArrow}>↓</div>
              <div className={styles.flowRow}>
                <div className={`${styles.flowBox} ${styles.flowBoxWarn}`}>Approval? (if required)</div>
              </div>
              <div className={styles.flowArrow}>↓</div>
              <div className={styles.flowRow}>
                <div className={styles.flowBox}>Signed execution intent</div>
              </div>
              <div className={styles.flowArrow}>↓</div>
              <div className={styles.flowRow}>
                <div className={`${styles.flowBox} ${styles.flowBoxSuccess}`}>Sandboxed execution</div>
              </div>
              <div className={styles.flowArrow}>↓</div>
              <div className={styles.flowRow}>
                <div className={styles.flowBox}>Audit record</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function QuickLinksSection() {
  return (
    <section className={styles.quickLinksSection}>
      <div className="container">
        <h2 className={styles.sectionTitle}>Where to start</h2>
        <div className="row">
          {QUICK_LINKS.map((l) => (
            <div key={l.title} className="col col--3" style={{ marginBottom: "1.5rem" }}>
              <div className={styles.quickCard}>
                <span className={styles.quickIcon}>{l.icon}</span>
                <h3 className={styles.quickTitle}>{l.title}</h3>
                <p className={styles.quickDesc}>{l.desc}</p>
                <Link to={l.href} className={styles.quickLink}>{l.label} →</Link>
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
        <h2>From zero to running in about 15 minutes.</h2>
        <p>
          Free, open source, and runs entirely on your machine.
          No cloud account required if you use Ollama.
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Home(): React.JSX.Element {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title} — Governed AI Agent Runtime`}
      description="An AI agent you can run locally. Connect Telegram or Ollama, use tools safely, and keep full control with policy, approval flows, and audit trail built in."
    >
      <HeroSection />
      <HowItWorksSection />
      <CapabilitiesSection />
      <SafetySection />
      <QuickLinksSection />
      <CTASection />
    </Layout>
  );
}
