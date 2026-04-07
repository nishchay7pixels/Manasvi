import { z } from "zod";

import { CONTRACT_SCHEMA_VERSION, trustClassSchema } from "./base.js";
import { executionIntentSchema } from "./execution-intent.js";
import { principalReferenceSchema, resolvedPrincipalContextSchema } from "./identity.js";
import { policyTraceSchema } from "./policy.js";
import { contextChunkSchema } from "./session-context.js";
import { toolManifestSchema } from "./tools.js";

export const AGENT_RUNTIME_CONTRACT_VERSION = "1.0" as const;

export const agentRuntimeStateSchema = z.enum([
  "idle",
  "initialized",
  "context_loaded",
  "planning",
  "proposed_response",
  "proposed_action",
  "awaiting_policy",
  "awaiting_approval",
  "awaiting_execution",
  "ingesting_observation",
  "recovering_from_failure",
  "completed",
  "failed",
  "halted_denied"
]);
export type AgentRuntimeState = z.infer<typeof agentRuntimeStateSchema>;

export const agentObservationTypeSchema = z.enum([
  "policy_decision",
  "approval_outcome",
  "execution_result",
  "tool_result",
  "runtime_failure"
]);
export type AgentObservationType = z.infer<typeof agentObservationTypeSchema>;

export const toolActionProposalSchema = z.object({
  proposalType: z.literal("tool_invocation"),
  proposalId: z.string().min(1),
  toolId: z.string().min(1),
  toolVersion: z.string().min(1).optional(),
  purpose: z.string().min(1),
  input: z.record(z.unknown()),
  expectedResource: z
    .object({
      resourceClass: z.string().min(1),
      resourceId: z.string().min(1)
    })
    .optional(),
  confidence: z.number().min(0).max(1).optional(),
  inferredActionClass: z.string().min(1).optional(),
  inferredSideEffectClass: z.string().min(1).optional()
});
export type ToolActionProposal = z.infer<typeof toolActionProposalSchema>;

export const memoryWriteActionProposalSchema = z.object({
  proposalType: z.literal("memory_write"),
  proposalId: z.string().min(1),
  namespace: z.string().min(1),
  content: z.string().min(1),
  purpose: z.string().min(1)
});
export type MemoryWriteActionProposal = z.infer<typeof memoryWriteActionProposalSchema>;

export const approvalRequestActionProposalSchema = z.object({
  proposalType: z.literal("approval_request"),
  proposalId: z.string().min(1),
  intentId: z.string().min(1),
  summary: z.string().min(1)
});
export type ApprovalRequestActionProposal = z.infer<typeof approvalRequestActionProposalSchema>;

export const actionProposalSchema = z.union([
  toolActionProposalSchema,
  memoryWriteActionProposalSchema,
  approvalRequestActionProposalSchema
]);
export type ActionProposal = z.infer<typeof actionProposalSchema>;

export const plannerDecisionSchema = z.discriminatedUnion("decisionType", [
  z.object({
    decisionType: z.literal("final_response"),
    responseText: z.string().min(1),
    reasoningSummary: z.string().min(1).optional()
  }),
  z.object({
    decisionType: z.literal("action_proposal"),
    proposal: actionProposalSchema,
    reasoningSummary: z.string().min(1).optional()
  }),
  z.object({
    decisionType: z.literal("clarification_request"),
    prompt: z.string().min(1),
    reasoningSummary: z.string().min(1).optional()
  }),
  z.object({
    decisionType: z.literal("halt"),
    reasonCode: z.string().min(1),
    message: z.string().min(1)
  }),
  z.object({
    decisionType: z.literal("error"),
    reasonCode: z.string().min(1),
    message: z.string().min(1)
  })
]);
export type PlannerDecision = z.infer<typeof plannerDecisionSchema>;

export const agentObservationSchema = z.object({
  observationId: z.string().min(1),
  type: agentObservationTypeSchema,
  summary: z.string().min(1),
  trustClassification: trustClassSchema,
  data: z.record(z.unknown()),
  trace: policyTraceSchema,
  createdAt: z.string().datetime({ offset: true })
});
export type AgentObservation = z.infer<typeof agentObservationSchema>;

export const plannerRequestSchema = z.object({
  schemaVersion: z.literal(AGENT_RUNTIME_CONTRACT_VERSION),
  requestId: z.string().min(1),
  runtimeState: agentRuntimeStateSchema,
  principalContext: resolvedPrincipalContextSchema,
  trace: policyTraceSchema,
  session: z.object({
    sessionId: z.string().min(1),
    tenantId: z.string().min(1),
    workspaceId: z.string().min(1)
  }),
  userInput: z.string().min(1),
  iteration: z.number().int().nonnegative(),
  availableTools: z.array(
    toolManifestSchema.pick({
      toolId: true,
      version: true,
      actionClass: true,
      sideEffectClass: true,
      mutability: true,
      capabilities: true,
      policyBinding: true,
      runtimeHints: true
    })
  ),
  contextChunks: z.array(contextChunkSchema),
  observations: z.array(agentObservationSchema)
});
export type PlannerRequest = z.infer<typeof plannerRequestSchema>;

export const plannerResponseSchema = z.object({
  schemaVersion: z.literal(AGENT_RUNTIME_CONTRACT_VERSION),
  requestId: z.string().min(1),
  decision: plannerDecisionSchema,
  providerMetadata: z
    .object({
      provider: z.string().min(1),
      model: z.string().min(1),
      latencyMs: z.number().int().nonnegative().optional()
    })
    .optional()
});
export type PlannerResponse = z.infer<typeof plannerResponseSchema>;

