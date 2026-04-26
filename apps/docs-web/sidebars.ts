import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  gettingStartedSidebar: [
    {
      type: "category",
      label: "Getting Started",
      collapsed: false,
      items: [
        "getting-started/introduction",
        "getting-started/prerequisites",
        "getting-started/install",
        "getting-started/run-locally",
        "getting-started/first-workflow",
        "getting-started/troubleshooting"
      ]
    },
    {
      type: "category",
      label: "Setup Guides",
      collapsed: false,
      items: [
        "setup/local-setup",
        "setup/connect-telegram",
        "setup/connect-slack",
        "setup/connect-model",
        "setup/environment-variables"
      ]
    }
  ],

  conceptsSidebar: [
    {
      type: "category",
      label: "Core Concepts",
      collapsed: false,
      items: [
        "concepts/agent-runtime",
        "concepts/tools",
        "concepts/execution-intent",
        "concepts/plugins",
        "concepts/nodes",
        "concepts/memory",
        "concepts/sessions",
        "concepts/policies",
        "concepts/approvals"
      ]
    }
  ],

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
