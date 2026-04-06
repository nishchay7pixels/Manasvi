import { randomUUID } from "node:crypto";

import {
  assembledContextSchema,
  contextChunkSchema,
  contextProvenanceSchema,
  createContextTraceId,
  createSessionId,
  messageContextTraceSchema,
  sessionEntitySchema,
  sessionMessageSchema,
  type AssembledContext,
  type ContextChunk,
  type ContextContentCategory,
  type ContextProvenance,
  type ContextSourceType,
  type MessageContextTrace,
  type PrincipalReference,
  type SessionEntity,
  type SessionIsolationMode,
  type SessionMessage,
  type SessionRiskProfile,
  type SessionType,
  type TrustClass
} from "@manasvi/contracts";

export interface SessionResolveInput {
  tenantId: string;
  workspaceId: string;
  isolationMode: SessionIsolationMode;
  sessionType: SessionType;
  owner: PrincipalReference;
  createdBy: PrincipalReference;
  participants?: PrincipalReference[];
  explicitSessionId?: string;
  channelBinding?: {
    channelPrincipal: PrincipalReference;
    externalThreadId?: string;
    externalConversationId?: string;
  };
  resolutionHint?: string;
  ttlSeconds?: number;
  tags?: string[];
}

export interface SessionStore {
  createSession(input: SessionResolveInput): Promise<SessionEntity>;
  resolveSession(input: SessionResolveInput): Promise<SessionEntity | undefined>;
  resolveOrCreateSession(input: SessionResolveInput): Promise<{ session: SessionEntity; created: boolean }>;
  getSessionById(sessionId: string): Promise<SessionEntity | undefined>;
  updateSession(session: SessionEntity): Promise<void>;
  recordSessionActivity(input: {
    sessionId: string;
    actor: PrincipalReference;
    timestamp?: string;
  }): Promise<void>;
  recordMessage(message: SessionMessage): Promise<void>;
  listSessionMessages(input: { sessionId: string; limit?: number }): Promise<SessionMessage[]>;
  recordContextTrace(trace: MessageContextTrace): Promise<void>;
  listContextTraces(input: { sessionId: string; limit?: number }): Promise<MessageContextTrace[]>;
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionEntity>();
  private readonly sessionMessages = new Map<string, SessionMessage[]>();
  private readonly sessionResolutionIndex = new Map<string, string>();
  private readonly contextTraces = new Map<string, MessageContextTrace[]>();

  async createSession(input: SessionResolveInput): Promise<SessionEntity> {
    const now = new Date().toISOString();
    const sessionId = input.explicitSessionId ?? createSessionId();
    const session = sessionEntitySchema.parse({
      schemaVersion: "1.0",
      contractVersion: "1.0.0",
      sessionId,
      sessionType: input.sessionType,
      isolationMode: input.isolationMode,
      status: "active",
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      owner: input.owner,
      createdBy: input.createdBy,
      participants: (input.participants ?? []).map((participant) => ({
        principal: participant,
        joinedAt: now
      })),
      ...(input.channelBinding ? { channelBinding: input.channelBinding } : {}),
      contextPolicyHints: {},
      tags: input.tags ?? [],
      createdAt: now,
      lastActivityAt: now,
      ...(input.ttlSeconds ? { ttlSeconds: input.ttlSeconds } : {}),
      ...(input.ttlSeconds
        ? {
            expiresAt: new Date(Date.now() + input.ttlSeconds * 1000).toISOString()
          }
        : {}),
      riskProfile: defaultRiskProfile()
    });
    this.sessions.set(session.sessionId, session);
    const resolutionKey = computeResolutionKey(input);
    if (resolutionKey) {
      this.sessionResolutionIndex.set(resolutionKey, session.sessionId);
    }
    return session;
  }

  async resolveSession(input: SessionResolveInput): Promise<SessionEntity | undefined> {
    if (input.explicitSessionId) {
      const explicit = this.sessions.get(input.explicitSessionId);
      if (!explicit) {
        return undefined;
      }
      if (
        explicit.tenantId !== input.tenantId ||
        explicit.workspaceId !== input.workspaceId ||
        explicit.isolationMode !== input.isolationMode
      ) {
        return undefined;
      }
      return explicit;
    }

    const key = computeResolutionKey(input);
    if (!key) {
      return undefined;
    }
    const sessionId = this.sessionResolutionIndex.get(key);
    if (!sessionId) {
      return undefined;
    }
    return this.sessions.get(sessionId);
  }

