export interface TrustBoundaryAssumption {
  assumptionId: string;
  title: string;
  trustBoundary: string;
  description: string;
  subsystems: string[];
  requiredOutcomes: string[];
}

export const TRUST_BOUNDARY_ASSUMPTIONS: TrustBoundaryAssumption[] = [
  {
    assumptionId: "TB-PLUGIN-001",
    title: "Plugins cannot self-grant undeclared privileges",
    trustBoundary: "extension-runtime capability gate",
    description:
      "A plugin may request capabilities but cannot exercise undeclared or ungranted capabilities.",
    subsystems: ["extension-runtime", "policy", "plugin-plane"],
    requiredOutcomes: [
      "undeclared privileged capability denied",
      "revoked plugin cannot continue operating"
    ]
  },
  {
    assumptionId: "TB-EVENT-001",
    title: "Forged internal events are rejected",
    trustBoundary: "ingress/event-bus authenticity boundary",
    description:
      "Internal or semantically privileged events must fail integrity/authenticity checks when forged or replayed.",
    subsystems: ["ingress", "event-bus", "orchestrator"],
    requiredOutcomes: ["integrity failure dead-lettered", "replay treated as duplicate or denied"]
  },
  {
    assumptionId: "TB-APPROVAL-001",
    title: "Approval and artifact validation cannot be bypassed",
    trustBoundary: "intent/approval/execution validation boundary",
    description:
      "Execution authorization fails closed for mutated payloads, expired artifacts, forged signatures, or replay.",
    subsystems: ["approval", "executor-sdk", "execution-manager"],
    requiredOutcomes: ["bypass attempt rejected with explicit validation code"]
  },
  {
    assumptionId: "TB-NODE-001",
    title: "Nodes cannot impersonate trusted identities",
    trustBoundary: "node-manager pairing and heartbeat identity boundary",
    description:
      "Mismatched pairing credentials, stale identity, or revoked/quarantined state must remove dispatch eligibility.",
    subsystems: ["node-manager", "policy", "remote-execution"],
    requiredOutcomes: ["impersonation rejected", "quarantined/revoked nodes ineligible"]
  },
  {
    assumptionId: "TB-SESSION-001",
    title: "Session boundaries prevent cross-session leakage",
    trustBoundary: "session/context assembly isolation boundary",
    description:
      "Context assembly for one session must not include message context from unrelated sessions.",
    subsystems: ["session-sdk", "orchestrator"],
    requiredOutcomes: ["no cross-session context chunk contamination"]
  },
  {
    assumptionId: "TB-MEMORY-001",
    title: "Untrusted memory is not silently promoted to trusted memory",
    trustBoundary: "memory write/promotion trust boundary",
    description:
      "Untrusted external memory cannot be directly written into trusted durable stores without explicit reviewed promotion.",
    subsystems: ["memory-service", "memory-plane", "policy"],
    requiredOutcomes: ["silent trust promotion blocked", "promotion path remains explicit"]
  }
];

export function getAssumption(assumptionId: string): TrustBoundaryAssumption {
  const assumption = TRUST_BOUNDARY_ASSUMPTIONS.find((entry) => entry.assumptionId === assumptionId);
  if (!assumption) {
    throw new Error(`Unknown trust-boundary assumption: ${assumptionId}`);
  }
  return assumption;
}
