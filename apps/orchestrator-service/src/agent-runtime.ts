import { randomUUID } from "node:crypto";

import {
  type ActionProposal,
  type AgentLoopConfig,
  type AgentObservation,
  type AgentRunRecord,
  type AgentRuntimeState,
  type AssembledContext,
  type ContextChunk,
  type MemoryContextCandidatesResponse,
  type PlannerDecision,
  type PlannerRequest,
  type PlannerResponse,
  type PolicyEvaluationResponse,
  agentLoopConfigSchema,
  agentObservationSchema,
  agentRunRecordSchema,
  parsePlannerDecisionEnvelope,
  plannerRequestSchema,
  plannerResponseSchema,
  resolvedPrincipalContextSchema,
  type ToolRegistryEntry,
  type ResolvedPrincipalContext,
  type ToolExecutionContract
} from "@manasvi/contracts";
import type { HttpMemoryClient } from "@manasvi/memory-sdk";
import type { ModelAdapter, ModelInvocationRequest, ModelInvocationResult } from "@manasvi/model-adapter";
import type { PolicyClient } from "@manasvi/policy-sdk";
import type { ContextAssembler, ContextSourceInput } from "@manasvi/session-sdk";
import { type InMemoryToolRegistry } from "@manasvi/tool-registry";
import {
  buildGovernedToolExecutionContract,
  createGovernedToolInvocation,
  validateToolInput,
  validateToolOutput
} from "@manasvi/tool-sdk";

import { buildExecutionIntentFromPolicy } from "./intent-planner.js";
import { buildModelInvocationRequest } from "./model-integration.js";
import { queryPolicyForOrchestration } from "./policy-integration.js";

interface ApprovalRequestResult {
  approvalRequestId: string;
}
interface ApprovalDecisionResult {
  state: "approved" | "rejected";
  artifact?: ToolExecutionContract["artifact"];
}

interface SystemArtifactResult {
  artifact: ToolExecutionContract["artifact"];
}

interface ToolExecutionResponse {
  resultArtifact?: {
    status: "completed" | "failed" | "timed_out" | "rejected";
    result: Record<string, unknown>;
    error?: { code: string; message: string };
  };
  toolOutput?: Record<string, unknown>;
}

interface ProposalSuspicionAssessment {
  suspicious: boolean;
  riskFlags: string[];
  reasons: string[];
}

export interface PlannerModelProvider {
  invokePlanner(input: {
    plannerRequest: PlannerRequest;
    modelRequest: ModelInvocationRequest;
  }): Promise<{
    modelResponse: ModelInvocationResult;
    plannerResponse: PlannerResponse;
  }>;
}

export class AdapterBackedPlannerProvider implements PlannerModelProvider {
  constructor(private readonly modelAdapter: ModelAdapter) {}

  async invokePlanner(input: {
    plannerRequest: PlannerRequest;
    modelRequest: ModelInvocationRequest;
  }): Promise<{ modelResponse: ModelInvocationResult; plannerResponse: PlannerResponse }> {
    const modelResponse = await this.modelAdapter.invoke(input.modelRequest);
    const plannerDecision = this.parsePlannerDecision(modelResponse);
    return {
      modelResponse,
      plannerResponse: plannerResponseSchema.parse({
        schemaVersion: "1.0",
        requestId: input.plannerRequest.requestId,
        decision: plannerDecision,
        providerMetadata: {
          provider: modelResponse.provider,
          model: modelResponse.model,
          latencyMs: modelResponse.latencyMs
        }
      })
    };
  }

  private parsePlannerDecision(modelResponse: ModelInvocationResult): PlannerDecision {
    if (modelResponse.mode === "mock" && modelResponse.outputText.startsWith("MOCK(")) {
      return {
        decisionType: "final_response",
        responseText: modelResponse.outputText
      };
    }
    const parsed = extractJsonObject(modelResponse.outputText) ?? extractTruncatedJsonObject(modelResponse.outputText);
    if (!parsed) {
      const fallback = modelResponse.outputText.trim();
      if (!fallback) {
        throw new Error("PLANNER_OUTPUT_PARSE_FAILED");
      }
      return {
        decisionType: "final_response",
        responseText: fallback
      };
    }
    try {
      const envelopeDecision = parsePlannerDecisionEnvelope(parsed);
      if (envelopeDecision.decisionType === "final_response") {
        const nested = extractJsonObject(envelopeDecision.responseText);
        if (nested) {
          try {
            return parsePlannerDecisionEnvelope(nested);
          } catch {
            return envelopeDecision;
          }
        }
      }
      return envelopeDecision;
    } catch {
      const fallback = modelResponse.outputText.trim();
      if (!fallback) {
        throw new Error("PLANNER_OUTPUT_PARSE_FAILED");
      }
      return {
        decisionType: "final_response",
        responseText: fallback
      };
    }
  }
}