  async resolveOrCreateSession(
    input: SessionResolveInput
  ): Promise<{ session: SessionEntity; created: boolean }> {
    if (input.isolationMode === "ephemeral_one_shot") {
      const session = await this.createSession(input);
      return {
        session,
        created: true
      };
    }
    const existing = await this.resolveSession(input);
    if (existing) {
      return {
        session: existing,
        created: false
      };
    }
    const created = await this.createSession(input);
    return {
      session: created,
      created: true
    };
  }

  async getSessionById(sessionId: string): Promise<SessionEntity | undefined> {
    return this.sessions.get(sessionId);
  }

  async updateSession(session: SessionEntity): Promise<void> {
    this.sessions.set(session.sessionId, sessionEntitySchema.parse(session));
  }

  async recordSessionActivity(input: {
    sessionId: string;
    actor: PrincipalReference;
    timestamp?: string;
  }): Promise<void> {
    const existing = this.sessions.get(input.sessionId);
    if (!existing) {
      throw new Error(`Session ${input.sessionId} not found`);
    }
    const updated = sessionEntitySchema.parse({
      ...existing,
      lastActedBy: input.actor,
      lastActivityAt: input.timestamp ?? new Date().toISOString()
    });
    this.sessions.set(input.sessionId, updated);
  }

  async recordMessage(message: SessionMessage): Promise<void> {
    const parsed = sessionMessageSchema.parse(message);
    const list = this.sessionMessages.get(parsed.sessionId) ?? [];
    list.push(parsed);
    this.sessionMessages.set(parsed.sessionId, list);
  }

  async listSessionMessages(input: { sessionId: string; limit?: number }): Promise<SessionMessage[]> {
    const list = this.sessionMessages.get(input.sessionId) ?? [];
    if (!input.limit || input.limit <= 0) {
      return [...list];
    }
    return list.slice(Math.max(list.length - input.limit, 0));
  }

  async recordContextTrace(trace: MessageContextTrace): Promise<void> {
    const parsed = messageContextTraceSchema.parse(trace);
    const list = this.contextTraces.get(parsed.sessionId) ?? [];
    list.unshift(parsed);
    this.contextTraces.set(parsed.sessionId, list);
  }

  async listContextTraces(input: { sessionId: string; limit?: number }): Promise<MessageContextTrace[]> {
    const list = this.contextTraces.get(input.sessionId) ?? [];
    if (!input.limit || input.limit <= 0) {
      return [...list];
    }
    return list.slice(0, input.limit);
  }
}

export interface ContextSourceInput {
  sourceType: ContextSourceType;
  sourceId: string;
  sourceRef: string;
  content: string;
  contentCategory: ContextContentCategory;
  trustClassification: TrustClass;
  originatingPrincipal?: PrincipalReference;
  originatingService?: string;
  observedAt?: string;
  tenantId?: string;
  workspaceId?: string;
  sessionId?: string;
  ttlSeconds?: number;
  sticky?: boolean;
  metadata?: Record<string, unknown>;
  transformation?: {
    transformed: boolean;
    transformType?: string;
    derivedFromChunkIds?: string[];
    derivedFromSourceRefs?: string[];
  };
}

export interface ContextAssemblyInput {
  message: {
    messageId: string;
    text: string;
    sender: PrincipalReference;
    trustClassification: TrustClass;
    sourceRef: string;
    createdAt?: string;
  };
  sessionResolve: SessionResolveInput;
  trace: {
    traceId: string;
    correlationId: string;
    parentTraceId?: string;
  };
  additionalSources?: ContextSourceInput[];
  systemInstructions?: string[];
  policyNotes?: string[];
  tokenBudget?: number;
}

export interface ContextAssemblerOptions {
  recentMessageLimit?: number;
  ttlSeconds?: {
    recentSessionMessage: number;
    runtimeNote: number;
    untrustedRetrievedContent: number;
    toolResult: number;
    summary: number;
    systemInstruction: number;
    riskPolicyAnnotation: number;
  };
}

