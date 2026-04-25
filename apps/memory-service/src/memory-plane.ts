import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import {
  createMemoryRecordId,
  createMemoryReviewId,
  memoryContextCandidatesRequestSchema,
  memoryContextCandidatesResponseSchema,
  memoryPromotionReviewSchema,
  memoryQueryRequestSchema,
  memoryQueryResponseSchema,
  memoryRecordSchema,
  memoryWriteRequestSchema,
  type MemoryAuditEvent,
  type MemoryClass,
  type MemoryContextCandidatesRequest,
  type MemoryPromotionCandidateRequest,
  type MemoryPromotionReview,
  type MemoryQueryRequest,
  type MemoryRecord,
  type MemoryWriteRequest,
  type PolicyTrace,
  type PrincipalReference,
  type ResolvedPrincipalContext
} from "@manasvi/contracts";
import {
  assertPromotionCompatibility,
  assertWriteCompatibility,
  isSensitiveMemoryClass,
  parseTenantWorkspaceNamespace
} from "@manasvi/memory-sdk";

export class MemoryPlaneError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

interface StoredRecord {
  record: MemoryRecord;
  encryptedContent?: string;
  encryptionIv?: string;
  encryptionTag?: string;
}

export interface MemoryPlaneOptions {
  serviceName: string;
  encryptionKey: string;
  encryptionKeyRef: string;
  ttlByClass: Record<MemoryClass, number | undefined>;
}

function now(): string {
  return new Date().toISOString();
}

function computeExpiry(createdAtIso: string, ttlSeconds?: number): string | undefined {
  if (!ttlSeconds) {
    return undefined;
  }
  return new Date(new Date(createdAtIso).getTime() + ttlSeconds * 1000).toISOString();
}

function inferRetentionClass(memoryClass: MemoryClass): "short_lived" | "durable" | "bounded_cache" | "audit_aligned" {
  if (memoryClass === "EPHEMERAL_SESSION") {
    return "short_lived";
  }
  if (memoryClass === "UNTRUSTED_EXTERNAL") {
    return "bounded_cache";
  }
  if (memoryClass === "AUDIT_ACTION_HISTORY") {
    return "audit_aligned";
  }
  return "durable";
}

function deriveAesKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

function toContextSourceType(memoryClass: MemoryClass): "user-memory" | "shared-memory" | "retrieved-web-content" | "risk-annotation" {
  switch (memoryClass) {
    case "USER_DURABLE":
      return "user-memory";
    case "ORG_SHARED_TRUSTED":
      return "shared-memory";
    case "UNTRUSTED_EXTERNAL":
      return "retrieved-web-content";
    case "AUDIT_ACTION_HISTORY":
      return "risk-annotation";
    case "EPHEMERAL_SESSION":
    default:
      return "user-memory";
  }
}

function mustMatchTenantWorkspace(context: ResolvedPrincipalContext, tenantId: string, workspaceId: string): void {
  if (context.tenantId && context.tenantId !== tenantId) {
    throw new MemoryPlaneError("TENANT_SCOPE_VIOLATION", 403, "Tenant scope mismatch");
  }
  if (context.workspaceId && context.workspaceId !== workspaceId) {
    throw new MemoryPlaneError("WORKSPACE_SCOPE_VIOLATION", 403, "Workspace scope mismatch");
  }
}

export class InMemoryTrustClassifiedMemoryPlane {
  private readonly byId = new Map<string, StoredRecord>();
  private readonly reviews = new Map<string, MemoryPromotionReview>();
  private readonly auditEvents: MemoryAuditEvent[] = [];
  private readonly aesKey: Buffer;

  constructor(private readonly options: MemoryPlaneOptions) {
    this.aesKey = deriveAesKey(options.encryptionKey);
  }

