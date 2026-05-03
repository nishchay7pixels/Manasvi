import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  // ── Getting Started + Setup ──────────────────────────────────────────────────
  gettingStartedSidebar: [
    {
      type: "category",
      label: "Getting Started",
      collapsed: false,
      items: [
        "getting-started/introduction",
        "getting-started/quickstart",
        "getting-started/prerequisites",
        "getting-started/install",
        "getting-started/run-locally",
        "getting-started/first-workflow",
        "getting-started/troubleshooting"
      ]
    },
    {
      type: "category",
      label: "Models",
      collapsed: false,
      items: [
        "setup/connect-deepseek",
        "setup/connect-ollama",
        "setup/connect-claude",
        "setup/connect-model"
      ]
    },
    {
      type: "category",
      label: "Channels",
      collapsed: false,
      items: [
        "setup/connect-telegram",
        "setup/connect-slack",
        "setup/connect-webui"
      ]
    },
    {
      type: "category",
      label: "Configuration",
      collapsed: true,
      items: [
        "setup/local-setup",
        "setup/environment-variables"
      ]
    },
    {
      type: "category",
      label: "Tools",
      collapsed: true,
      items: [
        "tools/overview",
        "tools/default-sets",
        "tools/demo-flows",
        "tools/tool-invocation-reference",
        {
          type: "category",
          label: "Core Tools",
          collapsed: true,
          items: [
            "tools/local-file-read",
            "tools/http-fetch",
            "tools/web-search",
            "tools/note-write",
            "tools/approval-request"
          ]
        },
        {
          type: "category",
          label: "Extended Tools",
          collapsed: true,
          items: [
            "tools/runtime-tools",
            "tools/filesystem-write-tools",
            "tools/session-tools",
            "tools/memory-tools",
            "tools/x-search",
            "tools/ui-tools",
            "tools/automation-tools",
            "tools/message-nodes-agents"
          ]
        },
        "tools/troubleshooting"
      ]
    }
  ],

  // ── Concepts ─────────────────────────────────────────────────────────────────
  conceptsSidebar: [
    {
      type: "category",
      label: "Core Concepts",
      collapsed: false,
      items: [
        "concepts/agent-runtime",
        "concepts/tools",
        "concepts/execution-intent",
        "concepts/policies",
        "concepts/approvals",
        "concepts/memory",
        "concepts/sessions",
        "concepts/plugins",
        "concepts/nodes"
      ]
    }
  ],

  // ── Architecture + Why Manasvi ───────────────────────────────────────────────
  architectureSidebar: [
    {
      type: "category",
      label: "Architecture",
      collapsed: false,
      items: [
        "architecture/overview",
        "architecture/ingress-plane",
        "architecture/orchestration-plane",
        "architecture/policy-service",
        "architecture/approval-flow",
        "architecture/execution-manager",
        "architecture/memory-plane",
        "architecture/extension-plane",
        "architecture/node-manager",
        "architecture/audit-governance"
      ]
    },
    {
      type: "category",
      label: "Why Manasvi",
      collapsed: false,
      items: [
        "why-manasvi/not-just-a-chatbot",
        "why-manasvi/policy-governed",
        "why-manasvi/execution-separation",
        "why-manasvi/untrusted-by-default"
      ]
    }
  ],

  // ── Security + Reference ─────────────────────────────────────────────────────
  securitySidebar: [
    {
      type: "category",
      label: "Security",
      collapsed: false,
      items: [
        "security/philosophy",
        "security/zero-trust",
        "security/policy-first",
        "security/approval-primitive",
        "security/sandboxed-execution",
        "security/plugin-isolation",
        "security/secrets-handling",
        "security/prompt-injection",
        "security/trust-classified-memory",
        "security/replay-tampering",
        "security/multi-tenant",
        "security/auditability"
      ]
    },
    {
      type: "category",
      label: "Reference",
      collapsed: false,
      items: [
        "reference/cli"
      ]
    },
    "contributing",
    "faq"
  ]
};

export default sidebars;