function extractJsonObject(input: string): unknown | null {
  const trimmed = input.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function extractTruncatedJsonObject(input: string): unknown | null {
  const trimmed = input.trim();
  const first = trimmed.indexOf("{");
  if (first < 0) {
    return null;
  }
  const candidate = trimmed.slice(first);
  const openCount = (candidate.match(/\{/g) ?? []).length;
  const closeCount = (candidate.match(/\}/g) ?? []).length;
  if (openCount <= closeCount) {
    return null;
  }
  const repaired = `${candidate}${"}".repeat(openCount - closeCount)}`;
  try {
    return JSON.parse(repaired);
  } catch {
    return null;
  }
}

export interface GovernedAgentRuntimeDependencies {
  policyClient: PolicyClient;
  memoryClient: Pick<HttpMemoryClient, "getContextCandidates">;
  contextAssembler: ContextAssembler;
  plannerProvider: PlannerModelProvider;
  toolRegistry: InMemoryToolRegistry;
  servicePrincipal: ResolvedPrincipalContext["caller"];
  createApprovalRequest: (intent: AgentRunRecord["intents"][number]) => Promise<ApprovalRequestResult>;
  submitApprovalDecision: (input: {
    intent: AgentRunRecord["intents"][number];
    approvalRequestId: string;
    decision: "approved" | "rejected";
  }) => Promise<ApprovalDecisionResult>;
  issueSystemArtifact: (intent: AgentRunRecord["intents"][number]) => Promise<SystemArtifactResult>;
  executeToolContract: (contract: ToolExecutionContract, dryRun: boolean) => Promise<ToolExecutionResponse>;
  intentSigning: {
    keyId: string;
    secret: string;
  };
  now?: () => Date;
}

export interface AgentRuntimeRunInput {
  tenantId: string;
  workspaceId: string;
  messageText: string;
  principalContext: ResolvedPrincipalContext;
  trace: {
    traceId: string;
    correlationId: string;
    parentTraceId?: string;
  };
  sessionId?: string;
  config?: Partial<AgentLoopConfig>;
  approvalSimulation?: "pending" | "approved" | "rejected";
}

export class GovernedAgentRuntime {
  private readonly now: () => Date;

  constructor(private readonly deps: GovernedAgentRuntimeDependencies) {
    this.now = deps.now ?? (() => new Date());
  }

  async runTurn(input: AgentRuntimeRunInput): Promise<AgentRunRecord> {
    const principalContext = resolvedPrincipalContextSchema.parse(input.principalContext);
    const config = agentLoopConfigSchema.parse(input.config ?? {});
    const runId = `agent-run:${randomUUID()}`;
    const createdAt = this.now().toISOString();
    let state: AgentRuntimeState = "initialized";
    let iterations = 0;
    let consecutiveFailures = 0;
    const proposalAttempts = new Map<string, number>();
    const lastCompletedToolOutputByProposal = new Map<string, unknown>();
    const transitions: AgentRunRecord["transitions"] = [];
    const observations: AgentObservation[] = [];
    const intents: AgentRunRecord["intents"] = [];

    const transition = (to: AgentRuntimeState, reason: string, metadata: Record<string, unknown> = {}): void => {
      transitions.push({
        at: this.now().toISOString(),
        from: state,
        to,
        reason,
        metadata
      });
      state = to;
    };

    let assembledContext = await this.assembleContext({
      input,
      principalContext
    });
    transition("context_loaded", "context_assembled", {
      sessionId: assembledContext.session.sessionId,
      contextTraceId: assembledContext.trace.traceId,
      chunks: assembledContext.chunks.length
    });

    let finalOutcome: AgentRunRecord["outcome"] = {
      status: "failed",
      reasonCode: "LOOP_DID_NOT_COMPLETE"
    };

    while (iterations < config.maxIterations) {
      iterations += 1;
      transition("planning", "planner_invocation", { iteration: iterations });
      const plannerRequest = this.buildPlannerRequest({
        runId,
        input,
        principalContext,
        assembledContext,
        observations,
        iteration: iterations
      });
      let plannerResponse: PlannerResponse;
      try {
        plannerResponse = await this.invokePlanner(plannerRequest, input.messageText, assembledContext);
      } catch (error) {
        consecutiveFailures += 1;
        const message = error instanceof Error ? error.message : "planner invocation failed";
        if (!config.strictPlannerParsing) {
          transition("proposed_response", "non_strict_planner_parse_fallback", {
            iteration: iterations,
            error: message
          });
          transition("completed", "fallback_response_returned");
          finalOutcome = {
            status: "completed",
            responseText: "I could not safely parse a structured plan, so I am returning without tool execution."
          };
          break;
        }
        observations.push(
          this.createObservation({
            type: "runtime_failure",
            summary: "Planner output invalid",
            trustClassification: "CONTROL_TRUSTED",
            data: { reason: message },
            trace: input.trace
          })
        );
        transition("recovering_from_failure", "planner_failure", {
          iteration: iterations,
          failures: consecutiveFailures,
          error: message
        });
        if (consecutiveFailures >= config.maxConsecutiveFailures) {
          transition("failed", "max_consecutive_failures_reached", { failures: consecutiveFailures });
          finalOutcome = {
            status: "failed",
            reasonCode: "MAX_CONSECUTIVE_FAILURES",
            responseText: "I could not safely complete this request due to planner errors."
          };
          break;
        }
        continue;
      }
      consecutiveFailures = 0;
      const decision = plannerResponse.decision;

      if (decision.decisionType === "final_response") {
        transition("proposed_response", "planner_final_response");
        transition("completed", "response_returned");
        finalOutcome = {
          status: "completed",
          responseText: decision.responseText
        };
        break;
      }

      if (decision.decisionType === "clarification_request") {
        transition("proposed_response", "planner_requested_clarification");
        transition("completed", "clarification_returned");
        finalOutcome = {
          status: "completed",
          responseText: decision.prompt
        };
        break;
      }

      if (decision.decisionType === "halt") {
        transition("halted_denied", "planner_halt", { reasonCode: decision.reasonCode });
        finalOutcome = {
          status: "halted_denied",
          reasonCode: decision.reasonCode,
          responseText: decision.message
        };
        break;
      }

      if (decision.decisionType === "error") {
        transition("recovering_from_failure", "planner_error_decision", { reasonCode: decision.reasonCode });
        observations.push(
          this.createObservation({
            type: "runtime_failure",
            summary: "Planner returned error decision",
            trustClassification: "CONTROL_TRUSTED",
            data: {
              reasonCode: decision.reasonCode,
              message: decision.message
            },
            trace: input.trace
          })
        );
        continue;
      }

      transition("proposed_action", "planner_action_proposal", {
        proposalType: decision.proposal.proposalType
      });

      if (decision.proposal.proposalType !== "tool_invocation") {
        observations.push(
          this.createObservation({
            type: "runtime_failure",
            summary: "Unsupported proposal type",
            trustClassification: "CONTROL_TRUSTED",
            data: {
              proposalType: decision.proposal.proposalType
            },
            trace: input.trace
          })
        );
        transition("recovering_from_failure", "unsupported_proposal_type", {
          proposalType: decision.proposal.proposalType
        });
        continue;
      }

      const toolEntry = this.deps.toolRegistry.resolve(decision.proposal.toolId, decision.proposal.toolVersion);
      if (!toolEntry || toolEntry.status !== "enabled") {
        observations.push(
          this.createObservation({
            type: "runtime_failure",
            summary: "Tool unavailable",
            trustClassification: "CONTROL_TRUSTED",
            data: {
              toolId: decision.proposal.toolId,
              requestedVersion: decision.proposal.toolVersion,
              reasonCode: !toolEntry ? "TOOL_NOT_REGISTERED" : "TOOL_NOT_ENABLED"
            },
            trace: input.trace
          })
        );
        transition("recovering_from_failure", "tool_unavailable", {
          toolId: decision.proposal.toolId
        });
        continue;
      }

      let validatedInput: Record<string, unknown>;
      const normalizedProposalInput = normalizeProposalToolInput({
        toolId: toolEntry.toolId,
        input: decision.proposal.input,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        actorPrincipalId: principalContext.actor.principalId
      });
      try {
        validatedInput = validateToolInput(toolEntry.toolId, normalizedProposalInput);
      } catch (error) {
        const message = error instanceof Error ? error.message : "validation failed";
        observations.push(
          this.createObservation({
            type: "runtime_failure",
            summary: "Tool input validation failed",
            trustClassification: "CONTROL_TRUSTED",
            data: {
              toolId: toolEntry.toolId,
              message
            },
            trace: input.trace
          })
        );
        transition("completed", "tool_input_invalid", {
          toolId: toolEntry.toolId
        });
        finalOutcome = {
          status: "completed",
          responseText: `I could not execute ${toolEntry.toolId} because the generated tool input was invalid (${message}). Please try rephrasing your request.`
        };
        break;
      }

      const proposalKey = `${toolEntry.toolId}:${JSON.stringify(validatedInput)}`;
      const attempts = (proposalAttempts.get(proposalKey) ?? 0) + 1;
      proposalAttempts.set(proposalKey, attempts);
      const previousOutput = lastCompletedToolOutputByProposal.get(proposalKey);
      if (attempts > 1 && previousOutput !== undefined) {
        transition("completed", "duplicate_tool_proposal_short_circuit", {
          toolId: toolEntry.toolId,
          attempts
        });
        finalOutcome = {
          status: "completed",
          responseText: `I completed the web search. Results: ${JSON.stringify(previousOutput)}`
        };
        break;
      }

      transition("awaiting_policy", "policy_evaluation_requested", {
        toolId: toolEntry.toolId
      });
      const suspicion = this.assessProposalForInjection({
        proposal: decision.proposal,
        assembledContext
      });
      if (suspicion.suspicious) {
        observations.push(
          this.createObservation({
            type: "runtime_failure",
            summary: "Suspicious proposal markers detected from untrusted context",
            trustClassification: "CONTROL_TRUSTED",
            data: {
              toolId: toolEntry.toolId,
              reasons: suspicion.reasons
            },
            trace: input.trace
          })
        );
      }
      const decisionResponse = await this.evaluateToolPolicy({
        input,
        principalContext,
        toolEntry,
        proposal: decision.proposal,
        additionalRiskFlags: suspicion.riskFlags
      });
      observations.push(
        this.createObservation({
          type: "policy_decision",
          summary: "Policy decision received for proposal",
          trustClassification: "CONTROL_TRUSTED",
          data: {
            decision: decisionResponse.decision,
            reasonCodes: decisionResponse.reasonCodes,
            approvalRequired: decisionResponse.approvalRequired,
            matchedPolicyId: decisionResponse.matchedPolicyId
          },
          trace: input.trace
        })
      );
      if (decisionResponse.decision === "DENY") {
        transition("halted_denied", "policy_denied_action", {
          toolId: toolEntry.toolId,
          reasonCodes: decisionResponse.reasonCodes
        });
        finalOutcome = {
          status: "halted_denied",
          reasonCode: "POLICY_DENIED",
          responseText: "I cannot perform that action under current policy."
        };
        break;
      }
      if (suspicion.suspicious && !decisionResponse.approvalRequired) {
        transition("halted_denied", "suspicious_proposal_blocked", {
          toolId: toolEntry.toolId,
          reasons: suspicion.reasons
        });
        finalOutcome = {
          status: "halted_denied",
          reasonCode: "SUSPICIOUS_PROPOSAL_BLOCKED",
          responseText: "I cannot execute that request because untrusted content attempted to influence control flow."
        };
        break;
      }

      const invocation = createGovernedToolInvocation({
        toolId: toolEntry.toolId,
        toolVersion: toolEntry.version,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        actor: principalContext.actor,
        caller: principalContext.caller,
        ...(assembledContext.session.sessionId ? { sessionId: assembledContext.session.sessionId } : {}),
        input: validatedInput,
        requestedSecretRefs: toolEntry.manifest.runtimeHints.declaredSecretRefs,
        trace: input.trace
      });
      let intent = buildExecutionIntentFromPolicy({
        decision: decisionResponse,
        principalContext,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        ...(assembledContext.session.sessionId ? { sessionId: assembledContext.session.sessionId } : {}),
        trace: input.trace,
        action: {
          actionId: `tool.invoke.${toolEntry.toolId}`,
          actionClass: toolEntry.manifest.policyBinding.policyActionClass,
          operation: toolEntry.manifest.runtimeBinding.operation,
          toolRef: toolEntry.manifest.runtimeBinding.toolRef,
          parameters: validatedInput
        },
        target: {
          ...toolEntry.manifest.policyBinding.resource,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          attributes: {
            toolId: toolEntry.toolId
          }
        },
        requiredCapabilities: toolEntry.manifest.capabilities.map((item) => item.capabilityId),
        ttlSeconds: 900,
        idempotencyKey: invocation.invocationId,
        signing: this.deps.intentSigning
      });
      intents.push(intent);

      if (decisionResponse.approvalRequired) {
        transition("awaiting_approval", "approval_required_by_policy", {
          intentId: intent.intentId
        });
        const request = await this.deps.createApprovalRequest(intent);
        observations.push(
          this.createObservation({
            type: "approval_outcome",
            summary: "Approval request created",
            trustClassification: "CONTROL_TRUSTED",
            data: {
              intentId: intent.intentId,
              approvalRequestId: request.approvalRequestId,
              state: input.approvalSimulation ?? "pending"
            },
            trace: input.trace
          })
        );

        let approvalArtifact: ToolExecutionContract["artifact"] | undefined;
        if ((input.approvalSimulation ?? "pending") === "pending") {
          finalOutcome = {
            status: "awaiting_approval",
            reasonCode: "APPROVAL_REQUIRED",
            responseText: `Action requires approval (request ${request.approvalRequestId}).`
          };
          break;
        }
        if (input.approvalSimulation === "rejected") {
          transition("halted_denied", "approval_rejected", {
            intentId: intent.intentId,
            approvalRequestId: request.approvalRequestId
          });
          finalOutcome = {
            status: "halted_denied",
            reasonCode: "APPROVAL_REJECTED",
            responseText: "Requested action was rejected during approval."
          };
          break;
        }
        if (input.approvalSimulation === "approved") {
          const decisionResult = await this.deps.submitApprovalDecision({
            intent,
            approvalRequestId: request.approvalRequestId,
            decision: "approved"
          });
          approvalArtifact = decisionResult.artifact;
          intent = {
            ...intent,
            approval: {
              ...intent.approval,
              state: "approved",
              approvedBy: principalContext.actor,
              approvedAt: this.now().toISOString(),
              approvalRequestId: request.approvalRequestId
            },
            lifecycle: "execution_authorized",
            updatedAt: this.now().toISOString()
          };
          intents[intents.length - 1] = intent;
        }

        transition("awaiting_execution", "execution_requested", {
          intentId: intent.intentId
        });
        const artifactResult = approvalArtifact
          ? { artifact: approvalArtifact }
          : await this.deps.issueSystemArtifact(intent);
        const contract = buildGovernedToolExecutionContract({
          manifest: toolEntry.manifest,
          invocation,
          intent,
          artifact: artifactResult.artifact,
          trace: input.trace
        });
        const execution = await this.deps.executeToolContract(contract, false);
        const executionStatus = execution.resultArtifact?.status ?? "failed";
        const executionData = execution.toolOutput ?? execution.resultArtifact?.result ?? {};
        if (execution.toolOutput) {
          validateToolOutput(toolEntry.toolId, execution.toolOutput);
        }
          observations.push(
            this.createObservation({
              type: executionStatus === "completed" ? "tool_result" : "execution_result",
              summary: executionStatus === "completed" ? "Tool execution completed" : "Execution completed with failure",
              trustClassification: "MODEL_INTERMEDIATE",
              data: {
                toolId: toolEntry.toolId,
              executionStatus,
              output: executionData,
              ...(execution.resultArtifact?.error ? { error: execution.resultArtifact.error } : {})
            },
            trace: input.trace
          })
        );
        if (executionStatus !== "completed") {
          transition("completed", "execution_failed_returned", {
            intentId: intent.intentId,
            status: executionStatus
          });
          const rawError = execution.resultArtifact?.error;
          const executionError =
            rawError && typeof rawError === "object" && "message" in rawError
              ? String((rawError as { message?: unknown }).message ?? "unknown execution failure")
              : rawError
                ? JSON.stringify(rawError)
                : `status=${executionStatus}; artifact=${JSON.stringify(execution.resultArtifact ?? {})}`;
          finalOutcome = {
            status: "completed",
            responseText: `I could not complete the requested tool execution because it failed: ${executionError}.`
          };
          break;
        }

        transition("ingesting_observation", "execution_result_ingested", {
          intentId: intent.intentId
        });
        lastCompletedToolOutputByProposal.set(proposalKey, executionData);
        assembledContext = this.injectObservationIntoContext(assembledContext, observations[observations.length - 1]!);
        continue;
      }

      transition("awaiting_execution", "execution_requested", {
        intentId: intent.intentId
      });
      const artifactResult = await this.deps.issueSystemArtifact(intent);
      const contract = buildGovernedToolExecutionContract({
        manifest: toolEntry.manifest,
        invocation,
        intent,
        artifact: artifactResult.artifact,
        trace: input.trace
      });
      const execution = await this.deps.executeToolContract(contract, false);
      const executionStatus = execution.resultArtifact?.status ?? "failed";
      const executionData = execution.toolOutput ?? execution.resultArtifact?.result ?? {};
      if (execution.toolOutput) {
        validateToolOutput(toolEntry.toolId, execution.toolOutput);
      }
        observations.push(
          this.createObservation({
            type: executionStatus === "completed" ? "tool_result" : "execution_result",
            summary: executionStatus === "completed" ? "Tool execution completed" : "Execution completed with failure",
            trustClassification: "MODEL_INTERMEDIATE",
            data: {
              toolId: toolEntry.toolId,
            executionStatus,
            output: executionData,
            ...(execution.resultArtifact?.error ? { error: execution.resultArtifact.error } : {})
          },
          trace: input.trace
        })
      );
      if (executionStatus !== "completed") {
        transition("completed", "execution_failed_returned", {
          intentId: intent.intentId,
          status: executionStatus
        });
        const rawError = execution.resultArtifact?.error;
        const executionError =
          rawError && typeof rawError === "object" && "message" in rawError
            ? String((rawError as { message?: unknown }).message ?? "unknown execution failure")
            : rawError
              ? JSON.stringify(rawError)
              : `status=${executionStatus}; artifact=${JSON.stringify(execution.resultArtifact ?? {})}`;
        finalOutcome = {
          status: "completed",
          responseText: `I could not complete the requested tool execution because it failed: ${executionError}.`
        };
        break;
      }

      transition("ingesting_observation", "execution_result_ingested", {
        intentId: intent.intentId
      });
      lastCompletedToolOutputByProposal.set(proposalKey, executionData);
      assembledContext = this.injectObservationIntoContext(assembledContext, observations[observations.length - 1]!);
    }

    if (iterations >= config.maxIterations && finalOutcome.status === "failed") {
      const latestToolResult = [...observations]
        .reverse()
        .find((item) => item.type === "tool_result");
      if (latestToolResult && typeof latestToolResult.data === "object" && latestToolResult.data !== null) {
        const payload = latestToolResult.data as Record<string, unknown>;
        transition("completed", "max_iterations_with_tool_result_fallback", {
          maxIterations: config.maxIterations
        });
        finalOutcome = {
          status: "completed",
          responseText: `I completed the requested tool execution. Results: ${JSON.stringify(payload.output ?? payload)}`
        };
      } else {
        const latestObservation = observations[observations.length - 1];
        if (latestObservation) {
          transition("completed", "max_iterations_observation_fallback", {
            maxIterations: config.maxIterations,
            observationType: latestObservation.type
          });
          finalOutcome = {
            status: "completed",
            responseText: `I reached the iteration limit, but here is the latest available result: ${latestObservation.summary}.`
          };
        } else {
          transition("failed", "max_iterations_reached", {
            maxIterations: config.maxIterations
          });
          finalOutcome = {
            status: "failed",
            reasonCode: "MAX_ITERATIONS_REACHED",
            responseText: "I could not safely complete this request within iteration limits."
          };
        }
      }
    }

    return agentRunRecordSchema.parse({
      schemaVersion: "1.0",
      contractVersion: "1.0.0",
      runId,
      trace: input.trace,
      principalContext,
      session: {
        sessionId: assembledContext.session.sessionId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId
      },
      userMessage: input.messageText,
      state,
      transitions,
      iterations,
      observations: observations.map((item) => agentObservationSchema.parse(item)),
      intents,
      outcome: finalOutcome,
      createdAt,
      updatedAt: this.now().toISOString()
    });
  }

  private async assembleContext(input: {
    input: AgentRuntimeRunInput;
    principalContext: ResolvedPrincipalContext;
  }): Promise<AssembledContext> {
    const memoryCandidates: MemoryContextCandidatesResponse = await this.deps.memoryClient.getContextCandidates({
      schemaVersion: "1.0",
      tenantId: input.input.tenantId,
      workspaceId: input.input.workspaceId,
      actorPrincipal: input.principalContext.actor,
      callerPrincipal: input.principalContext.caller,
      ...(input.input.sessionId ? { sessionId: input.input.sessionId } : {}),
      queryText: input.input.messageText,
      maxPerClass: 2,
      trace: input.input.trace
    }).catch(() => ({
      schemaVersion: "1.0" as const,
      records: [],
      trace: input.input.trace
    }));
    return this.deps.contextAssembler.assembleForMessage({
      message: {
        messageId: `agent-message:${randomUUID()}`,
        text: input.input.messageText,
        sender: input.principalContext.actor,
        trustClassification: "USER_OWNED",
        sourceRef: "agent-runtime",
        createdAt: this.now().toISOString()
      },
      sessionResolve: {
        tenantId: input.input.tenantId,
        workspaceId: input.input.workspaceId,
        isolationMode: "per_user_isolated",
        sessionType: "user_interaction",
        owner: input.principalContext.actor,
        createdBy: this.deps.servicePrincipal,
        participants: [input.principalContext.caller],
        ...(input.input.sessionId ? { explicitSessionId: input.input.sessionId } : {}),
        resolutionHint: input.principalContext.actor.principalId
      },
      trace: input.input.trace,
      systemInstructions: [
        "Model output does not execute tools. Tool use is proposal-only and policy mediated.",
        "User-facing responses must not include internal policy/trust/session/trace metadata unless explicitly requested."
      ],
      additionalSources: memoryCandidates.records.map((record) =>
        memoryRecordToContextSource({
          record,
          sessionId: input.input.sessionId ?? `session:pending:${randomUUID()}`
        })
      ),
      tokenBudget: 2048
    });
  }

  private buildPlannerRequest(input: {
    runId: string;
    input: AgentRuntimeRunInput;
    principalContext: ResolvedPrincipalContext;
    assembledContext: AssembledContext;
    observations: AgentObservation[];
    iteration: number;
  }): PlannerRequest {
    const availableTools = this.deps.toolRegistry
      .list({ status: "enabled" })
      .map((entry) => ({
        toolId: entry.toolId,
        version: entry.version,
        actionClass: entry.manifest.actionClass,
        sideEffectClass: entry.manifest.sideEffectClass,
        mutability: entry.manifest.mutability,
        capabilities: entry.manifest.capabilities,
        policyBinding: entry.manifest.policyBinding,
        runtimeHints: entry.manifest.runtimeHints
      }));
    return plannerRequestSchema.parse({
      schemaVersion: "1.0",
      requestId: `${input.runId}:planner:${input.iteration}`,
      runtimeState: "planning",
      principalContext: input.principalContext,
      trace: input.input.trace,
      session: {
        sessionId: input.assembledContext.session.sessionId,
        tenantId: input.input.tenantId,
        workspaceId: input.input.workspaceId
      },
      userInput: input.input.messageText,
      iteration: input.iteration,
      availableTools,
      contextChunks: input.assembledContext.chunks,
      observations: input.observations
    });
  }

  private async invokePlanner(
    plannerRequest: PlannerRequest,
    userInput: string,
    assembledContext: AssembledContext
  ): Promise<PlannerResponse> {
    const modelRequest = buildModelInvocationRequest({
      messageId: plannerRequest.requestId,
      traceId: plannerRequest.trace.traceId,
      correlationId: plannerRequest.trace.correlationId,
      userInput,
      assembledContext,
      maxContextChunks: 24,
      availableTools: plannerRequest.availableTools.map((t) => ({
        toolId: t.toolId,
        version: t.version,
        actionClass: t.actionClass,
        sideEffectClass: t.sideEffectClass
      }))
    });
    const result = await this.deps.plannerProvider.invokePlanner({
      plannerRequest,
      modelRequest
    });
    return plannerResponseSchema.parse(result.plannerResponse);
  }

  private async evaluateToolPolicy(input: {
    input: AgentRuntimeRunInput;
    principalContext: ResolvedPrincipalContext;
    toolEntry: ToolRegistryEntry;
    proposal: Extract<ActionProposal, { proposalType: "tool_invocation" }>;
    additionalRiskFlags?: string[];
  }): Promise<PolicyEvaluationResponse> {
    return queryPolicyForOrchestration(this.deps.policyClient, {
      principalContext: input.principalContext,
      actionClass: input.toolEntry.manifest.policyBinding.policyActionClass,
      actionId: `tool.invoke.${input.toolEntry.toolId}`,
      resource: {
        ...input.toolEntry.manifest.policyBinding.resource,
        tenantId: input.input.tenantId,
        workspaceId: input.input.workspaceId,
        attributes: {
          toolId: input.toolEntry.toolId,
          expectedResourceClass: input.proposal.expectedResource?.resourceClass
        }
      },
      requestedCapabilities: input.toolEntry.manifest.capabilities.map((item) => item.capabilityId),
      tenantId: input.input.tenantId,
      workspaceId: input.input.workspaceId,
      trace: input.input.trace,
      ...(input.input.sessionId ? { sessionId: input.input.sessionId } : {}),
      riskFlags: [
        input.toolEntry.manifest.sideEffectClass,
        ...input.toolEntry.manifest.tags,
        ...(input.additionalRiskFlags ?? [])
      ]
    });
  }

  private assessProposalForInjection(input: {
    proposal: Extract<ActionProposal, { proposalType: "tool_invocation" }>;
    assembledContext: AssembledContext;
  }): ProposalSuspicionAssessment {
    const suspectPatterns = [
      /ignore\s+(all|previous|prior)\s+instructions/i,
      /system\s+instruction/i,
      /policy\s+already\s+approved/i,
      /approval\s+already\s+granted/i,
      /exfiltrat/i,
      /secret/i
    ];
    const proposalPayload = JSON.stringify({
      purpose: input.proposal.purpose,
      input: input.proposal.input
    });
    const containsControlClaim = suspectPatterns.some((pattern) => pattern.test(proposalPayload));
    const untrustedContextPresent = input.assembledContext.chunks.some(
      (chunk) =>
        chunk.provenance.trustClassification === "EXTERNAL_UNTRUSTED" ||
        chunk.provenance.authority === "untrusted_external"
    );
    if (!containsControlClaim || !untrustedContextPresent) {
      return {
        suspicious: false,
        riskFlags: [],
        reasons: []
      };
    }
    return {
      suspicious: true,
      riskFlags: ["prompt_injection_suspected", "untrusted_context_control_claim"],
      reasons: ["proposal_contains_control_claims", "untrusted_context_present"]
    };
  }

  private injectObservationIntoContext(assembledContext: AssembledContext, observation: AgentObservation): AssembledContext {
    const chunk: ContextChunk = {
      chunkId: `obs:${observation.observationId}`,
      sessionId: assembledContext.session.sessionId,
      tenantId: assembledContext.session.tenantId,
      workspaceId: assembledContext.session.workspaceId,
      content: `${observation.summary}: ${JSON.stringify(observation.data)}`,
      tokenEstimate: Math.max(8, Math.ceil(JSON.stringify(observation.data).length / 5)),
      createdAt: observation.createdAt,
      sticky: false,
      stale: false,
      role: "tool_observation",
      provenance: {
        sourceType: "tool-result",
        sourceId: observation.observationId,
        sourceRef: `observation:${observation.observationId}`,
        observedAt: observation.createdAt,
        trustClassification: observation.trustClassification,
        authority: "informational",
        tenantId: assembledContext.session.tenantId,
        workspaceId: assembledContext.session.workspaceId,
        sessionId: assembledContext.session.sessionId,
        contentCategory: "tool-output",
        transformation: {
          transformed: false,
          derivedFromChunkIds: [],
          derivedFromSourceRefs: []
        }
      },
      metadata: {
        observationType: observation.type
      }
    };
    return {
      ...assembledContext,
      chunks: [...assembledContext.chunks.slice(-47), chunk]
    };
  }

  private createObservation(input: {
    type: AgentObservation["type"];
    summary: string;
    trustClassification: AgentObservation["trustClassification"];
    data: Record<string, unknown>;
    trace: AgentObservation["trace"];
  }): AgentObservation {
    return agentObservationSchema.parse({
      observationId: `observation:${randomUUID()}`,
      type: input.type,
      summary: input.summary,
      trustClassification: input.trustClassification,
      data: input.data,
      trace: input.trace,
      createdAt: this.now().toISOString()
    });
  }
}

function memoryRecordToContextSource(input: {
  record: MemoryContextCandidatesResponse["records"][number];
  sessionId: string;
}): ContextSourceInput {
  const sourceType =
    input.record.memoryClass === "UNTRUSTED_EXTERNAL"
      ? "retrieved-web-content"
      : input.record.memoryClass === "ORG_SHARED_TRUSTED"
        ? "shared-memory"
        : input.record.memoryClass === "AUDIT_ACTION_HISTORY"
          ? "risk-annotation"
          : "user-memory";
  const content = input.record.content.text ?? JSON.stringify(input.record.content.data ?? {});
  return {
    sourceType,
    sourceId: input.record.recordId,
    sourceRef: `memory:${input.record.recordId}`,
    content,
    contentCategory: "memory-fact",
    trustClassification: input.record.trustClassification,
    ...(input.record.provenance.originatingPrincipal
      ? { originatingPrincipal: input.record.provenance.originatingPrincipal }
      : {}),
    ...(input.record.provenance.originatingService
      ? { originatingService: input.record.provenance.originatingService }
      : {}),
    observedAt: input.record.provenance.createdAt,
    sessionId: input.sessionId,
    role:
      input.record.memoryClass === "UNTRUSTED_EXTERNAL"
        ? "evidence_untrusted"
        : input.record.memoryClass === "AUDIT_ACTION_HISTORY"
          ? "policy_runtime"
          : "memory_continuity",
    authority: input.record.trustClassification === "EXTERNAL_UNTRUSTED" ? "untrusted_external" : "informational",
    metadata: {
      memoryClass: input.record.memoryClass,
      contentType: input.record.contentType
    },
    transformation: {
      transformed: input.record.provenance.derivation.derived,
      ...(input.record.provenance.derivation.derivationType
        ? { transformType: input.record.provenance.derivation.derivationType }
        : {}),
      derivedFromChunkIds: input.record.provenance.derivation.derivedFromRecordIds,
      derivedFromSourceRefs: input.record.provenance.derivation.derivedFromSourceRefs
    }
  };
}

function normalizeProposalToolInput(input: {
  toolId: string;
  input: Record<string, unknown>;
  tenantId: string;
  workspaceId: string;
  actorPrincipalId: string;
}): Record<string, unknown> {
  if (input.toolId === "tool.fs-rename-file") {
    const raw = input.input;
    const fromPath =
      (typeof raw.fromPath === "string" ? raw.fromPath : undefined) ??
      (typeof raw.path === "string" ? raw.path : undefined) ??
      (typeof raw.sourcePath === "string" ? raw.sourcePath : undefined);
    const toPath =
      (typeof raw.toPath === "string" ? raw.toPath : undefined) ??
      (typeof raw.newPath === "string" ? raw.newPath : undefined) ??
      (typeof raw.destinationPath === "string" ? raw.destinationPath : undefined);
    return {
      ...raw,
      ...(fromPath ? { fromPath } : {}),
      ...(toPath ? { toPath } : {})
    };
  }

  if (input.toolId !== "tool.memory-note-write") {
    return input.input;
  }

  const raw = input.input;
  const noteCandidate = [raw.note, raw.content, raw.text, raw.memory, raw.value]
    .find((item) => typeof item === "string" && item.trim().length > 0);
  const actorSlug = input.actorPrincipalId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const namespaceDefault = `tenant/${input.tenantId}/workspace/${input.workspaceId}/user/${actorSlug}/notes`;

  return {
    ...raw,
    ...(typeof raw.namespace === "string" && raw.namespace.trim().length > 0 ? {} : { namespace: namespaceDefault }),
    ...(typeof raw.note === "string" && raw.note.trim().length > 0
      ? {}
      : typeof noteCandidate === "string"
        ? { note: noteCandidate }
        : {}),
    ...(typeof raw.trustClassification === "string" && raw.trustClassification.trim().length > 0
      ? {}
      : { trustClassification: "USER_OWNED" }),
    ...(typeof raw.noteType === "string" && raw.noteType.trim().length > 0 ? {} : { noteType: "fact" })
  };
}