  private encryptContent(content: MemoryRecord["content"]): {
    encryptedContent: string;
    encryptionIv: string;
    encryptionTag: string;
  } {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.aesKey, iv);
    const plaintext = Buffer.from(JSON.stringify(content), "utf8");
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      encryptedContent: encrypted.toString("base64"),
      encryptionIv: iv.toString("base64"),
      encryptionTag: tag.toString("base64")
    };
  }

  private decryptContent(stored: StoredRecord): MemoryRecord["content"] {
    if (!stored.encryptedContent || !stored.encryptionIv || !stored.encryptionTag) {
      return stored.record.content;
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.aesKey,
      Buffer.from(stored.encryptionIv, "base64")
    );
    decipher.setAuthTag(Buffer.from(stored.encryptionTag, "base64"));
    const encrypted = Buffer.from(stored.encryptedContent, "base64");
    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8")) as MemoryRecord["content"];
  }

  private toExposedRecord(stored: StoredRecord): MemoryRecord {
    return memoryRecordSchema.parse({
      ...stored.record,
      content: this.decryptContent(stored)
    });
  }

  private ensureNoSilentPromotion(input: MemoryWriteRequest): void {
    const durableTarget = input.memoryClass === "USER_DURABLE" || input.memoryClass === "ORG_SHARED_TRUSTED";
    const lineageUntrusted =
      input.provenance.originalTrustClassification === "EXTERNAL_UNTRUSTED" ||
      input.provenance.originalTrustClassification === "MODEL_INTERMEDIATE";
    if (
      durableTarget &&
      (input.trustClassification === "EXTERNAL_UNTRUSTED" ||
        input.trustClassification === "MODEL_INTERMEDIATE" ||
        (input.provenance.derivation.derived && lineageUntrusted))
    ) {
      throw new MemoryPlaneError(
        "SILENT_TRUST_PROMOTION_BLOCKED",
        422,
        "Untrusted or derived-untrusted content cannot be directly written into trusted durable memory"
      );
    }
  }

  private enforceClassSpecificRules(input: MemoryWriteRequest): void {
    const scoped = parseTenantWorkspaceNamespace(input.namespace);
    if (!scoped) {
      throw new MemoryPlaneError("NAMESPACE_SCOPE_MISSING", 422, "Namespace must include tenant/workspace scope");
    }
    if (scoped.tenantId !== input.tenantId || scoped.workspaceId !== input.workspaceId) {
      throw new MemoryPlaneError("NAMESPACE_SCOPE_MISMATCH", 422, "Namespace scope must match write tenant/workspace");
    }
    if (input.memoryClass === "USER_DURABLE") {
      if (!input.ownerPrincipal) {
        throw new MemoryPlaneError("OWNER_REQUIRED", 422, "USER_DURABLE memory requires ownerPrincipal");
      }
      if (!scoped.suffix.startsWith(`user/${input.ownerPrincipal.principalId}/`)) {
        throw new MemoryPlaneError("NAMESPACE_OWNER_MISMATCH", 422, "User namespace must match owner principal");
      }
    }
    if (input.memoryClass === "ORG_SHARED_TRUSTED" && !scoped.suffix.startsWith("shared/")) {
      throw new MemoryPlaneError(
        "NAMESPACE_WORKSPACE_MISMATCH",
        422,
        "Org shared namespace must use tenant/workspace scoped shared/* suffix"
      );
    }
  }

  private recordAudit(event: MemoryAuditEvent): void {
    this.auditEvents.unshift(event);
    if (this.auditEvents.length > 1000) {
      this.auditEvents.pop();
    }
  }

  private buildAuditEvent(input: {
    eventType: MemoryAuditEvent["eventType"];
    actor: PrincipalReference;
    caller: PrincipalReference;
    tenantId: string;
    workspaceId: string;
    namespace: string;
    trace: PolicyTrace;
    memoryClass?: MemoryClass;
    recordId?: string;
    policyDecisionId?: string | undefined;
    metadata?: Record<string, unknown>;
  }): MemoryAuditEvent {
    return {
      schemaVersion: "1.0",
      eventId: `memory-audit:${randomBytes(8).toString("hex")}`,
      eventType: input.eventType,
      ...(input.recordId ? { recordId: input.recordId } : {}),
      namespace: input.namespace,
      ...(input.memoryClass ? { memoryClass: input.memoryClass } : {}),
      actor: input.actor,
      caller: input.caller,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      ...(input.policyDecisionId !== undefined ? { policyDecisionId: input.policyDecisionId } : {}),
      timestamp: now(),
      trace: input.trace,
      metadata: input.metadata ?? {}
    };
  }

  pruneExpired(): { deletedRecordIds: string[] } {
    const deletedRecordIds: string[] = [];
    const current = Date.now();
    for (const [recordId, stored] of this.byId.entries()) {
      const expiresAt = stored.record.retention.expiresAt;
      if (!expiresAt) {
        continue;
      }
      if (new Date(expiresAt).getTime() > current) {
        continue;
      }
      if (!stored.record.retention.deleteAfterExpiry) {
        continue;
      }
      this.byId.delete(recordId);
      deletedRecordIds.push(recordId);
    }
    return { deletedRecordIds };
  }

  createRecord(input: {
    write: MemoryWriteRequest;
    principalContext: ResolvedPrincipalContext;
    policyDecisionId?: string | undefined;
  }): MemoryRecord {
    const parsed = memoryWriteRequestSchema.parse(input.write);
    mustMatchTenantWorkspace(input.principalContext, parsed.tenantId, parsed.workspaceId);
    assertWriteCompatibility(parsed);
    this.ensureNoSilentPromotion(parsed);
    this.enforceClassSpecificRules(parsed);

    const createdAt = now();
    const retentionTtl = parsed.retentionOverrideTtlSeconds ?? this.options.ttlByClass[parsed.memoryClass];
    const expiresAt = computeExpiry(createdAt, retentionTtl);
    const baseRecord = memoryRecordSchema.parse({
      schemaVersion: "1.0",
      contractVersion: "1.0.0",
      recordId: createMemoryRecordId(),
      memoryClass: parsed.memoryClass,
      namespace: parsed.namespace,
      tenantId: parsed.tenantId,
      workspaceId: parsed.workspaceId,
      ...(parsed.ownerPrincipal ? { ownerPrincipal: parsed.ownerPrincipal } : {}),
      ...(parsed.subjectPrincipal ? { subjectPrincipal: parsed.subjectPrincipal } : {}),
      trustClassification: parsed.trustClassification,
      contentType: parsed.contentType,
      content: parsed.content,
      tags: parsed.tags,
      provenance: parsed.provenance,
      createdAt,
      updatedAt: createdAt,
      createdByPrincipal: input.principalContext.actor,
      createdByService: this.options.serviceName,
      retention: {
        ...(retentionTtl ? { ttlSeconds: retentionTtl } : {}),
        ...(expiresAt ? { expiresAt } : {}),
        retentionClass: inferRetentionClass(parsed.memoryClass),
        deleteAfterExpiry: true
      },
      encryption: {
        encryptedAtRest: isSensitiveMemoryClass(parsed.memoryClass),
        ...(isSensitiveMemoryClass(parsed.memoryClass) ? { algorithm: "aes-256-gcm" } : {}),
        ...(isSensitiveMemoryClass(parsed.memoryClass) ? { keyRef: this.options.encryptionKeyRef } : {}),
        ...(isSensitiveMemoryClass(parsed.memoryClass) ? { encryptedAt: createdAt } : {})
      },
      promotion: {
        status: "not_applicable"
      },
      sourceReferences: parsed.sourceReferences,
      auditLinkage: {
        ...(parsed.provenance.linkedAuditRecordId
          ? { auditRecordId: parsed.provenance.linkedAuditRecordId }
          : {})
      }
    });
    const stored: StoredRecord = {
      record: baseRecord
    };
    if (isSensitiveMemoryClass(parsed.memoryClass)) {
      const encrypted = this.encryptContent(baseRecord.content);
      stored.encryptedContent = encrypted.encryptedContent;
      stored.encryptionIv = encrypted.encryptionIv;
      stored.encryptionTag = encrypted.encryptionTag;
      stored.record = {
        ...baseRecord,
        content: {
          data: {}
        }
      };
    }
    this.byId.set(baseRecord.recordId, stored);
    this.recordAudit(
      this.buildAuditEvent({
        eventType: "memory.created",
        actor: input.principalContext.actor,
        caller: input.principalContext.caller,
        tenantId: baseRecord.tenantId,
        workspaceId: baseRecord.workspaceId,
        namespace: baseRecord.namespace,
        memoryClass: baseRecord.memoryClass,
        recordId: baseRecord.recordId,
        trace: parsed.trace,
        policyDecisionId: input.policyDecisionId
      })
    );
    return this.toExposedRecord(stored);
  }

  getRecord(input: {
    recordId: string;
    principalContext: ResolvedPrincipalContext;
    trace: PolicyTrace;
    policyDecisionId?: string | undefined;
  }): MemoryRecord | undefined {
    const stored = this.byId.get(input.recordId);
    if (!stored) {
      return undefined;
    }
    mustMatchTenantWorkspace(input.principalContext, stored.record.tenantId, stored.record.workspaceId);
    const record = this.toExposedRecord(stored);
    this.recordAudit(
      this.buildAuditEvent({
        eventType: "memory.read",
        actor: input.principalContext.actor,
        caller: input.principalContext.caller,
        tenantId: record.tenantId,
        workspaceId: record.workspaceId,
        namespace: record.namespace,
        memoryClass: record.memoryClass,
        recordId: record.recordId,
        trace: input.trace,
        policyDecisionId: input.policyDecisionId
      })
    );
    return record;
  }

  queryRecords(input: {
    query: MemoryQueryRequest;
    principalContext: ResolvedPrincipalContext;
    policyDecisionId?: string | undefined;
  }) {
    const parsed = memoryQueryRequestSchema.parse(input.query);
    mustMatchTenantWorkspace(input.principalContext, parsed.tenantId, parsed.workspaceId);
    const records = Array.from(this.byId.values())
      .map((stored) => this.toExposedRecord(stored))
      .filter((record) => {
        if (record.tenantId !== parsed.tenantId || record.workspaceId !== parsed.workspaceId) {
          return false;
        }
        if (!parsed.includeExpired && record.retention.expiresAt) {
          if (new Date(record.retention.expiresAt).getTime() <= Date.now()) {
            return false;
          }
        }
        if (parsed.classes && !parsed.classes.includes(record.memoryClass)) {
          return false;
        }
        if (parsed.namespaces && !parsed.namespaces.some((namespace) => record.namespace.startsWith(namespace))) {
          return false;
        }
        if (parsed.ownerPrincipalId && record.ownerPrincipal?.principalId !== parsed.ownerPrincipalId) {
          return false;
        }
        if (parsed.subjectPrincipalId && record.subjectPrincipal?.principalId !== parsed.subjectPrincipalId) {
          return false;
        }
        if (parsed.trustClassFilter && !parsed.trustClassFilter.includes(record.trustClassification)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, parsed.limit);
    this.recordAudit(
      this.buildAuditEvent({
        eventType: "memory.queried",
        actor: input.principalContext.actor,
        caller: input.principalContext.caller,
        tenantId: parsed.tenantId,
        workspaceId: parsed.workspaceId,
        namespace: parsed.namespaces?.[0] ?? "query:multi",
        trace: parsed.trace,
        policyDecisionId: input.policyDecisionId,
        metadata: {
          resultCount: records.length
        }
      })
    );
    return memoryQueryResponseSchema.parse({
      schemaVersion: "1.0",
      records,
      trace: parsed.trace
    });
  }

  createPromotionCandidate(input: {
    request: MemoryPromotionCandidateRequest;
    principalContext: ResolvedPrincipalContext;
    policyDecisionId?: string | undefined;
  }): MemoryPromotionReview {
    const sourceStored = this.byId.get(input.request.recordId);
    if (!sourceStored) {
      throw new MemoryPlaneError("RECORD_NOT_FOUND", 404, `Record ${input.request.recordId} not found`);
    }
    const source = this.toExposedRecord(sourceStored);
    mustMatchTenantWorkspace(input.principalContext, source.tenantId, source.workspaceId);
    assertPromotionCompatibility({
      source,
      targetClass: input.request.targetClass,
      targetNamespace: input.request.targetNamespace
    });
    const review = memoryPromotionReviewSchema.parse({
      schemaVersion: "1.0",
      reviewId: createMemoryReviewId(),
      sourceRecordId: source.recordId,
      targetClass: input.request.targetClass,
      targetNamespace: input.request.targetNamespace,
      status: "pending",
      requestedBy: input.principalContext.actor,
      requestedAt: now(),
      trace: input.request.trace
    });
    this.reviews.set(review.reviewId, review);
    sourceStored.record = memoryRecordSchema.parse({
      ...sourceStored.record,
      promotion: {
        status: "pending_review",
        reviewId: review.reviewId
      },
      updatedAt: now()
    });
    this.recordAudit(
      this.buildAuditEvent({
        eventType: "memory.promotion_candidate_created",
        actor: input.principalContext.actor,
        caller: input.principalContext.caller,
        tenantId: source.tenantId,
        workspaceId: source.workspaceId,
        namespace: source.namespace,
        memoryClass: source.memoryClass,
        recordId: source.recordId,
        trace: input.request.trace,
        policyDecisionId: input.policyDecisionId,
        metadata: {
          reviewId: review.reviewId,
          targetClass: review.targetClass,
          targetNamespace: review.targetNamespace
        }
      })
    );
    return review;
  }

  reviewPromotion(input: {
    review: MemoryPromotionReview;
    principalContext: ResolvedPrincipalContext;
    policyDecisionId?: string | undefined;
  }): { review: MemoryPromotionReview; promotedRecord?: MemoryRecord } {
    const parsed = memoryPromotionReviewSchema.parse(input.review);
    const existing = this.reviews.get(parsed.reviewId);
    if (!existing) {
      throw new MemoryPlaneError("REVIEW_NOT_FOUND", 404, `Review ${parsed.reviewId} not found`);
    }
    const sourceStored = this.byId.get(parsed.sourceRecordId);
    if (!sourceStored) {
      throw new MemoryPlaneError("RECORD_NOT_FOUND", 404, `Source record ${parsed.sourceRecordId} not found`);
    }
    const source = this.toExposedRecord(sourceStored);
    mustMatchTenantWorkspace(input.principalContext, source.tenantId, source.workspaceId);
    if (existing.status !== "pending") {
      throw new MemoryPlaneError("REVIEW_ALREADY_DECIDED", 409, `Review ${existing.reviewId} already decided`);
    }
    const reviewed = memoryPromotionReviewSchema.parse({
      ...existing,
      status: parsed.status,
      reviewedBy: input.principalContext.actor,
      reviewedAt: now(),
      decisionReason: parsed.decisionReason
    });
    this.reviews.set(reviewed.reviewId, reviewed);
    if (reviewed.status === "rejected") {
      sourceStored.record = memoryRecordSchema.parse({
        ...sourceStored.record,
        promotion: {
          ...sourceStored.record.promotion,
          status: "rejected",
          reviewId: reviewed.reviewId
        },
        updatedAt: now()
      });
      this.recordAudit(
        this.buildAuditEvent({
          eventType: "memory.promotion_rejected",
          actor: input.principalContext.actor,
          caller: input.principalContext.caller,
          tenantId: source.tenantId,
          workspaceId: source.workspaceId,
          namespace: source.namespace,
          memoryClass: source.memoryClass,
          recordId: source.recordId,
          trace: reviewed.trace,
          policyDecisionId: input.policyDecisionId
        })
      );
      return { review: reviewed };
    }
    const promoted = this.createRecord({
      write: {
        schemaVersion: "1.0",
        memoryClass: reviewed.targetClass,
        namespace: reviewed.targetNamespace,
        tenantId: source.tenantId,
        workspaceId: source.workspaceId,
        ...(source.ownerPrincipal
          ? { ownerPrincipal: source.ownerPrincipal }
          : reviewed.targetClass === "USER_DURABLE"
            ? { ownerPrincipal: input.principalContext.actor }
            : {}),
        subjectPrincipal: source.subjectPrincipal,
        trustClassification:
          reviewed.targetClass === "ORG_SHARED_TRUSTED" ? "CONTROL_TRUSTED" : source.trustClassification,
        contentType: source.contentType,
        content: source.content,
        tags: [...source.tags, "promoted"],
        provenance: {
          ...source.provenance,
          originalMemoryClass: source.memoryClass,
          originalTrustClassification: source.trustClassification,
          derivation: {
            ...source.provenance.derivation,
            derived: true,
            derivationType: "promotion",
            derivedFromRecordIds: Array.from(
              new Set([...(source.provenance.derivation.derivedFromRecordIds ?? []), source.recordId])
            ),
            derivedFromSourceRefs: Array.from(
              new Set([...(source.provenance.derivation.derivedFromSourceRefs ?? []), source.provenance.sourceRef])
            )
          }
        },
        sourceReferences: Array.from(new Set([...source.sourceReferences, source.recordId])),
        trace: reviewed.trace
      },
      principalContext: input.principalContext,
      policyDecisionId: input.policyDecisionId
    });
    sourceStored.record = memoryRecordSchema.parse({
      ...sourceStored.record,
      promotion: {
        status: "promoted",
        reviewId: reviewed.reviewId,
        targetRecordId: promoted.recordId
      },
      updatedAt: now()
    });
    this.recordAudit(
      this.buildAuditEvent({
        eventType: "memory.promotion_approved",
        actor: input.principalContext.actor,
        caller: input.principalContext.caller,
        tenantId: promoted.tenantId,
        workspaceId: promoted.workspaceId,
        namespace: promoted.namespace,
        memoryClass: promoted.memoryClass,
        recordId: promoted.recordId,
        trace: reviewed.trace,
        policyDecisionId: input.policyDecisionId,
        metadata: {
          sourceRecordId: source.recordId,
          reviewId: reviewed.reviewId
        }
      })
    );
    return { review: reviewed, promotedRecord: promoted };
  }

  contextCandidates(input: {
    request: MemoryContextCandidatesRequest;
    principalContext: ResolvedPrincipalContext;
    policyDecisionId?: string | undefined;
  }) {
    const parsed = memoryContextCandidatesRequestSchema.parse(input.request);
    mustMatchTenantWorkspace(input.principalContext, parsed.tenantId, parsed.workspaceId);
    const ownerNamespacePrefix = `tenant/${parsed.tenantId}/workspace/${parsed.workspaceId}/user/${parsed.actorPrincipal.principalId}/`;
    const sessionNamespacePrefix = parsed.sessionId
      ? `tenant/${parsed.tenantId}/workspace/${parsed.workspaceId}/session/${parsed.sessionId}`
      : undefined;
    const records = Array.from(this.byId.values())
      .map((stored) => this.toExposedRecord(stored))
      .filter((record) => {
        if (record.tenantId !== parsed.tenantId || record.workspaceId !== parsed.workspaceId) {
          return false;
        }
        if (record.retention.expiresAt && new Date(record.retention.expiresAt).getTime() <= Date.now()) {
          return false;
        }
        if (record.memoryClass === "USER_DURABLE" && !record.namespace.startsWith(ownerNamespacePrefix)) {
          return false;
        }
        if (record.memoryClass === "EPHEMERAL_SESSION" && sessionNamespacePrefix) {
          return record.namespace.startsWith(sessionNamespacePrefix);
        }
        return true;
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    const classCounts = new Map<MemoryClass, number>();
    const filtered = records.filter((record) => {
      const current = classCounts.get(record.memoryClass) ?? 0;
      if (current >= parsed.maxPerClass) {
        return false;
      }
      classCounts.set(record.memoryClass, current + 1);
      return true;
    });
    const response = memoryContextCandidatesResponseSchema.parse({
      schemaVersion: "1.0",
      records: filtered.map((record) => ({
        recordId: record.recordId,
        memoryClass: record.memoryClass,
        namespace: record.namespace,
        trustClassification: record.trustClassification,
        contentType: record.contentType,
        content: record.content,
        provenance: record.provenance,
        sourceRef: `memory:${record.recordId}`
      })),
      trace: parsed.trace
    });
    this.recordAudit(
      this.buildAuditEvent({
        eventType: "memory.queried",
        actor: input.principalContext.actor,
        caller: input.principalContext.caller,
        tenantId: parsed.tenantId,
        workspaceId: parsed.workspaceId,
        namespace: parsed.sessionId ? sessionNamespacePrefix ?? "context-candidates" : "context-candidates",
        trace: parsed.trace,
        policyDecisionId: input.policyDecisionId,
        metadata: {
          resultCount: response.records.length
        }
      })
    );
    return response;
  }

  getAuditEvents(limit = 100): MemoryAuditEvent[] {
    return this.auditEvents.slice(0, limit);
  }
}
