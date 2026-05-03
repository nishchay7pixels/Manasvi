import { randomUUID } from "node:crypto";

import type { AssembledContext, ContextChunk, ResolvedPrincipalContext } from "@manasvi/contracts";
import type { AvailableToolSummary, ModelInvocationRequest, ModelInvocationResult } from "@manasvi/model-adapter";

export interface HarnessEventResultRecord {
  eventId: string;
  status: "completed" | "failed";
  createdAt: string;
  completedAt: string;
  errorMessage?: string;
  responseText?: string;
  response?: ModelInvocationResult;
  traceId: string;
  correlationId: string;
  sessionId: string;
  contextTraceId: string;
  policyDecision: string;
  policyReasonCodes: string[];
  auditRecordId?: string;
  principal: {
    callerPrincipalId: string;
    actorPrincipalId: string;
  };
  context: {
    includedChunkCount: number;
    excludedChunkCount: number;
    includedChunks: ContextChunkSummary[];
    trustClassifications: string[];
  };
}

export interface ContextChunkSummary {
  chunkId: string;
  role: string;
  sourceType: string;
  authority: string;
  trustClassification: string;
  contentCategory: string;
  tokenEstimate: number;
  preview: string;
}

export function buildModelInvocationRequest(input: {
  messageId: string;
  traceId: string;
  correlationId: string;
  userInput: string;
  assembledContext: AssembledContext;
  maxContextChunks: number;
  availableTools?: AvailableToolSummary[];
}): ModelInvocationRequest {
  const chunks = input.assembledContext.chunks.slice(-input.maxContextChunks);
  return {
    requestId: `model:${randomUUID()}`,
    messageId: input.messageId,
    sessionId: input.assembledContext.session.sessionId,
    traceId: input.traceId,
    correlationId: input.correlationId,
    userInput: input.userInput,
    contextChunks: chunks,
    ...(input.availableTools ? { availableTools: input.availableTools } : {})
  };
}

export function buildHarnessEventResultRecord(input: {
  eventId: string;
  assembledContext: AssembledContext;
  principalContext: ResolvedPrincipalContext;
  traceId: string;
  correlationId: string;
  policyDecision: string;
  policyReasonCodes: string[];
  auditRecordId?: string;
  modelResponse?: ModelInvocationResult;
  errorMessage?: string;
}): HarnessEventResultRecord {
  const createdAt = new Date().toISOString();
  const contextTrace = input.assembledContext.trace;
  const includedChunks = input.assembledContext.chunks.map(summarizeChunk);
  const trustClassifications = Array.from(
    new Set(input.assembledContext.chunks.map((chunk) => chunk.provenance.trustClassification))
  );

  return {
    eventId: input.eventId,
    status: input.errorMessage ? "failed" : "completed",
    createdAt,
    completedAt: createdAt,
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
    ...(input.modelResponse ? { responseText: input.modelResponse.outputText, response: input.modelResponse } : {}),
    traceId: input.traceId,
    correlationId: input.correlationId,
    sessionId: input.assembledContext.session.sessionId,
    contextTraceId: contextTrace.traceId,
    policyDecision: input.policyDecision,
    policyReasonCodes: input.policyReasonCodes,
    ...(input.auditRecordId ? { auditRecordId: input.auditRecordId } : {}),
    principal: {
      callerPrincipalId: input.principalContext.caller.principalId,
      actorPrincipalId: input.principalContext.actor.principalId
    },
    context: {
      includedChunkCount: contextTrace.includedChunkIds.length,
      excludedChunkCount: contextTrace.excludedChunkIds.length,
      includedChunks,
      trustClassifications
    }
  };
}

function summarizeChunk(chunk: ContextChunk): ContextChunkSummary {
  return {
    chunkId: chunk.chunkId,
    role: chunk.role,
    sourceType: chunk.provenance.sourceType,
    authority: chunk.provenance.authority,
    trustClassification: chunk.provenance.trustClassification,
    contentCategory: chunk.provenance.contentCategory,
    tokenEstimate: chunk.tokenEstimate,
    preview: truncate(chunk.content, 120)
  };
}

function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }
  return `${input.slice(0, maxLength)}...`;
}