export const agentRuntimeTransitionSchema = z.object({
  at: z.string().datetime({ offset: true }),
  from: agentRuntimeStateSchema,
  to: agentRuntimeStateSchema,
  reason: z.string().min(1),
  metadata: z.record(z.unknown()).default({})
});
export type AgentRuntimeTransition = z.infer<typeof agentRuntimeTransitionSchema>;

export const agentLoopConfigSchema = z.object({
  maxIterations: z.number().int().positive().max(20).default(6),
  maxConsecutiveFailures: z.number().int().positive().max(10).default(2),
  strictPlannerParsing: z.boolean().default(true)
});
export type AgentLoopConfig = z.infer<typeof agentLoopConfigSchema>;

export const agentRunOutcomeSchema = z.object({
  status: z.enum(["completed", "awaiting_approval", "halted_denied", "failed"]),
  responseText: z.string().optional(),
  reasonCode: z.string().optional()
});
export type AgentRunOutcome = z.infer<typeof agentRunOutcomeSchema>;

export const agentRunRecordSchema = z.object({
  schemaVersion: z.literal(AGENT_RUNTIME_CONTRACT_VERSION),
  contractVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  runId: z.string().min(1),
  trace: policyTraceSchema,
  principalContext: resolvedPrincipalContextSchema,
  session: z.object({
    sessionId: z.string().min(1),
    tenantId: z.string().min(1),
    workspaceId: z.string().min(1)
  }),
  userMessage: z.string().min(1),
  state: agentRuntimeStateSchema,
  transitions: z.array(agentRuntimeTransitionSchema),
  iterations: z.number().int().nonnegative(),
  observations: z.array(agentObservationSchema),
  intents: z.array(executionIntentSchema),
  outcome: agentRunOutcomeSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
});
export type AgentRunRecord = z.infer<typeof agentRunRecordSchema>;

export const plannerOutputEnvelopeSchema = z.object({
  decisionType: z.enum(["final_response", "action_proposal", "clarification_request", "halt", "error"]),
  responseText: z.string().optional(),
  reasoningSummary: z.string().optional(),
  prompt: z.string().optional(),
  reasonCode: z.string().optional(),
  message: z.string().optional(),
  proposal: z
    .object({
      proposalType: z.enum(["tool_invocation", "memory_write", "approval_request"]),
      proposalId: z.string().min(1),
      toolId: z.string().optional(),
      toolVersion: z.string().optional(),
      purpose: z.string().optional(),
      input: z.record(z.unknown()).optional(),
      expectedResource: z
        .object({
          resourceClass: z.string().min(1),
          resourceId: z.string().min(1)
        })
        .optional(),
      confidence: z.number().min(0).max(1).optional(),
      inferredActionClass: z.string().optional(),
      inferredSideEffectClass: z.string().optional(),
      namespace: z.string().optional(),
      content: z.string().optional(),
      intentId: z.string().optional(),
      summary: z.string().optional()
    })
    .optional()
});
export type PlannerOutputEnvelope = z.infer<typeof plannerOutputEnvelopeSchema>;

export function parsePlannerDecisionEnvelope(input: unknown): PlannerDecision {
  const parsed = plannerOutputEnvelopeSchema.parse(input);
  if (parsed.decisionType === "final_response") {
    return plannerDecisionSchema.parse({
      decisionType: "final_response",
      responseText: parsed.responseText,
      reasoningSummary: parsed.reasoningSummary
    });
  }
  if (parsed.decisionType === "action_proposal") {
    if (!parsed.proposal) {
      throw new Error("planner proposal missing");
    }
    if (parsed.proposal.proposalType === "tool_invocation") {
      return plannerDecisionSchema.parse({
        decisionType: "action_proposal",
        proposal: {
          proposalType: "tool_invocation",
          proposalId: parsed.proposal.proposalId,
          toolId: parsed.proposal.toolId,
          toolVersion: parsed.proposal.toolVersion,
          purpose: parsed.proposal.purpose,
          input: parsed.proposal.input ?? {},
          expectedResource: parsed.proposal.expectedResource,
          confidence: parsed.proposal.confidence,
          inferredActionClass: parsed.proposal.inferredActionClass,
          inferredSideEffectClass: parsed.proposal.inferredSideEffectClass
        },
        reasoningSummary: parsed.reasoningSummary
      });
    }
    if (parsed.proposal.proposalType === "memory_write") {
      return plannerDecisionSchema.parse({
        decisionType: "action_proposal",
        proposal: {
          proposalType: "memory_write",
          proposalId: parsed.proposal.proposalId,
          namespace: parsed.proposal.namespace,
          content: parsed.proposal.content,
          purpose: parsed.proposal.purpose
        },
        reasoningSummary: parsed.reasoningSummary
      });
    }
    return plannerDecisionSchema.parse({
      decisionType: "action_proposal",
      proposal: {
        proposalType: "approval_request",
        proposalId: parsed.proposal.proposalId,
        intentId: parsed.proposal.intentId,
        summary: parsed.proposal.summary
      },
      reasoningSummary: parsed.reasoningSummary
    });
  }
  if (parsed.decisionType === "clarification_request") {
    return plannerDecisionSchema.parse({
      decisionType: "clarification_request",
      prompt: parsed.prompt,
      reasoningSummary: parsed.reasoningSummary
    });
  }
  if (parsed.decisionType === "halt") {
    return plannerDecisionSchema.parse({
      decisionType: "halt",
      reasonCode: parsed.reasonCode,
      message: parsed.message
    });
  }
  return plannerDecisionSchema.parse({
    decisionType: "error",
    reasonCode: parsed.reasonCode ?? "PLANNER_ERROR",
    message: parsed.message ?? "planner returned error decision"
  });
}