export class ContextAssembler {
  private readonly options: Required<ContextAssemblerOptions>;

  constructor(
    private readonly store: SessionStore,
    options?: ContextAssemblerOptions
  ) {
    this.options = {
      recentMessageLimit: options?.recentMessageLimit ?? 20,
      ttlSeconds: {
        recentSessionMessage: options?.ttlSeconds?.recentSessionMessage ?? 24 * 60 * 60,
        runtimeNote: options?.ttlSeconds?.runtimeNote ?? 60 * 10,
        untrustedRetrievedContent: options?.ttlSeconds?.untrustedRetrievedContent ?? 60 * 20,
        toolResult: options?.ttlSeconds?.toolResult ?? 60 * 30,
        summary: options?.ttlSeconds?.summary ?? 24 * 60 * 60,
        systemInstruction: options?.ttlSeconds?.systemInstruction ?? 7 * 24 * 60 * 60,
        riskPolicyAnnotation: options?.ttlSeconds?.riskPolicyAnnotation ?? 60 * 60
      }
    };
  }

  async assembleForMessage(input: ContextAssemblyInput): Promise<AssembledContext> {
    const now = new Date();
    const { session, created } = await this.store.resolveOrCreateSession(input.sessionResolve);

    const previousMessages = await this.store.listSessionMessages({
      sessionId: session.sessionId,
      limit: this.options.recentMessageLimit
    });

    const candidates: ContextChunk[] = [];
    const traceEntries: MessageContextTrace["entries"] = [];

    for (const instruction of input.systemInstructions ?? []) {
      candidates.push(
        toContextChunk({
          source: {
            sourceType: "system-instruction",
            sourceId: "system:instruction",
            sourceRef: "system:instruction",
            content: instruction,
            contentCategory: "instruction",
            trustClassification: "CONTROL_TRUSTED",
            originatingService: "orchestrator-service",
            sticky: true,
            ttlSeconds: this.options.ttlSeconds.systemInstruction,
            sessionId: session.sessionId
          },
          session
        })
      );
    }

    candidates.push(
      toContextChunk({
        source: {
          sourceType: "session-metadata",
          sourceId: `session:${session.sessionId}`,
          sourceRef: `session:${session.sessionId}`,
          content: `Session ${session.sessionId} in ${session.isolationMode} mode for owner ${session.owner.principalId}.`,
          contentCategory: "metadata",
          trustClassification: "CONTROL_TRUSTED",
          originatingService: "orchestrator-service",
          sticky: true,
          ttlSeconds: this.options.ttlSeconds.systemInstruction,
          sessionId: session.sessionId,
          metadata: {
            created
          }
        },
        session
      })
    );

    for (const previous of previousMessages) {
      candidates.push(
        contextChunkSchema.parse({
          chunkId: `chunk:session-message:${previous.messageId}`,
          sessionId: previous.sessionId,
          tenantId: previous.tenantId,
          workspaceId: previous.workspaceId,
          content: previous.text,
          tokenEstimate: estimateTokens(previous.text),
          createdAt: previous.createdAt,
          expiresAt: new Date(
            new Date(previous.createdAt).getTime() + this.options.ttlSeconds.recentSessionMessage * 1000
          ).toISOString(),
          sticky: false,
          stale: false,
          provenance: contextProvenanceSchema.parse({
            sourceType: "session-message",
            sourceId: previous.messageId,
            sourceRef: previous.sourceRef,
            originatingPrincipal: previous.sender,
            observedAt: previous.createdAt,
            trustClassification: previous.trustClassification,
            tenantId: previous.tenantId,
            workspaceId: previous.workspaceId,
            sessionId: previous.sessionId,
            contentCategory: "user-input",
            transformation: {
              transformed: false,
              derivedFromChunkIds: [],
              derivedFromSourceRefs: []
            }
          }),
          metadata: {}
        })
      );
    }

    candidates.push(
      toContextChunk({
        source: {
          sourceType: "session-message",
          sourceId: input.message.messageId,
          sourceRef: input.message.sourceRef,
          content: input.message.text,
          contentCategory: "user-input",
          trustClassification: input.message.trustClassification,
          originatingPrincipal: input.message.sender,
          ...(input.message.createdAt ? { observedAt: input.message.createdAt } : {}),
          sessionId: session.sessionId,
          ttlSeconds: this.options.ttlSeconds.recentSessionMessage
        },
        session
      })
    );

    for (const policyNote of input.policyNotes ?? []) {
      candidates.push(
        toContextChunk({
          source: {
            sourceType: "policy-note",
            sourceId: "policy:note",
            sourceRef: "policy:note",
            content: policyNote,
            contentCategory: "policy-annotation",
            trustClassification: "CONTROL_TRUSTED",
            originatingService: "policy-service",
            ttlSeconds: this.options.ttlSeconds.riskPolicyAnnotation,
            sessionId: session.sessionId
          },
          session
        })
      );
    }

    for (const extra of input.additionalSources ?? []) {
      candidates.push(
        toContextChunk({
          source: {
            ...extra,
            ...(extra.ttlSeconds
              ? {}
              : {
                  ttlSeconds: defaultTtlBySourceType(extra.sourceType, this.options.ttlSeconds)
                })
          },
          session
        })
      );
    }

    const included: ContextChunk[] = [];
    const excludedChunkIds: string[] = [];
    let tokenUsed = 0;
    const tokenBudget = input.tokenBudget ?? 2048;
    const riskConstrained = session.riskProfile.level === "high" || session.riskProfile.level === "critical";
    let includedUntrustedCount = 0;

    const ordered = candidates.sort((a, b) => {
      if (a.sticky !== b.sticky) {
        return a.sticky ? -1 : 1;
      }
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    for (const chunk of ordered) {
      let outcome: MessageContextTrace["entries"][number] = {
        chunkId: chunk.chunkId,
        sourceRef: chunk.provenance.sourceRef,
        sourceType: chunk.provenance.sourceType,
        trustClassification: chunk.provenance.trustClassification,
        outcome: "included",
        reasonCode: "INCLUDED_METADATA"
      };

      if (chunk.sessionId !== session.sessionId) {
        outcome = { ...outcome, outcome: "excluded", reasonCode: "EXCLUDED_CROSS_SESSION" };
      } else if (chunk.tenantId !== session.tenantId) {
        outcome = { ...outcome, outcome: "excluded", reasonCode: "EXCLUDED_CROSS_TENANT" };
      } else if (chunk.workspaceId !== session.workspaceId) {
        outcome = { ...outcome, outcome: "excluded", reasonCode: "EXCLUDED_CROSS_WORKSPACE" };
      } else if (chunk.expiresAt && new Date(chunk.expiresAt).getTime() <= now.getTime()) {
        outcome = { ...outcome, outcome: "excluded", reasonCode: "EXCLUDED_TTL_EXPIRED" };
      } else if (chunk.stale) {
        outcome = { ...outcome, outcome: "excluded", reasonCode: "EXCLUDED_STALE" };
      } else if (
        riskConstrained &&
        chunk.provenance.trustClassification === "EXTERNAL_UNTRUSTED" &&
        includedUntrustedCount >= 1
      ) {
        outcome = { ...outcome, outcome: "excluded", reasonCode: "EXCLUDED_RISK_POLICY" };
      } else if (tokenUsed + chunk.tokenEstimate > tokenBudget) {
        outcome = { ...outcome, outcome: "excluded", reasonCode: "EXCLUDED_TOKEN_BUDGET" };
      } else {
        outcome = {
          ...outcome,
          outcome: chunk.provenance.transformation.transformed ? "transformed" : "included",
          reasonCode: deriveIncludeReason(chunk)
        };
        included.push(chunk);
        tokenUsed += chunk.tokenEstimate;
        if (chunk.provenance.trustClassification === "EXTERNAL_UNTRUSTED") {
          includedUntrustedCount += 1;
        }
      }

      if (outcome.outcome === "excluded") {
        excludedChunkIds.push(chunk.chunkId);
      }
      traceEntries.push(outcome);
    }

    const updatedRiskProfile = updateRiskProfile(session.riskProfile, included);
    const updatedSession = sessionEntitySchema.parse({
      ...session,
      riskProfile: updatedRiskProfile,
      lastActivityAt: now.toISOString(),
      lastActedBy: input.message.sender
    });
    await this.store.updateSession(updatedSession);
    await this.store.recordSessionActivity({
      sessionId: updatedSession.sessionId,
      actor: input.message.sender,
      timestamp: now.toISOString()
    });
    await this.store.recordMessage(
      sessionMessageSchema.parse({
        messageId: input.message.messageId,
        sessionId: updatedSession.sessionId,
        tenantId: updatedSession.tenantId,
        workspaceId: updatedSession.workspaceId,
        sender: input.message.sender,
        text: input.message.text,
        createdAt: input.message.createdAt ?? now.toISOString(),
        trustClassification: input.message.trustClassification,
        sourceRef: input.message.sourceRef
      })
    );

    const contextTrace = messageContextTraceSchema.parse({
      traceId: createContextTraceId(),
      messageId: input.message.messageId,
      sessionId: updatedSession.sessionId,
      tenantId: updatedSession.tenantId,
      workspaceId: updatedSession.workspaceId,
      resolvedBy: "context-assembler",
      resolvedAt: now.toISOString(),
      isolationMode: updatedSession.isolationMode,
      riskProfile: updatedSession.riskProfile,
      consideredSources: Array.from(new Set(candidates.map((candidate) => candidate.provenance.sourceType))),
      entries: traceEntries,
      includedChunkIds: included.map((chunk) => chunk.chunkId),
      excludedChunkIds,
      tokenBudget,
      tokenUsed,
      trace: input.trace
    });
    await this.store.recordContextTrace(contextTrace);

    return assembledContextSchema.parse({
      session: updatedSession,
      chunks: included,
      trace: contextTrace
    });
  }
}

function toContextChunk(input: { source: ContextSourceInput; session: SessionEntity }): ContextChunk {
  const observedAt = input.source.observedAt ?? new Date().toISOString();
  const enforcedTrust = enforceTrustClassification(input.source.sourceType, input.source.trustClassification);
  const expiresAt = input.source.ttlSeconds
    ? new Date(new Date(observedAt).getTime() + input.source.ttlSeconds * 1000).toISOString()
    : undefined;
  const provenance = contextProvenanceSchema.parse({
    sourceType: input.source.sourceType,
    sourceId: input.source.sourceId,
    sourceRef: input.source.sourceRef,
    ...(input.source.originatingPrincipal ? { originatingPrincipal: input.source.originatingPrincipal } : {}),
    ...(input.source.originatingService ? { originatingService: input.source.originatingService } : {}),
    observedAt,
    trustClassification: enforcedTrust,
    tenantId: input.source.tenantId ?? input.session.tenantId,
    workspaceId: input.source.workspaceId ?? input.session.workspaceId,
    sessionId: input.source.sessionId ?? input.session.sessionId,
    contentCategory: input.source.contentCategory,
    transformation: {
      transformed: input.source.transformation?.transformed ?? false,
      ...(input.source.transformation?.transformType
        ? { transformType: input.source.transformation.transformType }
        : {}),
      derivedFromChunkIds: input.source.transformation?.derivedFromChunkIds ?? [],
      derivedFromSourceRefs: input.source.transformation?.derivedFromSourceRefs ?? []
    }
  });

  return contextChunkSchema.parse({
    chunkId: `chunk:${input.source.sourceType}:${input.source.sourceId}:${randomUUID()}`,
    sessionId: input.source.sessionId ?? input.session.sessionId,
    tenantId: input.source.tenantId ?? input.session.tenantId,
    workspaceId: input.source.workspaceId ?? input.session.workspaceId,
    content: input.source.content,
    tokenEstimate: estimateTokens(input.source.content),
    createdAt: observedAt,
    ...(expiresAt ? { expiresAt } : {}),
    sticky: input.source.sticky ?? false,
    stale: false,
    provenance,
    metadata: input.source.metadata ?? {}
  });
}

function defaultTtlBySourceType(
  sourceType: ContextSourceType,
  ttl: Required<ContextAssemblerOptions>["ttlSeconds"]
): number {
  switch (sourceType) {
    case "session-message":
      return ttl.recentSessionMessage;
    case "retrieved-web-content":
    case "untrusted-external-upload":
      return ttl.untrustedRetrievedContent;
    case "tool-result":
      return ttl.toolResult;
    case "model-generated-summary":
      return ttl.summary;
    case "system-instruction":
      return ttl.systemInstruction;
    case "risk-annotation":
    case "policy-note":
      return ttl.riskPolicyAnnotation;
    default:
      return ttl.runtimeNote;
  }
}

function deriveIncludeReason(chunk: ContextChunk): MessageContextTrace["entries"][number]["reasonCode"] {
  switch (chunk.provenance.sourceType) {
    case "session-message":
      return "INCLUDED_RECENT_SESSION_MESSAGE";
    case "system-instruction":
      return "INCLUDED_SYSTEM_INSTRUCTION";
    case "tool-result":
      return "INCLUDED_TOOL_RESULT";
    case "policy-note":
      return "INCLUDED_POLICY_NOTE";
    default:
      if (chunk.provenance.transformation.transformed) {
        return "TRANSFORMED_SUMMARY";
      }
      return "INCLUDED_METADATA";
  }
}

function estimateTokens(content: string): number {
  return Math.max(1, Math.ceil(content.length / 4));
}

function defaultRiskProfile(): SessionRiskProfile {
  return {
    level: "low",
    factors: [],
    unsafeRequestCount: 0,
    untrustedContentRatio: 0,
    secretWorkflow: false,
    privilegedExecution: false,
    pluginInvolved: false,
    remoteNodeInvolved: false,
    approvalSensitive: false
  };
}

function updateRiskProfile(existing: SessionRiskProfile, included: ContextChunk[]): SessionRiskProfile {
  const untrustedCount = included.filter(
    (chunk) => chunk.provenance.trustClassification === "EXTERNAL_UNTRUSTED"
  ).length;
  const ratio = included.length === 0 ? existing.untrustedContentRatio : untrustedCount / included.length;
  const factors = new Set(existing.factors);
  if (ratio > 0.5) {
    factors.add("high_untrusted_ratio");
  }
  if (
    included.some(
      (chunk) =>
        chunk.provenance.originatingService?.includes("plugin") ||
        (chunk.provenance.sourceType === "tool-result" &&
          typeof chunk.metadata?.pluginId === "string" &&
          chunk.metadata.pluginId.length > 0)
    )
  ) {
    factors.add("plugin_content_seen");
  }
  const level = ratio > 0.7 ? "high" : ratio > 0.3 ? "medium" : existing.level;
  return sessionEntitySchema.shape.riskProfile.parse({
    ...existing,
    level,
    factors: Array.from(factors),
    untrustedContentRatio: ratio
  });
}

function computeResolutionKey(input: SessionResolveInput): string | undefined {
  switch (input.isolationMode) {
    case "per_user_isolated":
      return [
        input.tenantId,
        input.workspaceId,
        input.isolationMode,
        input.owner.principalId
      ].join("|");
    case "per_channel_thread":
      return [
        input.tenantId,
        input.workspaceId,
        input.isolationMode,
        input.channelBinding?.channelPrincipal.principalId ?? "none",
        input.channelBinding?.externalThreadId ??
          input.channelBinding?.externalConversationId ??
          input.resolutionHint ??
          "none"
      ].join("|");
    case "shared_collaborative": {
      const participants = [input.owner.principalId, ...(input.participants ?? []).map((p) => p.principalId)].sort();
      return [
        input.tenantId,
        input.workspaceId,
        input.isolationMode,
        participants.join(",")
      ].join("|");
    }
    case "service_internal":
      return [
        input.tenantId,
        input.workspaceId,
        input.isolationMode,
        input.createdBy.principalId,
        input.resolutionHint ?? "default"
      ].join("|");
    case "workspace_scoped_constrained":
      return [
        input.tenantId,
        input.workspaceId,
        input.isolationMode,
        input.resolutionHint ?? "workspace-default"
      ].join("|");
    case "ephemeral_one_shot":
      return undefined;
    default:
      return undefined;
  }
}

function enforceTrustClassification(sourceType: ContextSourceType, requested: TrustClass): TrustClass {
  if (sourceType === "retrieved-web-content" || sourceType === "untrusted-external-upload") {
    return "EXTERNAL_UNTRUSTED";
  }
  if (sourceType === "model-generated-summary" && requested === "CONTROL_TRUSTED") {
    return "MODEL_INTERMEDIATE";
  }
  return requested;
}
